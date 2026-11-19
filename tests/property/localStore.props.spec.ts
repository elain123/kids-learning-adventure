/**
 * Local_Store 本地存储适配器属性测试（fast-check，每个属性 ≥100 次迭代）
 *
 * 与 tests/unit/localStore.spec.ts 的示例化用例互补：本文件以生成式属性测试
 * 覆盖任意实体值、任意账号对与任意损坏存储值下的不变量。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createLocalStore,
  createMemoryStorage,
  initialEntityState,
  type EntityName,
  type EntityTypeMap,
  type OralBestEntry,
  type Settings,
  type WrongSet,
  type WrongSetItem,
} from '@/data/localStore';
import type {
  AnswerResult,
  Difficulty,
  IntervalLevel,
  IslandCollection,
  MasteryRecord,
  QueueItem,
  QuestionType,
  StarWallet,
  Subject,
  TodaySession,
} from '@/types';
import { COLLECTIBLE_ITEMS } from '@/types';

// ============ 生成器：合法实体值 ============

/** 安全标识串（小写字母/数字/点/短横线，不含冒号与下划线，避免键解析歧义） */
const arbId = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789.-'.split('')),
  { minLength: 1, maxLength: 24 },
);

/** 非负时间戳/计数值（JSON 可精确表示的整数范围） */
const arbTimestamp = fc.integer({ min: 0, max: 4_000_000_000_000 });

const arbLevel: fc.Arbitrary<IntervalLevel> = fc
  .integer({ min: 1, max: 5 })
  .map((n) => n as IntervalLevel);

const arbDifficulty: fc.Arbitrary<Difficulty> = fc
  .integer({ min: 1, max: 5 })
  .map((n) => n as Difficulty);

const arbSubject: fc.Arbitrary<Subject> = fc.constantFrom('chinese', 'math', 'english');

const QUESTION_TYPE_LIST: readonly QuestionType[] = [
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

const arbQuestionType: fc.Arbitrary<QuestionType> = fc.constantFrom(...QUESTION_TYPE_LIST);

const arbMasteryRecord: fc.Arbitrary<MasteryRecord> = fc.record({
  knowledgePointId: arbId,
  level: arbLevel,
  totalCorrect: fc.integer({ min: 0, max: 1_000_000 }),
  totalWrong: fc.integer({ min: 0, max: 1_000_000 }),
  nextReviewAt: fc.option(arbTimestamp, { nil: null }),
  mastered: fc.boolean(),
  lastAnswerAt: arbTimestamp,
});

const arbMastery: fc.Arbitrary<Record<string, MasteryRecord>> = fc.dictionary(
  arbId,
  arbMasteryRecord,
  { maxKeys: 6 },
);

// Wrong_Set v2 结构（multi-grade-mistake-book 任务 5.1：元素含 subject/grade/
// wrongCount 与可选 generated 快照；v1 的 retriedCorrect 随形状升级移除）
const arbGrade = fc.integer({ min: 1, max: 6 });

const arbGeneratedSnapshot = fc.record({
  paramsId: arbId,
  stem: arbId,
  operands: fc.dictionary(arbId, fc.integer({ min: -10_000, max: 10_000 }), { maxKeys: 4 }),
  answer: fc.integer({ min: -1_000_000, max: 1_000_000 }),
});

const arbWrongSetItem: fc.Arbitrary<WrongSetItem> = fc.record({
  questionRef: arbId,
  subject: arbSubject,
  grade: arbGrade,
  knowledgePointId: arbId,
  wrongAt: arbTimestamp,
  wrongCount: fc.integer({ min: 1, max: 10_000 }),
  generated: fc.option(arbGeneratedSnapshot, { nil: undefined }),
});

const arbWrongSet: fc.Arbitrary<WrongSet> = fc.record({
  items: fc.array(arbWrongSetItem, { maxLength: 10 }),
});

/** Last_Grade：三学科的可选年级记录（任意子集，含空形态） */
const arbLastGrade: fc.Arbitrary<EntityTypeMap['lastGrade']> = fc.record(
  {
    chinese: arbGrade,
    math: arbGrade,
    english: arbGrade,
  },
  { requiredKeys: [] },
);

/** 组合会话键："{subject}:{grade}"（grade 1-6，符合 isSubjectSessionMap 键形状） */
const arbSubjectGradeKey = fc.tuple(arbSubject, arbGrade).map(([s, g]) => `${s}:${g}`);

/** Child_Grade：null（未设置）或 1-6 整数（child-grade-setting 任务 2.1） */
const arbChildGrade: fc.Arbitrary<EntityTypeMap['childGrade']> = fc.option(arbGrade, {
  nil: null,
});

const arbWallet: fc.Arbitrary<StarWallet> = fc.record({
  balance: fc.integer({ min: 0, max: 1_000_000 }),
  totalEarned: fc.integer({ min: 0, max: 1_000_000 }),
});

const arbCollection: fc.Arbitrary<IslandCollection> = fc.record({
  items: fc.uniqueArray(
    fc.constantFrom(...COLLECTIBLE_ITEMS.map((item) => item.id)),
    { maxLength: COLLECTIBLE_ITEMS.length },
  ),
});

const arbQueueItem: fc.Arbitrary<QueueItem> = fc.oneof(
  fc.record({
    kind: fc.constant('bank' as const),
    questionId: arbId,
    knowledgePointId: arbId,
    subject: arbSubject,
    type: arbQuestionType,
    difficulty: arbDifficulty,
    source: fc.constantFrom('review' as const, 'new' as const, 'retry' as const),
  }),
  fc.record({
    kind: fc.constant('generated' as const),
    generatorParamsId: arbId,
    knowledgePointId: arbId,
    subject: arbSubject,
    type: arbQuestionType,
    difficulty: arbDifficulty,
    source: fc.constantFrom('review' as const, 'new' as const, 'retry' as const),
  }),
);

const arbAnswerResult: fc.Arbitrary<AnswerResult> = fc.record({
  questionRef: arbId,
  knowledgePointId: arbId,
  correct: fc.boolean(),
  retried: fc.boolean(),
  stars: fc.integer({ min: 0, max: 100 }),
  answeredAt: arbTimestamp,
});

/** 合法 'YYYY-MM-DD' 日期（4 位年 + 2 位月 + 2 位日，日取 1-28 避免月份天数问题） */
const arbDate: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 2000, max: 2099 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

const arbTodaySession: fc.Arbitrary<TodaySession> = fc.record({
  date: arbDate,
  queue: fc.array(arbQueueItem, { maxLength: 12 }),
  currentIndex: fc.integer({ min: 0, max: 50 }),
  streak: fc.integer({ min: 0, max: 1000 }),
  consecutiveWrong: fc.integer({ min: 0, max: 100 }),
  difficultyOffset: fc.constantFrom(0 as const, -1 as const),
  levelStartedAt: arbTimestamp,
  elapsedMs: fc.integer({ min: 0, max: 10_000_000 }),
  status: fc.constantFrom('active' as const, 'done' as const),
  results: fc.array(arbAnswerResult, { maxLength: 12 }),
});

const arbSessionToday: fc.Arbitrary<TodaySession | null> = fc.oneof(
  fc.constant(null),
  arbTodaySession,
);

const arbOralBestEntry: fc.Arbitrary<OralBestEntry> = fc.record({
  best: fc.integer({ min: 0, max: 10_000 }),
  achievedAt: arbTimestamp,
});

const arbOralBest: fc.Arbitrary<Record<string, OralBestEntry>> = fc.dictionary(
  arbId,
  arbOralBestEntry,
  { maxKeys: 6 },
);

const arbSettings: fc.Arbitrary<Settings> = fc.record({ soundOn: fc.boolean() });

/** 学科年级分组合会话：键符合 "{subject}:{grade}"，值为合法 TodaySession */
const arbSubjectSessions: fc.Arbitrary<EntityTypeMap['session:subjects']> = fc.dictionary(
  arbSubjectGradeKey,
  arbTodaySession,
  { maxKeys: 4 },
) as fc.Arbitrary<EntityTypeMap['session:subjects']>;

/** 各实体合法值生成器映射 */
const ENTITY_VALUE_ARBS: { [E in EntityName]: fc.Arbitrary<EntityTypeMap[E]> } = {
  mastery: arbMastery,
  wrongSet: arbWrongSet,
  wallet: arbWallet,
  collection: arbCollection,
  'session:today': arbSessionToday,
  oralBest: arbOralBest,
  settings: arbSettings,
  lastGrade: arbLastGrade,
  'session:subjects': arbSubjectSessions,
  childGrade: arbChildGrade,
};

// ============ 生成器：账号标识 ============

/** 账号标识（字母数字短横线下划线，非空） */
const arbAccountId = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
  { minLength: 1, maxLength: 16 },
);

/** 两个不同账号标识 */
const arbTwoAccounts = fc
  .tuple(arbAccountId, arbAccountId)
  .filter(([a, b]) => a !== b);

// ============ 测试侧校验预言（镜像 localStore 读取契约，用于保证生成值确实损坏） ============

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

const ONE_TO_FIVE: readonly number[] = [1, 2, 3, 4, 5];
const SUBJECTS: readonly string[] = ['chinese', 'math', 'english'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isMasteryRecordLike(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.knowledgePointId === 'string' &&
    ONE_TO_FIVE.includes(value.level as number) &&
    isFiniteNumber(value.totalCorrect) &&
    isFiniteNumber(value.totalWrong) &&
    (value.nextReviewAt === null || isFiniteNumber(value.nextReviewAt)) &&
    typeof value.mastered === 'boolean' &&
    isFiniteNumber(value.lastAnswerAt)
  );
}

/** 合法年级（1-6 整数，镜像 localStore isGradeValue） */
function isGradeLike(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 6;
}

function isGeneratedSnapshotLike(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.paramsId === 'string' &&
    typeof value.stem === 'string' &&
    isPlainObject(value.operands) &&
    Object.values(value.operands).every(isFiniteNumber) &&
    isFiniteNumber(value.answer)
  );
}

/**
 * Wrong_Set v2 校验预言（multi-grade-mistake-book 任务 5.1，镜像 localStore isWrongSetV2）
 */
function isWrongSetV2Like(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isPlainObject(item) &&
        typeof item.questionRef === 'string' &&
        SUBJECTS.includes(item.subject as string) &&
        isGradeLike(item.grade) &&
        typeof item.knowledgePointId === 'string' &&
        isFiniteNumber(item.wrongAt) &&
        Number.isInteger(item.wrongCount) &&
        (item.wrongCount as number) >= 1 &&
        (item.generated === undefined || isGeneratedSnapshotLike(item.generated)),
    )
  );
}

/**
 * 可识别 v1 形状预言（任一元素缺 wrongCount）：
 * 该形状读取时经迁移钩子升级（Req 6.6 优先于备份重置），不属于"损坏"，
 * 故损坏生成器必须排除此形状才能保证走备份自愈路径。
 */
function isLegacyV1WrongSetLike(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    Array.isArray(value.items) &&
    value.items.some((el) => !(isPlainObject(el) && isFiniteNumber(el.wrongCount)))
  );
}

function isQueueItemLike(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (value.kind !== 'bank' && value.kind !== 'generated') return false;
  if (value.kind === 'bank' && typeof value.questionId !== 'string') return false;
  if (value.kind === 'generated' && typeof value.generatorParamsId !== 'string') return false;
  return (
    typeof value.knowledgePointId === 'string' &&
    SUBJECTS.includes(value.subject as string) &&
    (QUESTION_TYPE_LIST as readonly string[]).includes(value.type as string) &&
    ONE_TO_FIVE.includes(value.difficulty as number) &&
    (value.source === 'review' || value.source === 'new' || value.source === 'retry')
  );
}

function isAnswerResultLike(value: unknown): boolean {
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

function isTodaySessionLike(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.date === 'string' &&
    DATE_RE.test(value.date) &&
    Array.isArray(value.queue) &&
    value.queue.every(isQueueItemLike) &&
    isNonNegativeInteger(value.currentIndex) &&
    isFiniteNumber(value.streak) &&
    isFiniteNumber(value.consecutiveWrong) &&
    (value.difficultyOffset === 0 || value.difficultyOffset === -1) &&
    isFiniteNumber(value.levelStartedAt) &&
    isFiniteNumber(value.elapsedMs) &&
    (value.status === 'active' || value.status === 'done') &&
    Array.isArray(value.results) &&
    value.results.every(isAnswerResultLike)
  );
}

/** 组合会话键形状（镜像 localStore SUBJECT_GRADE_KEY_RE） */
const SUBJECT_GRADE_KEY_RE = /^(chinese|math|english):[1-6]$/;

/**
 * 按实体分发"无需备份自愈即可读取"的判定（与 localStore 读取契约一致）。
 * 注意 wrongSet（multi-grade-mistake-book 任务 5.1）：合法 v2 或可识别 v1
 * 形状都不会走备份重置路径（v1 走迁移），因此二者都不算"损坏"。
 */
function isValidForEntity(entity: EntityName, value: unknown): boolean {
  switch (entity) {
    case 'mastery':
      return isPlainObject(value) && Object.values(value).every(isMasteryRecordLike);
    case 'wrongSet':
      return isWrongSetV2Like(value) || isLegacyV1WrongSetLike(value);
    case 'wallet':
      return isPlainObject(value) && isFiniteNumber(value.balance) && isFiniteNumber(value.totalEarned);
    case 'collection':
      return (
        isPlainObject(value) &&
        Array.isArray(value.items) &&
        value.items.every((item) => typeof item === 'string')
      );
    case 'session:today':
      return value === null || isTodaySessionLike(value);
    case 'oralBest':
      return (
        isPlainObject(value) &&
        Object.values(value).every(
          (entry) => isPlainObject(entry) && isFiniteNumber(entry.best) && isFiniteNumber(entry.achievedAt),
        )
      );
    case 'settings':
      return isPlainObject(value) && typeof value.soundOn === 'boolean';
    case 'lastGrade':
      return (
        isPlainObject(value) &&
        Object.entries(value).every(
          ([key, grade]) => SUBJECTS.includes(key) && isGradeLike(grade),
        )
      );
    case 'session:subjects':
      return (
        isPlainObject(value) &&
        Object.entries(value).every(
          ([key, session]) => SUBJECT_GRADE_KEY_RE.test(key) && isTodaySessionLike(session),
        )
      );
    case 'childGrade':
      // null（未设置）或 1-6 整数（镜像 localStore isChildGrade）
      return value === null || isGradeLike(value);
  }
}

// ============ 生成器：损坏存储值 ============

/** 无法解析的原始字符串（JSON.parse 必抛错） */
const arbUnparseableRaw = fc.string({ minLength: 0, maxLength: 60 }).filter((raw) => {
  try {
    JSON.parse(raw);
    return false;
  } catch {
    return true;
  }
});

/** 可解析但缺少必需字段/字段类型非法的原始字符串（对该实体必不合法） */
function arbInvalidStructureRaw(entity: EntityName): fc.Arbitrary<string> {
  return fc
    .jsonValue({ maxDepth: 3 })
    .filter((value) => !isValidForEntity(entity, value))
    .map((value) => JSON.stringify(value));
}

/** 损坏存储值：无法解析或结构非法二者之一 */
function arbCorruptRaw(entity: EntityName): fc.Arbitrary<string> {
  return fc.oneof(arbUnparseableRaw, arbInvalidStructureRaw(entity));
}

// ============ 生成器：按实体组合用例 ============

function entityRoundTripCase<E extends EntityName>(entity: E) {
  return fc.record({
    entity: fc.constant(entity),
    valueA: ENTITY_VALUE_ARBS[entity],
    valueB: ENTITY_VALUE_ARBS[entity],
  });
}

/** Property 22 用例：任意实体 + 该实体的两个任意合法值 */
const arbRoundTripCase = fc.oneof(
  entityRoundTripCase('mastery'),
  entityRoundTripCase('wrongSet'),
  entityRoundTripCase('wallet'),
  entityRoundTripCase('collection'),
  entityRoundTripCase('session:today'),
  entityRoundTripCase('oralBest'),
  entityRoundTripCase('settings'),
);

function entityCorruptCase<E extends EntityName>(entity: E) {
  return fc.record({
    entity: fc.constant(entity),
    raw1: arbCorruptRaw(entity),
    raw2: arbCorruptRaw(entity),
    value: ENTITY_VALUE_ARBS[entity],
    ts: arbTimestamp,
  });
}

/** Property 23 用例：任意实体 + 两个损坏原始值 + 一个合法恢复值 + 备份时间戳 */
const arbCorruptCase = fc.oneof(
  entityCorruptCase('mastery'),
  entityCorruptCase('wrongSet'),
  entityCorruptCase('wallet'),
  entityCorruptCase('collection'),
  entityCorruptCase('session:today'),
  entityCorruptCase('oralBest'),
  entityCorruptCase('settings'),
);

// ============ 属性测试 ============

describe('localStore 属性测试', () => {
  /**
   * **Feature: kids-learning-adventure, Property 22: 存储读写往返与多账号隔离**
   *
   * *For any* 实体值（Mastery_Record、Wrong_Set、Star_Wallet、Island_Collection、设置）
   * 与任意账号标识 A≠B：写入 A 后读 A 得到等价值；在写 A 之后读 B 得到该实体的初始状态，
   * 两账号互不影响。
   *
   * **Validates: Requirements 10.1, 10.2, 10.3, 12.7, 13.5**
   */
  it('Property 22: 写入 A 读回等价值；读 B 得初始态；两账号互不影响', () => {
    fc.assert(
      fc.property(arbRoundTripCase, arbTwoAccounts, ({ entity, valueA, valueB }, [accA, accB]) => {
        const storage = createMemoryStorage();
        const storeA = createLocalStore({ storage, accountId: accA });
        const storeB = createLocalStore({ storage, accountId: accB });

        // 写入 A 后读 A 得到等价值（Req 10.1, 10.3, 12.7）
        storeA.write(entity, valueA);
        expect(storeA.read(entity)).toEqual(valueA);

        // 在写 A 之后读 B 得到该实体的初始状态（Req 13.5）
        expect(storeB.read(entity)).toEqual(initialEntityState(entity));

        // 两账号互不影响：写 B 之后，B 读回自身值，A 仍为原值
        storeB.write(entity, valueB);
        expect(storeB.read(entity)).toEqual(valueB);
        expect(storeA.read(entity)).toEqual(valueA);

        // 新实例（模拟浏览器重开）读 A 仍与最后成功写入一致（Req 10.3）
        const storeAReopened = createLocalStore({ storage, accountId: accA });
        expect(storeAReopened.read(entity)).toEqual(valueA);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 23: 损坏数据自愈与备份保留**
   *
   * *For any* 无法解析或缺少必需字段的存储值：读取时该实体按初始状态返回
   * （Mastery_Record 空、Wrong_Set 空、余额 0、收藏空），原始损坏值被复制到独立备份键，
   * 且同一会话内再次读取/写入不覆盖该备份。
   *
   * **Validates: Requirements 10.4**
   */
  it('Property 23: 损坏读取按初始态自愈，原值入备份且会话内不被覆盖', () => {
    fc.assert(
      fc.property(arbCorruptCase, ({ entity, raw1, raw2, value, ts }) => {
        const storage = createMemoryStorage();
        const store = createLocalStore({ storage, now: () => ts });
        const entityKey = store.keyFor(entity);
        const backupKey = store.backupKeyFor(entity, ts);

        // 备份键独立于实体键
        expect(backupKey).not.toBe(entityKey);
        expect(backupKey).toContain(':backup:');

        // 损坏读取：返回该实体初始状态（Req 10.4）
        storage.setItem(entityKey, raw1);
        expect(store.read(entity)).toEqual(initialEntityState(entity));

        // 原始损坏值被复制到独立备份键
        expect(storage.getItem(backupKey)).toBe(raw1);

        // 同一会话内再次损坏读取：仍按初始态返回，且不覆盖首次备份
        storage.setItem(entityKey, raw2);
        expect(store.read(entity)).toEqual(initialEntityState(entity));
        expect(storage.getItem(backupKey)).toBe(raw1);

        // 同一会话内写入新合法值：读取恢复正常，备份依旧不被覆盖
        store.write(entity, value);
        expect(store.read(entity)).toEqual(value);
        expect(storage.getItem(backupKey)).toBe(raw1);
      }),
      { numRuns: 100 },
    );
  });
});
