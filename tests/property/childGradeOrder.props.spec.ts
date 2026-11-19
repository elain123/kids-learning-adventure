/**
 * Child_Grade 过滤后队列组织规则保持属性测试（fast-check，≥100 次迭代）
 *
 * 对应 .kiro/specs/child-grade-setting/design.md Property 2（tasks.md 3.3）。
 * 与 3.2（childGradeQueue.props.spec.ts）相同输入域：
 * 任意 Mastery_Record 集合、题库索引（kpId 按 {cn|math|en}.g{N}.{后缀} 契约形态
 * 生成并混入少量畸形 kpId）、口算生成器集合、now、会话配置，且 childGrade ∈ 1-6。
 *
 * 被测实现：src/engine/reviewEngine.ts 的 buildTodayQueue（可选第六参 childGrade）。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildTodayQueue } from '@/engine/reviewEngine';
import { kpIdGrade, kpIdSubject } from '@/engine/kpId';
import {
  buildQuestionIndex,
  type QuestionIndex,
} from '@/data/questionBank';
import {
  type Difficulty,
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

/** 小写字母数字段（kpId 后缀等，避免空白/点号干扰段解析与反例可读性） */
const segmentArb = (maxLength = 8): fc.Arbitrary<string> =>
  fc.stringOf(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''),
    ),
    { minLength: 1, maxLength },
  );

const SUBJECT_PREFIXES = ['cn', 'math', 'en'] as const;

/** 年级段形态 g{N}（N 为数字）——用于判定畸形 kpId 是否意外可解析 */
const GRADE_SEGMENT_PATTERN = /^g(\d+)$/;

/**
 * 契约形态 kpId：{cn|math|en}.g{N}.{后缀}，N ∈ 1-6。
 * （kpIdGrade 必可解析为该 N。）
 */
const wellFormedKpIdArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...SUBJECT_PREFIXES),
    fc.integer({ min: 1, max: 6 }),
    segmentArb(),
  )
  .map(([prefix, grade, suffix]) => `${prefix}.g${grade}.${suffix}`);

/**
 * 畸形 kpId（kpIdGrade 必返回 null），覆盖 fail-closed 分支：
 * - 缺年级段：无前缀形态 `xxx.g3.yy`（首段非 cn/math/en）、仅一段、第二段非 g{N}
 * - N 越界：g0、g7-g99
 */
const malformedKpIdArb: fc.Arbitrary<string> = fc.oneof(
  // 无前缀（首段不是 cn/math/en）
  fc
    .tuple(
      segmentArb(4).filter(
        (p) => !(SUBJECT_PREFIXES as readonly string[]).includes(p),
      ),
      fc.integer({ min: 1, max: 6 }),
      segmentArb(),
    )
    .map(([prefix, grade, suffix]) => `${prefix}.g${grade}.${suffix}`),
  // 仅一段（缺年级段）
  fc.constantFrom(...SUBJECT_PREFIXES),
  // 缺年级段（第二段不符合 g{N} 形态）
  fc
    .tuple(
      fc.constantFrom(...SUBJECT_PREFIXES),
      segmentArb().filter((s) => GRADE_SEGMENT_PATTERN.exec(s) === null),
    )
    .map(([prefix, suffix]) => `${prefix}.${suffix}`),
  // N 越界：g0
  fc
    .tuple(fc.constantFrom(...SUBJECT_PREFIXES), segmentArb())
    .map(([prefix, suffix]) => `${prefix}.g0.${suffix}`),
  // N 越界：g7-g99
  fc
    .tuple(
      fc.constantFrom(...SUBJECT_PREFIXES),
      fc.integer({ min: 7, max: 99 }),
      segmentArb(),
    )
    .map(([prefix, grade, suffix]) => `${prefix}.g${grade}.${suffix}`),
);

/**
 * 知识点 id 池：契约形态为主，混入少量（≥1）畸形 kpId；
 * 题目、生成器与掌握度记录从同一池中取样，保证三者有重叠。
 */
const kpPoolArb: fc.Arbitrary<string[]> = fc
  .tuple(
    fc.uniqueArray(wellFormedKpIdArb, { minLength: 1, maxLength: 12 }),
    fc.uniqueArray(malformedKpIdArb, { minLength: 1, maxLength: 3 }),
  )
  .map(([wellFormed, malformed]) => [
    ...wellFormed,
    ...malformed.filter((b) => !wellFormed.includes(b)),
  ]);

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

/** 与 kpId 前缀一致的学科（畸形 kpId 无前缀契约，学科任意） */
const subjectForKpId = (kpId: string): fc.Arbitrary<Subject> => {
  const subject = kpIdSubject(kpId);
  return subject === null
    ? fc.constantFrom('chinese', 'math', 'english')
    : fc.constant(subject);
};

/** 与 kpId 年级段一致的年级（种子契约；畸形 kpId 无年级段，年级任意 1-6） */
const gradeForKpId = (kpId: string): fc.Arbitrary<number> => {
  const grade = kpIdGrade(kpId);
  return grade === null ? fc.integer({ min: 1, max: 6 }) : fc.constant(grade);
};

/**
 * 任意合法题目：知识点取自池；按种子契约使题目 grade 与 kpId 年级段一致、
 * subject 与 kpId 前缀一致；题型覆盖全部枚举、phase 任意 1/2，
 * 因而自然覆盖可入队与不可入队（phase=2 / 二期题型）分布。
 * id 由调用方追加序号保证唯一。
 */
const questionArb = (kpPool: readonly string[]): fc.Arbitrary<Question> =>
  fc.constantFrom(...kpPool).chain((knowledgePointId) =>
    fc.record({
      id: segmentArb(10),
      subject: subjectForKpId(knowledgePointId),
      grade: gradeForKpId(knowledgePointId),
      volume: fc.constantFrom('A', 'B') as fc.Arbitrary<Question['volume']>,
      unit: segmentArb(4),
      type: fc.constantFrom(...ALL_QUESTION_TYPES),
      knowledgePointId: fc.constant(knowledgePointId),
      difficulty: fc.integer({ min: 1, max: 5 }) as fc.Arbitrary<Difficulty>,
      stem: segmentArb(20),
      answer: fc.constant({ choice: ['a'] }),
      hint: segmentArb(10),
      analysis: segmentArb(20),
      phase: fc.constantFrom(1, 2) as fc.Arbitrary<1 | 2>,
    }),
  );

/** 任意题库索引：由生成的题目经 buildQuestionIndex 构建 */
const questionIndexArb = (
  kpPool: readonly string[],
): fc.Arbitrary<QuestionIndex> =>
  fc
    .array(questionArb(kpPool), { maxLength: 40 })
    .map((questions) =>
      buildQuestionIndex(
        questions.map((q, i) => ({ ...q, id: `${q.id}#${i}` })),
      ),
    );

/**
 * 任意口算生成器集合：知识点取自池（部分知识点仅由生成器覆盖），
 * 按种子契约使生成器 grade 与 kpId 年级段一致（畸形 kpId 年级任意）。
 */
const generatorsArb = (
  kpPool: readonly string[],
): fc.Arbitrary<GeneratorParams[]> =>
  fc
    .array(fc.constantFrom(...kpPool), { maxLength: 4 })
    .chain((kps) =>
      fc.tuple(
        ...[...new Set(kps)].map((knowledgePointId) =>
          gradeForKpId(knowledgePointId).map(
            (grade): GeneratorParams => ({
              id: `gen-${knowledgePointId}`,
              knowledgePointId,
              grade,
              difficulty: 2,
              template: '{a} + {b} = ?',
              operands: {
                a: { min: 1, max: 100, integer: true },
                b: { min: 1, max: 100, integer: true },
              },
              operation: 'add',
              answerFormat: 'number',
            }),
          ),
        ),
      ),
    );

/**
 * 任意单条掌握度记录：混合三种形态——
 * - 已掌握（mastered=true, nextReviewAt=null）
 * - 未掌握且 nextReviewAt 任意（相对 now 可能到点/未到点，由 now 决定）
 * - 边界：nextReviewAt 恰可能等于 now（同一时间域内均匀取样）
 */
const masteryRecordArb = (knowledgePointId: string): fc.Arbitrary<MasteryRecord> =>
  fc
    .record({
      knowledgePointId: fc.constant(knowledgePointId),
      level: fc.constantFrom(1, 2, 3, 4, 5) as fc.Arbitrary<IntervalLevel>,
      totalCorrect: fc.nat(1_000_000),
      totalWrong: fc.nat(1_000_000),
      mastered: fc.boolean(),
      // 与 now 同一时间域取样，保证到点/未到点/恰等于 now 均被覆盖
      nextReviewAtRaw: nowArb,
      lastAnswerAt: nowArb,
    })
    .map(({ nextReviewAtRaw, ...base }) => ({
      ...base,
      nextReviewAt: base.mastered ? null : nextReviewAtRaw,
    }));

/**
 * 任意掌握度记录集合：键为知识点 id（取自池 + 少量池外 id 以覆盖
 * "有记录但题库无题"），混合已掌握/到点/未到点记录。
 */
const recordsArb = (
  kpPool: readonly string[],
): fc.Arbitrary<Record<string, MasteryRecord>> =>
  fc
    .array(fc.constantFrom(...kpPool), { maxLength: kpPool.length })
    .chain((picked) => {
      const inPool = [...new Set(picked)];
      return fc
        .array(segmentArb(6), { maxLength: 3 })
        .map((extras) => [...inPool, ...extras.map((e) => `outside:${e}`)]);
    })
    .chain((kpIds) =>
      fc
        .tuple(...kpIds.map((id) => masteryRecordArb(id)))
        .map((recs) => {
          const map: Record<string, MasteryRecord> = {};
          for (const rec of recs) {
            map[rec.knowledgePointId] = rec;
          }
          return map;
        }),
    );

/** 任意会话配置（上限取非负整数；groupSize/levelTargetMs 为设计常量） */
const configArb: fc.Arbitrary<SessionConfig> = fc.record({
  groupSize: fc.constant(3 as const),
  levelTargetMs: fc.constant(10 * 60 * 1000),
  maxNewPerSession: fc.integer({ min: 0, max: 50 }),
  maxReviewPerSession: fc.integer({ min: 0, max: 50 }),
});

/** 任意孩子年级（已设置）：1-6 */
const childGradeArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 6 });

/** 组合场景：知识点池 + 题库索引 + 生成器 + 记录集合 + now + 配置 + childGrade */
const scenarioArb = kpPoolArb.chain((kpPool) =>
  fc
    .tuple(
      questionIndexArb(kpPool),
      generatorsArb(kpPool),
      recordsArb(kpPool),
      nowArb,
      configArb,
      childGradeArb,
    )
    .map(([bank, generators, records, now, config, childGrade]) => ({
      bank,
      generators,
      records,
      now,
      config,
      childGrade,
    })),
);

const RUNS = { numRuns: 100 };

// ============ 属性测试 ============

describe('childGrade 过滤后队列组织规则属性测试', () => {
  /**
   * **Feature: child-grade-setting, Property 2: 过滤后队列组织规则保持**
   *
   * *For any* 任意 Mastery_Record 集合、题库索引（kpId 契约形态 + 少量畸形 kpId）、
   * 口算生成器集合、时间 now、会话配置与任意 childGrade ∈ 1-6，
   * buildTodayQueue(records, bank, now, config, generators, childGrade) 的
   * 输出队列应保持既有组织规则：
   * - 复习段（source='review'）按对应记录的 nextReviewAt 非递减升序排列；
   * - 任意复习段项都排在任意新知识点段项（source='new'）之前；
   * - 复习段项数 ≤ maxReviewPerSession；
   * - 新知识点段项数 ≤ maxNewPerSession。
   *
   * **Validates: Requirements 2.7**
   */
  it('Property 2: 复习升序在前、新知识点在后、各段上限不变', () => {
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

          const reviewItems = queue.filter((i) => i.source === 'review');
          const newItems = queue.filter((i) => i.source === 'new');
          // buildTodayQueue 仅产出 review / new 两种来源（无 retry 项）
          expect(reviewItems.length + newItems.length).toBe(queue.length);

          // (a) 复习段按对应记录的 nextReviewAt 非递减升序
          for (const item of reviewItems) {
            expect(
              item.knowledgePointId in records,
              `复习项知识点 ${item.knowledgePointId} 必须有掌握度记录`,
            ).toBe(true);
          }
          const reviewTimes = reviewItems.map(
            (i) => records[i.knowledgePointId].nextReviewAt as number,
          );
          for (let k = 1; k < reviewTimes.length; k += 1) {
            expect(
              reviewTimes[k] >= reviewTimes[k - 1],
              `复习段必须按 nextReviewAt 非递减升序：${reviewTimes[k - 1]} 之后出现 ${reviewTimes[k]}`,
            ).toBe(true);
          }

          // (b) 任意复习段项都排在任意新知识点段项之前：
          // 首个 'new' 项之后不允许再出现 'review' 项
          const firstNewIndex = queue.findIndex((i) => i.source === 'new');
          if (firstNewIndex >= 0) {
            for (let k = firstNewIndex; k < queue.length; k += 1) {
              expect(
                queue[k].source,
                `新知识点段起始位置 ${firstNewIndex} 之后（含）不得出现复习项（位置 ${k}）`,
              ).toBe('new');
            }
          }

          // (c) 复习段项数 ≤ maxReviewPerSession
          expect(reviewItems.length).toBeLessThanOrEqual(
            config.maxReviewPerSession,
          );

          // (d) 新知识点段项数 ≤ maxNewPerSession
          expect(newItems.length).toBeLessThanOrEqual(config.maxNewPerSession);
        },
      ),
      RUNS,
    );
  });
});
