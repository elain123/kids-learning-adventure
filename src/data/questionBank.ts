/**
 * 题库加载、逐题校验与索引（Question_Bank）
 *
 * 依据 .kiro/specs/kids-learning-adventure/design.md
 * "Components and Interfaces → 题库" 与 "Correctness Properties → Property 20/21" 实现：
 *
 * - validateQuestion：逐题必需字段与取值域校验（Req 9.2、9.3），纯函数
 * - loadQuestionBank：题库 JSON 整体解析失败返回 fatal 并记错误日志（Req 9.5）；
 *   坏题跳过、逐题产出一条标识该题的错误日志，满足 载入数 + 错误数 = 总数（Req 9.4、Property 20）；
 *   合法题在下一次启动加载后纳入对应学科/年级/单元出题范围（Req 9.6）
 * - buildQuestionIndex：按学科/年级/单元/知识点索引；phase=2 或二期题型题目载入但
 *   标记为 deferred，永不进入今日队列（Req 13.4、13.7、Property 24）
 * - 内存错误日志缓冲：时间戳 + 实体 + 题目标识 + 原因（持久化由 Local_Store 层负责）
 *
 * 本模块不依赖 DOM / localStorage；时间戳通过参数注入（默认 Date.now()），便于测试。
 */

import {
  PHASE2_QUESTION_TYPES,
  type Difficulty,
  type Question,
  type QuestionAnswer,
  type QuestionMedia,
  type QuestionOption,
  type QuestionType,
  type Subject,
  type Volume,
} from '../types';

// ============ 取值域常量（Req 9.2） ============

const SUBJECTS: readonly Subject[] = ['chinese', 'math', 'english'];
const VOLUMES: readonly Volume[] = ['A', 'B'];

/**
 * 题型枚举全集（Req 6/7/8 已定义题型 + Req 13.4 二期预留 reading/word_problem/read_aloud）
 */
const ALL_QUESTION_TYPES: readonly QuestionType[] = [
  // 语文（一期）
  'dictation',
  'pinyin',
  'similar_char',
  'polyphone',
  'word_match',
  'idiom_fill',
  'poem_chain',
  // 语文（二期预留）
  'reading',
  // 数学（一期）
  'oral',
  'blank',
  'judge',
  'choice',
  'unit_conv',
  'geometry',
  // 数学（二期预留）
  'word_problem',
  // 英语（一期）
  'word_card',
  // 英语（二期预留）
  'read_aloud',
];

const GRADE_MIN = 1;
const GRADE_MAX = 6;
const DIFFICULTY_MIN = 1;
const DIFFICULTY_MAX = 5;

/** 解析字数上限（题库 Schema：analysis ≤100 字） */
export const ANALYSIS_MAX_LENGTH = 100;

// ============ 校验结果与错误类型 ============

/** validateQuestion 返回：合法题给出归一化后的 Question，非法题给出原因 */
export type ValidateQuestionResult =
  | { ok: true; q: Question }
  | { ok: false; error: string };

/** 题库错误日志条目：时间戳 + 实体 + 题目标识 + 原因 */
export interface BankError {
  /** 时间戳（毫秒） */
  at: number;
  /** 实体：questionBank=题库整体结构，question=单题 */
  entity: 'questionBank' | 'question';
  /** 题目标识；无法识别时为 `<unknown@序号>`，整体错误时为 '-' */
  questionId: string;
  /** 错误原因 */
  reason: string;
}

/** loadQuestionBank 返回：部分加载（含坏题错误列表）或整体 fatal */
export type LoadQuestionBankResult =
  | { questions: Question[]; errors: BankError[] }
  | { fatal: string };

// ============ 内存错误日志缓冲 ============

const errorLogBuffer: BankError[] = [];

/**
 * 追加一条题库错误日志。
 * 时间戳可注入（默认 Date.now()）；持久化到 Local_Store 由存储层任务负责。
 */
export function logBankError(entry: Omit<BankError, 'at'>, at: number = Date.now()): void {
  errorLogBuffer.push({ ...entry, at });
}

/** 读取内存错误日志缓冲（只读视图） */
export function getBankErrorLog(): readonly BankError[] {
  return errorLogBuffer;
}

/** 清空内存错误日志缓冲（测试用） */
export function clearBankErrorLog(): void {
  errorLogBuffer.length = 0;
}

// ============ 基础守卫 ============

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

/** 按字符（码点）计数，用于 analysis ≤100 字判定 */
function charLength(s: string): number {
  return [...s].length;
}

function isNonEmptyStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);
}

// ============ answer / media / options 局部校验 ============

type AnswerCheck = { ok: true; answer: QuestionAnswer } | { ok: false; error: string };

/**
 * 校验并归一化标准答案。
 * 五种形态至少存在一种：choice/order/pairs/number/bool。
 * pairs 兼容种子数据的二元组数组格式 [["t1","a"],...]，统一归一化为 Record<string, string>。
 */
function validateAnswer(raw: unknown): AnswerCheck {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'answer 必须是对象' };
  }
  const answer: QuestionAnswer = {};
  let forms = 0;

  if (raw.choice !== undefined) {
    if (!isNonEmptyStringArray(raw.choice)) {
      return { ok: false, error: 'answer.choice 必须是非空字符串数组' };
    }
    answer.choice = [...raw.choice];
    forms += 1;
  }

  if (raw.order !== undefined) {
    if (!isNonEmptyStringArray(raw.order)) {
      return { ok: false, error: 'answer.order 必须是非空字符串数组' };
    }
    answer.order = [...raw.order];
    forms += 1;
  }

  if (raw.pairs !== undefined) {
    const p = raw.pairs;
    const record: Record<string, string> = {};
    if (Array.isArray(p)) {
      // 种子数据格式：[[左槽id, 右槽id], ...]
      if (p.length === 0) {
        return { ok: false, error: 'answer.pairs 不能为空' };
      }
      for (const pair of p) {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          !isNonEmptyString(pair[0]) ||
          !isNonEmptyString(pair[1])
        ) {
          return { ok: false, error: 'answer.pairs 数组元素必须是 [左槽id, 右槽id] 二元组' };
        }
        record[pair[0]] = pair[1];
      }
    } else if (isPlainObject(p)) {
      const entries = Object.entries(p);
      if (entries.length === 0) {
        return { ok: false, error: 'answer.pairs 不能为空' };
      }
      for (const [k, v] of entries) {
        if (!isNonEmptyString(k) || !isNonEmptyString(v)) {
          return { ok: false, error: 'answer.pairs 的键与值都必须是非空字符串' };
        }
        record[k] = v;
      }
    } else {
      return { ok: false, error: 'answer.pairs 必须是二元组数组或对象' };
    }
    answer.pairs = record;
    forms += 1;
  }

  if (raw.number !== undefined) {
    if (typeof raw.number !== 'number' || !Number.isFinite(raw.number)) {
      return { ok: false, error: 'answer.number 必须是有限数值' };
    }
    answer.number = raw.number;
    forms += 1;
  }

  if (raw.bool !== undefined) {
    if (typeof raw.bool !== 'boolean') {
      return { ok: false, error: 'answer.bool 必须是布尔值' };
    }
    answer.bool = raw.bool;
    forms += 1;
  }

  if (forms === 0) {
    return { ok: false, error: 'answer 缺少有效答案形态（choice/order/pairs/number/bool）' };
  }
  return { ok: true, answer };
}

type MediaCheck = { ok: true; media: QuestionMedia } | { ok: false; error: string };

function validateMedia(raw: unknown): MediaCheck {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'media 必须是对象' };
  }
  const media: QuestionMedia = {};
  if (raw.audio !== undefined) {
    if (!isNonEmptyString(raw.audio)) {
      return { ok: false, error: 'media.audio 必须是非空字符串' };
    }
    media.audio = raw.audio;
  }
  if (raw.image !== undefined) {
    if (!isNonEmptyString(raw.image)) {
      return { ok: false, error: 'media.image 必须是非空字符串' };
    }
    media.image = raw.image;
  }
  return { ok: true, media };
}

type OptionsCheck = { ok: true; options: QuestionOption[] } | { ok: false; error: string };

function validateOptions(raw: unknown): OptionsCheck {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'options 必须是数组' };
  }
  const options: QuestionOption[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item: unknown = raw[i];
    if (!isPlainObject(item)) {
      return { ok: false, error: `options[${i}] 必须是对象` };
    }
    if (!isNonEmptyString(item.id)) {
      return { ok: false, error: `options[${i}].id 缺失或不是非空字符串` };
    }
    const opt: QuestionOption = { id: item.id };
    if (item.text !== undefined) {
      if (typeof item.text !== 'string') {
        return { ok: false, error: `options[${i}].text 必须是字符串` };
      }
      opt.text = item.text;
    }
    if (item.image !== undefined) {
      if (!isNonEmptyString(item.image)) {
        return { ok: false, error: `options[${i}].image 必须是非空字符串` };
      }
      opt.image = item.image;
    }
    options.push(opt);
  }
  return { ok: true, options };
}

// ============ 逐题校验（Req 9.2、9.3） ============

/**
 * 校验单道题目的必需字段与取值域。
 * 必需字段：id、subject、grade、volume、unit、type、knowledgePointId、difficulty、
 * stem、answer、hint、analysis（≤100 字）、phase。
 * 取值域：subject ∈ chinese/math/english，grade ∈ 整数 1-6，volume ∈ A/B，
 * type ∈ 题型枚举（含二期预留），difficulty ∈ 整数 1-5，phase ∈ 1|2。
 * 合法题返回归一化后的 Question（pairs 归一化为 Record，多余字段被剔除）。
 */
export function validateQuestion(raw: unknown): ValidateQuestionResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: '题目必须是对象' };
  }
  if (!isNonEmptyString(raw.id)) {
    return { ok: false, error: '缺少必需字段 id（非空字符串）' };
  }
  if (typeof raw.subject !== 'string' || !SUBJECTS.includes(raw.subject as Subject)) {
    return { ok: false, error: `subject 取值非法（限 chinese/math/english）：${String(raw.subject)}` };
  }
  if (!isIntInRange(raw.grade, GRADE_MIN, GRADE_MAX)) {
    return { ok: false, error: `grade 必须是 ${GRADE_MIN}-${GRADE_MAX} 的整数` };
  }
  if (typeof raw.volume !== 'string' || !VOLUMES.includes(raw.volume as Volume)) {
    return { ok: false, error: `volume 取值非法（限 A/B）：${String(raw.volume)}` };
  }
  if (!isNonEmptyString(raw.unit)) {
    return { ok: false, error: '缺少必需字段 unit（非空字符串）' };
  }
  if (typeof raw.type !== 'string' || !ALL_QUESTION_TYPES.includes(raw.type as QuestionType)) {
    return { ok: false, error: `type 取值非法（不在题型枚举内）：${String(raw.type)}` };
  }
  if (!isNonEmptyString(raw.knowledgePointId)) {
    return { ok: false, error: '缺少必需字段 knowledgePointId（非空字符串）' };
  }
  if (!isIntInRange(raw.difficulty, DIFFICULTY_MIN, DIFFICULTY_MAX)) {
    return { ok: false, error: `difficulty 必须是 ${DIFFICULTY_MIN}-${DIFFICULTY_MAX} 的整数` };
  }
  if (!isNonEmptyString(raw.stem)) {
    return { ok: false, error: '缺少必需字段 stem（非空字符串）' };
  }
  const ans = validateAnswer(raw.answer);
  if (!ans.ok) {
    return { ok: false, error: ans.error };
  }
  if (!isNonEmptyString(raw.hint)) {
    return { ok: false, error: '缺少必需字段 hint（非空字符串）' };
  }
  if (!isNonEmptyString(raw.analysis)) {
    return { ok: false, error: '缺少必需字段 analysis（非空字符串）' };
  }
  if (charLength(raw.analysis) > ANALYSIS_MAX_LENGTH) {
    return { ok: false, error: `analysis 超过 ${ANALYSIS_MAX_LENGTH} 字上限` };
  }
  if (raw.phase !== 1 && raw.phase !== 2) {
    return { ok: false, error: `phase 取值非法（限 1/2）：${String(raw.phase)}` };
  }

  let media: QuestionMedia | undefined;
  if (raw.media !== undefined) {
    const m = validateMedia(raw.media);
    if (!m.ok) {
      return { ok: false, error: m.error };
    }
    media = m.media;
  }

  let options: QuestionOption[] | undefined;
  if (raw.options !== undefined) {
    const o = validateOptions(raw.options);
    if (!o.ok) {
      return { ok: false, error: o.error };
    }
    options = o.options;
  }

  const q: Question = {
    id: raw.id,
    subject: raw.subject as Subject,
    grade: raw.grade,
    volume: raw.volume as Volume,
    unit: raw.unit,
    type: raw.type as QuestionType,
    knowledgePointId: raw.knowledgePointId,
    difficulty: raw.difficulty as Difficulty,
    stem: raw.stem,
    ...(media !== undefined ? { media } : {}),
    ...(options !== undefined ? { options } : {}),
    answer: ans.answer,
    hint: raw.hint,
    analysis: raw.analysis,
    phase: raw.phase as 1 | 2,
  };
  return { ok: true, q };
}

// ============ 题库整体加载（Req 9.3-9.6、Property 20/21） ============

/**
 * 加载题库 JSON 字符串。
 * - 整体无法解析或结构非法（顶层非对象 / 缺少 questions 数组）→ 返回 { fatal } 并记错误日志，
 *   不产出任何可用题目（Req 9.5、Property 21）；
 * - 否则逐题校验：合法题载入，非法题跳过并各产生一条标识该题的错误日志，
 *   满足 questions.length + errors.length = 题目总数（Req 9.4、Property 20）。
 *
 * @param json 题库 JSON 字符串
 * @param now  时间戳注入（默认 Date.now()），用于错误日志
 */
export function loadQuestionBank(json: string, now: number = Date.now()): LoadQuestionBankResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const reason = `题库 JSON 解析失败：${e instanceof Error ? e.message : String(e)}`;
    logBankError({ entity: 'questionBank', questionId: '-', reason }, now);
    return { fatal: reason };
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.questions)) {
    const reason = '题库结构非法：顶层必须是包含 questions 数组的对象';
    logBankError({ entity: 'questionBank', questionId: '-', reason }, now);
    return { fatal: reason };
  }

  const questions: Question[] = [];
  const errors: BankError[] = [];
  const rawList: unknown[] = parsed.questions;
  for (let i = 0; i < rawList.length; i += 1) {
    const raw = rawList[i];
    const result = validateQuestion(raw);
    if (result.ok) {
      questions.push(result.q);
    } else {
      const questionId =
        isPlainObject(raw) && isNonEmptyString(raw.id) ? raw.id : `<unknown@${i}>`;
      const error: BankError = { at: now, entity: 'question', questionId, reason: result.error };
      errors.push(error);
      errorLogBuffer.push(error);
    }
  }
  return { questions, errors };
}

// ============ 索引与今日队列资格（Req 9.6、13.7） ============

/** 单元索引键：学科|年级|册|单元 */
export function unitKey(subject: Subject, grade: number, volume: Volume, unit: string): string {
  return `${subject}|${grade}|${volume}|${unit}`;
}

/**
 * 题目是否可进入今日队列。
 * phase=2 的题目与二期题型（reading/word_problem/read_aloud）载入但永不入队（Req 13.7）；
 * 双重判定保证即使数据标注不一致（如二期题型误标 phase=1）也不会入队。
 */
export function isQueueEligible(q: Question): boolean {
  return q.phase === 1 && !PHASE2_QUESTION_TYPES.includes(q.type);
}

/**
 * 题库索引：按学科/年级/单元/知识点组织，供 buildTodayQueue 等引擎层使用。
 * 索引覆盖全部合法载入题（含 phase=2，Property 20 要求可按学科/年级/单元检索到）；
 * queueEligible / deferred 划分今日队列资格。
 */
export interface QuestionIndex {
  /** 全部合法题目（含 phase=2，按载入顺序） */
  all: Question[];
  /** id → 题目 */
  byId: Map<string, Question>;
  /** 学科 → 题目列表 */
  bySubject: Map<Subject, Question[]>;
  /** 年级 → 题目列表 */
  byGrade: Map<number, Question[]>;
  /** unitKey(subject, grade, volume, unit) → 题目列表 */
  byUnit: Map<string, Question[]>;
  /** knowledgePointId → 题目列表 */
  byKnowledgePoint: Map<string, Question[]>;
  /** 可进入今日队列的题目（phase=1 且非二期题型） */
  queueEligible: Question[];
  /** 载入但不入队的题目（phase=2 或二期题型） */
  deferred: Question[];
}

/** 由合法题目列表构建索引 */
export function buildQuestionIndex(questions: readonly Question[]): QuestionIndex {
  const index: QuestionIndex = {
    all: [...questions],
    byId: new Map(),
    bySubject: new Map(),
    byGrade: new Map(),
    byUnit: new Map(),
    byKnowledgePoint: new Map(),
    queueEligible: [],
    deferred: [],
  };
  const push = <K>(map: Map<K, Question[]>, key: K, q: Question): void => {
    const list = map.get(key);
    if (list) {
      list.push(q);
    } else {
      map.set(key, [q]);
    }
  };
  for (const q of questions) {
    index.byId.set(q.id, q);
    push(index.bySubject, q.subject, q);
    push(index.byGrade, q.grade, q);
    push(index.byUnit, unitKey(q.subject, q.grade, q.volume, q.unit), q);
    push(index.byKnowledgePoint, q.knowledgePointId, q);
    if (isQueueEligible(q)) {
      index.queueEligible.push(q);
    } else {
      index.deferred.push(q);
    }
  }
  return index;
}
