/**
 * 题库属性测试：校验过滤与整体损坏（Question_Bank）
 *
 * 实现 tasks.md 2.2，覆盖设计文档 Correctness Properties：
 * - Property 20: 题库校验过滤（Validates: Requirements 9.3, 9.4, 9.6）
 * - Property 21: 题库整体损坏即失败（Validates: Requirements 9.5）
 *
 * fast-check 每个属性最少 100 次迭代。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ANALYSIS_MAX_LENGTH,
  buildQuestionIndex,
  clearBankErrorLog,
  getBankErrorLog,
  loadQuestionBank,
  unitKey,
} from '@/data/questionBank';
import type { QuestionType, Subject, Volume } from '@/types';

// ============ 测试工具 ============

type RawObj = Record<string, unknown>;

const NOW = 1_720_000_000_000;

function isRecord(v: unknown): v is RawObj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 全部题型枚举（与 src/types/index.ts 一致，含二期预留 reading/word_problem/read_aloud） */
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

const REQUIRED_FIELDS = [
  'id',
  'subject',
  'grade',
  'volume',
  'unit',
  'type',
  'knowledgePointId',
  'difficulty',
  'stem',
  'answer',
  'hint',
  'analysis',
  'phase',
] as const;

// ============ 基础生成器 ============

/** 非空白字符串（trim 后非空） */
const arbNonEmptyString = (maxLength = 24): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength }).filter((s) => s.trim().length > 0);

/** 超过 100 字上限的解析（按码点计，保证 > ANALYSIS_MAX_LENGTH） */
const arbLongAnalysis: fc.Arbitrary<string> = fc
  .array(fc.constantFrom('解', '析', '超', '长', '内', '容', 'a', '1'), {
    minLength: ANALYSIS_MAX_LENGTH + 1,
    maxLength: ANALYSIS_MAX_LENGTH + 60,
  })
  .map((chs) => chs.join(''));

/** 合法 answer：五种形态（choice/order/pairs/number/bool），pairs 覆盖二元组数组与对象两种格式 */
const arbAnswer: fc.Arbitrary<RawObj> = fc.oneof(
  fc.array(arbNonEmptyString(), { minLength: 1, maxLength: 5 }).map((choice) => ({ choice })),
  fc.array(arbNonEmptyString(), { minLength: 1, maxLength: 5 }).map((order) => ({ order })),
  // pairs：二元组数组格式（种子数据格式 [["t1","a"],...]）
  fc
    .array(fc.tuple(arbNonEmptyString(), arbNonEmptyString()), { minLength: 1, maxLength: 5 })
    .map((pairs) => ({ pairs })),
  // pairs：对象格式 { 左槽id: 右槽id }
  fc
    .array(fc.tuple(arbNonEmptyString(), arbNonEmptyString()), { minLength: 1, maxLength: 5 })
    .map((tuples) => ({ pairs: Object.fromEntries(tuples) })),
  fc
    .oneof(
      fc.integer({ min: -1_000_000, max: 1_000_000 }),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
    )
    .map((number) => ({ number })),
  fc.boolean().map((bool) => ({ bool })),
);

/** 合法 media（可选；空对象亦合法） */
const arbMedia = fc.option(
  fc.record({
    audio: fc.option(arbNonEmptyString(), { nil: undefined }),
    image: fc.option(arbNonEmptyString(), { nil: undefined }),
  }),
  { nil: undefined },
);

/** 合法 options（可选；元素必须含非空 id） */
const arbOptions = fc.option(
  fc.array(
    fc.record({
      id: arbNonEmptyString(),
      text: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
      image: fc.option(arbNonEmptyString(), { nil: undefined }),
    }),
    { maxLength: 5 },
  ),
  { nil: undefined },
);

/** 合法题目：必需字段齐全且取值合法（含 phase=1/2 与全部题型） */
const arbValidQuestion: fc.Arbitrary<RawObj> = fc.record({
  id: arbNonEmptyString(),
  subject: fc.constantFrom('chinese', 'math', 'english'),
  grade: fc.integer({ min: 1, max: 6 }),
  volume: fc.constantFrom('A', 'B'),
  unit: arbNonEmptyString(),
  type: fc.constantFrom(...ALL_QUESTION_TYPES),
  knowledgePointId: arbNonEmptyString(),
  difficulty: fc.integer({ min: 1, max: 5 }),
  stem: arbNonEmptyString(),
  media: arbMedia,
  options: arbOptions,
  answer: arbAnswer,
  hint: arbNonEmptyString(),
  analysis: fc
    .string({ minLength: 1, maxLength: ANALYSIS_MAX_LENGTH })
    .filter((s) => s.trim().length > 0),
  phase: fc.constantFrom(1, 2),
});

/**
 * 非法题目：每种生成路径都必然违反校验（缺字段 / 越界 / 非法枚举 / 超长解析 / 非法答案 / 非对象）。
 */
const arbInvalidQuestion: fc.Arbitrary<unknown> = fc.oneof(
  // 1) 题目本身不是对象
  fc.oneof(fc.constant(null), fc.integer(), arbNonEmptyString(), fc.boolean(), fc.constant([1, 2, 3])),
  // 2) 基于合法题的定向变异（每种变异必然非法）
  arbValidQuestion.chain((valid) =>
    fc.oneof(
      // 缺少必需字段
      fc.constantFrom(...REQUIRED_FIELDS).map((field) => {
        const copy: RawObj = { ...valid };
        delete copy[field];
        return copy;
      }),
      // 必需字符串字段为空白
      fc
        .constantFrom('id', 'unit', 'knowledgePointId', 'stem', 'hint', 'analysis')
        .chain((field) => fc.constantFrom('', '   ').map((v) => ({ ...valid, [field]: v }))),
      // grade 越界或非整数
      fc
        .oneof(
          fc.integer({ min: -100, max: 0 }),
          fc.integer({ min: 7, max: 100 }),
          fc.constantFrom(2.5, '3', null),
        )
        .map((v) => ({ ...valid, grade: v })),
      // difficulty 越界或非整数
      fc
        .oneof(
          fc.integer({ min: -100, max: 0 }),
          fc.integer({ min: 6, max: 100 }),
          fc.constantFrom(1.5, '5', null),
        )
        .map((v) => ({ ...valid, difficulty: v })),
      // 非法枚举取值
      fc.constantFrom('science', 'maths', '', 0, null).map((v) => ({ ...valid, subject: v })),
      fc.constantFrom('C', 'c', '', 1, null).map((v) => ({ ...valid, volume: v })),
      fc.constantFrom('essay', 'unknown_type', '', 7, null).map((v) => ({ ...valid, type: v })),
      fc.constantFrom(0, 3, '1', null, true).map((v) => ({ ...valid, phase: v })),
      // analysis 超过 100 字上限
      arbLongAnalysis.map((v) => ({ ...valid, analysis: v })),
      // answer 非法形态
      fc
        .constantFrom(
          {},
          [],
          null,
          'nope',
          42,
          { choice: [] },
          { pairs: [] },
          { pairs: {} },
          { number: 'x' },
          { bool: 1 },
          { choice: ['ok', ''] },
        )
        .map((v) => ({ ...valid, answer: v })),
    ),
  ),
);

// ============ 混合题目集合生成器 ============

interface TaggedItem {
  kind: 'valid' | 'invalid';
  raw: unknown;
}

/** 合法与非法题任意混合的题目集合 */
const arbMixedItems: fc.Arbitrary<TaggedItem[]> = fc.array(
  fc.oneof(
    arbValidQuestion.map((raw): TaggedItem => ({ kind: 'valid', raw })),
    arbInvalidQuestion.map((raw): TaggedItem => ({ kind: 'invalid', raw })),
  ),
  { maxLength: 40 },
);

// ============ 整体损坏 JSON 生成器 ============

/** 语法层面无法解析的 JSON 字符串 */
const arbUnparseableJson: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    '{',
    '[',
    '{"a":',
    '[1,2,',
    '{"questions": [',
    '',
    '   ',
    'not json at all',
    "{'a':1}",
    '[1,2,]',
    '{"a":1,}',
    'NaN',
    'undefined',
    '"unterminated',
  ),
  // 以 '{{' 开头的字符串必然解析失败
  fc.string().map((s) => `{{${s}}}`),
);

/** 可解析但顶层结构非法（非对象 / 缺少 questions 数组）的 JSON 字符串 */
const arbWrongStructureJson: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    'null',
    'true',
    'false',
    '123',
    '"questions"',
    '[]',
    '[1,2,3]',
    '{}',
    '{"questions":null}',
    '{"questions":{}}',
    '{"questions":"yes"}',
    '{"questions":5}',
    '{"questionnaire":[]}',
  ),
  fc.integer().map((v) => JSON.stringify(v)),
  fc.boolean().map((v) => JSON.stringify(v)),
  fc.string().map((v) => JSON.stringify(v)),
  fc.array(fc.integer()).map((v) => JSON.stringify(v)),
  // questions 存在但不是数组
  fc
    .oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null))
    .map((v) => JSON.stringify({ questions: v })),
);

/** 无法解析为合法题库结构的 JSON 字符串 */
const arbCorruptedJson: fc.Arbitrary<string> = fc.oneof(arbUnparseableJson, arbWrongStructureJson);

// ============ 属性测试 ============

describe('questionBank 属性测试', () => {
  /**
   * **Feature: kids-learning-adventure, Property 20: 题库校验过滤**
   *
   * *For any* 题目集合（合法与非法题任意混合），启动加载后：所有必需字段齐全且取值合法的题目被全部载入并可按学科/年级/单元索引检索到；所有非法题目被跳过且各自产生一条标识该题的错误日志；载入数 + 错误数 = 总数。
   *
   * **Validates: Requirements 9.3, 9.4, 9.6**
   */
  it('Property 20: 题库校验过滤（合法题全载入可索引、非法题跳过并逐题记错、载入数+错误数=总数）', () => {
    fc.assert(
      fc.property(arbMixedItems, (items) => {
        // 合法题 id 追加序号后缀保证唯一，便于按 id 精确断言
        const tagged = items.map((item, i) =>
          item.kind === 'valid'
            ? { ...item, raw: { ...(item.raw as RawObj), id: `${(item.raw as RawObj).id}#${i}` } }
            : item,
        );
        const rawList = tagged.map((t) => t.raw);
        const json = JSON.stringify({ questions: rawList });
        // 以 JSON 往返后的数据为基准（与实现侧所见一致）
        const parsedList = (JSON.parse(json) as { questions: unknown[] }).questions;

        clearBankErrorLog();
        const result = loadQuestionBank(json, NOW);

        // 结构合法的题库不应 fatal
        expect('fatal' in result).toBe(false);
        if ('fatal' in result) return;

        const expectedValid = tagged.map((t, i) => ({ t, i })).filter(({ t }) => t.kind === 'valid');
        const expectedInvalid = tagged
          .map((t, i) => ({ t, i }))
          .filter(({ t }) => t.kind === 'invalid');

        // 载入数 + 错误数 = 总数（Req 9.4）
        expect(result.questions.length + result.errors.length).toBe(tagged.length);
        // 合法题全部载入、非法题全部跳过（Req 9.3）
        expect(result.questions.length).toBe(expectedValid.length);
        expect(result.errors.length).toBe(expectedInvalid.length);

        const index = buildQuestionIndex(result.questions);
        expect(index.all.length).toBe(expectedValid.length);

        for (const { i } of expectedValid) {
          const raw = parsedList[i] as RawObj;
          const loaded = result.questions.find((q) => q.id === raw.id);
          expect(loaded, `合法题 ${String(raw.id)} 应被载入`).toBeDefined();
          if (!loaded) continue;

          // 必需字段与取值与输入一致
          expect(loaded.subject).toBe(raw.subject);
          expect(loaded.grade).toBe(raw.grade);
          expect(loaded.volume).toBe(raw.volume);
          expect(loaded.unit).toBe(raw.unit);
          expect(loaded.type).toBe(raw.type);
          expect(loaded.knowledgePointId).toBe(raw.knowledgePointId);
          expect(loaded.difficulty).toBe(raw.difficulty);
          expect(loaded.stem).toBe(raw.stem);
          expect(loaded.hint).toBe(raw.hint);
          expect(loaded.analysis).toBe(raw.analysis);
          expect(loaded.phase).toBe(raw.phase);
          if (raw.media !== undefined) expect(loaded.media).toEqual(raw.media);
          if (raw.options !== undefined) expect(loaded.options).toEqual(raw.options);

          // answer 归一化：pairs 二元组数组统一为 Record
          const expectedAnswer = { ...(raw.answer as RawObj) };
          if (Array.isArray(expectedAnswer.pairs)) {
            expectedAnswer.pairs = Object.fromEntries(
              expectedAnswer.pairs as Array<[string, string]>,
            );
          }
          expect(loaded.answer).toEqual(expectedAnswer);

          // 可按学科/年级/单元索引检索到（Req 9.6）
          expect(index.byId.get(raw.id as string)?.id).toBe(raw.id);
          expect(
            index.bySubject.get(raw.subject as Subject)?.some((q) => q.id === raw.id),
          ).toBe(true);
          expect(index.byGrade.get(raw.grade as number)?.some((q) => q.id === raw.id)).toBe(true);
          expect(
            index.byUnit
              .get(
                unitKey(
                  raw.subject as Subject,
                  raw.grade as number,
                  raw.volume as Volume,
                  raw.unit as string,
                ),
              )
              ?.some((q) => q.id === raw.id),
          ).toBe(true);
        }

        // 非法题：各自产生一条标识该题的错误日志，顺序与输入一致（Req 9.4）
        expectedInvalid.forEach(({ i }, k) => {
          const err = result.errors[k];
          const raw = parsedList[i];
          const expectedId =
            isRecord(raw) && typeof raw.id === 'string' && raw.id.trim().length > 0
              ? raw.id
              : `<unknown@${i}>`;
          expect(err.entity).toBe('question');
          expect(err.questionId).toBe(expectedId);
          expect(err.reason.trim().length).toBeGreaterThan(0);
          expect(err.at).toBe(NOW);
        });

        // 内存错误日志缓冲记录同一批错误
        const log = getBankErrorLog();
        expect(log.length).toBe(result.errors.length);
        result.errors.forEach((err, k) => {
          expect(log[k]).toEqual(err);
        });
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 21: 题库整体损坏即失败**
   *
   * *For any* 无法解析为合法题库结构的 JSON 字符串，`loadQuestionBank` 应返回 fatal 错误、记录错误日志，且不产出任何可用题目（系统据此停止进入练习流程）。
   *
   * **Validates: Requirements 9.5**
   */
  it('Property 21: 题库整体损坏即失败（fatal + 记错误日志 + 不产出题目）', () => {
    fc.assert(
      fc.property(arbCorruptedJson, (json) => {
        clearBankErrorLog();
        const result = loadQuestionBank(json, NOW);

        // 返回 fatal 错误
        expect('fatal' in result).toBe(true);
        if (!('fatal' in result)) return;
        expect(typeof result.fatal).toBe('string');
        expect(result.fatal.trim().length).toBeGreaterThan(0);

        // 不产出任何可用题目
        expect((result as { questions?: unknown }).questions).toBeUndefined();

        // 记录一条题库整体错误日志
        const log = getBankErrorLog();
        expect(log.length).toBe(1);
        expect(log[0].entity).toBe('questionBank');
        expect(log[0].questionId).toBe('-');
        expect(log[0].reason.trim().length).toBeGreaterThan(0);
        expect(log[0].at).toBe(NOW);
      }),
      { numRuns: 100 },
    );
  });
});
