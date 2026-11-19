/**
 * App_State setChildGrade 隔离性属性测试（fast-check，≥100 次迭代）
 *
 * 对应 .kiro/specs/child-grade-setting/design.md Property 7。
 * 与 tests/property/localStore.props.spec.ts 的通用实体属性互补：
 * 本文件专注 App_State 的 setChildGrade 调用对存储的写副作用范围——
 * 任意预置存储内容下，调用后除 childGrade 键外的全部键值逐一不变。
 *
 * 实体值生成器沿用 tests/property/localStore.props.spec.ts 的约定；
 * 存储键观测沿用 childGradeMissing.props.spec.ts 的记录型包装思路，
 * 此处镜像全部键值内容以支持"调用前后逐一深比较"。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createLocalStore,
  createMemoryStorage,
  type EntityName,
  type EntityTypeMap,
  type OralBestEntry,
  type Settings,
  type StorageLike,
  type WrongSet,
  type WrongSetItem,
} from '@/data/localStore';
import { createAppState } from '@/stores/appState';
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

// ============ 生成器：合法实体值（同 localStore.props.spec.ts 约定） ============

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

const arbGrade = fc.integer({ min: 1, max: 6 });

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

const arbGeneratedSnapshot = fc.record({
  paramsId: arbId,
  stem: arbId,
  operands: fc.dictionary(arbId, fc.integer({ min: -10_000, max: 10_000 }), { maxKeys: 4 }),
  answer: fc.integer({ min: -1_000_000, max: 1_000_000 }),
});

/** Wrong_Set v2 结构（multi-grade-mistake-book 任务 5.1） */
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

/** 组合会话键："{subject}:{grade}"（grade 1-6，符合 isSubjectSessionMap 键形状） */
const arbSubjectGradeKey = fc.tuple(arbSubject, arbGrade).map(([s, g]) => `${s}:${g}`);

const arbSubjectSessions: fc.Arbitrary<EntityTypeMap['session:subjects']> = fc.dictionary(
  arbSubjectGradeKey,
  arbTodaySession,
  { maxKeys: 4 },
) as fc.Arbitrary<EntityTypeMap['session:subjects']>;

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

/** Last_Grade：三学科的可选年级记录（任意子集，含空形态） */
const arbLastGrade: fc.Arbitrary<EntityTypeMap['lastGrade']> = fc.record(
  {
    chinese: arbGrade,
    math: arbGrade,
    english: arbGrade,
  },
  { requiredKeys: [] },
);

/** 合法 Child_Grade 值：null（未设置）或 1-6 整数 */
const arbChildGrade: fc.Arbitrary<EntityTypeMap['childGrade']> = fc.option(arbGrade, {
  nil: null },
);

/**
 * 任意预置存储内容：全部实体（含 childGrade 的任意初始值）的任意合法值组合，
 * 每个实体键可存在或缺失（缺失键读取按初始态返回，同样不得被触碰）。
 */
const arbStorageContents: fc.Arbitrary<Partial<EntityTypeMap>> = fc.record(
  {
    mastery: arbMastery,
    wrongSet: arbWrongSet,
    wallet: arbWallet,
    collection: arbCollection,
    'session:today': arbSessionToday,
    'session:subjects': arbSubjectSessions,
    oralBest: arbOralBest,
    settings: arbSettings,
    lastGrade: arbLastGrade,
    childGrade: arbChildGrade,
  },
  { requiredKeys: [] },
);

const ALL_ENTITY_NAMES: readonly EntityName[] = [
  'mastery',
  'wrongSet',
  'wallet',
  'collection',
  'session:today',
  'session:subjects',
  'oralBest',
  'settings',
  'lastGrade',
  'childGrade',
];

// ============ 镜像型存储包装（观测存储全部键值内容） ============

/**
 * 在内存 mock 上包装一层镜像 Map，记录当前全部键值内容，
 * 供"调用前后逐一深比较"使用（createMemoryStorage 本身不提供键枚举）。
 */
function createInspectableStorage(): {
  storage: StorageLike;
  snapshot(): Map<string, string>;
} {
  const base = createMemoryStorage();
  const mirror = new Map<string, string>();
  return {
    storage: {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        base.setItem(key, value);
        mirror.set(key, String(value));
      },
      removeItem: (key) => {
        base.removeItem(key);
        mirror.delete(key);
      },
    },
    snapshot: () => new Map(mirror),
  };
}

// ============ 属性测试 ============

describe('appState setChildGrade 隔离性属性测试', () => {
  /**
   * **Feature: child-grade-setting, Property 7: 设置孩子年级不触碰其他实体**
   *
   * *For any* 存储内容（mastery/wrongSet/wallet/collection/session:today/
   * session:subjects/oralBest/settings/lastGrade 任意合法值组合）与任意年级
   * g ∈ 1-6：调用 setChildGrade(g) 后，存储中除 childGrade 键外的全部键值
   * 与调用前逐一深相等（不新增、不删除、不修改任何其他实体的任何记录）。
   *
   * **Validates: Requirements 3.6**
   */
  it('Property 7: setChildGrade 后除 childGrade 键外全部键值与调用前逐一深相等', () => {
    fc.assert(
      fc.property(
        arbStorageContents,
        arbGrade,
        arbTimestamp,
        (contents, grade, ts) => {
          const { storage, snapshot } = createInspectableStorage();

          // 预置任意合法存储内容（经 Local_Store 立即写入，保证合法编码）
          const seedStore = createLocalStore({ storage, now: () => ts });
          const writeAny = seedStore.write as (entity: EntityName, value: unknown) => void;
          for (const entity of ALL_ENTITY_NAMES) {
            const value = contents[entity];
            if (value !== undefined) {
              writeAny.call(seedStore, entity, value);
            }
          }

          // 创建 App_State（内存存储 + 注入时钟；启动只读恢复，不写存储）
          const state = createAppState({ storage, now: () => ts });
          const childGradeKey = state.store.keyFor('childGrade');

          // 调用前快照：存储中全部原始键值
          const before = snapshot();

          // 调用 setChildGrade(g)
          state.setChildGrade(grade);

          // 设置生效：响应式引用与 Local_Store 立即读出均为 g
          expect(state.childGrade.value).toBe(grade);
          expect(state.store.read('childGrade')).toBe(grade);

          // 调用后快照：除 childGrade 键外键集合不变（不新增、不删除）
          const after = snapshot();
          const beforeKeys = [...before.keys()].filter((key) => key !== childGradeKey);
          const afterKeys = [...after.keys()].filter((key) => key !== childGradeKey);
          expect(afterKeys.sort()).toEqual(beforeKeys.sort());

          // 除 childGrade 键外全部键值与调用前逐一深相等
          //（原始字符串逐字节相等，蕴含解析后深相等）
          for (const key of beforeKeys) {
            expect(after.get(key)).toBe(before.get(key));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
