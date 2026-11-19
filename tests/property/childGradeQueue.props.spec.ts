/**
 * 按孩子年级过滤的队列纯净属性测试（fast-check，≥100 次迭代）
 *
 * 实现 tasks.md 3.2，对应 .kiro/specs/child-grade-setting/design.md Property 1。
 *
 * 被测实现：src/engine/reviewEngine.ts buildTodayQueue 的可选 childGrade 过滤参数。
 *
 * 生成器约定（design.md「Correctness Properties」）：
 * - kpId 按 {cn|math|en}.g{N}.{后缀} 形态生成（N ∈ 1-6）；
 * - 按种子契约使题目 grade、生成器 grade 与 kpId 年级段一致；
 * - 混入少量畸形 kpId（缺年级段、N 越界、无前缀）覆盖 fail-closed 分支——
 *   畸形 kpId 的题目一律为 queue-eligible（phase=1 一期题型）且知识点必有
 *   Mastery_Record（record-backed），因此它们只能经复习段 fail-closed 被排除，
 *   绝不会因 q.grade ≤ childGrade 从新知识点段混入队列。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildTodayQueue } from '@/engine/reviewEngine';
import { kpIdGrade } from '@/engine/kpId';
import { buildQuestionIndex } from '@/data/questionBank';
import {
  PHASE2_QUESTION_TYPES,
  type GeneratorParams,
  type IntervalLevel,
  type MasteryRecord,
  type Question,
  type QuestionType,
  type SessionConfig,
  type Subject,
} from '@/types';

// ============ 基础生成器 ============

const MAX_TS = 1_000_000_000_000; // 任意时间戳上限（留出间隔余量）

/** 任意 now 时间戳 */
const nowArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_TS });

/** 任意 childGrade（1-6 整数，本属性固定已设置） */
const childGradeArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 6 });

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
 * 不可能经新知识点段入队；复习段则由 fail-closed 排除。
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
 *   复习段由 fail-closed 排除）；
 * - 少量池外 id（契约形态与畸形混合，覆盖"有记录但题库无题"）。
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

/** 任意会话配置（上限取非负整数；groupSize/levelTargetMs 为设计常量） */
const configArb: fc.Arbitrary<SessionConfig> = fc.record({
  groupSize: fc.constant(3 as const),
  levelTargetMs: fc.constant(10 * 60 * 1000),
  maxNewPerSession: fc.integer({ min: 0, max: 50 }),
  maxReviewPerSession: fc.integer({ min: 0, max: 50 }),
});

/** 组合场景：知识点池 + 畸形 kpId + 题库索引 + 生成器 + 记录集合 + now + 配置 + childGrade */
const scenarioArb = fc
  .tuple(kpPoolArb, malformedKpIdsArb)
  .chain(([pool, malformed]) =>
    fc
      .tuple(
        questionsArb(pool, malformed),
        generatorsArb(pool),
        recordsArb(pool, malformed),
        nowArb,
        configArb,
        childGradeArb,
      )
      .map(([questions, generators, records, now, config, childGrade]) => ({
        bank: buildQuestionIndex(questions),
        generators,
        records,
        now,
        config,
        childGrade,
      })),
  );

const RUNS = { numRuns: 100 };

// ============ 属性测试 ============

describe('按孩子年级过滤的队列纯净属性测试', () => {
  /**
   * **Feature: child-grade-setting, Property 1: 按孩子年级过滤的队列纯净**
   *
   * *For any* Mastery_Record 集合、题库索引、口算生成器集合、时间 now、会话配置
   * 与任意 childGrade ∈ 1-6，buildTodayQueue(records, bank, now, config,
   * generators, childGrade) 的输出队列应满足：每个 kind='bank' 队列项对应题目的
   * grade ≤ childGrade；每个 kind='generated' 队列项对应生成器参数的
   * grade ≤ childGrade；每个队列项的 kpIdGrade(knowledgePointId) 可解析且
   * ≤ childGrade；且任何年级超限（或年级段不可解析）的到点复习知识点不出现在
   * 复习段，任何年级超限的可入队题/生成器知识点不出现在新知识点段。
   *
   * **Validates: Requirements 2.1, 2.2, 2.3**
   */
  it('Property 1: 队列项三个年级来源均 ≤ childGrade，超限/不可解析知识点不入队', () => {
    fc.assert(
      fc.property(
        scenarioArb,
        ({ bank, generators, records, now, config, childGrade }) => {
          const queue = buildTodayQueue(
            records,
            bank,
            now,
            config,
            generators,
            childGrade,
          );
          const generatorById = new Map(generators.map((g) => [g.id, g]));

          // (a) 队列纯净：每个队列项三个年级来源（题目 grade / 生成器 grade /
          //     kpId 年级段）均可判定且 ≤ childGrade
          for (const item of queue) {
            if (item.kind === 'bank') {
              const q = bank.byId.get(item.questionId as string);
              expect(q, `队列项题目 ${item.questionId} 必须存在于题库`).toBeDefined();
              if (q) {
                expect(
                  q.grade,
                  `bank 队列项题目 ${q.id} 年级 ${q.grade} 必须 ≤ childGrade=${childGrade}`,
                ).toBeLessThanOrEqual(childGrade);
              }
            } else {
              const gen = generatorById.get(item.generatorParamsId as string);
              expect(
                gen,
                `队列项生成器 ${item.generatorParamsId} 必须存在`,
              ).toBeDefined();
              if (gen) {
                expect(
                  gen.grade,
                  `generated 队列项生成器 ${gen.id} 年级 ${gen.grade} 必须 ≤ childGrade=${childGrade}`,
                ).toBeLessThanOrEqual(childGrade);
              }
            }
            const g = kpIdGrade(item.knowledgePointId);
            expect(
              g,
              `队列项知识点 ${item.knowledgePointId} 的年级段必须可解析`,
            ).not.toBeNull();
            expect(
              g as number,
              `队列项知识点 ${item.knowledgePointId} 年级段 ${g} 必须 ≤ childGrade=${childGrade}`,
            ).toBeLessThanOrEqual(childGrade);
          }

          // (b) 复习段排除：年级超限或年级段不可解析的到点复习知识点
          //     不出现在复习段
          const reviewKpIds = new Set(
            queue.filter((i) => i.source === 'review').map((i) => i.knowledgePointId),
          );
          for (const rec of Object.values(records)) {
            const due =
              !rec.mastered && rec.nextReviewAt !== null && rec.nextReviewAt <= now;
            if (!due) {
              continue;
            }
            const g = kpIdGrade(rec.knowledgePointId);
            if (g === null || g > childGrade) {
              expect(
                reviewKpIds.has(rec.knowledgePointId),
                `到点复习知识点 ${rec.knowledgePointId}（年级段 ${
                  g === null ? '不可解析' : g
                }）不应出现在复习段（childGrade=${childGrade}）`,
              ).toBe(false);
            }
          }

          // (c) 新知识点段排除：年级超限的可入队题/生成器知识点
          //     不出现在新知识点段
          const newKpIds = new Set(
            queue.filter((i) => i.source === 'new').map((i) => i.knowledgePointId),
          );
          for (const q of bank.queueEligible) {
            if (q.grade > childGrade && !(q.knowledgePointId in records)) {
              expect(
                newKpIds.has(q.knowledgePointId),
                `年级超限（${q.grade} > ${childGrade}）的可入队题知识点 ${q.knowledgePointId} 不应出现在新知识点段`,
              ).toBe(false);
            }
          }
          for (const gen of generators) {
            if (gen.grade > childGrade && !(gen.knowledgePointId in records)) {
              expect(
                newKpIds.has(gen.knowledgePointId),
                `年级超限（${gen.grade} > ${childGrade}）的生成器知识点 ${gen.knowledgePointId} 不应出现在新知识点段`,
              ).toBe(false);
            }
          }
        },
      ),
      RUNS,
    );
  });
});
