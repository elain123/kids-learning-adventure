/**
 * Adventure_Engine（冒险引擎）—— 会话编排
 *
 * 本模块实现 design.md「Components and Interfaces → 冒险引擎」中的会话编排部分：
 * - groupIntoGroups：将练习队列按每组 3 题依次编排，最后一个小组 1 至 3 题
 *   （Requirements 2.1, 7.9；Property 2）；
 * - nextUnanswered：定位学生下一道未作答的题目，全部完成时返回 null
 *   （Requirements 1.3, 1.5, 2.7；Property 1）；
 * - serializeSession / deserializeSession：Today_Session 的序列化与反序列化，
 *   供"中途退出保存进度、重进恢复下一未答题"使用（Requirements 2.4, 2.5, 2.8；
 *   Property 3）。localStorage 的实际读写与键命名空间由 Local_Store
 *   （src/data/localStore.ts）承担，本模块只提供纯的（反）序列化与结构校验；
 * - createTodaySession：由已生成的今日队列创建全新会话（Requirement 1.4）；
 * - applyFirstAnswer / applyRetry / awardAnswer / shouldLowerDifficulty /
 *   clampDifficulty：作答流程定盘——首答与重试的计数转移（Streak/连错）、
 *   星星发放与连错降难度（Requirements 4.1, 4.3-4.8, 5.1；Properties 11-13）。
 *
 * 设计约束：纯函数，不做任何 I/O、不读取系统时钟，时间一律通过参数注入；
 * 不修改入参，返回新对象。
 */

import { localDateString } from './reviewEngine';
import type {
  AnswerResult,
  Difficulty,
  QueueItem,
  QuestionType,
  Subject,
  TodaySession,
} from '../types';

// ============ 三题分组（Requirement 2.1, 7.9；Property 2） ============

/**
 * 将练习队列按每组 size 题依次切分为若干小组。
 *
 * 不变量（Property 2）：
 * - 除最后一组外每组恰为 size 题；
 * - 最后一组为 1 至 size 题；
 * - 全部组拼接后与原始队列逐元素相等（不丢题、不重题、不改序）；
 * - 空队列返回空数组（没有任何小组）。
 *
 * 设计签名中 size 固定为 3（SessionConfig.groupSize），此处提供默认值 3
 * 以便直接以 groupIntoGroups(queue) 调用；不修改入参，返回全新数组。
 */
export function groupIntoGroups<T>(queue: readonly T[], size: 3 = 3): T[][] {
  // 防御：非法 size（绕过类型标注调用时）避免死循环，按无组可分处理
  if (!Number.isInteger(size) || size <= 0) {
    return [];
  }
  const groups: T[][] = [];
  for (let i = 0; i < queue.length; i += size) {
    groups.push(queue.slice(i, i + size));
  }
  return groups;
}

// ============ 下一未答题定位（Requirements 1.3, 1.5, 2.7；Property 1） ============

/**
 * 返回会话中学生下一道未作答的题目。
 *
 * 语义（Property 1）：
 * - currentIndex 始终指向"下一道未作答位置"，返回 queue[currentIndex]；
 * - 当且仅当全部题目完成时返回 null，即
 *   status === 'done'（会话已标记完成）或 currentIndex >= queue.length（队列答完）。
 */
export function nextUnanswered(session: TodaySession): QueueItem | null {
  if (session.status === 'done') {
    return null;
  }
  if (session.currentIndex >= session.queue.length) {
    return null;
  }
  return session.queue[session.currentIndex];
}

// ============ 会话序列化/反序列化（Requirements 2.4, 2.5, 2.8；Property 3） ============

/**
 * 将 Today_Session 序列化为 JSON 字符串，供写入 Local_Store 保存进度。
 * TodaySession 为纯数据对象，JSON.stringify 即可完整保留
 * queue / currentIndex / results / streak 等全部字段。
 */
export function serializeSession(session: TodaySession): string {
  return JSON.stringify(session);
}

/**
 * 将 JSON 字符串反序列化为 Today_Session。
 *
 * 校验契约（Property 3 / Requirement 10.4 的会话侧）：
 * - JSON 无法解析时返回 null；
 * - 解析结果缺少必需字段或字段取值越界时返回 null；
 * - 校验通过时返回与原会话等价的 TodaySession。
 *
 * 返回 null 时由调用方（Local_Store / 冒险引擎壳层）按"无当日会话"处理，
 * 例如触发损坏备份与重新生成队列。
 */
export function deserializeSession(json: string): TodaySession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return isTodaySession(parsed) ? parsed : null;
}

// ============ 结构校验（反序列化契约） ============

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

const SUBJECTS: readonly Subject[] = ['chinese', 'math', 'english'];

const QUESTION_TYPES: readonly QuestionType[] = [
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

/** 难度取值域 1-5 */
const ONE_TO_FIVE: readonly number[] = [1, 2, 3, 4, 5];

/** 本地自然日 'YYYY-MM-DD' 格式 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isQueueItem(value: unknown): value is QueueItem {
  if (!isPlainObject(value)) return false;
  if (value.kind !== 'bank' && value.kind !== 'generated') return false;
  if (value.kind === 'bank' && typeof value.questionId !== 'string') return false;
  if (value.kind === 'generated' && typeof value.generatorParamsId !== 'string') return false;
  return (
    typeof value.knowledgePointId === 'string' &&
    SUBJECTS.includes(value.subject as Subject) &&
    QUESTION_TYPES.includes(value.type as QuestionType) &&
    ONE_TO_FIVE.includes(value.difficulty as number) &&
    (value.source === 'review' || value.source === 'new' || value.source === 'retry')
  );
}

function isAnswerResult(value: unknown): value is AnswerResult {
  return (
    isPlainObject(value) &&
    typeof value.questionRef === 'string' &&
    typeof value.knowledgePointId === 'string' &&
    typeof value.correct === 'boolean' &&
    typeof value.retried === 'boolean' &&
    isFiniteNumber(value.stars) &&
    isFiniteNumber(value.answeredAt)
  );
}

/**
 * TodaySession 结构校验（类型守卫）。
 * 与 Local_Store 读取契约（Req 10.4）对 'session:today' 实体的校验一致：
 * 全部必需字段齐全且取值合法时返回 true。
 */
export function isTodaySession(value: unknown): value is TodaySession {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.date === 'string' &&
    DATE_RE.test(value.date) &&
    Array.isArray(value.queue) &&
    value.queue.every(isQueueItem) &&
    isNonNegativeInteger(value.currentIndex) &&
    isFiniteNumber(value.streak) &&
    isFiniteNumber(value.consecutiveWrong) &&
    (value.difficultyOffset === 0 || value.difficultyOffset === -1) &&
    isFiniteNumber(value.levelStartedAt) &&
    isFiniteNumber(value.elapsedMs) &&
    (value.status === 'active' || value.status === 'done') &&
    Array.isArray(value.results) &&
    value.results.every(isAnswerResult)
  );
}

// ============ 创建全新今日会话（Requirement 1.4） ============

/**
 * 由已生成的今日队列创建全新 Today_Session。
 *
 * 初始态约定：
 * - date 取 now 对应的本地自然日（经 reviewEngine.localDateString，与
 *   "当日队列只生成一次"判定（Req 3.8/3.9）使用同一日期口径）；
 * - status='active'、currentIndex=0、streak=0、consecutiveWrong=0、
 *   difficultyOffset=0、elapsedMs=0、results=[]；
 * - levelStartedAt 取注入的 now（关卡计时起点，Requirement 2.2）。
 *
 * @param queue buildTodayQueue 生成的今日队列（直接引用，不复制；调用方不应再修改）
 * @param now 当前时间戳（毫秒），由调用方注入
 */
export function createTodaySession(queue: QueueItem[], now: number): TodaySession {
  return {
    date: localDateString(now),
    queue,
    currentIndex: 0,
    streak: 0,
    consecutiveWrong: 0,
    difficultyOffset: 0,
    levelStartedAt: now,
    elapsedMs: 0,
    status: 'active',
    results: [],
  };
}

// ============ 作答流程：首答/重试、连胜连错、星星发放、难度下调 ============
// （Requirements 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1；Properties 11, 12, 13）
//
// 职责边界：本组函数只维护 Today_Session 内部的计数与进度——streak /
// consecutiveWrong / difficultyOffset 计数转移、currentIndex 推进、
// AnswerResult 记录与本题应发星星数。以下关联副作用由练习壳层负责：
// - 掌握度记录更新：壳层调用 reviewEngine.applyAnswer 完成；其中"重试后答对
//   按答错记"（Req 4.3）即壳层在 retry-correct 时以 correct=false 调用
//   applyAnswer，与本模块把重试结果记为 AnswerResult.correct=false 的口径一致；
// - Star_Wallet 入账：壳层按返回的 stars 增加 balance 与 totalEarned（Req 5.1），
//   并在 1 秒内刷新界面余额（Req 5.9）；
// - Hint/答案解析/鼓励文案/音效等展示反馈：由 Feedback_Service 按本模块产出的
//   事件驱动（Req 4.1、4.2、12.3、12.4）。

/** 首次答对的基础星星数（Requirement 5.1） */
export const ANSWER_STARS_BASE = 5;

/** Streak 达 3 的倍数时翻倍后的星星数（Requirements 4.6, 5.1） */
export const ANSWER_STARS_DOUBLED = 10;

/** 触发难度下调的连续首次答错题数（Requirement 4.7） */
export const CONSECUTIVE_WRONG_THRESHOLD = 3;

// ---- 作答流程事件（引擎产出的纯数据对象，由练习壳层消费） ----

/**
 * 首次作答答对事件：壳层据此实时展示 Streak 计数（Req 4.4）；
 * streak 达 3 的倍数时星星翻倍（doubled=true，展示星星加倍反馈，Req 4.6）。
 */
export interface FirstCorrectEvent {
  type: 'first-correct';
  /** 答对后的 Streak 值 */
  streak: number;
  /** 本题发放星星数（5 或 10） */
  stars: number;
  /** 星星是否因 Streak 达 3 的倍数而翻倍（Requirement 4.6） */
  doubled: boolean;
}

/**
 * 首次作答答错事件：壳层据此展示该题 Hint（此时不得展示答案）并保留同一道
 * 题供学生重试（Req 4.1）。retryLeft 恒为 1：重试机会仅此一次，壳层收到本
 * 事件后进入"待重试"态，待 applyRetry 定盘后结束。
 *
 * 注意：待重试态不持久化——中途退出再恢复时，该题按全新首答处理（学生重新
 * 获得一次首答与一次重试）。这是设计允许的选择：Req 2.4 只要求保存关卡、
 * 下一未作答位置与已答结果；首错题目的结果尚未记录（见 applyFirstAnswer），
 * 会话结构因此无法区分"待重试"与"全新首答"。
 */
export interface FirstWrongEvent {
  type: 'first-wrong';
  /** 剩余重试次数，恒为 1（Req 4.1：重试次数限 1 次） */
  retryLeft: 1;
  /** 答错后的连续首次答错计数 */
  consecutiveWrong: number;
  /**
   * 本次答错是否触发了难度下调：仅 difficultyOffset 由 0 跳变为 -1 的沿为
   * true；已处于下调状态（offset 已为 -1）时继续答错不再重复触发。
   */
  difficultyLowered: boolean;
}

/**
 * 重试答对事件：本题按答错记账（Req 4.3），壳层展示鼓励性反馈并推进下一题。
 */
export interface RetryCorrectEvent {
  type: 'retry-correct';
}

/**
 * 重试仍错事件：壳层据此公布正确答案 + 不超过 100 字的解析 + 不含批评或否定
 * 表述的鼓励文案，并提供进入下一题的操作入口（Req 4.2）。
 */
export interface RetryWrongEvent {
  type: 'retry-wrong';
}

/** 作答流程事件联合类型 */
export type AnswerFlowEvent =
  | FirstCorrectEvent
  | FirstWrongEvent
  | RetryCorrectEvent
  | RetryWrongEvent;

/** applyFirstAnswer 返回值 */
export interface ApplyFirstAnswerOutcome {
  /** 更新后的会话（新对象，入参不被修改） */
  session: TodaySession;
  /** 本题应发星星数：首次答对为 5 或 10，首次答错为 0（壳层据此入账 Star_Wallet） */
  stars: number;
  events: AnswerFlowEvent[];
}

/** applyRetry 返回值 */
export interface ApplyRetryOutcome {
  /** 更新后的会话（新对象，入参不被修改） */
  session: TodaySession;
  events: AnswerFlowEvent[];
}

// ============ 星星发放规则（Requirements 4.6, 5.1；Property 12） ============

/**
 * 按首次作答答对后的 Streak 值计算本题应发星星数。
 *
 * 语义（Property 12）：对任意 s ≥ 1，s 是 3 的倍数时返回 10（按 2 倍发放，
 * Req 4.6），否则返回 5（Req 5.1）。s < 1 为防御分支（正常流程中首答后的
 * streak 至少为 1），不触发翻倍，返回 5。
 */
export function awardAnswer(streakAfter: number): 5 | 10 {
  return streakAfter >= 1 && streakAfter % 3 === 0
    ? ANSWER_STARS_DOUBLED
    : ANSWER_STARS_BASE;
}

// ============ 难度调节（Requirements 4.7, 4.8；Property 13） ============

/**
 * 是否应下调后续出题难度：连续首次答错计数达到 3（Req 4.7）。
 * 重试后答对仍计为答错，即重试不会清减该计数（见 applyRetry）；
 * 首次答对后该计数归零（Req 4.8），不再触发下调（Property 13）。
 */
export function shouldLowerDifficulty(consecutiveWrong: number): boolean {
  return consecutiveWrong >= CONSECUTIVE_WRONG_THRESHOLD;
}

/**
 * 将难度偏移应用到题目难度上，并夹取到合法区间：
 * difficulty + offset 之后不低于该学科题库最低难度 minDifficulty（Req 4.7：
 * "下调后不得低于 Question_Bank 中该学科题目的最低难度等级"），也不高于 5。
 *
 * @param difficulty 题目原始难度（1-5）
 * @param offset 难度偏移（连错 3 题后为 -1，见 TodaySession.difficultyOffset）
 * @param minDifficulty 该学科题库最低难度等级（1-5），由题库索引提供
 */
export function clampDifficulty(
  difficulty: Difficulty,
  offset: number,
  minDifficulty: Difficulty,
): Difficulty {
  const applied = difficulty + offset;
  if (applied < minDifficulty) return minDifficulty;
  if (applied > 5) return 5;
  return applied as Difficulty;
}

// ============ 首次作答定盘（Requirements 4.1, 4.4-4.8；Property 11） ============

/**
 * AnswerResult.questionRef 取值：题库题（kind='bank'）取题目 id；生成题
 * （kind='generated'）取 gen:{generatorParamsId}——完整生成器签名
 * gen:{paramsId}:{operandsHash} 含操作数散列，只有生成题目的壳层知晓；
 * 壳层在把结果落入 Wrong_Set 时可替换为完整签名，掌握度归属不受影响
 * （掌握度按 knowledgePointId 记账）。
 */
function queueItemRef(item: QueueItem): string {
  if (item.kind === 'bank') {
    return item.questionId ?? '';
  }
  return `gen:${item.generatorParamsId ?? ''}`;
}

/**
 * 首次作答定盘：Streak / 连错计数转移、本题星星与题目推进。
 *
 * 答对（Requirements 4.4, 4.6, 4.8, 5.1；Properties 11, 12）：
 * - streak + 1、consecutiveWrong 归零、difficultyOffset 归零（不再触发下调）；
 * - stars = awardAnswer(新 streak)：3 的倍数 10 颗、否则 5 颗；
 * - 记录 AnswerResult{ correct: true, retried: false, stars, answeredAt: now }；
 * - currentIndex 前进 1；越过队尾时 status 置为 'done'（全部完成，Req 1.5）。
 *
 * 答错（Requirements 4.1, 4.5, 4.7；Properties 11, 13）：
 * - streak 归零、consecutiveWrong + 1；
 * - currentIndex 不前进，保留同一道题供重试（Req 4.1）；本次作答暂不记录
 *   results——本题结果在重试定盘时由 applyRetry 一次性记录（retried=true）；
 * - consecutiveWrong 达到 3 时 difficultyOffset 置为 -1（Req 4.7）；下调后
 *   的实际难度下限由 clampDifficulty 在出题选取时夹取；
 * - 产出 retryLeft=1 的 first-wrong 事件（含 difficultyLowered 跳变沿）。
 *
 * 不变量：调用返回后 difficultyOffset 恒等于
 * shouldLowerDifficulty(新 consecutiveWrong) ? -1 : 0。
 *
 * 防御：会话已完成（status='done'）或当前位置无题时不做任何变更，
 * 原样返回会话、stars=0 与空事件。
 *
 * @param session 当前今日会话
 * @param correct 学生首次作答是否答对（由判定服务得出）
 * @param now 作答时间戳（毫秒），由调用方注入，记入 answeredAt
 */
export function applyFirstAnswer(
  session: TodaySession,
  correct: boolean,
  now: number,
): ApplyFirstAnswerOutcome {
  const item = session.queue[session.currentIndex];
  if (session.status === 'done' || item === undefined) {
    return { session, stars: 0, events: [] };
  }

  if (correct) {
    const streak = session.streak + 1;
    const stars = awardAnswer(streak);
    const result: AnswerResult = {
      questionRef: queueItemRef(item),
      knowledgePointId: item.knowledgePointId,
      correct: true,
      retried: false,
      stars,
      answeredAt: now,
    };
    const currentIndex = session.currentIndex + 1;
    return {
      session: {
        ...session,
        currentIndex,
        streak,
        consecutiveWrong: 0,
        difficultyOffset: 0,
        status: currentIndex >= session.queue.length ? 'done' : session.status,
        results: [...session.results, result],
      },
      stars,
      events: [
        {
          type: 'first-correct',
          streak,
          stars,
          doubled: stars === ANSWER_STARS_DOUBLED,
        },
      ],
    };
  }

  const consecutiveWrong = session.consecutiveWrong + 1;
  const lower = shouldLowerDifficulty(consecutiveWrong);
  return {
    session: {
      ...session,
      streak: 0,
      consecutiveWrong,
      difficultyOffset: lower ? -1 : 0,
      // currentIndex 不前进、results 不记录：本题待重试定盘，见函数文档
    },
    stars: 0,
    events: [
      {
        type: 'first-wrong',
        retryLeft: 1,
        consecutiveWrong,
        difficultyLowered: lower && session.difficultyOffset === 0,
      },
    ],
  };
}

/**
 * 重试定盘：首错后保留的同一道题的重试结果落账并推进。
 *
 * 语义（Requirements 4.2, 4.3, 4.7；Properties 10, 11）：
 * - 重试答对按答错记（Req 4.3）：无论 correct 为何，记录的 AnswerResult
 *   恒为 { correct: false, retried: true, stars: 0 }；壳层在 retry-correct
 *   时同样以 correct=false 调用 reviewEngine.applyAnswer，使掌握度更新与
 *   首次答错完全一致（Property 10）；
 * - currentIndex 前进 1（重试次数已消耗，进入下一题）；越过队尾时
 *   status 置为 'done'；
 * - streak / consecutiveWrong / difficultyOffset 均不变：计数转移在首错时
 *   已完成，且重试后答对仍计为答错（连错计数不清零，Req 4.7）；
 * - 事件：retry-correct（壳层展示鼓励并推进）或 retry-wrong（壳层公布答案 +
 *   ≤100 字解析 + 鼓励文案 + 下一题入口，Req 4.2）。
 *
 * 调用前提：会话处于"待重试"态（applyFirstAnswer 产出 first-wrong 事件后）。
 * 会话结构本身无法区分待重试与全新首答（见 FirstWrongEvent 文档），本函数
 * 不校验该前提，由壳层保证仅在待重试态调用。
 *
 * 防御：会话已完成或当前位置无题时原样返回会话与空事件。
 *
 * @param session 当前今日会话
 * @param correct 学生重试作答是否答对（仅用于选择反馈事件，结果恒按答错记）
 * @param now 作答时间戳（毫秒），由调用方注入，记入 answeredAt
 */
export function applyRetry(
  session: TodaySession,
  correct: boolean,
  now: number,
): ApplyRetryOutcome {
  const item = session.queue[session.currentIndex];
  if (session.status === 'done' || item === undefined) {
    return { session, events: [] };
  }

  // 重试答对按答错记（Req 4.3）：correct 恒为 false、retried=true
  const result: AnswerResult = {
    questionRef: queueItemRef(item),
    knowledgePointId: item.knowledgePointId,
    correct: false,
    retried: true,
    stars: 0,
    answeredAt: now,
  };
  const currentIndex = session.currentIndex + 1;
  return {
    session: {
      ...session,
      currentIndex,
      status: currentIndex >= session.queue.length ? 'done' : session.status,
      results: [...session.results, result],
    },
    events: [correct ? { type: 'retry-correct' } : { type: 'retry-wrong' }],
  };
}
