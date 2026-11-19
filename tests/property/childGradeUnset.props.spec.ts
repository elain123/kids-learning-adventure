/**
 * 未设置与既有行为等价（buildTodayQueue childGrade 可选参数）属性测试
 *
 * 实现 tasks.md 3.5，覆盖设计文档 Correctness Properties：
 * - Property 4: 未设置与既有行为等价（Validates: Requirements 3.1）
 *
 * 被测实现：src/engine/reviewEngine.ts 的 buildTodayQueue（可选第六参 childGrade，默认 null）。
 *
 * 属性内容：
 * 1) 任意输入域（含畸形 kpId）下，buildTodayQueue(..., generators, null) 的输出
 *    与既有五参调用 buildTodayQueue(..., generators) 的输出深相等——
 *    childGrade=null 时 gradeWithinLimit 恒为 true，代码路径逐字节一致；
 * 2) 契约形态输入域（kpId 按 {cn|math|en}.g{N}.{后缀} 生成，N ∈ 1-6，
 *    题目/生成器 grade 与 kpId 年级段一致，故全部内容年级 ≤ 6）下，
 *    buildTodayQueue(..., generators, 6) 的输出与未过滤输出深相等——
 *    全部内容年级均在上限 6 之内，过滤不产生任何排除。
 *
 * fast-check 每个属性最少 100 次迭代。
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
} from '@/types';

const RUNS = { numRuns: 100 };

const MAX_TS = 1_000_000_000_000; // 任意时间戳上限

/** 任意 now 时间戳 */
const nowArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_TS });

/** 非空白短字符串 */
const nonEmptyString = (maxLength = 16): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength }).filter((s) => s.trim().length > 0);

/**
 * 知识点条目：kpId 与其年级（按种子契约，题目/生成器 grade 与 kpId 年级段一致）。
 */
interface KpEntry {
  kpId: string;
  grade: number;
}

/** kpId 后缀段（不含 '.'，避免干扰年级段解析形态） */
const kpSuffixArb: fc.Arbitrary<string> = nonEmptyString(10).filter(
  (s) => !s.includes('.'),
);

/**
 * 契约形态知识点条目：kpId 为 {cn|math|en}.g{N}.{后缀}，N ∈ 1-6，grade = N。
 * 保证 kpIdGrade 可解析且 ≤ 6，内容年级 ≤ 6。
 */
const contractKpEntryArb: fc.Arbitrary<KpEntry> = fc
  .tuple(fc.constantFrom('cn', 'math', 'en'), fc.integer({ min: 1, max: 6 }), kpSuffixArb)
  .map(([prefix, grade, suffix]) => ({
    kpId: `${prefix}.g${grade}.${suffix}`,
    grade,
  }));

/** 畸形 kpId：缺年级段、N 越界、无学科前缀等，kpIdGrade 不可解析（返回 null） */
const malformedKpIdArb: fc.Arbitrary<string> = fc.oneof(
  nonEmptyString(8).map((s) => `kp:${s}`),
  fc
    .tuple(fc.integer({ min: 7, max: 99 }), kpSuffixArb)
    .map(([n, suffix]) => `cn.g${n}.${suffix}`),
  kpSuffixArb.map((suffix) => `cn.${suffix}`),
  kpSuffixArb,
);

/**
 * 广义知识点条目：契约形态 + 少量畸形 kpId（条目 grade 仍任意取 1-6）。
 * 用于「childGrade=null 与五参调用等价」属性——null 时不过滤，对任意输入域成立。
 */
const broadKpEntryArb: fc.Arbitrary<KpEntry> = fc.oneof(
  contractKpEntryArb,
  malformedKpIdArb.chain((kpId) =>
    fc.integer({ min: 1, max: 6 }).map((grade) => ({ kpId, grade })),
  ),
);

/** 全部题型枚举（含二期题型；过滤等价性与题型无关，保持输入域与其余队列属性一致） */
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

/** 任意题目：知识点取自池，grade 与池条目一致（种子契约），其余字段任意 */
const questionArb = (kpPool: readonly KpEntry[]): fc.Arbitrary<Question> =>
  fc
    .record({
      id: nonEmptyString(10),
      entry: fc.constantFrom(...kpPool),
      subject: fc.constantFrom('chinese', 'math', 'english') as fc.Arbitrary<
        Question['subject']
      >,
      volume: fc.constantFrom('A', 'B') as fc.Arbitrary<Question['volume']>,
      unit: nonEmptyString(6),
      type: fc.constantFrom(...ALL_QUESTION_TYPES),
      difficulty: fc.integer({ min: 1, max: 5 }) as fc.Arbitrary<Question['difficulty']>,
      stem: nonEmptyString(20),
      answer: fc.constant({ choice: ['a'] }),
      hint: nonEmptyString(10),
      analysis: nonEmptyString(20),
      phase: fc.constantFrom(1, 2) as fc.Arbitrary<1 | 2>,
    })
    .map(({ entry, ...rest }) => ({
      ...rest,
      knowledgePointId: entry.kpId,
      grade: entry.grade,
    }));

/** 任意题库索引：由生成的题目经 buildQuestionIndex 构建，id 追加序号保证唯一 */
const questionIndexArb = (kpPool: readonly KpEntry[]): fc.Arbitrary<QuestionIndex> =>
  fc.array(questionArb(kpPool), { maxLength: 40 }).map((questions) =>
    buildQuestionIndex(questions.map((q, i) => ({ ...q, id: `${q.id}#${i}` }))),
  );

/** 任意口算生成器集合：知识点取自池，grade 与池条目一致 */
const generatorsArb = (
  kpPool: readonly KpEntry[],
): fc.Arbitrary<GeneratorParams[]> =>
  fc
    .array(fc.constantFrom(...kpPool), { maxLength: 4 })
    .map((entries) => {
      const seen = new Set<string>();
      const result: GeneratorParams[] = [];
      for (const entry of entries) {
        if (seen.has(entry.kpId)) continue;
        seen.add(entry.kpId);
        result.push({
          id: `gen-${result.length}`,
          knowledgePointId: entry.kpId,
          grade: entry.grade,
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
      return result;
    });

/** 任意单条掌握度记录：混合已掌握（nextReviewAt=null）与未掌握任意到点形态 */
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
 * 任意掌握度记录集合：键取自知识点池；includeOutside 时混入少量池外 id
 * （覆盖"有记录但题库/生成器无题"，池外知识点无可用题，不产生队列项，
 * 因而不影响过滤等价性断言）。
 */
const recordsArb = (
  kpPool: readonly KpEntry[],
  includeOutside: boolean,
): fc.Arbitrary<Record<string, MasteryRecord>> =>
  fc
    .array(fc.constantFrom(...kpPool), { maxLength: kpPool.length })
    .chain((picked) => {
      const inPool = [...new Set(picked.map((e) => e.kpId))];
      if (!includeOutside) {
        return fc.constant(inPool);
      }
      return fc
        .array(malformedKpIdArb, { maxLength: 3 })
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

/** 组合场景：知识点池（按条目生成器）+ 题库索引 + 生成器 + 记录集合 + now + 配置 */
const scenarioArb = (
  entryArb: fc.Arbitrary<KpEntry>,
  includeOutsideRecords: boolean,
) =>
  fc
    .uniqueArray(entryArb, {
      minLength: 1,
      maxLength: 12,
      selector: (e) => e.kpId,
    })
    .chain((kpPool) =>
      fc
        .tuple(
          questionIndexArb(kpPool),
          generatorsArb(kpPool),
          recordsArb(kpPool, includeOutsideRecords),
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

/** 广义场景：混入畸形 kpId（题目 grade ≤ 6），用于 null 等价属性 */
const broadScenarioArb = scenarioArb(broadKpEntryArb, true);

/** 契约场景：kpId 全部契约形态、内容年级均 ≤ 6，用于 childGrade=6 等价属性 */
const contractScenarioArb = scenarioArb(contractKpEntryArb, true);

// ============ 属性测试 ============

describe('childGrade 未设置与既有行为等价属性测试', () => {
  /**
   * **Feature: child-grade-setting, Property 4: 未设置与既有行为等价**
   *
   * *For any* 输入域（任意 Mastery_Record 集合、题库索引、生成器集合、now、
   * 会话配置，含畸形 kpId），显式传 childGrade=null 的输出与既有五参调用
   * （省略 childGrade）的输出深相等——null 时 gradeWithinLimit 恒为 true，
   * 过滤代码路径与既有实现逐字节一致。
   *
   * **Validates: Requirements 3.1**
   */
  it('Property 4: childGrade=null 与既有五参调用输出深相等（任意输入域）', () => {
    fc.assert(
      fc.property(broadScenarioArb, ({ bank, generators, records, now, config }) => {
        const legacy = buildTodayQueue(records, bank, now, config, generators);
        const withNull = buildTodayQueue(records, bank, now, config, generators, null);
        expect(withNull).toEqual(legacy);
      }),
      RUNS,
    );
  });

  /**
   * **Feature: child-grade-setting, Property 4: 未设置与既有行为等价**
   *
   * *For any* 契约形态输入域（kpId 为 {cn|math|en}.g{N}.{后缀}，N ∈ 1-6，
   * 题目/生成器 grade 与之一致，即全部内容年级 ≤ 6），childGrade=6 的输出
   * 与未过滤输出深相等——全部内容年级在上限之内，过滤不产生任何排除。
   *
   * **Validates: Requirements 3.1**
   */
  it('Property 4: childGrade=6 与未过滤输出深相等（全部内容年级 ≤ 6）', () => {
    fc.assert(
      fc.property(
        contractScenarioArb,
        ({ bank, generators, records, now, config }) => {
          const unfiltered = buildTodayQueue(records, bank, now, config, generators);
          const withGrade6 = buildTodayQueue(records, bank, now, config, generators, 6);
          expect(withGrade6).toEqual(unfiltered);
          // 同场景下 null 等价同样成立
          const withNull = buildTodayQueue(records, bank, now, config, generators, null);
          expect(withNull).toEqual(unfiltered);
        },
      ),
      RUNS,
    );
  });
});
