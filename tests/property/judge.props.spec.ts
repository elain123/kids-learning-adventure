/**
 * 作答判定服务（Judge）属性测试
 *
 * 实现文件：src/engine/judge.ts（judgeAnswer / judgeQuestion / judgeGenerated，纯函数、同步、无 I/O）
 * 设计契约（design.md "Property 16: 判定与标准答案一致"，Validates: Requirements 6.5, 8.5）：
 * 对任意合法题目与任意学生作答，判定为对 当且仅当 作答与标准答案按该题型的比对规则相等；
 * 判定在本地完成、不依赖网络。
 *
 * 比对规则（按标准答案中定义的字段分派，choice > order > pairs > number > bool）：
 * - choice：选项 id 集合相等（与顺序无关，重复 id 去重后比对）
 * - order：序列严格相等（长度与逐元素相等）
 * - pairs：映射完全相等；标准答案与学生作答均接受 Record 或二元组数组两种表示，先归一化再比对
 * - number：|差值| ≤ JUDGE_EPSILON（1e-9）；NaN 恒不相等
 * - bool：严格相等
 *
 * 测试策略：
 * 1) 各题型定向生成"按规则相等"（必须 PASS）与"扰动后不等"（必须 FAIL）两类作答，
 *    断言判定结果与期望完全一致（覆盖 design 点名的关键场景：乱序集合 PASS、
 *    重排序列 FAIL、错配映射 FAIL、ε 内/外数值、翻转布尔）；
 * 2) 任意标准答案 × 任意学生作答的双条件属性：judgeAnswer 的结果与测试侧独立实现的
 *    规则 oracle 完全一致（iff 语义）；
 * 3) judgeQuestion / judgeGenerated 与 judgeAnswer 走同一判定管线。
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  JUDGE_EPSILON,
  judgeAnswer,
  judgeGenerated,
  judgeQuestion,
} from '../../src/engine/judge';
import type { PairsLike, StudentAnswer } from '../../src/engine/judge';
import type {
  GeneratedQuestion,
  Question,
  QuestionAnswer,
} from '../../src/types';

// ============ 测试侧独立实现的比对规则 oracle（按设计契约重写，不引用实现） ============

/** choice 规则：集合相等（与顺序无关） */
function oracleSetEquals(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) {
    return false;
  }
  for (const x of sa) {
    if (!sb.has(x)) {
      return false;
    }
  }
  return true;
}

/** pairs 规则前置：将 Record 或二元组数组归一化为 Record；非法表示返回 null */
function oracleNormalizePairs(pairs: unknown): Record<string, string> | null {
  if (pairs === undefined || pairs === null || typeof pairs !== 'object') {
    return null;
  }
  if (Array.isArray(pairs)) {
    const map: Record<string, string> = {};
    for (const entry of pairs) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        return null;
      }
      const [target, option] = entry as unknown[];
      if (typeof target !== 'string' || typeof option !== 'string') {
        return null;
      }
      map[target] = option;
    }
    return map;
  }
  const map: Record<string, string> = {};
  for (const key of Object.keys(pairs)) {
    const value = (pairs as Record<string, unknown>)[key];
    if (typeof value !== 'string') {
      return null;
    }
    map[key] = value;
  }
  return map;
}

/**
 * 判定 oracle：判定为对 当且仅当 作答与标准答案按该形态的比对规则相等。
 * 分派次序与契约一致（choice > order > pairs > number > bool）。
 */
function oracleJudge(answer: QuestionAnswer, student: StudentAnswer): boolean {
  if (answer.choice !== undefined) {
    return student.choice !== undefined && oracleSetEquals(answer.choice, student.choice);
  }
  if (answer.order !== undefined) {
    return (
      student.order !== undefined &&
      answer.order.length === student.order.length &&
      answer.order.every((v, i) => v === student.order![i])
    );
  }
  if (answer.pairs !== undefined) {
    const expected = oracleNormalizePairs(answer.pairs);
    const actual = oracleNormalizePairs(student.pairs);
    if (expected === null || actual === null) {
      return false;
    }
    const keys = Object.keys(expected);
    return (
      keys.length === Object.keys(actual).length &&
      keys.every((k) => actual[k] === expected[k])
    );
  }
  if (answer.number !== undefined) {
    return (
      student.number !== undefined &&
      !Number.isNaN(answer.number) &&
      !Number.isNaN(student.number) &&
      Math.abs(answer.number - student.number) <= JUDGE_EPSILON
    );
  }
  if (answer.bool !== undefined) {
    return student.bool === answer.bool;
  }
  return false;
}

// ============ 基础生成器 ============

/** 选项/槽位 id */
const idArb = fc.string({ minLength: 1, maxLength: 5 });

/** 确定性随机 shuffle：以随机排序键排序（同键时按原下标稳定） */
function shuffleArb<T>(arr: readonly T[]): fc.Arbitrary<T[]> {
  return fc
    .array(fc.integer({ min: 0, max: 1_000_000 }), {
      minLength: arr.length,
      maxLength: arr.length,
    })
    .map((keys) =>
      arr
        .map((v, i) => ({ v, k: keys[i], i }))
        .sort((x, y) => x.k - y.k || x.i - y.i)
        .map((e) => e.v),
    );
}

/** 定向用例：标准答案 + 学生作答 + 期望判定结果 */
interface JudgeCase {
  answer: QuestionAnswer;
  student: StudentAnswer;
  expected: boolean;
  label: string;
}

// ============ choice：判定 ⇔ 集合相等 ============

const choiceAnswerArb = fc.uniqueArray(idArb, { minLength: 1, maxLength: 6 });

const choiceCaseArb: fc.Arbitrary<JudgeCase> = choiceAnswerArb.chain((correct) =>
  fc.oneof(
    // 完全相同 → PASS
    fc.constant<JudgeCase>({
      answer: { choice: correct },
      student: { choice: [...correct] },
      expected: true,
      label: 'choice-exact',
    }),
    // 乱序但集合相等 → PASS（design 点名场景）
    shuffleArb(correct).map<JudgeCase>((shuffled) => ({
      answer: { choice: correct },
      student: { choice: shuffled },
      expected: true,
      label: 'choice-shuffled-pass',
    })),
    // 乱序 + 重复元素（去重后集合仍相等）→ PASS
    shuffleArb(correct).map<JudgeCase>((shuffled) => ({
      answer: { choice: correct },
      student: {
        choice: [...shuffled, ...shuffled.slice(0, Math.max(1, Math.floor(shuffled.length / 2)))],
      },
      expected: true,
      label: 'choice-shuffled-dupes-pass',
    })),
    // 多选一个集合外选项 → FAIL
    idArb
      .filter((x) => !correct.includes(x))
      .map<JudgeCase>((extra) => ({
        answer: { choice: correct },
        student: { choice: [...correct, extra] },
        expected: false,
        label: 'choice-extra-fail',
      })),
    // 漏选一个 → FAIL
    fc.integer({ min: 0, max: correct.length - 1 }).map<JudgeCase>((drop) => ({
      answer: { choice: correct },
      student: { choice: correct.filter((_, j) => j !== drop) },
      expected: false,
      label: 'choice-missing-one-fail',
    })),
    // 选错一个（替换为集合外选项）→ FAIL
    fc
      .tuple(
        fc.integer({ min: 0, max: correct.length - 1 }),
        idArb.filter((x) => !correct.includes(x)),
      )
      .map<JudgeCase>(([at, replacement]) => ({
        answer: { choice: correct },
        student: { choice: correct.map((v, j) => (j === at ? replacement : v)) },
        expected: false,
        label: 'choice-replaced-fail',
      })),
    // 学生作答缺失该字段 → FAIL
    fc.constant<JudgeCase>({
      answer: { choice: correct },
      student: {},
      expected: false,
      label: 'choice-field-missing-fail',
    }),
  ),
);

// ============ order：判定 ⇔ 序列严格相等 ============

const orderAnswerArb = fc.array(idArb, { minLength: 1, maxLength: 6 });

/** 至少 2 个不同元素的序列（保证存在非恒等排列） */
const orderDistinctArb = fc.uniqueArray(idArb, { minLength: 2, maxLength: 6 });

/** 生成一个与原序列不同的排列 */
function differentPermutationArb(arr: readonly string[]): fc.Arbitrary<string[]> {
  return shuffleArb(arr).map((shuffled) => {
    if (shuffled.some((v, i) => v !== arr[i])) {
      return shuffled;
    }
    // 偶发地洗回原序列：交换第一个与第一个不同元素的位置，必得不同序列
    const swapAt = arr.findIndex((v) => v !== arr[0]);
    const fixed = [...shuffled];
    [fixed[0], fixed[swapAt]] = [fixed[swapAt], fixed[0]];
    return fixed;
  });
}

const orderCaseArb: fc.Arbitrary<JudgeCase> = fc
  .oneof(
    // 完全相同 → PASS
    orderAnswerArb.map<JudgeCase>((correct) => ({
      answer: { order: correct },
      student: { order: [...correct] },
      expected: true,
      label: 'order-exact-pass',
    })),
    // 重排为不同序列 → FAIL（design 点名场景；与 choice 的乱序 PASS 形成对照）
    orderDistinctArb.chain((correct) =>
      differentPermutationArb(correct).map<JudgeCase>((reordered) => ({
        answer: { order: correct },
        student: { order: reordered },
        expected: false,
        label: 'order-reordered-fail',
      })),
    ),
    // 逆序（元素互异时必为不同序列）→ FAIL
    orderDistinctArb.map<JudgeCase>((correct) => ({
      answer: { order: correct },
      student: { order: [...correct].reverse() },
      expected: false,
      label: 'order-reversed-fail',
    })),
    // 长度更短（删去一个元素）→ FAIL
    fc
      .tuple(orderAnswerArb, fc.integer({ min: 0 }))
      .filter(([correct]) => correct.length >= 2)
      .map<JudgeCase>(([correct, drop]) => ({
        answer: { order: correct },
        student: { order: correct.filter((_, j) => j !== drop % correct.length) },
        expected: false,
        label: 'order-shorter-fail',
      })),
    // 长度更长（追加元素）→ FAIL
    fc.tuple(orderAnswerArb, idArb).map<JudgeCase>(([correct, extra]) => ({
      answer: { order: correct },
      student: { order: [...correct, extra] },
      expected: false,
      label: 'order-longer-fail',
    })),
    // 学生作答缺失该字段 → FAIL
    orderAnswerArb.map<JudgeCase>((correct) => ({
      answer: { order: correct },
      student: {},
      expected: false,
      label: 'order-field-missing-fail',
    })),
  );

// ============ pairs：判定 ⇔ 映射完全相等（两种表示均可） ============

/** pairs 标准答案：唯一目标槽 key × 任意选项 value，以二元组数组表示 */
const pairsTuplesArb = fc
  .uniqueArray(idArb, { minLength: 1, maxLength: 5 })
  .chain((keys) =>
    fc
      .array(idArb, { minLength: keys.length, maxLength: keys.length })
      .map((values) => keys.map((k, i) => [k, values[i]] as [string, string])),
  );

function tuplesToRecord(tuples: ReadonlyArray<readonly [string, string]>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [t, o] of tuples) {
    record[t] = o;
  }
  return record;
}

/** pairs 非法表示（归一化失败，应判错） */
const malformedPairsArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant([['only-target']]),
  fc.constant([['t1', 'a'], ['t2']]),
  fc.constant([['t1', 42]]),
  fc.constant('not-a-pairs'),
  fc.constant(123),
  fc.constant({ t1: 42 }),
);

const pairsCaseArb: fc.Arbitrary<JudgeCase> = pairsTuplesArb.chain((correct) => {
  const record = tuplesToRecord(correct);
  return fc.oneof(
    // Record 标准答案 × Record 相同作答 → PASS
    fc.constant<JudgeCase>({
      answer: { pairs: record },
      student: { pairs: { ...record } },
      expected: true,
      label: 'pairs-record-equal-pass',
    }),
    // Record 标准答案 × 乱序二元组数组作答（映射相等）→ PASS
    shuffleArb(correct).map<JudgeCase>((shuffled) => ({
      answer: { pairs: record },
      student: { pairs: shuffled as PairsLike },
      expected: true,
      label: 'pairs-tuples-equal-pass',
    })),
    // 二元组数组标准答案（种子数据表示）× Record 作答 → PASS
    shuffleArb(correct).map<JudgeCase>((answerTuples) => ({
      answer: { pairs: answerTuples as PairsLike } as unknown as QuestionAnswer,
      student: { pairs: { ...record } },
      expected: true,
      label: 'pairs-answer-as-tuples-pass',
    })),
    // 错配映射：某一目标槽配到不同选项 → FAIL（design 点名场景）
    fc
      .tuple(
        fc.integer({ min: 0, max: correct.length - 1 }),
        idArb.filter((v) => v !== ''),
      )
      .filter(([at, wrong]) => wrong !== correct[at][1])
      .map<JudgeCase>(([at, wrong]) => ({
        answer: { pairs: record },
        student: { pairs: { ...record, [correct[at][0]]: wrong } },
        expected: false,
        label: 'pairs-wrong-mapping-fail',
      })),
    // 缺少一个目标槽 → FAIL
    fc.integer({ min: 0, max: correct.length - 1 }).map<JudgeCase>((drop) => {
      const shrunk = { ...record };
      delete shrunk[correct[drop][0]];
      return {
        answer: { pairs: record },
        student: { pairs: shrunk },
        expected: false,
        label: 'pairs-missing-target-fail',
      };
    }),
    // 多出一个目标槽 → FAIL
    idArb
      .filter((k) => !(k in record))
      .map<JudgeCase>((extra) => ({
        answer: { pairs: record },
        student: { pairs: { ...record, [extra]: 'any' } },
        expected: false,
        label: 'pairs-extra-target-fail',
      })),
    // 学生作答表示非法（归一化失败）→ FAIL
    malformedPairsArb.map<JudgeCase>((malformed) => ({
      answer: { pairs: record },
      student: { pairs: malformed as PairsLike },
      expected: false,
      label: 'pairs-malformed-fail',
    })),
    // 学生作答缺失该字段 → FAIL
    fc.constant<JudgeCase>({
      answer: { pairs: record },
      student: {},
      expected: false,
      label: 'pairs-field-missing-fail',
    }),
  );
});

// ============ number：判定 ⇔ |差值| ≤ JUDGE_EPSILON ============

/**
 * 有界数值：|a| ≤ 1e4（ulp ≈ 1.8e-12 ≪ 1e-9），
 * 保证 ε 内/外两个区间的加减法不会被浮点舍入翻转判定结论。
 */
const boundedNumberArb = fc.double({ min: -1e4, max: 1e4, noNaN: true });

const signArb = fc.constantFrom(1, -1);

const numberCaseArb: fc.Arbitrary<JudgeCase> = boundedNumberArb.chain((correct) =>
  fc.oneof(
    // 完全相同 → PASS
    fc.constant<JudgeCase>({
      answer: { number: correct },
      student: { number: correct },
      expected: true,
      label: 'number-exact-pass',
    }),
    // 容差内（|Δ| ≤ 0.9e-9 < ε）→ PASS
    fc
      .tuple(fc.double({ min: 0, max: 0.9e-9, noNaN: true }), signArb)
      .map<JudgeCase>(([delta, sign]) => ({
        answer: { number: correct },
        student: { number: correct + delta * sign },
        expected: true,
        label: 'number-within-epsilon-pass',
      })),
    // 超出容差（|Δ| ≥ 1.1e-9 > ε）→ FAIL
    fc
      .tuple(fc.double({ min: 1.1e-9, max: 1e-5, noNaN: true }), signArb)
      .map<JudgeCase>(([delta, sign]) => ({
        answer: { number: correct },
        student: { number: correct + delta * sign },
        expected: false,
        label: 'number-beyond-epsilon-fail',
      })),
    // NaN 作答恒不相等 → FAIL
    fc.constant<JudgeCase>({
      answer: { number: correct },
      student: { number: NaN },
      expected: false,
      label: 'number-nan-fail',
    }),
    // 学生作答缺失该字段 → FAIL
    fc.constant<JudgeCase>({
      answer: { number: correct },
      student: {},
      expected: false,
      label: 'number-field-missing-fail',
    }),
  ),
);

// ============ bool：判定 ⇔ 严格相等 ============

const boolCaseArb: fc.Arbitrary<JudgeCase> = fc.boolean().chain((correct) =>
  fc.oneof(
    // 相同 → PASS
    fc.constant<JudgeCase>({
      answer: { bool: correct },
      student: { bool: correct },
      expected: true,
      label: 'bool-same-pass',
    }),
    // 翻转 → FAIL（design 点名场景）
    fc.constant<JudgeCase>({
      answer: { bool: correct },
      student: { bool: !correct },
      expected: false,
      label: 'bool-flipped-fail',
    }),
    // 学生作答缺失该字段 → FAIL
    fc.constant<JudgeCase>({
      answer: { bool: correct },
      student: {},
      expected: false,
      label: 'bool-field-missing-fail',
    }),
  ),
);

// ============ 双条件：任意标准答案 × 任意学生作答 ============

/** 任意形态的合法标准答案（恰含一种形态字段） */
const anyAnswerArb: fc.Arbitrary<QuestionAnswer> = fc.oneof(
  choiceAnswerArb.map<QuestionAnswer>((choice) => ({ choice })),
  orderAnswerArb.map<QuestionAnswer>((order) => ({ order })),
  pairsTuplesArb.map<QuestionAnswer>((tuples) => ({ pairs: tuplesToRecord(tuples) })),
  boundedNumberArb.map<QuestionAnswer>((number) => ({ number })),
  fc.boolean().map<QuestionAnswer>((bool) => ({ bool })),
);

/** 任意学生作答：各字段独立地出现或缺失（pairs 覆盖两种合法表示，number 含 NaN） */
const anyStudentArb: fc.Arbitrary<StudentAnswer> = fc.record({
  choice: fc.option(fc.array(idArb, { minLength: 1, maxLength: 6 }), { nil: undefined }),
  order: fc.option(fc.array(idArb, { minLength: 1, maxLength: 6 }), { nil: undefined }),
  pairs: fc.option(
    fc.oneof(
      pairsTuplesArb.map<PairsLike>((tuples) => tuplesToRecord(tuples)),
      pairsTuplesArb.map<PairsLike>((tuples) => tuples),
    ),
    { nil: undefined },
  ),
  number: fc.option(fc.oneof(boundedNumberArb, fc.constant(NaN)), { nil: undefined }),
  bool: fc.option(fc.boolean(), { nil: undefined }),
});

// ============ judgeQuestion 包装所需的最小合法 Question ============

function buildQuestion(answer: QuestionAnswer): Question {
  return {
    id: 'q-prop-16',
    subject: 'math',
    grade: 3,
    volume: 'A',
    unit: 'unit-1',
    type: 'choice',
    knowledgePointId: 'kp.prop16',
    difficulty: 3,
    stem: '判定包装测试题',
    answer,
    hint: 'hint',
    analysis: 'analysis',
    phase: 1,
  };
}

function buildGenerated(answer: number): GeneratedQuestion {
  return {
    signature: 'gen:prop16:00000000',
    generatorParamsId: 'prop16',
    knowledgePointId: 'kp.prop16',
    subject: 'math',
    type: 'oral',
    difficulty: 3,
    stem: '1 + 1 = ?',
    operands: { a: 1, b: 1 },
    answer,
  };
}

// ============ 属性测试 ============

describe('Judge 作答判定（属性测试）', () => {
  /**
   * **Feature: kids-learning-adventure, Property 16: 判定与标准答案一致**
   * **Validates: Requirements 6.5, 8.5**
   *
   * choice 形态：判定为对 当且仅当 学生选项 id 集合与标准答案集合相等（与顺序无关）。
   * 覆盖：完全相同、乱序相等、乱序+重复元素相等 → PASS；
   * 多选/漏选/错选、字段缺失 → FAIL。
   */
  it('Property 16: choice——判定 ⇔ 选项 id 集合相等（乱序集合必须 PASS）', () => {
    fc.assert(
      fc.property(choiceCaseArb, ({ answer, student, expected, label }) => {
        expect(
          judgeAnswer(answer, student),
          `${label}: judge(${JSON.stringify(answer)}, ${JSON.stringify(student)}) 应为 ${expected}`,
        ).toBe(expected);
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 16: 判定与标准答案一致**
   * **Validates: Requirements 6.5, 8.5**
   *
   * order 形态：判定为对 当且仅当 学生序列与标准答案序列严格相等。
   * 覆盖：完全相同 → PASS；重排/逆序/截短/加长、字段缺失 → FAIL。
   */
  it('Property 16: order——判定 ⇔ 序列严格相等（重排序列必须 FAIL）', () => {
    fc.assert(
      fc.property(orderCaseArb, ({ answer, student, expected, label }) => {
        expect(
          judgeAnswer(answer, student),
          `${label}: judge(${JSON.stringify(answer)}, ${JSON.stringify(student)}) 应为 ${expected}`,
        ).toBe(expected);
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 16: 判定与标准答案一致**
   * **Validates: Requirements 6.5, 8.5**
   *
   * pairs 形态：判定为对 当且仅当 归一化后的映射完全相等。
   * 覆盖：Record/二元组数组两种表示（含种子数据表示的标准答案）相等 → PASS；
   * 错配映射、缺槽、多槽、非法表示、字段缺失 → FAIL。
   */
  it('Property 16: pairs——判定 ⇔ 映射完全相等（错配映射必须 FAIL，两种表示互通）', () => {
    fc.assert(
      fc.property(pairsCaseArb, ({ answer, student, expected, label }) => {
        expect(
          judgeAnswer(answer, student),
          `${label}: judge(${JSON.stringify(answer)}, ${JSON.stringify(student)}) 应为 ${expected}`,
        ).toBe(expected);
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 16: 判定与标准答案一致**
   * **Validates: Requirements 6.5, 8.5**
   *
   * number 形态：判定为对 当且仅当 |学生值 − 标准值| ≤ JUDGE_EPSILON（1e-9）。
   * 覆盖：完全相同、容差内 → PASS；超出容差、NaN、字段缺失 → FAIL。
   */
  it('Property 16: number——判定 ⇔ 数值容差内相等（ε 内 PASS、ε 外 FAIL）', () => {
    fc.assert(
      fc.property(numberCaseArb, ({ answer, student, expected, label }) => {
        expect(
          judgeAnswer(answer, student),
          `${label}: judge(${JSON.stringify(answer)}, ${JSON.stringify(student)}) 应为 ${expected}`,
        ).toBe(expected);
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 16: 判定与标准答案一致**
   * **Validates: Requirements 6.5, 8.5**
   *
   * bool 形态：判定为对 当且仅当 学生布尔值与标准答案严格相等。
   * 覆盖：相同 → PASS；翻转、字段缺失 → FAIL。
   */
  it('Property 16: bool——判定 ⇔ 布尔严格相等（翻转必须 FAIL）', () => {
    fc.assert(
      fc.property(boolCaseArb, ({ answer, student, expected, label }) => {
        expect(
          judgeAnswer(answer, student),
          `${label}: judge(${JSON.stringify(answer)}, ${JSON.stringify(student)}) 应为 ${expected}`,
        ).toBe(expected);
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 16: 判定与标准答案一致**
   * **Validates: Requirements 6.5, 8.5**
   *
   * 双条件（iff）：对任意形态的标准答案与任意学生作答（字段任意出现/缺失、
   * pairs 两种表示、number 含 NaN），judgeAnswer 的结果与按设计契约独立重写的
   * oracle 完全一致——判定为对 当且仅当 作答按该形态规则与标准答案相等。
   */
  it('Property 16: 任意标准答案 × 任意学生作答——判定结果与规则 oracle 完全一致', () => {
    fc.assert(
      fc.property(anyAnswerArb, anyStudentArb, (answer, student) => {
        expect(
          judgeAnswer(answer, student),
          `judge(${JSON.stringify(answer)}, ${JSON.stringify(student)}) 应等于 oracle 结果`,
        ).toBe(oracleJudge(answer, student));
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 16: 判定与标准答案一致**
   * **Validates: Requirements 6.5, 8.5**
   *
   * 包装入口同管线：judgeQuestion 以题目自带标准答案判定，结果恒等于
   * judgeAnswer(question.answer, student)；judgeGenerated 与题库数值题同一
   * 数值容差规则（|Δ| ≤ ε 且 NaN 恒不相等）。
   */
  it('Property 16: judgeQuestion / judgeGenerated 与 judgeAnswer 同一判定管线', () => {
    fc.assert(
      fc.property(anyAnswerArb, anyStudentArb, (answer, student) => {
        const question = buildQuestion(answer);
        expect(judgeQuestion(question, student)).toBe(judgeAnswer(answer, student));
      }),
      { numRuns: 100 },
    );
    fc.assert(
      fc.property(
        boundedNumberArb,
        fc.oneof(boundedNumberArb, fc.constant(NaN)),
        (correct, studentNumber) => {
          const generated = buildGenerated(correct);
          const expected =
            !Number.isNaN(correct) &&
            !Number.isNaN(studentNumber) &&
            Math.abs(correct - studentNumber) <= JUDGE_EPSILON;
          expect(judgeGenerated(generated, studentNumber)).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 16: 判定与标准答案一致**
   * **Validates: Requirements 6.5, 8.5**
   *
   * 本地性：三个判定入口均为普通同步函数（非 async），调用即同步返回 boolean，
   * 不发起任何异步/网络工作——"1 秒内判定、无网络依赖"由纯本地比对天然满足。
   */
  it('Property 16: 判定为纯本地同步函数（同步返回 boolean，无异步/网络依赖）', () => {
    expect(judgeAnswer.constructor.name).toBe('Function');
    expect(judgeQuestion.constructor.name).toBe('Function');
    expect(judgeGenerated.constructor.name).toBe('Function');
    expect(typeof judgeAnswer({ bool: true }, { bool: true })).toBe('boolean');
    expect(typeof judgeQuestion(buildQuestion({ number: 7 }), { number: 7 })).toBe('boolean');
    expect(typeof judgeGenerated(buildGenerated(2), 2)).toBe('boolean');
  });
});
