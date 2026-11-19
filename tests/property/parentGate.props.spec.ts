/**
 * 家长确认挑战（Parent_Gate 门禁）属性测试
 *
 * 实现文件：src/engine/parentGate.ts（createParentGateChallenge / checkParentGateAnswer，纯函数、同步、无 I/O）
 * 设计契约（design.md "Property 13: 家长确认挑战生成与校验"，Validates: Requirements 1.2, 1.3）：
 * - 对任意随机源输出序列，createParentGateChallenge(rand) 生成的挑战满足：
 *   a、b 均为 [GATE_OPERAND_MIN, GATE_OPERAND_MAX]（即 [12,49]）内整数，且 answer = a + b；
 * - 对任意挑战，checkParentGateAnswer(challenge, String(challenge.answer)) 恒为 true；
 * - 对任意不等于 answer 的整数输入、空串、非数字字符串，校验恒为 false。
 *
 * 测试策略：
 * 1) 随机源输出序列定向覆盖常规 [0,1) 值、越界值（1、>1、负值）与非有限值（NaN/Infinity），
 *    断言任意序列下生成的挑战恒满足取值区间与 answer = a + b（实现将任意随机源输出归一化，
 *    故"任意随机源序列"全称成立）；
 * 2) 任意合法挑战 × 正确作答字符串（含首尾空白填充）→ 恒通过；
 * 3) 任意合法挑战 × 三类必败输入（不等于 answer 的整数、空串/空白串、非数字字符串）→ 恒不通过。
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  GATE_OPERAND_MAX,
  GATE_OPERAND_MIN,
  checkParentGateAnswer,
  createParentGateChallenge,
} from '../../src/engine/parentGate';
import type { ParentGateChallenge } from '../../src/engine/parentGate';

const NUM_RUNS = { numRuns: 100 };

// ============ fast-check arbitraries ============

/**
 * 任意随机源输出：覆盖常规 [0,1] 值、越界/负值，以及 NaN、±Infinity 等非有限值。
 * 实现契约要求对任意随机源输出序列性质成立，故注入面须超出 Math.random 的常态区间。
 */
const arbRandOutput: fc.Arbitrary<number> = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.double({ min: -1e9, max: 1e9, noNaN: true }),
  fc.constantFrom(NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1, -0, 2, -1),
);

/** 任意随机源输出序列（长度 ≥ 2，一次挑战消耗两次输出） */
const arbRandSequence: fc.Arbitrary<number[]> = fc.array(arbRandOutput, {
  minLength: 2,
  maxLength: 8,
});

/** 由随机源输出序列构造 rand：依次消费，耗尽后重复末位输出 */
function randFromSequence(sequence: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = sequence[Math.min(index, sequence.length - 1)];
    index += 1;
    return value;
  };
}

/** 任意合法挑战：操作数独立抽取自 [12,49]（等价于生成器输出空间） */
const arbChallenge: fc.Arbitrary<ParentGateChallenge> = fc
  .tuple(
    fc.integer({ min: GATE_OPERAND_MIN, max: GATE_OPERAND_MAX }),
    fc.integer({ min: GATE_OPERAND_MIN, max: GATE_OPERAND_MAX }),
  )
  .map(([a, b]) => ({ a, b, answer: a + b }));

/** 首尾空白填充（trim 可去除的 ASCII 空白） */
const arbWhitespacePadding: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 3 })
  .map((chars) => chars.join(''));

/** 十进制整数字符串形态（与实现判定规则同一形态，用于过滤生成必败输入） */
const DECIMAL_INTEGER_PATTERN = /^-?\d+$/;

/**
 * 非十进制整数字符串：trim 后不匹配整数形态。
 * 覆盖空串、纯空白串、字母、小数、科学计数、全角数字等任意非数字输入。
 */
const arbNonIntegerString: fc.Arbitrary<string> = fc
  .string({ minLength: 0, maxLength: 12 })
  .filter((s) => !DECIMAL_INTEGER_PATTERN.test(s.trim()));

/** 定向非数字样例（点名高频绕过尝试，与随机生成互补） */
const arbDirectedNonInteger: fc.Arbitrary<string> = fc.constantFrom(
  '',
  '   ',
  'abc',
  '12.5',
  '1e3',
  '12a',
  '+42',
  '--3',
  '４２',
  '四十二',
  '42\n43',
);

// ============ 属性测试 ============

describe('Parent_Gate 家长确认挑战（属性测试）', () => {
  /**
   * **Feature: child-grade-setting, Property 13: 家长确认挑战生成与校验**
   * **Validates: Requirements 1.2, 1.3**
   *
   * 生成侧：对任意随机源输出序列（含越界、负值、NaN、Infinity），
   * a、b 恒为 [12,49] 内整数且 answer 恒等于 a + b。
   */
  it('**Feature: child-grade-setting, Property 13: 家长确认挑战生成与校验** — 任意随机源序列：a、b ∈ [12,49] 且 answer = a + b', () => {
    // **Validates: Requirements 1.2, 1.3**
    expect(GATE_OPERAND_MIN).toBe(12);
    expect(GATE_OPERAND_MAX).toBe(49);
    fc.assert(
      fc.property(arbRandSequence, (sequence) => {
        const challenge = createParentGateChallenge(randFromSequence(sequence));
        expect(Number.isInteger(challenge.a)).toBe(true);
        expect(Number.isInteger(challenge.b)).toBe(true);
        expect(challenge.a).toBeGreaterThanOrEqual(GATE_OPERAND_MIN);
        expect(challenge.a).toBeLessThanOrEqual(GATE_OPERAND_MAX);
        expect(challenge.b).toBeGreaterThanOrEqual(GATE_OPERAND_MIN);
        expect(challenge.b).toBeLessThanOrEqual(GATE_OPERAND_MAX);
        expect(challenge.answer).toBe(challenge.a + challenge.b);
      }),
      NUM_RUNS,
    );
  });

  /**
   * **Feature: child-grade-setting, Property 13: 家长确认挑战生成与校验**
   * **Validates: Requirements 1.2, 1.3**
   *
   * 校验侧（通过半）：对任意挑战，String(answer) 恒通过；
   * 首尾填充空白后（trim 语义内）仍恒通过。
   */
  it('**Feature: child-grade-setting, Property 13: 家长确认挑战生成与校验** — 正确作答字符串恒通过', () => {
    // **Validates: Requirements 1.2, 1.3**
    fc.assert(
      fc.property(
        arbChallenge,
        arbWhitespacePadding,
        arbWhitespacePadding,
        (challenge, leftPad, rightPad) => {
          expect(checkParentGateAnswer(challenge, String(challenge.answer))).toBe(true);
          expect(
            checkParentGateAnswer(challenge, `${leftPad}${challenge.answer}${rightPad}`),
          ).toBe(true);
        },
      ),
      NUM_RUNS,
    );
  });

  /**
   * **Feature: child-grade-setting, Property 13: 家长确认挑战生成与校验**
   * **Validates: Requirements 1.2, 1.3**
   *
   * 校验侧（必败半之一）：任意不等于 answer 的整数输入（含负值、区间外值、
   * 首尾空白填充）恒不通过。
   */
  it('**Feature: child-grade-setting, Property 13: 家长确认挑战生成与校验** — 不等于 answer 的整数输入恒不通过', () => {
    // **Validates: Requirements 1.2, 1.3**
    fc.assert(
      fc.property(
        arbChallenge.chain((challenge) =>
          fc.tuple(
            fc.constant(challenge),
            fc.integer({ min: -10_000, max: 10_000 }).filter((n) => n !== challenge.answer),
            arbWhitespacePadding,
          ),
        ),
        ([challenge, wrongValue, pad]) => {
          expect(checkParentGateAnswer(challenge, String(wrongValue))).toBe(false);
          expect(checkParentGateAnswer(challenge, `${pad}${wrongValue}`)).toBe(false);
        },
      ),
      NUM_RUNS,
    );
  });

  /**
   * **Feature: child-grade-setting, Property 13: 家长确认挑战生成与校验**
   * **Validates: Requirements 1.2, 1.3**
   *
   * 校验侧（必败半之二）：空串、纯空白串与任意非数字字符串
   * （trim 后不匹配十进制整数形态）恒不通过。
   */
  it('**Feature: child-grade-setting, Property 13: 家长确认挑战生成与校验** — 空串与非数字字符串恒不通过', () => {
    // **Validates: Requirements 1.2, 1.3**
    fc.assert(
      fc.property(
        arbChallenge,
        fc.oneof(arbNonIntegerString, arbDirectedNonInteger),
        (challenge, input) => {
          expect(checkParentGateAnswer(challenge, input)).toBe(false);
        },
      ),
      NUM_RUNS,
    );
  });
});
