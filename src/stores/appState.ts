/**
 * 应用级共享状态（App_State，薄壳接线层）
 *
 * 依据 .kiro/specs/kids-learning-adventure/design.md「数据流（今日冒险主流程）」
 * 与任务 13.1 的设计约定实现：
 * - 初始化 Local_Store（createLocalStore），写失败经 onWriteError 汇入
 *   writeError（Req 10.6，供 UI 提示"本次进度可能无法保存"）；
 * - 启动时加载三科种子题库并经 2.1 校验器校验、构建索引（Req 9.3-9.6）；
 *   整体 fatal 时记入 bankError，练习流程入口据此停止（Req 9.5）；
 * - 持有响应式引用：wallet（Star_Wallet，变化 1 秒内刷新界面，Req 5.9）、
 *   session（Today_Session）、soundOn（音效开关，Req 12.5-12.7）、
 *   childGrade（孩子年级，child-grade-setting Req 4.3，setChildGrade 立即落盘）；
 *   startAdventure 仅在当日会话需要新生成的分支读取 childGrade 传入
 *   buildTodayQueue 过滤（Req 2.9/3.2/3.5），当日已生成会话不读、不重建；
 * - startAdventure：今日冒险主流程编排——已有当日会话且未答完则续练、
 *   未生成则经 Review_Engine 生成并持久化、全部完成返回 done、无可出题
 *   返回 empty（Req 1.3、1.4、1.5、1.7、3.8）；
 * - 引擎层（Review_Engine / Adventure_Engine）为纯函数，本模块只做
 *   读存储 → 调引擎 → 写存储 → 同步响应式引用 的薄壳编排。
 *
 * 页面（首页/学科页/练习页/宝箱页/小岛页）统一经 useAppState() 获取共享实例；
 * 测试可经 createAppState 注入内存 StorageLike / 时钟 / 随机源，
 * 并经 setSharedAppState 替换共享实例。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue';

import chineseJson from '../data/seed/questions-chinese.json';
import mathJson from '../data/seed/questions-math.json';
import englishJson from '../data/seed/questions-english.json';
import generatorsJson from '../data/seed/generators-math.json';
import chineseG1Json from '../data/seed/questions-chinese-g1.json';
import chineseG2Json from '../data/seed/questions-chinese-g2.json';
import chineseG5Json from '../data/seed/questions-chinese-g5.json';
import chineseG6Json from '../data/seed/questions-chinese-g6.json';
import mathG1Json from '../data/seed/questions-math-g1.json';
import mathG2Json from '../data/seed/questions-math-g2.json';
import mathG5Json from '../data/seed/questions-math-g5.json';
import mathG6Json from '../data/seed/questions-math-g6.json';
import englishG5Json from '../data/seed/questions-english-g5.json';
import englishG6Json from '../data/seed/questions-english-g6.json';
import generatorsG1Json from '../data/seed/generators-math-g1.json';
import generatorsG2Json from '../data/seed/generators-math-g2.json';
import generatorsG5Json from '../data/seed/generators-math-g5.json';
import generatorsG6Json from '../data/seed/generators-math-g6.json';

import {
  buildQuestionIndex,
  loadQuestionBank,
  type QuestionIndex,
} from '../data/questionBank';
import {
  createLocalStore,
  LocalStoreWriteError,
  type LocalStore,
  type StorageLike,
} from '../data/localStore';
import {
  buildTodayQueue,
  localDateString,
  shouldGenerateTodayQueue,
} from '../engine/reviewEngine';
import { createTodaySession, nextUnanswered } from '../engine/adventureEngine';
import { createFeedbackService, type FeedbackService } from '../services/feedback';
import { audioService, type AudioService } from '../services/audioService';
import type {
  GeneratorParams,
  Question,
  SessionConfig,
  StarWallet,
  TodaySession,
} from '../types';

// ============ 会话配置（与契约测试 tests/unit/seedContract.spec.ts 口径一致） ============

/** 今日会话配置：每组 3 题、关卡目标 10 分钟、复习/新知识点各上限 50 */
export const SESSION_CONFIG: SessionConfig = {
  groupSize: 3,
  levelTargetMs: 10 * 60 * 1000,
  maxNewPerSession: 50,
  maxReviewPerSession: 50,
};

// ============ 种子题库加载 ============

interface SeedBankOutcome {
  bank: QuestionIndex | null;
  fatal: string | null;
}

/**
 * 加载三科全部年级种子题库并构建索引（multi-grade-mistake-book Req 2.7）。
 * 聚合既有三、四年级文件（内容不变，Req 2.4）与一至六年级扩充文件；
 * 既有文件排在最前，保持一期"今日冒险"队列的确定性顺序不变。
 * 任一题库整体无法解析时返回 fatal（Req 9.5）；坏题由 loadQuestionBank
 * 逐题跳过并记错误日志（Req 9.4），此处只汇总合法题。
 */
function loadSeedBank(now: number): SeedBankOutcome {
  const sources: Array<[string, unknown]> = [
    ['questions-chinese', chineseJson],
    ['questions-math', mathJson],
    ['questions-english', englishJson],
    ['questions-chinese-g1', chineseG1Json],
    ['questions-chinese-g2', chineseG2Json],
    ['questions-chinese-g5', chineseG5Json],
    ['questions-chinese-g6', chineseG6Json],
    ['questions-math-g1', mathG1Json],
    ['questions-math-g2', mathG2Json],
    ['questions-math-g5', mathG5Json],
    ['questions-math-g6', mathG6Json],
    ['questions-english-g5', englishG5Json],
    ['questions-english-g6', englishG6Json],
  ];
  const questions: Question[] = [];
  for (const [label, raw] of sources) {
    const result = loadQuestionBank(JSON.stringify(raw), now);
    if ('fatal' in result) {
      return { bank: null, fatal: `${label}：${result.fatal}` };
    }
    questions.push(...result.questions);
  }
  return { bank: buildQuestionIndex(questions), fatal: null };
}

/** 口算生成器参数的最小结构守卫（种子结构由 tests/unit/seedContract.spec.ts 契约保证） */
function isGeneratorParams(value: unknown): value is GeneratorParams {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.knowledgePointId === 'string' &&
    typeof v.grade === 'number' &&
    typeof v.difficulty === 'number' &&
    typeof v.template === 'string' &&
    typeof v.operands === 'object' &&
    v.operands !== null &&
    typeof v.operation === 'string' &&
    v.answerFormat === 'number'
  );
}

/** 解析 generators-math{,-gN}.json 的 GeneratorParams 列表（非法条目跳过） */
function parseGenerators(raw: unknown): GeneratorParams[] {
  const list = (raw as { generators?: unknown } | null)?.generators;
  if (!Array.isArray(list)) return [];
  return list.filter(isGeneratorParams);
}

// ============ startAdventure 结果 ============

/**
 * 今日冒险主流程编排结果：
 * - ready：会话就绪（resumed=true 表示续练当日已有会话，Req 1.3/1.5；
 *   resumed=false 表示新生成，Req 1.4），壳层直接导航练习页展示第一题（Req 1.2）；
 * - done：当日全部题目已完成，壳层展示完成庆祝画面而不进入练习（Req 1.5）；
 * - empty：Review_Engine 无法生成当日会话（无可用题），壳层提示并停留首页（Req 1.7）；
 * - fatal：题库整体加载失败，壳层提示并停止进入练习流程（Req 9.5）。
 */
export type StartAdventureResult =
  | { kind: 'ready'; session: TodaySession; resumed: boolean }
  | { kind: 'done'; session: TodaySession }
  | { kind: 'empty' }
  | { kind: 'fatal'; message: string };

// ============ App_State ============

export interface AppStateOptions {
  /** 存储实现注入（默认 localStorage）；测试注入内存 mock */
  storage?: StorageLike;
  /** Audio_Service 注入（默认共享 audioService 实例）；测试可 mock */
  audio?: AudioService;
  /** 时钟注入，默认 Date.now */
  now?: () => number;
  /** 随机源注入（鼓励文案选取），默认 Math.random */
  rand?: () => number;
}

export interface AppState {
  /** Local_Store 适配器（ mastery/wrongSet/oralBest 等其余实体由页面经 store 直读直写） */
  readonly store: LocalStore;
  /** 题库索引；整体加载失败（fatal）时为 null（Req 9.5） */
  readonly bank: QuestionIndex | null;
  /** 口算生成器参数列表 */
  readonly generators: readonly GeneratorParams[];
  /** 会话配置 */
  readonly sessionConfig: SessionConfig;
  /** 答题反馈编排服务（音效开关经其持久化，Req 12.5-12.7） */
  readonly feedback: FeedbackService;
  /** 题库整体加载失败原因；未失败为 null */
  readonly bankError: Ref<string | null>;
  /** 存储写失败提示（Req 10.6）；无失败为 null */
  readonly writeError: Ref<string | null>;
  /** 星星钱包（响应式；变化即时驱动界面刷新，Req 5.9） */
  readonly wallet: Ref<StarWallet>;
  /** 今日会话（响应式；页面间共享） */
  readonly session: Ref<TodaySession | null>;
  /** 音效开关状态（响应式，默认开，Req 12.5） */
  readonly soundOn: Ref<boolean>;
  /** 当日会话是否已全部完成（首页"已完成"态，Req 1.5） */
  readonly todayDone: ComputedRef<boolean>;
  /** 今日冒险主流程编排（见 StartAdventureResult） */
  startAdventure(): StartAdventureResult;
  /** 从 Local_Store 重新读入今日会话到响应式引用（返回首页时同步） */
  refreshSession(): void;
  /** 更新今日会话：同步响应式引用并立即持久化（Req 2.4；写失败汇入 writeError） */
  saveSession(session: TodaySession): void;
  /** 更新星星钱包：同步响应式引用并调度写入（变化后 1 秒内落盘，Req 10.2） */
  setWallet(next: StarWallet): void;
  /** 发放星星（count > 0）：余额与累计获得同步增加 */
  addStars(count: number): void;
  /** 设置音效开关（Req 12.5-12.7） */
  setSoundOn(on: boolean): void;
  /** 孩子年级（响应式；null = 未设置）。启动时从 Local_Store 恢复（child-grade-setting Req 4.3） */
  readonly childGrade: Ref<number | null>;
  /**
   * 设置孩子年级（1-6 整数；非法值防御性忽略）：
   * 同步更新响应式引用并立即写入 Local_Store（Req 1.6、1.7、4.1、4.2）；
   * 写失败汇入 writeError，内存态保持已选年级可见（Req 4.7）。
   */
  setChildGrade(grade: number): void;
}

/** 创建 App_State 实例（默认走 localStorage 与共享 Audio_Service） */
export function createAppState(options: AppStateOptions = {}): AppState {
  const nowFn = options.now ?? (() => Date.now());

  // 启动加载题库（Req 9.3）；整体 fatal 时停止进入练习流程（Req 9.5）。
  // 先于 Local_Store 构造：题库索引与生成器参数同时作为
  // Wrong_Set v1→v2 迁移上下文注入（multi-grade-mistake-book Req 6.6）。
  const { bank, fatal } = loadSeedBank(nowFn());
  const bankError = ref<string | null>(fatal);

  // 口算生成器参数：聚合全部年级生成器文件（既有文件在前，Req 2.7；
  // 种子结构由契约测试保证，非法条目防御性跳过）
  const generators = [
    generatorsJson,
    generatorsG1Json,
    generatorsG2Json,
    generatorsG5Json,
    generatorsG6Json,
  ].flatMap(parseGenerators);

  const writeError = ref<string | null>(null);
  const store = createLocalStore({
    ...(options.storage !== undefined ? { storage: options.storage } : {}),
    // v1 错题学科/年级推导：kpId 推导优先，题库 byId 与生成器参数兜底；
    // bank 为 null（题库 fatal）时仅 kpId 推导
    wrongSetMigration: { bank, generators },
    onWriteError: (error: LocalStoreWriteError) => {
      writeError.value = error.message;
    },
  });

  // Feedback_Service：构造时经 Local_Store 恢复音效开关上次设置（Req 12.7）
  const feedback = createFeedbackService({
    audio: options.audio ?? audioService,
    store,
    ...(options.rand !== undefined ? { rand: options.rand } : {}),
  });

  // 响应式共享状态：初始值从 Local_Store 恢复（Req 10.3）
  const wallet = ref<StarWallet>(store.read('wallet'));
  const session = ref<TodaySession | null>(store.read('session:today'));
  const soundOn = ref<boolean>(feedback.isSoundOn());
  // 孩子年级：启动时从 Local_Store 恢复（Req 4.3；缺失/损坏经实体机制按未设置 null 返回）
  const childGrade = ref<number | null>(store.read('childGrade'));

  /** 当日会话全部完成（Req 1.5）：会话属于今日且无下一未答题 */
  const todayDone = computed<boolean>(() => {
    const s = session.value;
    return s !== null && s.date === localDateString(nowFn()) && nextUnanswered(s) === null;
  });

  /** 会话持久化：立即写入（进度保存优先于批量调度）；写失败汇入 writeError（Req 10.6） */
  function persistSession(next: TodaySession): void {
    session.value = next;
    try {
      store.write('session:today', next);
    } catch (error) {
      writeError.value =
        error instanceof LocalStoreWriteError ? error.message : String(error);
    }
  }

  function startAdventure(): StartAdventureResult {
    // 题库整体加载失败：停止进入练习流程（Req 9.5）
    if (bankError.value !== null || bank === null) {
      return { kind: 'fatal', message: bankError.value ?? '题库加载失败' };
    }

    const now = nowFn();
    const existing = store.read('session:today');

    if (!shouldGenerateTodayQueue(existing, now)) {
      // 当日会话已存在且应沿用（Req 3.9）：有未答题直接续练（Req 1.3/1.5）
      const current = existing as TodaySession;
      session.value = current;
      if (nextUnanswered(current) !== null) {
        return { kind: 'ready', session: current, resumed: true };
      }
      // 全部完成：壳层展示完成庆祝画面（Req 1.5）
      return { kind: 'done', session: current };
    }

    // 当日会话尚未生成：依据 Mastery_Record 经 Review_Engine 生成（Req 1.4/3.8）。
    // 仅此生成分支读取 childGrade 并按其过滤（child-grade-setting Req 2.9/3.2/3.5）；
    // 当日已生成会话走上方续练/done 分支，不读、不重建（Req 3.3/3.4）。
    const queue = buildTodayQueue(
      store.read('mastery'),
      bank,
      now,
      SESSION_CONFIG,
      generators,
      store.read('childGrade')
    );
    if (queue.length === 0) {
      // 无可用题：壳层提示并停留首页（Req 1.7）
      return { kind: 'empty' };
    }
    const created = createTodaySession(queue, now);
    persistSession(created);
    return { kind: 'ready', session: created, resumed: false };
  }

  function refreshSession(): void {
    session.value = store.read('session:today');
  }

  function saveSession(next: TodaySession): void {
    persistSession(next);
  }

  function setWallet(next: StarWallet): void {
    // 响应式引用即时更新驱动界面刷新（Req 5.9），调度写入保证 1 秒内落盘（Req 10.2）
    wallet.value = next;
    store.schedule('wallet', next);
  }

  function addStars(count: number): void {
    if (count <= 0) return;
    setWallet({
      balance: wallet.value.balance + count,
      totalEarned: wallet.value.totalEarned + count,
    });
  }

  function setSoundOn(on: boolean): void {
    feedback.setSoundOn(on);
    soundOn.value = feedback.isSoundOn();
  }

  /**
   * 设置孩子年级：非法值（非 1-6 整数）防御性忽略（UI 仅提供合法选项，
   * 正常流程不可达）；合法时同步更新响应式引用并立即落盘
   * （Req 1.6、1.7、4.1、4.2）；写失败捕获 LocalStoreWriteError 汇入
   * writeError，内存态保持已选年级可见（Req 4.7）。
   */
  function setChildGrade(grade: number): void {
    if (!Number.isInteger(grade) || grade < 1 || grade > 6) return;
    childGrade.value = grade;
    try {
      store.write('childGrade', grade);
    } catch (error) {
      writeError.value =
        error instanceof LocalStoreWriteError ? error.message : String(error);
    }
  }

  return {
    store,
    bank,
    generators,
    sessionConfig: SESSION_CONFIG,
    feedback,
    bankError,
    writeError,
    wallet,
    session,
    soundOn,
    todayDone,
    startAdventure,
    refreshSession,
    saveSession,
    setWallet,
    addStars,
    setSoundOn,
    childGrade,
    setChildGrade,
  };
}

// ============ 应用内共享实例 ============

let shared: AppState | null = null;

/** 应用内共享 AppState（惰性创建；页面统一经此获取） */
export function useAppState(): AppState {
  if (shared === null) {
    shared = createAppState();
  }
  return shared;
}

/** 测试用：注入自制实例或传 null 使下次 useAppState 重新创建 */
export function setSharedAppState(state: AppState | null): void {
  shared = state;
}
