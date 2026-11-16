/**
 * 数学口算生成器（Math_Generator）属性测试
 *
 * 实现文件：src/engine/mathGenerator.ts（generateOralQuestion，纯函数，随机源注入）
 * 种子参数：src/data/seed/generators-math.json（10 条真实 GeneratorParams，作为固定用例纳入属性运行）
 *
 * 实现契约（与实现文件头注释及设计文档 Error Handling 一致）：
 *  - 主路径：带全部 constraints 有限次（100 次）重采，产出满足全部约束的样本
 *    （resultMin/resultMax、divisible 整除、decimalPlaces 小数位上限）；
 *  - 放宽路径：主路径 100 次未命中时放宽 constraints，仅保留"除数非 0"硬性合法条件，
 *    保证函数总能产出可作答题目；
 *  - 两条路径都保证：操作数落在 operands 范围内、integer 标记被遵守、
 *    answer 等于按 operation 对生成操作数的真实计算结果（按 decimalPlaces 清浮点伪影）。
 *
 * 属性按此契约设计为恰好接受两种产出（全约束满足 / 放宽路径仅保除数非 0），
 * 并在"可行参数 × 统计随机源"下验证主路径被压倒性地命中（本文件断言 0 次放宽）。
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { generateOralQuestion } from '../../src/engine/mathGenerator';
import type {
  Difficulty,
  GeneratedQuestion,
  GeneratorConstraints,
  GeneratorParams,
  OperandRange,
  OralOperation,
} from '../../src/types';
import seedJson from '../../src/data/seed/generators-math.json';

// ============ 测试侧独立实现的设计公式（oracle） ============

type ResolvedOp = Exclude<OralOperation, 'mixed'>;

const RESOLVED_OPS: readonly ResolvedOp[] = ['add', 'sub', 'mul', 'div'];

const OP_SYMBOLS: Record<ResolvedOp, string> = {
  add: '+',
  sub: '-',
  mul: '×',
  div: '÷',
};

/** 与实现一致的浮点比较相对容差 */
const EPS = 1e-9;

/** 未指定 decimalPlaces 时实现用于清浮点伪影的小数位（与实现常量一致） */
const DEFAULT_PLACES = 10;

/** 按 operation 对两个操作数求真实结果（设计公式） */
function computeOp(op: ResolvedOp, a: number, b: number): number {
  switch (op) {
    case 'add':
      return a + b;
    case 'sub':
      return a - b;
    case 'mul':
      return a * b;
    case 'div':
      return a / b;
  }
}

/** 四舍五入到指定小数位（清浮点伪影，与设计公式一致） */
function roundTo(value: number, places: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const factor = 10 ** places;
  return Number((Math.round(value * factor) / factor).toFixed(places));
}

/** 模板填充（{a}/{b}/{op} 占位符替换，与实现一致） */
function fillStem(template: string, operands: Record<string, number>, op: ResolvedOp): string {
  let stem = template;
  for (const key of Object.keys(operands)) {
    stem = stem.split(`{${key}}`).join(String(operands[key]));
  }
  return stem.split('{op}').join(OP_SYMBOLS[op]);
}

function isNearInteger(value: number): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }
  return Math.abs(value - Math.round(value)) <= EPS * Math.max(1, Math.abs(value));
}

function exceedsDecimalPlaces(raw: number, places: number): boolean {
  if (!Number.isFinite(raw)) {
    return true;
  }
  return Math.abs(raw - roundTo(raw, places)) > EPS * Math.max(1, Math.abs(raw));
}

/**
 * 镜像实现的约束校验（含"除法除数非 0"硬性条件）：
 * resultMin/resultMax 作用于清伪影后的 answer，divisible/decimalPlaces 作用于原始结果。
 */
function constraintsHold(
  params: GeneratorParams,
  op: ResolvedOp,
  left: number,
  right: number,
  answer: number,
): boolean {
  if (op === 'div' && right === 0) {
    return false;
  }
  const c = params.constraints;
  if (c === undefined) {
    return true;
  }
  const raw = computeOp(op, left, right);
  if (c.resultMin !== undefined && answer < c.resultMin) {
    return false;
  }
  if (c.resultMax !== undefined && answer > c.resultMax) {
    return false;
  }
  if (c.divisible === true && op === 'div' && !isNearInteger(raw)) {
    return false;
  }
  if (c.decimalPlaces !== undefined && exceedsDecimalPlaces(raw, c.decimalPlaces)) {
    return false;
  }
  return true;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============ 随机源生成器 ============

/** mulberry32 确定性 PRNG：与 Math.random 同契约，返回 [0,1) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 统计随机源：由 fast-check 整数种子驱动的确定性 PRNG */
const prngRandArb: fc.Arbitrary<() => number> = fc
  .integer({ min: 0, max: 0xffffffff })
  .map((seed) => mulberry32(seed));

/**
 * 对抗性随机源：短 double 序列循环消费。
 * 覆盖常数序列（如永远返回同一个值）、全 0 序列等极端随机源，
 * 用于验证"放宽路径"契约仍被遵守。序列值裁剪到 [0,1) 契约内。
 */
const cyclicRandArb: fc.Arbitrary<() => number> = fc
  .array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 24 })
  .map((values) => {
    const clamped = values.map((v) => (v >= 1 ? 1 - Number.EPSILON : v < 0 || Object.is(v, -0) ? 0 : v));
    let i = 0;
    return () => clamped[i++ % clamped.length];
  });

// ============ 合法 GeneratorParams 生成器 ============

const metaArb = fc.record({
  grade: fc.constantFrom(3, 4),
  difficulty: fc.constantFrom<Difficulty>(1, 2, 3, 4, 5),
});

const idArb = fc.integer({ min: 0, max: 1_000_000_000 }).map((n) => `gen-prop-${n}`);

/** 非负整数范围（含端点，min ≤ max，min ≥ 0） */
const nonNegIntRangeArb: fc.Arbitrary<OperandRange> = fc
  .tuple(fc.integer({ min: 0, max: 500 }), fc.integer({ min: 0, max: 500 }))
  .map(([x, y]) => ({ min: Math.min(x, y), max: Math.max(x, y), integer: true }));

/** 正整数范围（除数用，min ≥ 1，保证合法参数下除法存在非 0 除数） */
const posIntRangeArb = (minLo: number, maxHi: number): fc.Arbitrary<OperandRange> =>
  fc
    .tuple(fc.integer({ min: minLo, max: maxHi }), fc.integer({ min: minLo, max: maxHi }))
    .map(([x, y]) => ({ min: Math.min(x, y), max: Math.max(x, y), integer: true }));

/** 小数范围（1~2 位小数，min ≤ max），附带小数位数供约束构造使用 */
const decimalRangeArb: fc.Arbitrary<{ range: OperandRange; decimals: number }> = fc
  .tuple(
    fc.integer({ min: 0, max: 2000 }),
    fc.integer({ min: 0, max: 2000 }),
    fc.constantFrom(1, 2),
  )
  .map(([x, y, d]) => ({
    range: { min: Math.min(x, y) / 10 ** d, max: Math.max(x, y) / 10 ** d, integer: false },
    decimals: d,
  }));

const FIXED_TEMPLATES: Record<ResolvedOp, string[]> = {
  add: ['{a} + {b} = ?', '{a}+{b}=?'],
  sub: ['{a} - {b} = ?', '{a}-{b}=?'],
  mul: ['{a} × {b} = ?', '{a}×{b}=?'],
  div: ['{a} ÷ {b} = ?', '{a}÷{b}=?'],
};

const MIXED_TEMPLATES = ['{a} {op} {b} = ?', '{a}{op}{b}=?'];

interface Meta {
  grade: number;
  difficulty: Difficulty;
}

function buildParams(
  op: OralOperation,
  operands: Record<string, OperandRange>,
  constraints: GeneratorConstraints | undefined,
  template: string,
  meta: Meta,
  id: string,
): GeneratorParams {
  return {
    id,
    knowledgePointId: `math.g${meta.grade}.prop.${op}`,
    grade: meta.grade,
    difficulty: meta.difficulty,
    template,
    operands,
    operation: op,
    constraints,
    answerFormat: 'number',
  };
}

/** 非负操作数下按四角计算结果的真实可达区间 */
function opResultInterval(op: ResolvedOp, a: OperandRange, b: OperandRange): [number, number] {
  const vals = [
    computeOp(op, a.min, b.min),
    computeOp(op, a.min, b.max),
    computeOp(op, a.max, b.min),
    computeOp(op, a.max, b.max),
  ];
  return [Math.min(...vals), Math.max(...vals)];
}

/** 操作数取样网格的缩放因子（与实现 sampleOperand 一致：整数步长 1，小数按 10^decimals 缩放） */
function operandGridScale(range: OperandRange): number {
  if (range.integer) {
    return 1;
  }
  const decimalsOf = (n: number): number => {
    const s = String(n).toLowerCase();
    if (s.includes('e')) {
      const [mantissa, exponent] = s.split('e');
      const frac = mantissa.includes('.') ? mantissa.split('.')[1].length : 0;
      return Math.max(0, frac - Number(exponent));
    }
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  };
  return 10 ** Math.min(Math.max(decimalsOf(range.min), decimalsOf(range.max)), 6);
}

/** b 网格（[bLoK, bHiK] 整点 / scale）中落在结果区间 [rLo, rHi] 内的取值个数 */
function countGridValuesInInterval(
  bLoK: number,
  bHiK: number,
  scale: number,
  rLo: number,
  rHi: number,
): number {
  const kLo = Math.max(bLoK, Math.ceil(rLo * scale - 1e-6));
  const kHi = Math.min(bHiK, Math.floor(rHi * scale + 1e-6));
  return Math.max(0, kHi - kLo + 1);
}

/**
 * 窗口 [rMin, rMax] 在均匀网格采样下的精确命中概率（仅 add/sub/mul 使用该窗口）。
 * 对每个 a 网格值，以 O(1) 区间计数累加使命中窗口的 b 网格值个数；
 * 命中概率 < MIN_WINDOW_HIT_PROBABILITY 时调用方应放宽窗口，
 * 否则"可行参数 0 次放宽"的统计断言无法稳定成立。
 */
function windowHitProbability(
  op: ResolvedOp,
  a: OperandRange,
  b: OperandRange,
  rMin: number,
  rMax: number,
): number {
  const sa = operandGridScale(a);
  const sb = operandGridScale(b);
  const aLoK = Math.round(a.min * sa);
  const aHiK = Math.round(a.max * sa);
  const bLoK = Math.round(b.min * sb);
  const bHiK = Math.round(b.max * sb);
  const bCount = bHiK - bLoK + 1;
  let hit = 0;
  for (let ak = aLoK; ak <= aHiK; ak++) {
    const av = ak / sa;
    if (op === 'add') {
      hit += countGridValuesInInterval(bLoK, bHiK, sb, rMin - av, rMax - av);
    } else if (op === 'sub') {
      hit += countGridValuesInInterval(bLoK, bHiK, sb, av - rMax, av - rMin);
    } else if (op === 'mul') {
      if (av === 0) {
        hit += rMin <= 0 && 0 <= rMax ? bCount : 0;
      } else {
        hit += countGridValuesInInterval(bLoK, bHiK, sb, rMin / av, rMax / av);
      }
    } else {
      return 0;
    }
  }
  return hit / ((aHiK - aLoK + 1) * bCount);
}

/** 窗口约束的最低单次命中概率：低于该值时 100 次重采仍有可观概率全部落空 */
const MIN_WINDOW_HIT_PROBABILITY = 0.2;

/**
 * 居中窗口约束：在真实可达区间中部取一个宽度 ≥ 30% 区间的窗口。
 * 离散结果集（整数/小数网格）上连续窗口可能恰好不含任何可达值
 * （如 a∈{3}、b∈{2,3} 的乘积只有 6 与 9，窗口 [7.05,7.95] 不可行），
 * 或命中率过低导致 100 次重采仍落空；故按网格精确枚举命中概率，
 * 不足时退化为全可达区间 [lo,hi]（命中率 1），保证参数可行且主路径统计必然命中。
 */
function windowConstraintsArb(
  op: ResolvedOp,
  a: OperandRange,
  b: OperandRange,
  dpChoices: (number | undefined)[],
): fc.Arbitrary<GeneratorConstraints | undefined> {
  const [lo, hi] = opResultInterval(op, a, b);
  return fc.oneof(
    fc.constant(undefined),
    fc
      .tuple(fc.double({ min: 0.3, max: 1, noNaN: true }), fc.constantFrom(...dpChoices))
      .map(([f, dp]) => {
        const mid = (lo + hi) / 2;
        const half = (hi - lo) / 2;
        let resultMin = mid - f * half;
        let resultMax = mid + f * half;
        if (windowHitProbability(op, a, b, resultMin, resultMax) < MIN_WINDOW_HIT_PROBABILITY) {
          resultMin = lo;
          resultMax = hi;
        }
        const c: GeneratorConstraints = {
          resultMin,
          resultMax,
          divisible: false,
        };
        if (dp !== undefined) {
          c.decimalPlaces = dp;
        }
        return c;
      }),
  );
}

const templateArb = (op: ResolvedOp) => fc.constantFrom(...FIXED_TEMPLATES[op]);

/** 整数加/减/乘：窗口约束 + 任意小数位上限（整数结果必满足） */
const intBinaryParamsArb = (op: 'add' | 'sub' | 'mul'): fc.Arbitrary<GeneratorParams> =>
  fc
    .tuple(nonNegIntRangeArb, nonNegIntRangeArb, metaArb, idArb, templateArb(op))
    .chain(([a, b, meta, id, template]) =>
      windowConstraintsArb(op, a, b, [undefined, 0, 1, 2]).map((constraints) =>
        buildParams(op, { a, b }, constraints, template, meta, id),
      ),
    );

/** 小数加/减：小数位上限取操作数小数位最大值（结果必满足） */
const decimalAddSubParamsArb = (op: 'add' | 'sub'): fc.Arbitrary<GeneratorParams> =>
  fc
    .tuple(decimalRangeArb, decimalRangeArb, metaArb, idArb, templateArb(op))
    .chain(([ra, rb, meta, id, template]) => {
      const bound = Math.max(ra.decimals, rb.decimals);
      return windowConstraintsArb(op, ra.range, rb.range, [bound, bound + 1]).map((constraints) =>
        buildParams(op, { a: ra.range, b: rb.range }, constraints, template, meta, id),
      );
    });

/** 小数乘：小数位上限取两操作数小数位之和（结果必满足） */
const decimalMulParamsArb: fc.Arbitrary<GeneratorParams> = fc
  .tuple(decimalRangeArb, decimalRangeArb, metaArb, idArb, templateArb('mul'))
  .chain(([ra, rb, meta, id, template]) => {
    const bound = ra.decimals + rb.decimals;
    return windowConstraintsArb('mul', ra.range, rb.range, [bound, bound + 1]).map((constraints) =>
      buildParams('mul', { a: ra.range, b: rb.range }, constraints, template, meta, id),
    );
  });

/**
 * 减法非负约束（resultMin=0）：a 区间随机占优 b 区间（a.min ≥ b.min 且 a.max ≥ b.max），
 * 保证可行且单次命中率 ≥ 1/2。
 */
const subNonNegParamsArb: fc.Arbitrary<GeneratorParams> = fc
  .tuple(nonNegIntRangeArb, metaArb, idArb, templateArb('sub'), fc.constantFrom(0, 1, 2))
  .chain(([b, meta, id, template, dp]) =>
    fc
      .tuple(
        fc.integer({ min: b.min, max: b.max }),
        fc.integer({ min: b.max, max: b.max + 200 }),
      )
      .map(([aMin, aMax]) => {
        const a: OperandRange = { min: aMin, max: aMax, integer: true };
        const constraints: GeneratorConstraints = {
          resultMin: 0,
          resultMax: a.max - b.min,
          divisible: false,
          decimalPlaces: dp,
        };
        return buildParams('sub', { a, b }, constraints, template, meta, id);
      }),
  );

/**
 * 整数整除（divisible 或 decimalPlaces=0 触发实现的构造式取样）：
 * 先取商区间 [qLo,qHi] 与除数区间 [bLo,bHi]，被除数区间取 [bLo*qLo, bHi*qHi]，
 * 使任意除数下商区间都非空，构造式取样首次必命中。
 */
const divExactParamsArb: fc.Arbitrary<GeneratorParams> = fc
  .tuple(
    fc.integer({ min: 1, max: 50 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 50 }),
    fc.integer({ min: 0, max: 200 }),
    metaArb,
    idArb,
    templateArb('div'),
  )
  .chain(([bLo, bPad, qLo, qPad, meta, id, template]) => {
    const bHi = bLo + bPad;
    const qHi = qLo + qPad;
    const a: OperandRange = { min: bLo * qLo, max: bHi * qHi, integer: true };
    const b: OperandRange = { min: bLo, max: bHi, integer: true };
    return fc
      .tuple(
        fc.integer({ min: qLo, max: qHi }),
        fc.integer({ min: qLo, max: qHi }),
        fc.constantFrom<'divisible' | 'places' | 'both'>('divisible', 'places', 'both'),
      )
      .map(([r1, r2, flavor]) => {
        const constraints: GeneratorConstraints = {
          resultMin: Math.min(r1, r2),
          resultMax: Math.max(r1, r2),
        };
        if (flavor !== 'places') {
          constraints.divisible = true;
        }
        if (flavor !== 'divisible') {
          constraints.decimalPlaces = 0;
        }
        return buildParams('div', { a, b }, constraints, template, meta, id);
      });
  });

/**
 * 自由整数除法（不要求整除）：范围比值受限（max/min ≤ 10），
 * 以商的中心锚定 ±50%~100% 窗口，单次命中率 ≥ ~0.4。
 */
const divFreeParamsArb: fc.Arbitrary<GeneratorParams> = fc
  .tuple(
    fc.integer({ min: 1, max: 100 }),
    fc.integer({ min: 1, max: 10 }),
    fc.integer({ min: 1, max: 50 }),
    fc.integer({ min: 1, max: 10 }),
    fc.double({ min: 0.5, max: 1, noNaN: true }),
    metaArb,
    idArb,
    templateArb('div'),
  )
  .map(([aLo, aFactor, bLo, bFactor, g, meta, id, template]) => {
    const a: OperandRange = { min: aLo, max: aLo * aFactor, integer: true };
    const b: OperandRange = { min: bLo, max: bLo * bFactor, integer: true };
    const q0 = (a.min + a.max) / 2 / ((b.min + b.max) / 2);
    const constraints: GeneratorConstraints = {
      resultMin: Math.max(0, q0 * (1 - g)),
      resultMax: q0 * (1 + g),
      divisible: false,
    };
    return buildParams('div', { a, b }, constraints, template, meta, id);
  });

/**
 * mixed 混合运算：resultMax 取全部运算结果上界（永不拒绝），
 * resultMin 可取 0（减法非负）、decimalPlaces 可取小整数（除法须整除），
 * 拒绝概率被 add/sub/mul 分支稀释，主路径统计必然命中。
 */
const mixedParamsArb: fc.Arbitrary<GeneratorParams> = fc
  .tuple(
    nonNegIntRangeArb,
    posIntRangeArb(1, 99),
    metaArb,
    idArb,
    fc.constantFrom(...MIXED_TEMPLATES),
    fc.constantFrom(undefined, 0, 1, 2),
    fc.boolean(),
    fc.boolean(),
  )
  .map(([a, b, meta, id, template, dp, withMin, withDivisible]) => {
    const hi = Math.max(a.max + b.max, a.max - b.min, a.max * b.max, a.max / b.min);
    const constraints: GeneratorConstraints = { resultMax: hi };
    if (withMin) {
      constraints.resultMin = 0;
    }
    if (dp !== undefined) {
      constraints.decimalPlaces = dp;
    }
    if (withDivisible) {
      constraints.divisible = true;
    }
    return buildParams('mixed', { a, b }, constraints, template, meta, id);
  });

/** 合法且可行的 GeneratorParams 全覆盖生成器 */
const paramsArb: fc.Arbitrary<GeneratorParams> = fc.oneof(
  intBinaryParamsArb('add'),
  intBinaryParamsArb('sub'),
  intBinaryParamsArb('mul'),
  decimalAddSubParamsArb('add'),
  decimalAddSubParamsArb('sub'),
  decimalMulParamsArb,
  subNonNegParamsArb,
  divExactParamsArb,
  divFreeParamsArb,
  mixedParamsArb,
);

/** 种子题库 10 条真实 GeneratorParams（固定用例） */
const seedParams = (seedJson as { generators: unknown[] }).generators as GeneratorParams[];
const seedParamsArb: fc.Arbitrary<GeneratorParams> = fc.constantFrom(...seedParams);

// ============ 契约断言 ============

interface ContractOutcome {
  /** true = 命中放宽路径（全约束未满足，仅验证"除数非 0"硬性条件） */
  relaxed: boolean;
}

/**
 * 断言生成题满足 Property 17 契约：
 * 结构字段与签名格式、操作数落范围与 integer 标记、题干模板填充、
 * 答案等于真实计算结果，以及"全约束满足 / 放宽路径仅保除数非 0"二选一。
 * mode='strict' 用于可行参数 × 统计随机源：要求必须命中全约束主路径。
 */
function assertQuestionContract(
  params: GeneratorParams,
  q: GeneratedQuestion,
  mode: 'strict' | 'tolerant',
): ContractOutcome {
  // ---- 结构字段与签名格式 gen:{paramsId}:{operandsHash} ----
  expect(q.generatorParamsId).toBe(params.id);
  expect(q.knowledgePointId).toBe(params.knowledgePointId);
  expect(q.subject).toBe('math');
  expect(q.type).toBe('oral');
  expect(q.difficulty).toBe(params.difficulty);
  expect(q.signature).toMatch(new RegExp(`^gen:${escapeRegExp(params.id)}:[0-9a-f]{8}$`));

  // ---- 操作数：键一致、落在 operands 范围内、integer 标记被遵守 ----
  expect(Object.keys(q.operands).sort()).toEqual(Object.keys(params.operands).sort());
  for (const [key, range] of Object.entries(params.operands)) {
    const v = q.operands[key];
    expect(Number.isFinite(v), `操作数 ${key}=${v} 应为有限数`).toBe(true);
    expect(v, `操作数 ${key}=${v} 应 ≥ ${range.min}`).toBeGreaterThanOrEqual(range.min);
    expect(v, `操作数 ${key}=${v} 应 ≤ ${range.max}`).toBeLessThanOrEqual(range.max);
    if (range.integer) {
      expect(Number.isInteger(v), `操作数 ${key}=${v} 应为整数`).toBe(true);
    }
  }

  // ---- 题干：模板占位符全部替换，且与某一具体运算的填充结果完全一致 ----
  expect(q.stem).not.toContain('{a}');
  expect(q.stem).not.toContain('{b}');
  expect(q.stem).not.toContain('{op}');
  let op: ResolvedOp;
  if (params.operation === 'mixed') {
    const candidates = RESOLVED_OPS.filter((o) => fillStem(params.template, q.operands, o) === q.stem);
    expect(candidates, `题干 "${q.stem}" 应恰匹配一种运算的模板填充`).toHaveLength(1);
    op = candidates[0];
  } else {
    op = params.operation;
    expect(q.stem).toBe(fillStem(params.template, q.operands, op));
  }

  // ---- 答案：等于按 operation 对生成操作数的真实计算结果（清浮点伪影后） ----
  const keys = Object.keys(params.operands).sort();
  const left = q.operands[keys[0]];
  const right = q.operands[keys[1]];
  const places = params.constraints?.decimalPlaces ?? DEFAULT_PLACES;
  const expected = roundTo(computeOp(op, left, right), places);
  const answerOk =
    q.answer === expected ||
    Math.abs(q.answer - expected) <= EPS * Math.max(1, Math.abs(expected));
  expect(answerOk, `答案 ${q.answer} 应等于真实计算结果 ${expected}（${left} ${OP_SYMBOLS[op]} ${right}）`).toBe(true);

  // ---- 约束：全约束满足（主路径）或仅保"除数非 0"（放宽路径） ----
  const satisfied = constraintsHold(params, op, left, right, q.answer);
  if (satisfied) {
    return { relaxed: false };
  }
  if (mode === 'strict') {
    expect(
      satisfied,
      `可行参数下主路径应命中全约束（op=${op}, a=${left}, b=${right}, constraints=${JSON.stringify(params.constraints)}）`,
    ).toBe(true);
  }
  // 放宽路径唯一保留的硬性合法条件：除法除数非 0
  if (op === 'div') {
    expect(right, '放宽路径下除法除数仍应非 0').not.toBe(0);
  }
  return { relaxed: true };
}

// ============ 属性测试 ============

describe('Math_Generator 口算生成器（属性测试）', () => {
  /**
   * **Feature: kids-learning-adventure, Property 17: 口算生成器产出合法且答案正确**
   * **Validates: Requirements 7.3**
   *
   * 可行参数 × 统计随机源：对任意合法可行的 GeneratorParams 与任意 PRNG 随机源，
   * 生成题操作数落范围、integer 标记被遵守、答案等于真实计算结果，
   * 且全部 constraints 满足（主路径命中）——可行参数下放宽路径应 0 次出现。
   */
  it('Property 17: 可行参数 × 统计随机源——操作数合法、答案正确、全约束满足', () => {
    let relaxedCount = 0;
    fc.assert(
      fc.property(paramsArb, prngRandArb, (params, rand) => {
        const q = generateOralQuestion(params, rand);
        if (assertQuestionContract(params, q, 'strict').relaxed) {
          relaxedCount++;
        }
      }),
      { numRuns: 300 },
    );
    // 主路径被压倒性行使：可行参数下 100 次重采统计必然命中，放宽路径 0 次
    expect(relaxedCount).toBe(0);
  });

  /**
   * **Feature: kids-learning-adventure, Property 17: 口算生成器产出合法且答案正确**
   * **Validates: Requirements 7.3**
   *
   * 可行参数 × 对抗性随机源（循环 double 序列，含常数/全 0 等极端序列）：
   * 任何随机源下操作数合法性与答案正确性恒成立；
   * 约束满足或命中放宽路径（仅保"除数非 0"）——恰好这两种产出被接受。
   */
  it('Property 17: 可行参数 × 对抗性随机源——两产出契约（全约束 或 仅除数非 0）', () => {
    let primaryCount = 0;
    let relaxedCount = 0;
    fc.assert(
      fc.property(paramsArb, cyclicRandArb, (params, rand) => {
        const q = generateOralQuestion(params, rand);
        if (assertQuestionContract(params, q, 'tolerant').relaxed) {
          relaxedCount++;
        } else {
          primaryCount++;
        }
      }),
      { numRuns: 200 },
    );
    // 健全性：对抗性随机源下主路径仍应大量命中（生成器不是永远在放宽）
    expect(primaryCount).toBeGreaterThan(0);
  });

  /**
   * **Feature: kids-learning-adventure, Property 17: 口算生成器产出合法且答案正确**
   * **Validates: Requirements 7.3**
   *
   * 固定用例：种子题库 10 条真实 GeneratorParams × 统计随机源。
   * 种子参数均为可行参数（单次命中率 ≥ ~1/2），主路径应 0 次放宽。
   */
  it('Property 17: 种子题库 10 条真实参数 × 统计随机源——全约束满足', () => {
    expect(seedParams).toHaveLength(10);
    let relaxedCount = 0;
    fc.assert(
      fc.property(seedParamsArb, prngRandArb, (params, rand) => {
        const q = generateOralQuestion(params, rand);
        if (assertQuestionContract(params, q, 'strict').relaxed) {
          relaxedCount++;
        }
      }),
      { numRuns: 200 },
    );
    expect(relaxedCount).toBe(0);
  });

  /**
   * **Feature: kids-learning-adventure, Property 17: 口算生成器产出合法且答案正确**
   * **Validates: Requirements 7.3**
   *
   * 固定用例：种子题库 10 条真实 GeneratorParams × 对抗性随机源。
   * 极端随机源（如常数序列迫使 100 次重采全部拒绝）下放宽路径可以出现，
   * 但契约仍只有两种产出：全约束满足，或仅保"除数非 0"。
   */
  it('Property 17: 种子题库 10 条真实参数 × 对抗性随机源——两产出契约', () => {
    let primaryCount = 0;
    fc.assert(
      fc.property(seedParamsArb, cyclicRandArb, (params, rand) => {
        const q = generateOralQuestion(params, rand);
        if (!assertQuestionContract(params, q, 'tolerant').relaxed) {
          primaryCount++;
        }
      }),
      { numRuns: 150 },
    );
    expect(primaryCount).toBeGreaterThan(0);
  });
});
