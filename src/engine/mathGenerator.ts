/**
 * 数学口算生成器（Math_Generator）
 *
 * 依据设计文档 "GeneratorParams（数学口算生成器参数）" 生成规则与
 * Property 17（口算生成器产出合法且答案正确，Validates: Requirements 7.3）实现：
 *
 * - 随机源通过参数注入（rand 与 Math.random 同契约，返回 [0,1)），纯函数、无 I/O；
 * - 操作数在各自 operands 范围内取样：integer=true 取整数；否则按 min/max 的小数位
 *   确定步长、以缩放整数离散取样，避免 0.1+0.2 之类的浮点伪影进入题干；
 * - 按 operation 计算真实答案；operation=mixed 时用 rand 从 + - × ÷ 中随机挑选，
 *   题干模板中的 {a}/{b}/{op} 占位符替换为实际数值与运算符号；
 * - 校验 constraints（resultMin/resultMax、divisible 整除、decimalPlaces 小数位上限），
 *   不满足则在有限次（100 次）内重采；要求整除的整数除法采用构造式取样
 *   （先取除数 b、再在可行区间内取商 q、被除数 a=b×q），保证可行参数下稳定产出整除结果；
 * - 有限次重采仍不满足时按设计错误处理策略放宽约束（仅保留"除数非 0"硬性合法条件），
 *   保证函数总能产出可作答的题目（"仍失败则换下一知识点题并记日志"由调用方负责）；
 * - answer 为按 operation 对生成操作数的真实计算结果，按 decimalPlaces 清理浮点伪影；
 * - signature 形如 gen:{paramsId}:{operandsHash}，operandsHash 为操作数对象的确定性
 *   FNV-1a 散列（mixed 时额外纳入实际抽中的运算，避免同操作数不同运算的签名冲突）。
 */

import type {
  GeneratedQuestion,
  GeneratorConstraints,
  GeneratorParams,
  OperandRange,
  OralOperation,
} from '../types';

/** 非 mixed 的具体运算 */
type ResolvedOperation = Exclude<OralOperation, 'mixed'>;

/** mixed 时随机挑选的运算池 */
const MIXED_OPERATIONS: readonly ResolvedOperation[] = ['add', 'sub', 'mul', 'div'];

/** 运算符号（与种子题库模板中使用的 ×、÷ 一致） */
const OP_SYMBOLS: Record<ResolvedOperation, string> = {
  add: '+',
  sub: '-',
  mul: '×',
  div: '÷',
};

/** 约束采样的最大重试次数（有限次重采，之后放宽约束） */
const MAX_SAMPLE_ATTEMPTS = 100;

/** 未指定 decimalPlaces 时清理浮点伪影所保留的小数位数 */
const ARTIFACT_CLEANUP_PLACES = 10;

/** 非整数操作数取样时保留的小数位上限 */
const MAX_OPERAND_DECIMALS = 6;

/** 浮点比较相对容差（用于区分真实小数位与浮点伪影） */
const EPSILON = 1e-9;

/** 一次取样的产出 */
interface Sample {
  /** 全部操作数（键与 params.operands 一致） */
  operands: Record<string, number>;
  /** 实际采用的运算（mixed 时已解析为具体运算） */
  operation: ResolvedOperation;
  /** 主操作数 a（被减数/被除数，按操作数键排序取第一个） */
  left: number;
  /** 主操作数 b（减数/除数，按操作数键排序取第二个） */
  right: number;
  /** 按 operation 对 left/right 的原始计算结果（未清理浮点伪影） */
  rawAnswer: number;
  /** 清理浮点伪影后的真实计算结果（GeneratedQuestion.answer 取值） */
  answer: number;
}

/**
 * 按知识点参数程序化生成一道口算题。
 *
 * @param params 口算生成器参数（题库 JSON 的 GeneratorParams）
 * @param rand 随机源，与 Math.random 同契约，返回 [0,1)
 * @returns 生成题目（题干、操作数、真实答案、确定性签名）
 */
export function generateOralQuestion(
  params: GeneratorParams,
  rand: () => number,
): GeneratedQuestion {
  const constraints = params.constraints;
  const places = constraints?.decimalPlaces ?? ARTIFACT_CLEANUP_PLACES;

  // 第一阶段：带全部 constraints 有限次重采
  let sample: Sample | null = null;
  for (let attempt = 0; attempt < MAX_SAMPLE_ATTEMPTS; attempt++) {
    const candidate = sampleOnce(params, constraints, places, rand);
    if (candidate !== null && passesConstraints(candidate, constraints)) {
      sample = candidate;
      break;
    }
  }

  // 第二阶段（错误处理：采样冲突，约束无法满足）：放宽 constraints，
  // 仅保留"除数非 0"硬性条件重新采样，保证总能产出题目
  if (sample === null) {
    sample = sampleRelaxed(params, places, rand);
  }

  return {
    signature: `gen:${params.id}:${hashOperands(
      sample.operands,
      sample.operation,
      params.operation === 'mixed',
    )}`,
    generatorParamsId: params.id,
    knowledgePointId: params.knowledgePointId,
    subject: 'math',
    type: 'oral',
    difficulty: params.difficulty,
    stem: buildStem(params.template, sample.operands, sample.operation),
    operands: sample.operands,
    answer: sample.answer,
  };
}

// ============ 取样 ============

/**
 * 单次取样。返回 null 表示本次取样不可行（如构造式除法的商区间为空），
 * 由调用方在有限次内重试。
 */
function sampleOnce(
  params: GeneratorParams,
  constraints: GeneratorConstraints | undefined,
  places: number,
  rand: () => number,
): Sample | null {
  const keys = Object.keys(params.operands).sort();
  if (keys.length === 0) {
    return null;
  }
  const operation = resolveOperation(params.operation, rand);

  // 整数除法且要求整除（divisible=true，或 decimalPlaces=0 等价于商须为整数）时，
  // 采用构造式取样，保证整除约束在可行参数下稳定命中
  if (
    operation === 'div' &&
    keys.length >= 2 &&
    requiresExactQuotient(constraints) &&
    params.operands[keys[0]].integer &&
    params.operands[keys[1]].integer
  ) {
    return sampleExactDivision(params, keys[0], keys[1], constraints, places, rand);
  }

  const operands: Record<string, number> = {};
  for (const key of keys) {
    operands[key] = sampleOperand(params.operands[key], rand);
  }
  const left = operands[keys[0]];
  const right = keys.length > 1 ? operands[keys[1]] : left;
  return makeSample(operands, operation, left, right, places);
}

/**
 * 构造式整除取样：先取除数 b，再在 [被除数范围 / b] 与 [resultMin, resultMax]
 * 的交集中取整数商 q，令被除数 a = b × q。b=0 或商区间为空时返回 null（重试）。
 */
function sampleExactDivision(
  params: GeneratorParams,
  dividendKey: string,
  divisorKey: string,
  constraints: GeneratorConstraints | undefined,
  places: number,
  rand: () => number,
): Sample | null {
  const rangeA = params.operands[dividendKey];
  const rangeB = params.operands[divisorKey];
  const divisor = sampleOperand(rangeB, rand);
  if (divisor === 0) {
    return null;
  }
  // 商的可行区间：被除数范围除以除数（除数为负时区间端点互换，取 min/max 兼容）
  const end1 = rangeA.min / divisor;
  const end2 = rangeA.max / divisor;
  let qLo = Math.ceil(Math.min(end1, end2));
  let qHi = Math.floor(Math.max(end1, end2));
  if (constraints?.resultMin !== undefined) {
    qLo = Math.max(qLo, Math.ceil(constraints.resultMin));
  }
  if (constraints?.resultMax !== undefined) {
    qHi = Math.min(qHi, Math.floor(constraints.resultMax));
  }
  if (qHi < qLo) {
    return null;
  }
  const quotient = qLo + randomIndex(qHi - qLo + 1, rand);
  const dividend = divisor * quotient;
  // 防御性校验：浮点边界漂移导致被除数越界时重试
  if (dividend < rangeA.min || dividend > rangeA.max) {
    return null;
  }

  const operands: Record<string, number> = {};
  for (const key of Object.keys(params.operands)) {
    if (key !== dividendKey && key !== divisorKey) {
      operands[key] = sampleOperand(params.operands[key], rand);
    }
  }
  operands[dividendKey] = dividend;
  operands[divisorKey] = divisor;
  return makeSample(operands, 'div', dividend, divisor, places);
}

/** 放宽约束的兜底取样：仅保留"除数非 0"硬性合法条件 */
function sampleRelaxed(
  params: GeneratorParams,
  places: number,
  rand: () => number,
): Sample {
  let lastResort: Sample | null = null;
  for (let attempt = 0; attempt < MAX_SAMPLE_ATTEMPTS; attempt++) {
    const candidate = sampleOnce(params, undefined, places, rand);
    if (candidate === null) {
      continue;
    }
    lastResort = lastResort ?? candidate;
    if (candidate.operation !== 'div' || candidate.right !== 0) {
      return candidate;
    }
  }
  if (lastResort !== null) {
    return lastResort;
  }
  // 极端路径（如操作数范围为空）：返回零值样本，保证函数总能产出题目
  const operands: Record<string, number> = {};
  for (const key of Object.keys(params.operands)) {
    operands[key] = 0;
  }
  const operation: ResolvedOperation = params.operation === 'mixed' ? 'add' : params.operation;
  return makeSample(operands, operation, 0, 0, places);
}

/** 在 [min, max]（含端点）内按 integer 标记取样一个操作数 */
function sampleOperand(range: OperandRange, rand: () => number): number {
  if (range.integer) {
    const lo = Math.ceil(range.min);
    const hi = Math.floor(range.max);
    if (hi < lo) {
      return lo;
    }
    return lo + randomIndex(hi - lo + 1, rand);
  }
  // 非整数：按 min/max 的小数位确定步长，以缩放整数取样，避免浮点伪影进入题干
  const decimals = Math.min(
    Math.max(countDecimals(range.min), countDecimals(range.max)),
    MAX_OPERAND_DECIMALS,
  );
  const scale = 10 ** decimals;
  const lo = Math.round(range.min * scale);
  const hi = Math.round(range.max * scale);
  if (hi < lo) {
    return Number((lo / scale).toFixed(decimals));
  }
  const k = lo + randomIndex(hi - lo + 1, rand);
  return Number((k / scale).toFixed(decimals));
}

/** 在 [0, span) 内取整数下标；对越界的 rand 返回值做防御性截断 */
function randomIndex(span: number, rand: () => number): number {
  return Math.min(Math.floor(rand() * span), span - 1);
}

/** mixed 时用随机源解析为具体运算；其余运算直接返回 */
function resolveOperation(operation: OralOperation, rand: () => number): ResolvedOperation {
  if (operation !== 'mixed') {
    return operation;
  }
  return MIXED_OPERATIONS[randomIndex(MIXED_OPERATIONS.length, rand)];
}

/** 是否需要整除：divisible=true，或 decimalPlaces=0（商须为整数，等价于整除） */
function requiresExactQuotient(constraints: GeneratorConstraints | undefined): boolean {
  return constraints?.divisible === true || constraints?.decimalPlaces === 0;
}

// ============ 约束校验 ============

/** 校验样本是否满足 constraints（"除数非 0"为硬性条件，先于约束判断） */
function passesConstraints(sample: Sample, constraints: GeneratorConstraints | undefined): boolean {
  if (sample.operation === 'div' && sample.right === 0) {
    return false;
  }
  if (constraints === undefined) {
    return true;
  }
  if (constraints.resultMin !== undefined && sample.answer < constraints.resultMin) {
    return false;
  }
  if (constraints.resultMax !== undefined && sample.answer > constraints.resultMax) {
    return false;
  }
  if (
    constraints.divisible === true &&
    sample.operation === 'div' &&
    !isNearInteger(sample.rawAnswer)
  ) {
    return false;
  }
  if (
    constraints.decimalPlaces !== undefined &&
    exceedsDecimalPlaces(sample.rawAnswer, constraints.decimalPlaces)
  ) {
    return false;
  }
  return true;
}

/** 判断原始结果的小数位是否真实超过上限（容差内的浮点伪影不算超过） */
function exceedsDecimalPlaces(raw: number, places: number): boolean {
  if (!Number.isFinite(raw)) {
    return true;
  }
  return Math.abs(raw - roundTo(raw, places)) > EPSILON * Math.max(1, Math.abs(raw));
}

/** 判断值是否为整数（容差内的浮点伪影视为整数） */
function isNearInteger(value: number): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }
  return Math.abs(value - Math.round(value)) <= EPSILON * Math.max(1, Math.abs(value));
}

// ============ 计算与格式化 ============

function makeSample(
  operands: Record<string, number>,
  operation: ResolvedOperation,
  left: number,
  right: number,
  places: number,
): Sample {
  const rawAnswer = computeAnswer(operation, left, right);
  return { operands, operation, left, right, rawAnswer, answer: roundTo(rawAnswer, places) };
}

/** 按 operation 计算两个操作数的真实结果 */
function computeAnswer(operation: ResolvedOperation, a: number, b: number): number {
  switch (operation) {
    case 'add':
      return a + b;
    case 'sub':
      return a - b;
    case 'mul':
      return a * b;
    case 'div':
      return a / b;
    default: {
      const unreachable: never = operation;
      throw new Error(`generateOralQuestion: 未知运算 ${String(unreachable)}`);
    }
  }
}

/**
 * 四舍五入到指定小数位并清理浮点伪影（如 0.1+0.2=0.30000000000000004 → 0.3）。
 * 结果经 toFixed 归一化，避免再次出现 0.30000000000000004 这类表示。
 */
function roundTo(value: number, places: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const factor = 10 ** places;
  return Number((Math.round(value * factor) / factor).toFixed(places));
}

/** 用生成数值与运算符号填充题干模板的 {a}/{b}/{op} 占位符 */
function buildStem(
  template: string,
  operands: Record<string, number>,
  operation: ResolvedOperation,
): string {
  let stem = template;
  for (const key of Object.keys(operands)) {
    stem = stem.split(`{${key}}`).join(String(operands[key]));
  }
  return stem.split('{op}').join(OP_SYMBOLS[operation]);
}

/** 统计数值最简十进制表示的小数位数（兼容科学计数法表示） */
function countDecimals(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  const s = String(n).toLowerCase();
  if (s.includes('e')) {
    const [mantissa, exponent] = s.split('e');
    const frac = mantissa.includes('.') ? mantissa.split('.')[1].length : 0;
    return Math.max(0, frac - Number(exponent));
  }
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * 操作数对象的确定性散列（FNV-1a 32 位，输出 8 位十六进制）。
 * 键排序后序列化，保证同一操作数集合散列稳定；
 * mixed 时把实际抽中的运算纳入散列输入，避免同操作数不同运算的签名冲突。
 */
function hashOperands(
  operands: Record<string, number>,
  operation: ResolvedOperation,
  mixed: boolean,
): string {
  const canonical = Object.keys(operands)
    .sort()
    .map((key) => `${key}=${operands[key]}`)
    .join(',');
  const input = mixed ? `${canonical}|op=${operation}` : canonical;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
