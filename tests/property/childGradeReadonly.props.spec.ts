/**
 * Child_Grade 过滤不修改入参属性测试（fast-check，≥100 次迭代）
 *
 * 对应 .kiro/specs/child-grade-setting/design.md Property 3。
 *
 * 被测实现：src/engine/reviewEngine.ts 的 buildTodayQueue（可选第六参 childGrade）。
 * 输入域与同族 childGrade 队列属性测试一致：kpId 按 {cn|math|en}.g{N}.{后缀}
 * 契约形态生成（题目 grade、生成器 grade 与 kpId 年级段 N 一致），并混入少量
 * 畸形 kpId（缺年级段、N 越界、无前缀）覆盖 fail-closed 分支。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildTodayQueue } from '@/engine/reviewEngine';
import {
  buildQuestionIndex,
  type QuestionIndex,
} from '@/data/questionBank';
import {
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

/** 非空白短字符串（供题目文案字段使用） */
const nonEmptyString = (maxLength = 16): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength }).filter((s) => s.trim().length > 0);

/**
 * kpId 段字符串：非空白、不含 '.' 且不符合 g{N} 形态，
 * 避免拼出的 kpId 段结构被意外污染（如把后缀误判为年级段）。
 */
const segmentString = (maxLength = 8): fc.Arbitrary<string> =>
  fc
    .string({ minLength: 1, maxLength })
    .filter((s) => s.trim().length > 0 && !s.includes('.') && !/^g\d+$/.test(s));

/** 契约形态 kpId 的学科前缀 */
const prefixArb = fc.constantFrom('cn', 'math', 'en');

/** 合法年级值 N ∈ 1-6 */
const gradeArb = fc.integer({ min: 1, max: 6 });

/** 任意 childGrade：null（未设置）或 1-6 整数 */
const childGradeArb: fc.Arbitrary<number | null> = fc.option(
  fc.integer({ min: 1, max: 6 }),
  { nil: null },
);

/**
 * 知识点描述：kpId 字符串 + 按种子契约应携带的年级
 * （null 表示 kpId 年级段不可解析，kpIdGrade 返回 null）。
 */
interface KpSpec {
  kpId: string;
  grade: number | null;
}

/** 契约形态 kpId：{cn|math|en}.g{N}.{后缀}，N ∈ 1-6 */
const wellFormedKpArb: fc.Arbitrary<KpSpec> = fc
  .tuple(prefixArb, gradeArb, segmentString())
  .map(([prefix, grade, suffix]) => ({
    kpId: `${prefix}.g${grade}.${suffix}`,
    grade,
  }));

/** 畸形 kpId：缺年级段 / N 越界 / 无前缀（kpIdGrade 均返回 null） */
const malformedKpArb: fc.Arbitrary<KpSpec> = fc
  .oneof(
    // 缺年级段：第二段不是 g{N} 形态
    fc.tuple(prefixArb, segmentString()).map(([p, s]) => `${p}.${s}`),
    // N 越界（0 或 >6）
    fc
      .tuple(prefixArb, fc.constantFrom(0, 7, 8, 12), segmentString())
      .map(([p, n, s]) => `${p}.g${n}.${s}`),
    // 无前缀：无可识别学科前缀且无年级段
    fc.tuple(segmentString(), segmentString()).map(([a, b]) => `${a}xx.${b}`),
  )
  .map((kpId) => ({ kpId, grade: null }));

/** 知识点池：契约形态为主，混入少量畸形 kpId */
const kpPoolArb: fc.Arbitrary<KpSpec[]> = fc
  .tuple(
    fc.array(wellFormedKpArb, { minLength: 1, maxLength: 10 }),
    fc.array(malformedKpArb, { maxLength: 3 }),
  )
  .map(([wellFormed, malformed]) => {
    const seen = new Set<string>();
    const pool: KpSpec[] = [];
    for (const spec of [...wellFormed, ...malformed]) {
      if (!seen.has(spec.kpId)) {
        seen.add(spec.kpId);
        pool.push(spec);
      }
    }
    return pool;
  });

/** 由 kpId 前缀推导学科（不可识别时返回 null，由调用方回退） */
const subjectOf = (kpId: string): Subject | null => {
  const prefix = kpId.split('.')[0];
  if (prefix === 'cn') return 'chinese';
  if (prefix === 'math') return 'math';
  if (prefix === 'en') return 'english';
  return null;
};

/** 全部题型枚举（含二期题型 reading/word_problem/read_aloud） */
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
 * 任意题目：知识点取自池；按种子契约题目 grade 与 kpId 年级段一致
 * （畸形 kpId 年级不可解析时取任意 1-6 年级，覆盖契约破坏数据）。
 * id 由调用方追加序号保证唯一。
 */
const questionArb = (kpPool: readonly KpSpec[]): fc.Arbitrary<Question> =>
  fc
    .tuple(
      fc.constantFrom(...kpPool),
      fc.record({
        id: nonEmptyString(10),
        subject: fc.constantFrom('chinese', 'math', 'english') as fc.Arbitrary<Subject>,
        grade: gradeArb,
        volume: fc.constantFrom('A', 'B') as fc.Arbitrary<Question['volume']>,
        unit: nonEmptyString(6),
        type: fc.constantFrom(...ALL_QUESTION_TYPES),
        difficulty: fc.integer({ min: 1, max: 5 }) as fc.Arbitrary<
          Question['difficulty']
        >,
        stem: nonEmptyString(20),
        answer: fc.constant({ choice: ['a'] }),
        hint: nonEmptyString(10),
        analysis: nonEmptyString(20),
        phase: fc.constantFrom(1, 2) as fc.Arbitrary<1 | 2>,
      }),
    )
    .map(([spec, base]) => ({
      ...base,
      grade: spec.grade ?? base.grade,
      subject: subjectOf(spec.kpId) ?? base.subject,
      knowledgePointId: spec.kpId,
    }));

/** 任意题库索引：由生成的题目经 buildQuestionIndex 构建 */
const questionIndexArb = (
  kpPool: readonly KpSpec[],
): fc.Arbitrary<QuestionIndex> =>
  fc
    .array(questionArb(kpPool), { maxLength: 40 })
    .map((qs) =>
      buildQuestionIndex(qs.map((q, i) => ({ ...q, id: `${q.id}#${i}` }))),
    );

/**
 * 任意口算生成器参数：知识点取自池（部分知识点仅由生成器覆盖）；
 * 按种子契约生成器 grade 与 kpId 年级段一致（畸形 kpId 取任意年级）。
 */
const generatorsArb = (
  kpPool: readonly KpSpec[],
): fc.Arbitrary<GeneratorParams[]> =>
  fc
    .array(fc.tuple(fc.constantFrom(...kpPool), gradeArb), { maxLength: 4 })
    .map((pairs) => {
      const seen = new Set<string>();
      const gens: GeneratorParams[] = [];
      for (const [spec, fallbackGrade] of pairs) {
        if (seen.has(spec.kpId)) continue;
        seen.add(spec.kpId);
        gens.push({
          id: `gen-${gens.length}`,
          knowledgePointId: spec.kpId,
          grade: spec.grade ?? fallbackGrade,
          difficulty: 2,
          template: '{a} + {b} = ?',
          operands: {
            a: { min: 1, max: 100, integer: true },
            b: { min: 1, max: 100, integer: true },
          },
          operation: 'add',
          answerFormat: 'number',
        });
      }
      return gens;
    });

/**
 * 任意单条掌握度记录：混合三种形态——
 * - 已掌握（mastered=true, nextReviewAt=null）
 * - 未掌握且 nextReviewAt 任意（相对 now 可能到点/未到点，由 now 决定）
 * - 边界：nextReviewAt 恰可能等于 now（同一时间域内均匀取样）
 */
const masteryRecordArb = (
  knowledgePointId: string,
): fc.Arbitrary<MasteryRecord> =>
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
 * 任意掌握度记录集合：键为知识点 id（取自池 + 少量池外 id 以覆盖
 * "有记录但题库无题"），混合已掌握/到点/未到点记录。
 */
const recordsArb = (
  kpPool: readonly KpSpec[],
): fc.Arbitrary<Record<string, MasteryRecord>> =>
  fc
    .array(fc.constantFrom(...kpPool), { maxLength: kpPool.length })
    .map((specs) => [...new Set(specs.map((s) => s.kpId))])
    .chain((inPool) =>
      fc
        .array(segmentString(6), { maxLength: 3 })
        .map((extras) => [...inPool, ...extras.map((e) => `outside:${e}`)]),
    )
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

describe('childGrade 过滤不修改入参属性测试', () => {
  /**
   * **Feature: child-grade-setting, Property 3: 过滤不修改掌握度记录**
   *
   * *For any* Mastery_Record 集合、题库索引、生成器集合、now、配置与任意
   * childGrade（含 null 与 1-6），调用 buildTodayQueue 后入参 records 与调用前
   * 深相等（不新增、不删除、不修改任何记录的任何字段），题库索引与生成器集合
   * 同样不被修改。
   *
   * **Validates: Requirements 2.4**
   */
  it('Property 3: 调用 buildTodayQueue 后 records / 题库索引 / 生成器集合与调用前深相等', () => {
    fc.assert(
      fc.property(
        scenarioArb,
        ({ bank, generators, records, now, config, childGrade }) => {
          // 深快照（structuredClone 覆盖 Map/数组/嵌套对象）
          const recordsBefore = structuredClone(records);
          const bankBefore = structuredClone(bank);
          const generatorsBefore = structuredClone(generators);

          const queue = buildTodayQueue(
            records,
            bank,
            now,
            config,
            generators,
            childGrade,
          );

          // 掌握度记录：不新增、不删除、不修改任何记录的任何字段
          expect(records).toEqual(recordsBefore);
          // 题库索引：全部子结构（all/queueEligible/deferred/byXxx Map）不变
          expect(bank).toEqual(bankBefore);
          // 生成器集合：元素内容与顺序均不变
          expect(generators).toEqual(generatorsBefore);

          // 调用本身正常返回（队列数组）
          expect(Array.isArray(queue)).toBe(true);
        },
      ),
      RUNS,
    );
  });
});
