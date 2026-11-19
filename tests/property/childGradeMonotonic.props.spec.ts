/**
 * 过滤单调性与调高再纳入属性测试（fast-check，≥100 次迭代）
 *
 * 实现 tasks.md 3.6，对应 .kiro/specs/child-grade-setting/design.md Property 5。
 *
 * 被测实现：src/engine/reviewEngine.ts buildTodayQueue 的可选 childGrade 过滤参数。
 *
 * 输入域与 3.2（childGradeQueue.props.spec.ts，Property 1）相同：
 * - kpId 按 {cn|math|en}.g{N}.{后缀} 契约形态生成（N ∈ 1-6），并混入少量畸形
 *   kpId（缺年级段、N 越界、无前缀）覆盖 fail-closed 分支；
 * - 按种子契约使题目 grade、生成器 grade 与 kpId 年级段一致；
 * - 任意 Mastery_Record 集合（混合已掌握/到点/未到点）、任意 now。
 *
 * 会话上限约定（重要）：本属性断言"知识点集合"的子集关系与调高再纳入。
 * 当会话上限截断生效时该关系按设计不成立——上限相同的前提下，调高年级会让
 * 更多候选进入同一按 nextReviewAt 升序的复习序列，可能把原本能进队列的低年级
 * 项挤出上限之外（这是上限规则的预期行为，由 Property 2 单独覆盖）。因此本
 * 属性将会话上限生成为不小于候选总数（复习段候选 ≤ 记录数、新知识点段候选
 * ≤ 题数 + 生成器数），即保证不截断，使断言聚焦过滤单调性本身
 * （Requirement 2.10：调高后原被排除的到点知识点重新成为复习段候选）。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildTodayQueue } from '@/engine/reviewEngine';
import { kpIdGrade } from '@/engine/kpId';
import {
  buildQuestionIndex,
  isQueueEligible,
  type QuestionIndex,
} from '@/data/questionBank';
import {
  PHASE2_QUESTION_TYPES,
  type GeneratorParams,
  type IntervalLevel,
  type MasteryRecord,
  type QueueItem,
  type Question,
  type QuestionType,
  type SessionConfig,
  type Subject,
} from '@/types';

// ============ 基础生成器 ============

const MAX_TS = 1_000_000_000_000; // 任意时间戳上限（留出间隔余量）

/** 任意 now 时间戳 */
const nowArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_TS });

/** 非空白短字符串 */
const nonEmptyString = (maxLength = 16): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength }).filter((s) => s.trim().length > 0);

/** kpId 后缀段：纯小写字母（不含数字，保证畸形形态不会意外拼出合法年级段） */
const alphaSegArb = fc.stringMatching(/^[a-z]{2,8}$/);

/** kpId 后缀：1-2 个字母段，如 `zi` / `add.within100` 之形 */
const suffixArb: fc.Arbitrary<string> = fc
  .array(alphaSegArb, { minLength: 1, maxLength: 2 })
  .map((segs) => segs.join('.'));

// ============ kpId 生成（契约形态 + 畸形混入） ============

/** 学科前缀 → 学科 */
const PREFIX_SUBJECT: Record<string, Subject> = {
  cn: 'chinese',
  math: 'math',
  en: 'english',
};

/** 契约形态知识点：kpId = {cn|math|en}.g{N}.{后缀}，N ∈ 1-6 */
interface WellFormedKp {
  kpId: string;
  subject: Subject;
  /** 与 kpId 年级段一致（种子契约） */
  grade: number;
}

const wellFormedKpArb: fc.Arbitrary<WellFormedKp> = fc
  .tuple(fc.constantFrom('cn', 'math', 'en'), fc.integer({ min: 1, max: 6 }), suffixArb)
  .map(([prefix, grade, suffix]) => ({
    kpId: `${prefix}.g${grade}.${suffix}`,
    subject: PREFIX_SUBJECT[prefix] as Subject,
    grade,
  }));

/**
 * 畸形 kpId（kpIdGrade 恒返回 null），覆盖三类形态：
 * - 缺年级段：第二段不是 g{N}，如 `cn.zi.abc`
 * - N 越界：g0 / g7-g12，如 `math.g7.add`
 * - 无前缀：年级段在首位（`g3.zi`）、纯后缀（`zi.abc`）、数字段充当年级位（`zi.001`）
 */
const malformedKpIdArb: fc.Arbitrary<string> = fc.oneof(
  // 缺年级段
  fc
    .tuple(fc.constantFrom('cn', 'math', 'en'), suffixArb)
    .map(([prefix, suffix]) => `${prefix}.${suffix}`),
  // N 越界
  fc
    .tuple(
      fc.constantFrom('cn', 'math', 'en'),
      fc.constantFrom(0, 7, 8, 9, 10, 11, 12),
      suffixArb,
    )
    .map(([prefix, n, suffix]) => `${prefix}.g${n}.${suffix}`),
  // 无前缀：年级段在首位（kpIdGrade 只看第二段，故不可解析）
  fc
    .tuple(fc.integer({ min: 1, max: 6 }), suffixArb)
    .map(([n, suffix]) => `g${n}.${suffix}`),
  // 无前缀：纯后缀
  suffixArb,
  // 无前缀：数字段充当年级位（缺 g 前缀）
  fc
    .tuple(alphaSegArb, fc.integer({ min: 0, max: 999 }))
    .map(([seg, n]) => `${seg}.${n}`),
);

/** 知识点池：契约形态 kpId 1-12 个（按 kpId 去重） */
const kpPoolArb: fc.Arbitrary<WellFormedKp[]> = fc.uniqueArray(wellFormedKpArb, {
  selector: (k) => k.kpId,
  minLength: 1,
  maxLength: 12,
});

/** 畸形 kpId 1-3 个（保证每次迭代都覆盖 fail-closed 分支） */
const malformedKpIdsArb: fc.Arbitrary<string[]> = fc.uniqueArray(malformedKpIdArb, {
  minLength: 1,
  maxLength: 3,
});

// ============ 题目 / 生成器 / 掌握度记录生成器 ============

/** 全部题型枚举（含二期预留 reading/word_problem/read_aloud） */
const ALL_QUESTION_TYPES: readonly QuestionType[] = [
  'dictation',
  'pinyin',
  'similar_char',
  'polyphone',
  'word_match',
  'idiom_fill',
  'poem_chain',
  'reading',
  'oral',
  'blank',
  'judge',
  'choice',
  'unit_conv',
  'geometry',
  'word_problem',
  'word_card',
  'read_aloud',
];

/** 一期可入队题型（phase=1 且非二期题型） */
const QUEUE_SAFE_TYPES: readonly QuestionType[] = ALL_QUESTION_TYPES.filter(
  (t) => !PHASE2_QUESTION_TYPES.includes(t),
);

/**
 * 契约形态知识点的题目：subject/grade/knowledgePointId 与 kpId 一致（种子契约），
 * 题型覆盖全部枚举、phase 任意 1/2（含永不可入队的 deferred 题）。
 */
const questionForKpArb = (kp: WellFormedKp): fc.Arbitrary<Question> =>
  fc.record({
    id: nonEmptyString(10),
    subject: fc.constant(kp.subject),
    grade: fc.constant(kp.grade),
    volume: fc.constantFrom('A', 'B') as fc.Arbitrary<Question['volume']>,
    unit: nonEmptyString(6),
    type: fc.constantFrom(...ALL_QUESTION_TYPES),
    knowledgePointId: fc.constant(kp.kpId),
    difficulty: fc.integer({ min: 1, max: 5 }) as fc.Arbitrary<Question['difficulty']>,
    stem: nonEmptyString(20),
    answer: fc.constant({ choice: ['a'] }),
    hint: nonEmptyString(10),
    analysis: nonEmptyString(20),
    phase: fc.constantFrom(1, 2) as fc.Arbitrary<1 | 2>,
  });

/**
 * 畸形 kpId 的题目：恒为 queue-eligible（phase=1 一期题型），subject/grade 任意
 * （契约破坏数据）。这些知识点必有 Mastery_Record（见 recordsArb），因此题目
 * 不可能经新知识点段入队；过滤队列中由 fail-closed 排除，未过滤队列中可出现。
 */
const malformedQuestionArb = (knowledgePointId: string): fc.Arbitrary<Question> =>
  fc.record({
    id: nonEmptyString(10),
    subject: fc.constantFrom('chinese', 'math', 'english') as fc.Arbitrary<Subject>,
    grade: fc.integer({ min: 1, max: 6 }),
    volume: fc.constantFrom('A', 'B') as fc.Arbitrary<Question['volume']>,
    unit: nonEmptyString(6),
    type: fc.constantFrom(...QUEUE_SAFE_TYPES),
    knowledgePointId: fc.constant(knowledgePointId),
    difficulty: fc.integer({ min: 1, max: 5 }) as fc.Arbitrary<Question['difficulty']>,
    stem: nonEmptyString(20),
    answer: fc.constant({ choice: ['a'] }),
    hint: nonEmptyString(10),
    analysis: nonEmptyString(20),
    phase: fc.constant(1 as const),
  });

/** 题目列表：每个契约知识点 0-3 题、每个畸形 kpId 0-2 题，id 追加序号保证唯一 */
const questionsArb = (
  pool: readonly WellFormedKp[],
  malformed: readonly string[],
): fc.Arbitrary<Question[]> => {
  const lists = [
    ...pool.map((kp) => fc.array(questionForKpArb(kp), { maxLength: 3 })),
    ...malformed.map((id) => fc.array(malformedQuestionArb(id), { maxLength: 2 })),
  ];
  return fc
    .tuple(...lists)
    .map((qs) => qs.flat().map((q, i) => ({ ...q, id: `${q.id}#${i}` })));
};

/**
 * 口算生成器：仅数学知识点（与种子一致），grade 与 kpId 年级段一致。
 * 畸形 kpId 不挂生成器（畸形知识点已 record-backed，生成器无从入队）。
 */
const generatorsArb = (
  pool: readonly WellFormedKp[],
): fc.Arbitrary<GeneratorParams[]> => {
  const mathKps = pool.filter((k) => k.subject === 'math');
  if (mathKps.length === 0) {
    return fc.constant([]);
  }
  return fc
    .array(fc.constantFrom(...mathKps), { maxLength: Math.min(4, mathKps.length) })
    .map((picked) =>
      [...new Set(picked.map((k) => k.kpId))].map((kpId, i): GeneratorParams => {
        const kp = mathKps.find((k) => k.kpId === kpId) as WellFormedKp;
        return {
          id: `gen-${i}-${kpId}`,
          knowledgePointId: kp.kpId,
          grade: kp.grade,
          difficulty: 2,
          template: '{a} + {b} = ?',
          operands: {
            a: { min: 1, max: 100, integer: true },
            b: { min: 1, max: 100, integer: true },
          },
          operation: 'add',
          answerFormat: 'number',
        };
      }),
    );
};

/**
 * 任意单条掌握度记录：混合三种形态——
 * - 已掌握（mastered=true, nextReviewAt=null）
 * - 未掌握且 nextReviewAt 任意（相对 now 可能到点/未到点/恰等于 now）
 */
const masteryRecordArb = (knowledgePointId: string): fc.Arbitrary<MasteryRecord> =>
  fc
    .record({
      knowledgePointId: fc.constant(knowledgePointId),
      level: fc.constantFrom(1, 2, 3, 4, 5) as fc.Arbitrary<IntervalLevel>,
      totalCorrect: fc.nat(1_000_000),
      totalWrong: fc.nat(1_000_000),
      mastered: fc.boolean(),
      nextReviewAtRaw: nowArb,
      lastAnswerAt: nowArb,
    })
    .map(({ nextReviewAtRaw, ...base }) => ({
      ...base,
      nextReviewAt: base.mastered ? null : nextReviewAtRaw,
    }));

/**
 * 任意掌握度记录集合：
 * - 契约知识点池的随机子集（覆盖有/无记录两种情形）；
 * - 全部畸形 kpId 恒有记录（record-backed：新知识点段永不枚举到它们，
 *   过滤队列由 fail-closed 排除）；
 * - 少量池外 id（契约形态与畸形混合，覆盖"有记录但题库无题"——
 *   即"无可用题/生成器"的调高再纳入反面分支）。
 */
const recordsArb = (
  pool: readonly WellFormedKp[],
  malformed: readonly string[],
): fc.Arbitrary<Record<string, MasteryRecord>> => {
  const inPoolIds = fc
    .array(fc.constantFrom(...pool), { maxLength: pool.length })
    .map((picked) => [...new Set(picked.map((k) => k.kpId))]);
  const extraWellFormed = fc
    .array(wellFormedKpArb, { maxLength: 2 })
    .map((ks) => ks.map((k) => k.kpId));
  const extraMalformed = fc.array(malformedKpIdArb, { maxLength: 2 });
  return fc
    .tuple(inPoolIds, extraWellFormed, extraMalformed)
    .chain(([inPool, extra, extraMal]) => {
      const ids = [...new Set([...inPool, ...malformed, ...extra, ...extraMal])];
      return fc
        .tuple(...ids.map((id) => masteryRecordArb(id)))
        .map((recs) => {
          const map: Record<string, MasteryRecord> = {};
          for (const rec of recs) {
            map[rec.knowledgePointId] = rec;
          }
          return map;
        });
    });
};

/** 任意两个年级 gLow ≤ gHigh（含相等情形：子集退化为相等、再纳入区间为空） */
const gradePairArb: fc.Arbitrary<readonly [number, number]> = fc
  .tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 6 }))
  .map(([a, b]) => (a <= b ? ([a, b] as const) : ([b, a] as const)));

/**
 * 不截断的会话配置：上限不小于候选总数（复习段候选 ≤ 记录数；
 * 新知识点段候选 ≤ 题数 + 生成器数），保证任何过滤级别下都不发生截断，
 * 使子集与再纳入断言聚焦过滤单调性（截断行为由 Property 2 覆盖）。
 */
const uncappedConfigArb = (candidateBound: number): fc.Arbitrary<SessionConfig> =>
  fc.record({
    groupSize: fc.constant(3 as const),
    levelTargetMs: fc.constant(10 * 60 * 1000),
    maxNewPerSession: fc.integer({ min: candidateBound, max: candidateBound + 50 }),
    maxReviewPerSession: fc.integer({ min: candidateBound, max: candidateBound + 50 }),
  });

/** 组合场景：知识点池 + 畸形 kpId + 题库索引 + 生成器 + 记录集合 + now + 不截断配置 + gLow ≤ gHigh */
const scenarioArb = fc
  .tuple(kpPoolArb, malformedKpIdsArb)
  .chain(([pool, malformed]) =>
    fc
      .tuple(
        questionsArb(pool, malformed),
        generatorsArb(pool),
        recordsArb(pool, malformed),
        nowArb,
        gradePairArb,
      )
      .chain(([questions, generators, records, now, [gLow, gHigh]]) => {
        const candidateBound =
          questions.length + generators.length + Object.keys(records).length;
        return uncappedConfigArb(candidateBound).map((config) => ({
          bank: buildQuestionIndex(questions),
          generators,
          records,
          now,
          config,
          gLow,
          gHigh,
        }));
      }),
  );

const RUNS = { numRuns: 100 };

// ============ 断言辅助 ============

/** 队列的知识点集合 */
const kpSetOf = (queue: readonly QueueItem[]): Set<string> =>
  new Set(queue.map((i) => i.knowledgePointId));

/**
 * 知识点在某 childGrade 下是否有可用题/生成器——
 * 与 buildTodayQueue 内部 pickItemForKnowledgePoint 的可用性判定同口径：
 * 该知识点存在可入队题（isQueueEligible 且 q.grade ≤ childGrade），
 * 或存在生成器（g.grade ≤ childGrade）。
 */
const hasAvailableItem = (
  knowledgePointId: string,
  bank: QuestionIndex,
  generators: readonly GeneratorParams[],
  childGrade: number,
): boolean => {
  const questions = bank.byKnowledgePoint.get(knowledgePointId);
  const hasQuestion =
    questions !== undefined &&
    questions.some((q) => isQueueEligible(q) && q.grade <= childGrade);
  const hasGenerator = generators.some(
    (g) => g.knowledgePointId === knowledgePointId && g.grade <= childGrade,
  );
  return hasQuestion || hasGenerator;
};

// ============ 属性测试 ============

describe('childGrade 过滤单调性与调高再纳入属性测试', () => {
  /**
   * **Feature: child-grade-setting, Property 5: 过滤单调性与调高再纳入**
   *
   * *For any* 与 Property 1 相同的输入域与任意两个年级 gLow ≤ gHigh：
   * (a) 以 childGrade=gLow 生成的队列知识点集合是以 childGrade=gHigh 生成的
   *     子集，后者又是未过滤（childGrade=null，即既有五参调用）队列的子集；
   * (b) *for any* 年级高于 gLow 而不高于 gHigh 的到点未掌握知识点，它在
   *     gLow 队列中缺席，而在 gHigh 队列中（有可用题/生成器时）出现于复习段。
   *
   * 会话上限生成为不小于候选总数（不截断）：截断时子集关系按设计不成立
   * （上限相同时调高年级会让更多候选挤占同一上限），上限规则由 Property 2 覆盖。
   *
   * **Validates: Requirements 2.10**
   */
  it('Property 5: gLow 队列 ⊆ gHigh 队列 ⊆ 未过滤队列，调高后到点知识点再纳入复习段', () => {
    fc.assert(
      fc.property(
        scenarioArb,
        ({ bank, generators, records, now, config, gLow, gHigh }) => {
          const queueLow = buildTodayQueue(
            records,
            bank,
            now,
            config,
            generators,
            gLow,
          );
          const queueHigh = buildTodayQueue(
            records,
            bank,
            now,
            config,
            generators,
            gHigh,
          );
          // 未过滤：既有五参调用（Property 4 已证与显式 null 深相等）
          const queueUnfiltered = buildTodayQueue(records, bank, now, config, generators);

          const lowSet = kpSetOf(queueLow);
          const highSet = kpSetOf(queueHigh);
          const unfilteredSet = kpSetOf(queueUnfiltered);

          // (a) 单调性：gLow 队列知识点集合 ⊆ gHigh 队列 ⊆ 未过滤队列
          for (const kpId of lowSet) {
            expect(
              highSet.has(kpId),
              `gLow=${gLow} 队列知识点 ${kpId} 必须包含于 gHigh=${gHigh} 队列`,
            ).toBe(true);
          }
          for (const kpId of highSet) {
            expect(
              unfilteredSet.has(kpId),
              `gHigh=${gHigh} 队列知识点 ${kpId} 必须包含于未过滤队列`,
            ).toBe(true);
          }

          // (b) 调高再纳入：年级 ∈ (gLow, gHigh] 的到点未掌握知识点
          const highReviewKpIds = kpSetOf(
            queueHigh.filter((i) => i.source === 'review'),
          );
          for (const rec of Object.values(records)) {
            const due =
              !rec.mastered && rec.nextReviewAt !== null && rec.nextReviewAt <= now;
            if (!due) {
              continue;
            }
            const g = kpIdGrade(rec.knowledgePointId);
            if (g === null || g <= gLow || g > gHigh) {
              continue;
            }
            // 在 gLow 队列中缺席（复习段被年级谓词排除；有记录故不入新知识点段）
            expect(
              lowSet.has(rec.knowledgePointId),
              `到点知识点 ${rec.knowledgePointId}（年级 ${g} > gLow=${gLow}）应缺席 gLow 队列`,
            ).toBe(false);
            // 有可用题/生成器时，在 gHigh 队列中出现于复习段
            if (hasAvailableItem(rec.knowledgePointId, bank, generators, gHigh)) {
              expect(
                highReviewKpIds.has(rec.knowledgePointId),
                `到点知识点 ${rec.knowledgePointId}（年级 ${g} ≤ gHigh=${gHigh}，有可用题/生成器）应出现于 gHigh 队列复习段`,
              ).toBe(true);
            }
          }
        },
      ),
      RUNS,
    );
  });
});
