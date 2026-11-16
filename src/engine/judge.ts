/**
 * 作答判定服务（Judge）
 *
 * 依据 design.md "Property 16: 判定与标准答案一致"（Validates: Requirements 6.5, 8.5）：
 * 对任意合法题目与任意学生作答，按题型的比对规则判定作答与题库标准答案是否一致。
 * 纯本地、纯函数、同步执行，无 I/O、无网络依赖（1 秒内判定由纯本地比对天然满足）。
 *
 * 比对规则（按标准答案 QuestionAnswer 的形态分派）：
 * - choice：选项 id 集合相等（与顺序无关）—— 拼音选择/多音字/选择/单词卡 4 选 1
 * - order：序列严格相等 —— 古诗文接龙等
 * - pairs：映射完全相等（每个目标槽都配到正确选项；先归一化表示）
 * - number：数值相等，浮点容差 1e-9 —— 口算/填空/几何计算/单位换算
 * - bool：布尔严格相等 —— 判断题
 *
 * 注意（种子数据契约差异，后续任务需对齐）：
 * src/types/index.ts 中 QuestionAnswer.pairs 声明为 Record<string, string>，
 * 但种子数据 src/data/seed/questions-chinese.json 实际使用二元组数组
 * （如 [["t1","a"],["t2","b"]]）。本模块对标准答案与学生作答统一做归一化，
 * 两种表示均可判定；题库校验器（2.1）与类型定义后续应统一该表示。
 */

import type {
  GeneratedQuestion,
  Question,
  QuestionAnswer,
} from '../types/index';

/** 数值判定的浮点容差 */
export const JUDGE_EPSILON = 1e-9;

/** pairs 答案的两种合法表示：映射对象或二元组数组 */
export type PairsLike = Record<string, string> | ReadonlyArray<readonly [string, string]>;

/** 学生作答载荷：与标准答案同构，pairs 额外接受二元组数组 */
export interface StudentAnswer {
  choice?: string[];
  order?: string[];
  pairs?: PairsLike;
  number?: number;
  bool?: boolean;
}

/** 将 pairs 归一化为 Record<string, string>；非法输入返回 null */
function normalizePairs(pairs: PairsLike | undefined): Record<string, string> | null {
  if (pairs === undefined || pairs === null) {
    return null;
  }
  if (Array.isArray(pairs)) {
    const map: Record<string, string> = {};
    for (const entry of pairs) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        return null;
      }
      const [target, option] = entry;
      if (typeof target !== 'string' || typeof option !== 'string') {
        return null;
      }
      map[target] = option;
    }
    return map;
  }
  if (typeof pairs === 'object') {
    const record = pairs as Record<string, string>;
    const map: Record<string, string> = {};
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (typeof value !== 'string') {
        return null;
      }
      map[key] = value;
    }
    return map;
  }
  return null;
}

/** 集合相等（与顺序无关，允许重复 id 去重后比对） */
function setEquals(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) {
    return false;
  }
  for (const item of setA) {
    if (!setB.has(item)) {
      return false;
    }
  }
  return true;
}

/** 序列严格相等 */
function sequenceEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** 映射完全相等 */
function mapEquals(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || b[key] !== a[key]) {
      return false;
    }
  }
  return true;
}

/** 数值相等（浮点容差 JUDGE_EPSILON；NaN 恒不相等） */
function numberEquals(a: number, b: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return false;
  }
  return Math.abs(a - b) <= JUDGE_EPSILON;
}

/**
 * 判定学生作答是否与标准答案一致。
 *
 * 按标准答案中定义的字段分派比对规则（choice > order > pairs > number > bool）。
 * 学生作答对应字段缺失、表示非法或比对不等时返回 false。
 */
export function judgeAnswer(answer: QuestionAnswer, student: StudentAnswer): boolean {
  if (answer.choice !== undefined) {
    return student.choice !== undefined && setEquals(answer.choice, student.choice);
  }
  if (answer.order !== undefined) {
    return student.order !== undefined && sequenceEquals(answer.order, student.order);
  }
  if (answer.pairs !== undefined) {
    const expected = normalizePairs(answer.pairs);
    const actual = normalizePairs(student.pairs);
    return expected !== null && actual !== null && mapEquals(expected, actual);
  }
  if (answer.number !== undefined) {
    return student.number !== undefined && numberEquals(answer.number, student.number);
  }
  if (answer.bool !== undefined) {
    return student.bool === answer.bool;
  }
  return false;
}

/** 判定题库题：以题目自带的标准答案与学生作答比对 */
export function judgeQuestion(question: Question, student: StudentAnswer): boolean {
  return judgeAnswer(question.answer, student);
}

/**
 * 判定口算生成题：数值答案统一比对（与题库题走同一判定管线）。
 */
export function judgeGenerated(question: GeneratedQuestion, studentNumber: number): boolean {
  return numberEquals(question.answer, studentNumber);
}
