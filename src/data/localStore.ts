/**
 * Local_Store 本地存储适配器
 *
 * 依据 .kiro/specs/kids-learning-adventure/design.md 的
 * "Data Models → localStorage 数据模型"、"Error Handling" 章节实现，
 * 并按 .kiro/specs/multi-grade-mistake-book/design.md 扩充（任务 5.1）：
 * - 新增 lastGrade（Last_Grade）与 session:subjects（学科年级分组合会话）
 *   实体，沿用同一键命名空间、1 秒 schedule 落盘与备份自愈契约；
 * - wrongSet 实体同键原地升级为 v2 结构（类型见 src/engine/wrongSet.ts）：
 *   读取时在 JSON 解析成功后做形状检测，可识别 v1 形状（任一元素缺
 *   wrongCount）经 migrateWrongSetV1 迁移、调度写回 v2 值后返回迁移结果
 *   （multi-grade Req 6.6，优先于 Req 6.5 的备份重置路径）；仅当既非 v2
 *   亦非可识别 v1 形状时才走既有备份自愈。迁移只读写 wrongSet 键，
 *   其余实体读取行为与一期完全一致。
 * 并按 .kiro/specs/child-grade-setting/design.md 扩充（任务 2.1）：
 * - 新增 childGrade（Child_Grade，孩子年级）实体：number | null，初始态
 *   null（未设置）；校验器 isChildGrade 接受 null 或 1-6 整数，其余值
 *   走既有损坏备份自愈路径（备份后按未设置启动）；读写沿用同一键命名
 *   空间、备份自愈、账号隔离与写失败上报契约。
 *
 * 契约（_Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 12.7, 13.5；
 * multi-grade-mistake-book 6.1-6.8；child-grade-setting 4.1, 4.3-4.6_）：
 * - 键命名空间：`kla:v1:{accountId}:{entity}`，一期 accountId 固定为 'default'，
 *   不同账号的数据完全隔离（Req 13.5 / multi-grade Req 6.7）。
 * - 读取：JSON 解析 + 各实体必需字段校验；失败时将原始值复制到
 *   `kla:v1:{accountId}:backup:{entity}:{timestamp}`（同一会话内不覆盖），
 *   并按该实体初始态启动（Req 10.4 / multi-grade Req 6.5）；键不存在时按
 *   初始态启动且不创建备份（multi-grade Req 6.4）。
 * - 写入：数据变化后 1 秒内写入（schedule 延迟 WRITE_DELAY_MS < 1000ms，
 *   突发连续变化以首个未落盘变化起算计时）；写失败抛出 LocalStoreWriteError
 *   供 UI 提示"本次进度可能无法保存"（Req 10.2, 10.6 / multi-grade Req 6.2, 6.8）。
 * - 存储可注入：接受任意 StorageLike（默认 globalThis.localStorage），
 *   测试可注入内存 mock；模块不依赖 DOM。
 */

import type {
  AnswerResult,
  GeneratorParams,
  IslandCollection,
  MasteryRecord,
  QueueItem,
  QuestionType,
  StarWallet,
  Subject,
  TodaySession,
} from '../types';
import type { LastGrade } from '../engine/gradeSelector';
import type { SubjectGradeKey } from '../engine/subjectSession';
import type { WrongSet } from '../engine/wrongSet';
import {
  isLegacyV1WrongSetShape,
  isWrongSetV2Shape,
  migrateWrongSetV1,
} from '../engine/wrongSetMigration';
import type { QuestionIndex } from './questionBank';

// Wrong_Set v2 类型再导出：既有模块（PracticePage、一期测试）从 localStore
// 导入 WrongSet/WrongSetItem 的路径保持不变（multi-grade-mistake-book 任务 5.1）。
export type {
  FirstWrongEntry,
  GeneratedSnapshot,
  WrongSet,
  WrongSetItem,
} from '../engine/wrongSet';

// ============ 存储抽象（可注入） ============

/** localStorage 的最小接口子集，便于内存 mock 注入 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 内存版 StorageLike，供测试与不依赖浏览器的场景使用 */
export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

// ============ 实体模型 ============

/**
 * Wrong_Set 实体为 v2 结构（src/engine/wrongSet.ts，同键原地升级）：
 * 元素含 questionRef/subject/grade/knowledgePointId/wrongAt/wrongCount 与
 * 可选 generated 快照；类型经上方 export type 再导出。
 */

/** 口算历史最佳纪录条目 */
export interface OralBestEntry {
  best: number;
  achievedAt: number;
}

/** 设置（音效开关默认开启，Req 12.5） */
export interface Settings {
  soundOn: boolean;
}

/** 各实体的值类型映射（键后缀 → 结构，见设计文档 localStorage 数据模型表） */
export interface EntityTypeMap {
  /** Mastery_Record：Record<knowledgePointId, MasteryRecord> */
  mastery: Record<string, MasteryRecord>;
  /** Wrong_Set */
  wrongSet: WrongSet;
  /** Star_Wallet */
  wallet: StarWallet;
  /** Island_Collection */
  collection: IslandCollection;
  /** Today_Session；不存在/未开始为 null */
  'session:today': TodaySession | null;
  /** 口算最佳纪录：Record<generatorParamsId, { best, achievedAt }> */
  oralBest: Record<string, OralBestEntry>;
  /** 设置 */
  settings: Settings;
  /**
   * Last_Grade：仅记录学生选择过年级的学科（multi-grade Req 6.1）；初始态 {}
   */
  lastGrade: LastGrade;
  /**
   * 学科年级分组合会话：Record<"{subject}:{grade}", TodaySession>
   *（multi-grade Req 3.3）；初始态 {}
   */
  'session:subjects': Record<SubjectGradeKey, TodaySession>;
  /**
   * Child_Grade（孩子年级）：1-6 整数；null 表示未设置（初始态）
   *（child-grade-setting Req 4.1）
   */
  childGrade: number | null;
}

/** 实体名（localStorage 键后缀） */
export type EntityName = keyof EntityTypeMap;

// ============ 常量 ============

/** 键命名空间前缀 */
export const STORAGE_PREFIX = 'kla:v1';

/** 一期固定账号标识（Req 13.5：一期单一默认账号，结构预留多账号） */
export const DEFAULT_ACCOUNT_ID = 'default';

/**
 * 调度写入延迟（毫秒）。Req 10.2 要求变化后 1 秒内写入，
 * 取 800ms 留出余量；突发连续变化自首个未落盘变化起算。
 */
export const WRITE_DELAY_MS = 800;

// ============ 错误类型 ============

/**
 * 写入失败错误（Req 10.6）。
 * UI 层捕获后提示"本次进度可能无法保存"，内存态继续可用。
 */
export class LocalStoreWriteError extends Error {
  constructor(
    public readonly entity: EntityName,
    public readonly key: string,
    public readonly cause?: unknown,
  ) {
    super(`Local_Store 写入失败（entity=${entity}, key=${key}）：本次进度可能无法保存`);
    this.name = 'LocalStoreWriteError';
  }
}

// ============ 各实体初始态（Req 10.4） ============

/** 各实体初始态工厂（每次调用返回新对象，避免共享引用） */
const INITIAL_STATE_FACTORIES: { [E in EntityName]: () => EntityTypeMap[E] } = {
  mastery: () => ({}),
  wrongSet: () => ({ items: [] }),
  wallet: () => ({ balance: 0, totalEarned: 0 }),
  collection: () => ({ items: [] }),
  'session:today': () => null,
  oralBest: () => ({}),
  settings: () => ({ soundOn: true }),
  lastGrade: () => ({}),
  'session:subjects': () => ({}),
  childGrade: () => null,
};

/** 返回某实体的初始状态（每次调用返回新对象，避免共享引用） */
export function initialEntityState<E extends EntityName>(entity: E): EntityTypeMap[E] {
  return INITIAL_STATE_FACTORIES[entity]();
}

// ============ 必需字段校验（读取契约） ============

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

/** 间隔级别与难度共用取值域 1-5 */
const ONE_TO_FIVE: readonly number[] = [1, 2, 3, 4, 5];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isMasteryRecord(value: unknown): value is MasteryRecord {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.knowledgePointId === 'string' &&
    ONE_TO_FIVE.includes(value.level as number) &&
    isFiniteNumber(value.totalCorrect) &&
    isFiniteNumber(value.totalWrong) &&
    (value.nextReviewAt === null || isFiniteNumber(value.nextReviewAt)) &&
    typeof value.mastered === 'boolean' &&
    isFiniteNumber(value.lastAnswerAt)
  );
}

function isMasteryMap(value: unknown): value is Record<string, MasteryRecord> {
  return isPlainObject(value) && Object.values(value).every(isMasteryRecord);
}

/** 合法年级：1-6 的整数（Last_Grade 值与组合会话键共用取值域） */
function isGradeValue(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 6;
}

/**
 * Wrong_Set v2 校验（multi-grade-mistake-book Req 6.6）：
 * 必需字段 questionRef/subject/grade(1-6 整数)/knowledgePointId/wrongAt/wrongCount
 * 齐全且合法；generated 快照可选，但存在时须结构合法。
 *（形状判定复用迁移模块的 isWrongSetV2Shape，保证"读取校验"与"迁移出口"一致。）
 */
export function isWrongSetV2(value: unknown): value is WrongSet {
  return isWrongSetV2Shape(value);
}

/**
 * Last_Grade 校验（multi-grade-mistake-book Req 6.1）：
 * 键限三个学科，值为 1-6 整数；{} 为合法初始态。
 */
export function isLastGrade(value: unknown): value is LastGrade {
  if (!isPlainObject(value)) return false;
  return Object.entries(value).every(
    ([key, grade]) => SUBJECTS.includes(key as Subject) && isGradeValue(grade),
  );
}

/**
 * Child_Grade 校验（child-grade-setting Req 4.5）：
 * null（未设置）或 1-6 整数；其余（非整数、越界、对象、字符串等）视为损坏，
 * 走既有备份自愈路径（备份后按未设置启动）。
 */
export function isChildGrade(value: unknown): value is number | null {
  return value === null || isGradeValue(value);
}

/** 组合会话键形状："{subject}:{grade}"，学科限三科、年级 1-6 */
const SUBJECT_GRADE_KEY_RE = /^(chinese|math|english):[1-6]$/;

/**
 * 学科年级分组合会话校验（multi-grade-mistake-book Req 3.3）：
 * 键符合 "{subject}:{grade}" 形状，值逐项过 isTodaySession。
 */
export function isSubjectSessionMap(
  value: unknown,
): value is Record<SubjectGradeKey, TodaySession> {
  if (!isPlainObject(value)) return false;
  return Object.entries(value).every(
    ([key, session]) => SUBJECT_GRADE_KEY_RE.test(key) && isTodaySession(session),
  );
}

function isWallet(value: unknown): value is StarWallet {
  return isPlainObject(value) && isFiniteNumber(value.balance) && isFiniteNumber(value.totalEarned);
}

function isCollection(value: unknown): value is IslandCollection {
  return (
    isPlainObject(value) &&
    Array.isArray(value.items) &&
    value.items.every((item) => typeof item === 'string')
  );
}

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

function isTodaySession(value: unknown): value is TodaySession {
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

function isOralBestEntry(value: unknown): value is OralBestEntry {
  return isPlainObject(value) && isFiniteNumber(value.best) && isFiniteNumber(value.achievedAt);
}

function isOralBestMap(value: unknown): value is Record<string, OralBestEntry> {
  return isPlainObject(value) && Object.values(value).every(isOralBestEntry);
}

function isSettings(value: unknown): value is Settings {
  return isPlainObject(value) && typeof value.soundOn === 'boolean';
}

/** 按实体分发必需字段校验 */
function isValidEntityValue(entity: EntityName, value: unknown): boolean {
  switch (entity) {
    case 'mastery':
      return isMasteryMap(value);
    case 'wrongSet':
      return isWrongSetV2(value);
    case 'wallet':
      return isWallet(value);
    case 'collection':
      return isCollection(value);
    case 'session:today':
      // null 表示今日尚无会话，是合法状态
      return value === null || isTodaySession(value);
    case 'oralBest':
      return isOralBestMap(value);
    case 'settings':
      return isSettings(value);
    case 'lastGrade':
      return isLastGrade(value);
    case 'session:subjects':
      return isSubjectSessionMap(value);
    case 'childGrade':
      // null 表示未设置，是合法状态（同 session:today 先例）
      return isChildGrade(value);
  }
}

// ============ LocalStore 接口 ============

export interface LocalStoreOptions {
  /** 存储实现；默认 globalThis.localStorage，测试注入内存 mock */
  storage?: StorageLike;
  /** 账号标识，一期固定 'default'（Req 13.5） */
  accountId?: string;
  /** 时钟注入（备份键时间戳），默认 Date.now */
  now?: () => number;
  /** 调度写入延迟（毫秒），默认 WRITE_DELAY_MS（800ms < 1s，Req 10.2） */
  writeDelayMs?: number;
  /** 定时器注入，便于测试精确控制调度写入时机 */
  setTimeoutFn?: (callback: () => void, delayMs: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /**
   * 调度写入（定时器触发）失败回调：写失败时逐实体上报，
   * UI 据此提示"本次进度可能无法保存"（Req 10.6）。
   */
  onWriteError?: (error: LocalStoreWriteError) => void;
  /**
   * Wrong_Set v1→v2 迁移上下文（multi-grade-mistake-book Req 6.6）：
   * v1 元素学科/年级推导顺序为 kpId 推导 → 题库 byId 查找 → 生成器参数
   * 查找；缺省 bank=null、generators=[] 时仅 kpId 推导（无题库上下文的
   * 构造点，如小岛/宝箱页的独立 store，属正常形态）。
   */
  wrongSetMigration?: {
    bank: QuestionIndex | null;
    generators: readonly GeneratorParams[];
  };
}

export interface LocalStore {
  readonly accountId: string;
  /** 实体键：`kla:v1:{accountId}:{entity}` */
  keyFor(entity: EntityName): string;
  /** 备份键：`kla:v1:{accountId}:backup:{entity}:{timestamp}` */
  backupKeyFor(entity: EntityName, timestamp: number): string;
  /**
   * 读取实体：JSON 解析 + 必需字段校验；
   * 损坏时原始值备份（会话内不覆盖）并返回初始态（Req 10.4）。
   * wrongSet 例外：可识别 v1 形状经迁移升级并调度写回 v2 后返回
   *（multi-grade Req 6.6，优先于备份重置），不做备份。
   */
  read<E extends EntityName>(entity: E): EntityTypeMap[E];
  /**
   * 立即写入（同步）。写失败抛出 LocalStoreWriteError 供 UI 捕获（Req 10.6）。
   * 成功后会丢弃同实体较旧的调度待写值，避免旧值覆盖新值。
   */
  write<E extends EntityName>(entity: E, value: EntityTypeMap[E]): void;
  /**
   * 调度写入：自首个未落盘变化起 writeDelayMs（< 1 秒）内落盘（Req 10.2）。
   * 定时器触发时写失败经 onWriteError 上报（不会在定时器内抛出）。
   */
  schedule<E extends EntityName>(entity: E, value: EntityTypeMap[E]): void;
  /** 立即落盘全部调度待写值（取消定时器）；任一实体写失败时抛出（Req 10.6） */
  flush(): void;
  /** 是否存在调度待写值 */
  hasPending(): boolean;
}

function resolveDefaultStorage(): StorageLike {
  const g = globalThis as { localStorage?: StorageLike };
  if (g.localStorage) return g.localStorage;
  throw new Error(
    'createLocalStore: 未注入 storage 且当前环境无 localStorage，请通过 options.storage 注入 StorageLike 实例',
  );
}

// ============ 工厂实现 ============

export function createLocalStore(options: LocalStoreOptions = {}): LocalStore {
  const accountId = options.accountId ?? DEFAULT_ACCOUNT_ID;
  const storage = options.storage ?? resolveDefaultStorage();
  const now = options.now ?? (() => Date.now());
  const writeDelayMs = options.writeDelayMs ?? WRITE_DELAY_MS;
  const setTimeoutFn =
    options.setTimeoutFn ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const clearTimeoutFn =
    options.clearTimeoutFn ?? ((handle: unknown) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));
  const onWriteError = options.onWriteError;
  /** Wrong_Set v1→v2 迁移上下文：默认无题库上下文（仅 kpId 推导） */
  const migrationBank = options.wrongSetMigration?.bank ?? null;
  const migrationGenerators = options.wrongSetMigration?.generators ?? [];

  const prefix = `${STORAGE_PREFIX}:${accountId}`;
  /** 本会话已备份过的实体（同一会话内备份不被覆盖，Req 10.4） */
  const backedUpThisSession = new Set<EntityName>();
  /** 调度待写值（按实体去重，只保留最新值） */
  const pending = new Map<EntityName, EntityTypeMap[EntityName]>();
  let timer: unknown = null;

  function keyFor(entity: EntityName): string {
    return `${prefix}:${entity}`;
  }

  function backupKeyFor(entity: EntityName, timestamp: number): string {
    return `${prefix}:backup:${entity}:${timestamp}`;
  }

  /** 损坏值备份：尽力而为（备份写失败不阻断读取自愈），同一会话内不覆盖 */
  function backupCorrupted(entity: EntityName, raw: string): void {
    if (backedUpThisSession.has(entity)) return;
    try {
      storage.setItem(backupKeyFor(entity, now()), raw);
      backedUpThisSession.add(entity);
    } catch {
      // 备份失败时仍按初始态启动，不阻断应用
    }
  }

  function read<E extends EntityName>(entity: E): EntityTypeMap[E] {
    let raw: string | null;
    try {
      raw = storage.getItem(keyFor(entity));
    } catch {
      // 存储不可读：无法取得原值备份，直接按初始态启动
      return initialEntityState(entity);
    }
    if (raw === null) return initialEntityState(entity);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      backupCorrupted(entity, raw);
      return initialEntityState(entity);
    }
    if (isValidEntityValue(entity, parsed)) return parsed as EntityTypeMap[E];

    // Wrong_Set 同键原地升级（multi-grade-mistake-book Req 6.6，优先于
    // Req 6.5 备份重置）：可识别 v1 形状（任一元素缺 wrongCount）→ 迁移并
    // 调度写回 v2 值后返回迁移结果；不备份、不按初始态重置。
    // 迁移只读写 wrongSet 键，其余实体一律落入下方既有备份自愈路径。
    if (entity === 'wrongSet' && isLegacyV1WrongSetShape(parsed)) {
      const { set } = migrateWrongSetV1(parsed, migrationBank, migrationGenerators);
      schedule('wrongSet', set);
      return set as EntityTypeMap[E];
    }

    backupCorrupted(entity, raw);
    return initialEntityState(entity);
  }

  function write<E extends EntityName>(entity: E, value: EntityTypeMap[E]): void {
    const key = keyFor(entity);
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch (cause) {
      throw new LocalStoreWriteError(entity, key, cause);
    }
    try {
      storage.setItem(key, serialized);
    } catch (cause) {
      throw new LocalStoreWriteError(entity, key, cause);
    }
    // 立即写入成功后，同实体较旧的调度待写值作废，避免旧值覆盖新值
    pending.delete(entity);
  }

  function schedule<E extends EntityName>(entity: E, value: EntityTypeMap[E]): void {
    pending.set(entity, value);
    // 自首个未落盘变化起算计时；窗口内后续变化仅更新待写值，不推迟落盘
    if (timer === null) {
      timer = setTimeoutFn(runScheduledFlush, writeDelayMs);
    }
  }

  function runScheduledFlush(): void {
    timer = null;
    const errors = flushPending();
    for (const error of errors) {
      if (onWriteError) onWriteError(error);
    }
  }

  function flush(): void {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    const errors = flushPending();
    if (errors.length > 0) throw errors[0];
  }

  function flushPending(): LocalStoreWriteError[] {
    if (pending.size === 0) return [];
    const entries = Array.from(pending.entries());
    pending.clear();
    const errors: LocalStoreWriteError[] = [];
    for (const [entity, value] of entries) {
      try {
        write(entity, value);
      } catch (error) {
        errors.push(
          error instanceof LocalStoreWriteError
            ? error
            : new LocalStoreWriteError(entity, keyFor(entity), error),
        );
      }
    }
    return errors;
  }

  function hasPending(): boolean {
    return pending.size > 0;
  }

  return {
    accountId,
    keyFor,
    backupKeyFor,
    read,
    write,
    schedule,
    flush,
    hasPending,
  };
}
