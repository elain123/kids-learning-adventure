/**
 * Session_Clock（关卡计时）
 *
 * 冒险引擎的关卡时钟模块：自关卡第一题展示时起累计关卡进行时长，
 * 目标时长 10 分钟；到点产出「继续/休息」提示事件。
 *
 * 设计约束（design.md「Components and Interfaces → 冒险引擎」）：
 * - 纯函数实现：不做任何 I/O，不读取系统时钟，时间通过参数注入；
 * - 不修改入参；
 * - 10 分钟关卡计时（Requirement 2.2）、到点提示（Requirement 2.6）、
 *   口算关倒计时与到时自动结算（Requirements 7.4, 7.5）共用同一计时语义。
 */

import type { AnswerResult, QueueItem, SessionConfig, TodaySession } from '../types';

/** 关卡目标时长默认值：10 分钟（Requirement 2.2；与 SessionConfig.levelTargetMs 一致） */
export const LEVEL_TARGET_MS = 10 * 60 * 1000;

/**
 * 关卡时钟事件。
 * 当前仅一种：到点提示，携带 UI 应展示的操作项「继续」与「休息」
 * （Requirement 2.6：达到 10 分钟时展示包含「继续」与「休息」选项的提示）。
 */
export interface TimeUpEvent {
  type: 'time-up';
  actions: ['continue', 'rest'];
}

export type LevelClockEvent = TimeUpEvent;

/**
 * 关卡已进行时长（毫秒）。
 *
 * TodaySession.elapsedMs 记录本关此前各段已累计的时长（如中断恢复前的进度），
 * levelStartedAt 为本段关卡计时起点；本函数返回两者之和。
 * now 早于 levelStartedAt 时（时钟回拨）本段按 0 计，不出现负时长。
 *
 * @param session 今日会话（读取其 levelStartedAt 与 elapsedMs）
 * @param now 当前时间戳（毫秒），由调用方注入
 */
export function elapsedMs(
  session: Pick<TodaySession, 'levelStartedAt' | 'elapsedMs'>,
  now: number,
): number {
  const running = Math.max(0, now - session.levelStartedAt);
  return session.elapsedMs + running;
}

/**
 * 距离关卡目标时长还剩多少毫秒；已到点或超时时返回 0。
 *
 * @param session 今日会话
 * @param now 当前时间戳（毫秒），由调用方注入
 * @param config 会话配置（levelTargetMs，默认 10 分钟）
 */
export function remainingMs(
  session: Pick<TodaySession, 'levelStartedAt' | 'elapsedMs'>,
  now: number,
  config: Pick<SessionConfig, 'levelTargetMs'>,
): number {
  return Math.max(0, config.levelTargetMs - elapsedMs(session, now));
}

/**
 * 关卡进行时长是否已达到目标时长（10 分钟）。
 * 判定为 elapsedMs(session, now) ≥ config.levelTargetMs（Requirement 2.2, 2.6）。
 */
export function isTimeUp(
  session: Pick<TodaySession, 'levelStartedAt' | 'elapsedMs'>,
  now: number,
  config: Pick<SessionConfig, 'levelTargetMs'>,
): boolean {
  return elapsedMs(session, now) >= config.levelTargetMs;
}

/**
 * 关卡时钟检查（tick）：到点产出「继续/休息」提示事件，未到点返回 null。
 *
 * 由 UI 以注入的时钟周期调用；返回的事件不可重复消费由调用方负责
 * （例如提示展示期间暂停调用，或在学生选择「继续」后重置本段计时起点）。
 *
 * @param session 今日会话
 * @param now 当前时间戳（毫秒），由调用方注入
 * @param config 会话配置（levelTargetMs，默认 10 分钟）
 */
export function checkLevelClock(
  session: Pick<TodaySession, 'levelStartedAt' | 'elapsedMs'>,
  now: number,
  config: Pick<SessionConfig, 'levelTargetMs'>,
): LevelClockEvent | null {
  if (!isTimeUp(session, now, config)) {
    return null;
  }
  return { type: 'time-up', actions: ['continue', 'rest'] };
}

// ============ 口算关自动结算（Requirements 7.4, 7.5） ============

/** 口算关结算结果 */
export interface OralSettlement {
  /** 本关题目总数（队列长度） */
  total: number;
  /** 已作答题目数（results 长度） */
  answered: number;
  /**
   * 本关答对题数：仅统计已作答且首次作答答对的题目；
   * 倒计时结束时未作答的题目不计入答对题数（Requirement 7.5）。
   */
  correct: number;
}

/**
 * 口算关到时自动结算：倒计时结束时，以已产出的作答结果统计本关答对题数。
 *
 * 语义（Requirement 7.5）：
 * - 仅统计 results 中 correct=true 的作答（重试后答对的 correct=false，不计入）；
 * - 队列中未作答的题目（queue 长度超出 results 长度的部分）不计入答对题数；
 * - 纯函数，时间已通过 results 内的 answeredAt 固化，本函数不读时钟。
 *
 * @param results 本关已作答题目结果（TodaySession.results）
 * @param queue 本关题目队列（TodaySession.queue）
 */
export function settleOralLevel(
  results: readonly AnswerResult[],
  queue: readonly QueueItem[],
): OralSettlement {
  let correct = 0;
  for (const r of results) {
    if (r.correct) {
      correct += 1;
    }
  }
  return {
    total: queue.length,
    answered: results.length,
    correct,
  };
}
