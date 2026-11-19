/**
 * Parent_Gate 门禁模块（纯函数）
 *
 * 依据 design.md「Components and Interfaces → Parent_Gate 门禁模块」实现：
 * 进入 Parent_Settings（孩子年级设置）前的家长确认挑战——随机两位数加法题
 * （如 "23 + 18 = ?"），用于防止低龄孩子误触修改设置。
 *
 * 设计约束：
 * - 纯函数实现：不做任何 I/O，不读取系统时钟，随机源通过参数注入（默认 Math.random）；
 * - 操作数 a、b 均为 [GATE_OPERAND_MIN, GATE_OPERAND_MAX]（即 [12,49]）内整数，
 *   answer 恒等于 a + b（和 ≤ 98，超出一、二年级课内心算范围，对家长零成本）；
 * - 答案校验：输入去除首尾空白后须为十进制整数字符串且数值等于 answer；
 *   空串、非数字、错误数值均不通过（Requirements 1.2, 1.3）。
 */

/** 家长确认挑战：两位数加法题 */
export interface ParentGateChallenge {
  a: number;
  b: number;
  /** 恒等于 a + b */
  answer: number;
}

/** 操作数取值下限（两位数，超出一、二年级心算范围） */
export const GATE_OPERAND_MIN = 12;

/** 操作数取值上限（保证和 ≤ 98） */
export const GATE_OPERAND_MAX = 49;

/** 操作数取值区间长度 */
const GATE_OPERAND_RANGE = GATE_OPERAND_MAX - GATE_OPERAND_MIN + 1;

/**
 * 将随机源输出归一化到 [0, 1) 区间：
 * Math.random 本身满足该区间；对注入的任意随机源输出（含越界值、负值），
 * 取小数部分映射回 [0, 1)，非有限值（NaN/Infinity）按 0 处理，
 * 保证任意随机源序列下操作数恒落在 [GATE_OPERAND_MIN, GATE_OPERAND_MAX] 内。
 */
function normalizeRandom(rand: () => number): number {
  const r = rand();
  if (!Number.isFinite(r)) {
    return 0;
  }
  return ((r % 1) + 1) % 1;
}

/**
 * 生成家长确认挑战：a、b 为 [GATE_OPERAND_MIN, GATE_OPERAND_MAX] 内整数，
 * answer = a + b。随机源注入（默认 Math.random），便于测试定盘。
 */
export function createParentGateChallenge(rand: () => number = Math.random): ParentGateChallenge {
  const a = GATE_OPERAND_MIN + Math.floor(normalizeRandom(rand) * GATE_OPERAND_RANGE);
  const b = GATE_OPERAND_MIN + Math.floor(normalizeRandom(rand) * GATE_OPERAND_RANGE);
  return { a, b, answer: a + b };
}

/** 十进制整数字符串形态：可选负号 + 至少一位数字（仅 ASCII 数字） */
const DECIMAL_INTEGER_PATTERN = /^-?\d+$/;

/**
 * 校验家长确认作答：输入去除首尾空白后须为十进制整数字符串，
 * 且数值等于 challenge.answer；空串、非数字、错误数值均返回 false。
 */
export function checkParentGateAnswer(challenge: ParentGateChallenge, input: string): boolean {
  if (typeof input !== 'string') {
    return false;
  }
  const trimmed = input.trim();
  if (!DECIMAL_INTEGER_PATTERN.test(trimmed)) {
    return false;
  }
  return Number.parseInt(trimmed, 10) === challenge.answer;
}
