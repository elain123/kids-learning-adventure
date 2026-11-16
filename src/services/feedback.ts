/**
 * 答题反馈编排与音效开关（Feedback_Service）
 *
 * 依据 .kiro/specs/kids-learning-adventure/requirements.md 实现：
 * - Req 4.1：首错展示 Hint、保留重试机会，此时不展示正确答案；
 * - Req 4.2：重试仍错展示正确答案 + 不超过 100 字的解析 + 不含批评或否定
 *   表述的鼓励文案，并提供进入下一题的操作入口；
 * - Req 12.3：答对播放正确音效并展示时长不超过 3 秒的庆祝动画；
 * - Req 12.4：答错播放时长不超过 1 秒的提示音效（与答对音效不同，由
 *   Audio_Service 音效配方保证）；
 * - Req 12.5：音效开关默认开启，可关闭全部音效；
 * - Req 12.6：开关切为关闭时立即停止当前音效，且后续答题与奖励场景均不再
 *   播放任何音效；
 * - Req 12.7：音效开关状态经 Local_Store settings 实体持久化，重新打开
 *   应用时恢复上次设置。
 *
 * 编排方式：各反馈方法触发音效（开关开启时）并返回纯数据事件对象，由 UI 层
 * 消费渲染（庆祝动画 / Hint 条 / 答案解析卡片 / 星星与宝箱动效）。本模块不
 * 依赖 DOM/Vue；Audio_Service、Local_Store 与随机源全部注入，测试可用 mock。
 */

import type { Question } from '../types';
import type { AudioService, EffectName } from './audioService';
import type { LocalStore } from '../data/localStore';
import { ANALYSIS_MAX_LENGTH } from '../data/questionBank';
import { pickEncouragement } from '../data/encouragement';

/**
 * 庆祝动画展示时长（毫秒）。Req 12.3 要求不超过 3 秒，取上限 3000ms；
 * 实际动画渲染由 UI 层按 durationMs 执行。
 */
export const CELEBRATION_DURATION_MS = 3000;

/** 解析字数上限，与题库 Schema 一致（analysis ≤100 字，Req 4.2） */
export const FEEDBACK_ANALYSIS_MAX_LENGTH = ANALYSIS_MAX_LENGTH;

// ============ 反馈事件（UI 层消费的纯数据对象） ============

/** 答对反馈事件：展示时长 ≤3 秒的庆祝动画（Req 12.3） */
export interface CelebrationEvent {
  kind: 'celebration';
  /** 庆祝动画展示时长（毫秒），保证 ≤ 3000 */
  durationMs: number;
}

/** 首错反馈事件：仅展示针对该题的 Hint，绝不包含正确答案（Req 4.1） */
export interface HintEvent {
  kind: 'hint';
  /** 针对该题的引导性提示，不直接给出答案 */
  hint: string;
  /** 剩余重试次数（首错后重试限 1 次） */
  retryLeft: 1;
}

/** 再错反馈事件：公布答案 + ≤100 字解析 + 鼓励文案 + 下一题入口（Req 4.2） */
export interface AnswerRevealEvent {
  kind: 'answer-reveal';
  /** 该题的正确答案 */
  answer: Question['answer'];
  /** 不超过 100 字的解析 */
  analysis: string;
  /** 不含批评或否定表述的鼓励文案 */
  encouragement: string;
  /** 进入下一题的操作入口 */
  nextAction: 'next-question';
}

/** 星星奖励反馈事件 */
export interface StarsEvent {
  kind: 'stars';
  /** 本次发放/变化的星星数量 */
  count: number;
}

/** 宝箱开启反馈事件 */
export interface TreasureEvent {
  kind: 'treasure';
}

/** 全部反馈事件的联合类型 */
export type FeedbackEvent =
  | CelebrationEvent
  | HintEvent
  | AnswerRevealEvent
  | StarsEvent
  | TreasureEvent;

// ============ 解析截断（≤100 字保证） ============

/**
 * 将解析文本按字符（码点）截断到上限。
 * 题库校验已保证 analysis ≤100 字，本函数在反馈边界再做兜底，
 * 确保 Req 4.2 的"不超过 100 字"对任何调用方传入的题目都成立。
 */
export function truncateAnalysis(
  analysis: string,
  maxLength: number = FEEDBACK_ANALYSIS_MAX_LENGTH,
): string {
  const chars = [...analysis];
  return chars.length <= maxLength ? analysis : chars.slice(0, maxLength).join('');
}

// ============ Feedback_Service ============

export interface FeedbackServiceOptions {
  /** 注入的 Audio_Service（必传；测试可 mock） */
  audio: AudioService;
  /**
   * 注入的 Local_Store（可选）：提供时音效开关状态经 settings 实体持久化
   * ——创建时读取恢复上次设置（Req 12.7），变化时调度写入（1 秒内落盘，
   * Req 10.2）；不提供时开关状态仅会话内有效，默认开启（Req 12.5）。
   */
  store?: LocalStore;
  /** 鼓励文案选取的随机源，默认 Math.random */
  rand?: () => number;
}

export interface FeedbackService {
  /** 当前音效开关状态（默认开，Req 12.5） */
  isSoundOn(): boolean;
  /**
   * 设置音效开关（Req 12.5、12.6、12.7）。
   * 关闭时立即停止当前正在播放的音效，且后续答题与奖励场景均不再播放
   * 任何音效；开启时恢复播放。状态经注入的 Local_Store settings 实体持久化。
   */
  setSoundOn(on: boolean): void;
  /**
   * 答对反馈：开关开启时播放正确音效，返回 ≤3 秒庆祝动画事件（Req 12.3）。
   * 开关关闭时不播放音效，但事件照常返回（仅抑制声音，不抑制视觉反馈）。
   */
  onCorrect(): CelebrationEvent;
  /**
   * 首错反馈：开关开启时播放提示音效（≤1 秒、无人声、与答对音效不同，
   * Req 12.4），返回仅含该题 Hint 的事件，不包含正确答案（Req 4.1）。
   */
  onFirstWrong(question: Pick<Question, 'hint'>): HintEvent;
  /**
   * 再错反馈：开关开启时播放提示音效，返回答案 + ≤100 字解析 +
   * 鼓励文案 + 进入下一题入口的事件（Req 4.2）。
   */
  onSecondWrong(question: Pick<Question, 'answer' | 'analysis'>): AnswerRevealEvent;
  /** 星星奖励反馈：开关开启时播放星星音效，返回星星事件 */
  onStars(count: number): StarsEvent;
  /** 宝箱开启反馈：开关开启时播放宝箱音效，返回宝箱事件 */
  onTreasure(): TreasureEvent;
}

/**
 * 创建 Feedback_Service 实例。
 * 构造时从注入的 Local_Store 读取 settings 恢复音效开关上次状态；
 * 无 Local_Store 或无历史设置时默认开启（Req 12.5、12.7）。
 */
export function createFeedbackService(options: FeedbackServiceOptions): FeedbackService {
  const { audio, store, rand = Math.random } = options;

  // 读取上次设置；localStore.read 对缺失/损坏数据回退初始态 { soundOn: true }
  let soundOn = store?.read('settings').soundOn ?? true;

  /** 音效触发闸门：开关关闭时不发起任何播放调用（Req 12.6） */
  function play(name: EffectName): void {
    if (!soundOn) return;
    // Audio_Service.playEffect 约定静默降级（不 reject）；catch 兜底防御
    audio.playEffect(name).catch(() => undefined);
  }

  function isSoundOn(): boolean {
    return soundOn;
  }

  function setSoundOn(on: boolean): void {
    if (on === soundOn) return;
    soundOn = on;
    if (!on) {
      // 关闭即停当前正在播放的全部音效与读音（Req 12.6）
      audio.stopAll();
    }
    // 持久化设置：调度写入保证变化后 1 秒内落盘（Req 12.7、10.2）
    store?.schedule('settings', { soundOn: on });
  }

  function onCorrect(): CelebrationEvent {
    play('correct');
    return { kind: 'celebration', durationMs: CELEBRATION_DURATION_MS };
  }

  function onFirstWrong(question: Pick<Question, 'hint'>): HintEvent {
    play('wrong');
    // 仅展示 Hint，绝不携带答案（Req 4.1）；retryLeft 固定 1（重试限 1 次）
    return { kind: 'hint', hint: question.hint, retryLeft: 1 };
  }

  function onSecondWrong(question: Pick<Question, 'answer' | 'analysis'>): AnswerRevealEvent {
    play('wrong');
    return {
      kind: 'answer-reveal',
      answer: question.answer,
      analysis: truncateAnalysis(question.analysis),
      encouragement: pickEncouragement(rand),
      nextAction: 'next-question',
    };
  }

  function onStars(count: number): StarsEvent {
    play('star');
    return { kind: 'stars', count };
  }

  function onTreasure(): TreasureEvent {
    play('treasure');
    return { kind: 'treasure' };
  }

  return { isSoundOn, setSoundOn, onCorrect, onFirstWrong, onSecondWrong, onStars, onTreasure };
}
