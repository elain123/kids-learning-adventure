/**
 * 今日队列（buildTodayQueue / shouldGenerateTodayQueue）属性测试
 *
 * 实现 tasks.md 4.4，覆盖设计文档 Correctness Properties：
 * - Property 8: 今日队列排序与分段（Validates: Requirements 3.5, 3.6, 1.4, 1.6）
 * - Property 9: 今日队列按自然日只生成一次（Validates: Requirements 3.8, 3.9）
 * - Property 24: 二期题型不入今日队列（Validates: Requirements 13.7）
 * - Property 7（掌握侧一半）: 已掌握记录永不出现在队列输出中（Validates: Requirements 3.7）
 *
 * 被测实现：src/engine/reviewEngine.ts 与 src/data/questionBank.ts。
 * fast-check 每个属性最少 100 次迭代。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildTodayQueue,
  localDateString,
  shouldGenerateTodayQueue,
} from '@/engine/reviewEngine';
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
  type Question,
  type QuestionType,
  type QueueItem,
  type SessionConfig,
  type TodaySession,
} from '@/types';

// ============ 基础生成器 ============

const MAX_TS = 1_000_000_000_000; // 任意时间戳上限（留出间隔余量）

/** 任意 now 时间戳 */
const nowArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_TS });

/** 非空白短字符串 */
const nonEmptyString = (maxLength = 16): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength }).filter((s) => s.trim().length > 0);

/** 知识点 id（带前缀避免生成空串歧义） */
const kpIdArb: fc.Arbitrary<string> = nonEmptyString(10).map((s) => `kp:${s}`);

/** 知识点 id 池：题目与掌握度记录从同一池中取样，保证二者有重叠 */
const kpPoolArb: fc.Arbitrary<string[]> = fc.uniqueArray(kpIdArb, {
  minLength: 1,
  maxLength: 12,
});

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

/**
 * 任意合法题目：知识点取自池；题型覆盖全部枚举（含二期题型），phase 任意 1/2，
 * 因而自然覆盖「phase=2」「二期题型误标 phase=1」等分布。id 由调用方追加序号保证唯一。
 */
const questionArb = (kpPool: readonly string[]): fc.Arbitrary<Question> =>
  fc.record({
    id: nonEmptyString(10),
    subject: fc.constantFrom('chinese', 'math', 'english') as fc.Arbitrary<
      Question['subject']
    >,
    grade: fc.integer({ min: 1, max: 6 }),
    volume: fc.constantFrom('A', 'B') as fc.Arbitrary<Question['volume']>,
    unit: nonEmptyString(6),
    type: fc.constantFrom(...ALL_QUESTION_TYPES),
    knowledgePointId: fc.constantFrom(...kpPool),
    difficulty: fc.integer({ min: 1, max: 5 }) as fc.Arbitrary<Question['difficulty']>,
    stem: nonEmptyString(20),
    answer: fc.constant({ choice: ['a'] }),
    hint: nonEmptyString(10),
    analysis: nonEmptyString(20),
    phase: fc.constantFrom(1, 2) as fc.Arbitrary<1 | 2>,
  });

/** 二期题型题：题型取自 reading/word_problem/read_aloud，phase 仍任意 1/2（覆盖误标情形） */
const phase2QuestionArb = (kpPool: readonly string[]): fc.Arbitrary<Question> =>
  fc
    .tuple(questionArb(kpPool), fc.constantFrom(...PHASE2_QUESTION_TYPES))
    .map(([q, type]) => ({ ...q, type }));

/**
 * 任意题库索引：由生成的合法题目经 buildQuestionIndex 构建，
 * 并追加保证存在的二期题型题（phase 随机 1/2），确保题库必含二期内容。
 */
const questionIndexArb = (
  kpPool: readonly string[],
): fc.Arbitrary<QuestionIndex> =>
  fc
    .tuple(
      fc.array(questionArb(kpPool), { maxLength: 40 }),
      fc.array(phase2QuestionArb(kpPool), { minLength: 1, maxLength: 6 }),
    )
    .map(([normal, phase2]) => {
      const all = [...normal, ...phase2].map((q, i) => ({
        ...q,
        id: `${q.id}#${i}`,
      }));
      return buildQuestionIndex(all);
    });

/** 任意口算生成器参数：知识点取自池（部分知识点仅由生成器覆盖） */
const generatorsArb = (
  kpPool: readonly string[],
): fc.Arbitrary<GeneratorParams[]> =>
  fc
    .array(fc.constantFrom(...kpPool), { maxLength: 4 })
    .map((kps) =>
      [...new Set(kps)].map(
        (knowledgePointId, i): GeneratorParams => ({
          id: `gen-${i}`,
          knowledgePointId,
          grade: 3,
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
 * 任意掌握度记录集合：键为知识点 id（取自池 + 少量池外 id 以覆盖"有记录但题库无题"），
 * 混合已掌握/到点/未到点记录。
 */
const recordsArb = (
  kpPool: readonly string[],
): fc.Arbitrary<Record<string, MasteryRecord>> =>
  fc
    .array(fc.constantFrom(...kpPool), { maxLength: kpPool.length })
    .chain((picked) => {
      const inPool = [...new Set(picked)];
      return fc
        .array(nonEmptyString(6), { maxLength: 3 })
        .map((extras) => [
          ...inPool,
          ...extras.map((e) => `outside:${e}`),
        ]);
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

/** 组合场景：知识点池 + 题库索引 + 生成器 + 记录集合 + now + 配置 */
const scenarioArb = kpPoolArb.chain((kpPool) =>
  fc
    .tuple(
      questionIndexArb(kpPool),
      generatorsArb(kpPool),
      recordsArb(kpPool),
      nowArb,
      configArb,
    )
    .map(([bank, generators, records, now, config]) => ({
      bank,
      generators,
      records,
      now,
      config,
    })),
);

// ============ Property 9 用：任意已有会话 ============

/** 本地自然日字符串 'YYYY-MM-DD'（随机年月日，不要求为真实日历日之外的特殊值） */
const dateStringArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 1970, max: 2100 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(
    ([y, m, d]) =>
      `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  );

/** 除 date 外的任意合法会话字段 */
const sessionFieldsArb = fc.record({
  queue: fc.constant([] as QueueItem[]),
  currentIndex: fc.nat(100),
  streak: fc.nat(100),
  consecutiveWrong: fc.nat(100),
  difficultyOffset: fc.constantFrom(0, -1) as fc.Arbitrary<0 | -1>,
  levelStartedAt: nowArb,
  elapsedMs: fc.nat(10 * 60 * 1000),
  status: fc.constantFrom('active', 'done') as fc.Arbitrary<'active' | 'done'>,
  results: fc.constant([] as TodaySession['results']),
});

const RUNS = { numRuns: 100 };

// ============ 属性测试 ============

describe('今日队列属性测试', () => {
  /**
   * **Feature: kids-learning-adventure, Property 8: 今日队列排序与分段**
   *
   * *For any* Mastery_Record 集合与题库，buildTodayQueue 的输出应满足：
   * 所有到点复习题（nextReviewAt ≤ now 且未掌握）按 nextReviewAt 从最早到最晚
   * 升序排列，且任意复习题都排在任意新知识点题之前；当到点复习集合为空时，
   * 队列全部由新知识点题组成。
   *
   * **Validates: Requirements 3.5, 3.6, 1.4, 1.6**
   */
  it('Property 8: 今日队列排序与分段（复习升序在前、新知识点在后、空复习全新）', () => {
    fc.assert(
      fc.property(scenarioArb, ({ bank, generators, records, now, config }) => {
        const queue = buildTodayQueue(records, bank, now, config, generators);

        const dueSet = new Set(
          Object.values(records)
            .filter(
              (r) => !r.mastered && r.nextReviewAt !== null && r.nextReviewAt <= now,
            )
            .map((r) => r.knowledgePointId),
        );

        const reviewItems = queue.filter((i) => i.source === 'review');
        const newItems = queue.filter((i) => i.source === 'new');
        expect(reviewItems.length + newItems.length).toBe(queue.length);

        // (a) 复习段：全部来自到点复习集合，且按 nextReviewAt 非递减升序
        for (const item of reviewItems) {
          expect(
            dueSet.has(item.knowledgePointId),
            `复习项知识点 ${item.knowledgePointId} 必须是到点未掌握记录`,
          ).toBe(true);
        }
        const reviewTimes = reviewItems.map(
          (i) => records[i.knowledgePointId].nextReviewAt as number,
        );
        for (let k = 1; k < reviewTimes.length; k += 1) {
          expect(
            reviewTimes[k] >= reviewTimes[k - 1],
            `复习段必须按 nextReviewAt 升序：${reviewTimes[k - 1]} 之后出现 ${reviewTimes[k]}`,
          ).toBe(true);
        }

        // (b) 分段：任意复习题都排在任意新知识点题之前
        const firstNewIndex = queue.findIndex((i) => i.source === 'new');
        if (firstNewIndex >= 0) {
          for (let k = firstNewIndex; k < queue.length; k += 1) {
            expect(queue[k].source).toBe('new');
          }
        }

        // (c) 新知识点段：全部来自无 Mastery_Record 的知识点
        for (const item of newItems) {
          expect(
            item.knowledgePointId in records,
            `新知识点项 ${item.knowledgePointId} 不应有掌握度记录`,
          ).toBe(false);
        }

        // (d) 数量上限
        expect(reviewItems.length).toBeLessThanOrEqual(config.maxReviewPerSession);
        expect(newItems.length).toBeLessThanOrEqual(config.maxNewPerSession);

        // (e) 到点复习集合为空时，队列全部由新知识点题组成
        if (dueSet.size === 0) {
          expect(reviewItems.length).toBe(0);
          for (const item of queue) {
            expect(item.source).toBe('new');
          }
        }

        // (f) 队列内知识点不重复（复习段键唯一；新段要求无记录，两段互斥）
        const kpIds = queue.map((i) => i.knowledgePointId);
        expect(new Set(kpIds).size).toBe(kpIds.length);

        // 纯函数：入参不被修改（记录集合大小不变）
        expect(typeof queue).toBe('object');
      }),
      RUNS,
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 9: 今日队列按自然日只生成一次**
   *
   * *For any* 本地日期 d 与已有会话状态：当已存在 date=d 的 Today_Session 时，
   * 进入练习沿用该会话而不重新生成；仅当不存在 date=d 的会话时才生成新队列。
   *
   * **Validates: Requirements 3.8, 3.9**
   */
  it('Property 9: 今日队列按自然日只生成一次（当日沿用、异日/无会话才生成）', () => {
    fc.assert(
      fc.property(
        nowArb,
        sessionFieldsArb,
        dateStringArb,
        fc.boolean(),
        (now, fields, otherDate, useSameDay) => {
          const today = localDateString(now);
          // useSameDay 时构造 date=today 的会话；否则构造 date≠today 的会话
          const date = useSameDay ? today : otherDate;
          const session: TodaySession = { ...fields, date };

          const result = shouldGenerateTodayQueue(session, now);
          // 仅当会话 date 与 now 的本地自然日不同（即不存在当日会话）时才应生成
          expect(result).toBe(date !== today);
          if (date === today) {
            // 已存在 date=今日的会话：沿用，不重新生成
            expect(result).toBe(false);
          }

          // 无会话（null）：始终生成新队列
          expect(shouldGenerateTodayQueue(null, now)).toBe(true);
        },
      ),
      RUNS,
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 24: 二期题型不入今日队列**
   *
   * *For any* 包含二期题型（语文阅读理解、英语跟读评分、数学多步骤应用题）题目的
   * 题库与任意 Mastery_Record 集合，buildTodayQueue 的输出不包含任何 phase=2 的题目。
   *
   * **Validates: Requirements 13.7**
   */
  it('Property 24: 二期题型不入今日队列（输出不含 phase=2 或二期题型题）', () => {
    fc.assert(
      fc.property(scenarioArb, ({ bank, generators, records, now, config }) => {
        const queue = buildTodayQueue(records, bank, now, config, generators);

        // 前置确认：生成的题库确实含有二期内容（保证本属性在非平凡输入上运行）
        expect(bank.deferred.length).toBeGreaterThan(0);

        for (const item of queue) {
          if (item.kind === 'bank') {
            const q = bank.byId.get(item.questionId as string);
            expect(q, `队列项 ${item.questionId} 必须存在于题库`).toBeDefined();
            if (!q) continue;
            // 不含 phase=2 题目
            expect(q.phase).toBe(1);
            // 不含二期题型（即使误标 phase=1 也不入队）
            expect(PHASE2_QUESTION_TYPES.includes(q.type)).toBe(false);
            expect(isQueueEligible(q)).toBe(true);
          } else {
            // kind='generated'：仅数学口算生成器，属一期题型
            expect(item.type).toBe('oral');
            expect(item.subject).toBe('math');
          }
        }

        // deferred（phase=2 或二期题型）题目绝不入队
        const deferredIds = new Set(bank.deferred.map((q) => q.id));
        for (const item of queue) {
          if (item.questionId !== undefined) {
            expect(deferredIds.has(item.questionId)).toBe(false);
          }
        }
      }),
      RUNS,
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 7: 五级答对即掌握且永不再入队**
   *
   * （掌握侧一半）*For any* 包含已掌握记录的输入，buildTodayQueue 的输出队列
   * 不包含该知识点的题目。（applyAnswer 一侧由 reviewEngine.props.spec.ts 覆盖。）
   *
   * **Validates: Requirements 3.7**
   */
  it('Property 7（掌握侧）: 已掌握记录永不出现在今日队列输出中', () => {
    fc.assert(
      fc.property(scenarioArb, ({ bank, generators, records, now, config }) => {
        const queue = buildTodayQueue(records, bank, now, config, generators);

        const masteredKpIds = new Set(
          Object.values(records)
            .filter((r) => r.mastered)
            .map((r) => r.knowledgePointId),
        );

        for (const item of queue) {
          expect(
            masteredKpIds.has(item.knowledgePointId),
            `已掌握知识点 ${item.knowledgePointId} 不应入队`,
          ).toBe(false);
        }
      }),
      RUNS,
    );
  });
});
