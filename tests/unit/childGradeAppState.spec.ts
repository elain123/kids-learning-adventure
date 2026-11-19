/**
 * 单元测试：启动恢复、写失败与升级保留（child-grade-setting 任务 4.5）
 *
 * 以内存存储 + 注入时钟 + 真实种子题库创建 App_State（createAppState 默认加载
 * 全部年级种子文件），覆盖不以属性测试覆盖的示例与边界需求：
 *
 * 1. 启动恢复（Req 4.3）：预置已写 childGrade 的内存存储创建 App_State，
 *    childGrade 响应式引用立即恢复为已存值；
 * 2. 写失败（Req 4.7）：注入 setItem 抛错的存储，setChildGrade 后 writeError
 *    有"本次进度可能无法保存"提示、childGrade 引用保持新值、startAdventure 仍可用；
 * 3. 过滤后两段均空（Req 2.6）：仅高年级可出题 + childGrade=1，startAdventure
 *    返回 empty 且不生成会话；首页点击"今日冒险"展示提示并停留首页；
 * 4. 学科页年级流程不受扰（Req 2.8）：存入 childGrade 后，学科页年级流程
 *    （filterBankForGrade + 五参 buildTodayQueue + session:subjects）输出与
 *    存入前完全一致；
 * 5. 升级保留（Req 4.8、3.1）：预置一期/二期各实体数据（无 childGrade 键），
 *    启动后既有数据逐键不变、childGrade 为 null、今日冒险按未设置不过滤生成。
 *
 * _Requirements: 2.6, 2.8, 3.1, 4.3, 4.7, 4.8_
 */

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import HomePage from '@/pages/HomePage.vue';
import {
  createAppState,
  setSharedAppState,
  SESSION_CONFIG,
  type AppState,
} from '@/stores/appState';
import {
  createLocalStore,
  createMemoryStorage,
  type EntityName,
  type EntityTypeMap,
  type StorageLike,
} from '@/data/localStore';
import { filterBankForGrade, filterGeneratorsForGrade } from '@/data/questionBank';
import { buildTodayQueue, localDateString } from '@/engine/reviewEngine';
import { subjectGradeKey } from '@/engine/subjectSession';
import type { LastGrade } from '@/engine/gradeSelector';
import type { AudioService } from '@/services/audioService';
import type {
  IslandCollection,
  MasteryRecord,
  QueueItem,
  StarWallet,
  Subject,
  TodaySession,
} from '@/types';
import type { WrongSet } from '@/engine/wrongSet';

// ============ 公共测试辅助 ============

/** 固定注入时钟：2025-06-15 10:30（本地时间），日期取月中避免跨月边界 */
const NOW = new Date(2025, 5, 15, 10, 30, 0).getTime();
const DAY_MS = 24 * 3600 * 1000;

/** 静音 Audio_Service（注入 App_State，避免 jsdom 媒体告警干扰） */
const silentAudio: AudioService = {
  playEffect: () => Promise.resolve(),
  playPronunciation: () => Promise.resolve(),
  speakText: () => Promise.resolve(),
  stopAll: () => undefined,
  isEffectAvailable: () => false,
};

/** 创建注入固定时钟与静音音频的 App_State */
function createTestState(storage: StorageLike): AppState {
  return createAppState({ storage, audio: silentAudio, now: () => NOW });
}

/** 到点未掌握的掌握度记录 */
function dueRecord(knowledgePointId: string): MasteryRecord {
  return {
    knowledgePointId,
    level: 1,
    totalCorrect: 1,
    totalWrong: 0,
    nextReviewAt: NOW - 1000,
    mastered: false,
    lastAnswerAt: NOW - 2000,
  };
}

/** 已掌握的掌握度记录（nextReviewAt=null，永不进入复习段） */
function masteredRecord(knowledgePointId: string): MasteryRecord {
  return {
    knowledgePointId,
    level: 5,
    totalCorrect: 8,
    totalWrong: 0,
    nextReviewAt: null,
    mastered: true,
    lastAnswerAt: NOW - DAY_MS,
  };
}

/**
 * 镜像型存储包装：在内存 mock 上记录全部键值内容，
 * 供"启动前后逐键比较"与"无备份键"断言使用。
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

/** 测试路由：与 src/router 同路径骨架，非首页组件以空桩替代 */
function createTestRouter(): Router {
  const stub = { template: '<div />' };
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: stub },
      { path: '/subject/:id', name: 'subject', component: stub },
      { path: '/practice', name: 'practice', component: stub },
      { path: '/box', name: 'box', component: stub },
      { path: '/island', name: 'island', component: stub },
    ],
  });
}

// ============ 1. 启动恢复（Req 4.3） ============

describe('启动恢复（Req 4.3）', () => {
  it.each([1, 3, 6])(
    '预置已写 childGrade=%i 的存储创建 App_State，引用立即恢复为已存值',
    (grade) => {
      const storage = createMemoryStorage();
      // 模拟家长此前设置并关闭浏览器：同一底层存储上预置 childGrade
      const seedStore = createLocalStore({ storage });
      seedStore.write('childGrade', grade);

      // 重新打开应用（新 App_State 实例）：引用立即恢复为最后一次成功写入值
      const state = createTestState(storage);
      expect(state.childGrade.value).toBe(grade);
      expect(state.store.read('childGrade')).toBe(grade);
    },
  );

  it('存储中无 childGrade 键时按未设置 null 启动（对照）', () => {
    const state = createTestState(createMemoryStorage());
    expect(state.childGrade.value).toBeNull();
  });
});

// ============ 2. 写失败（Req 4.7） ============

describe('写失败（Req 4.7）', () => {
  /** setItem 恒抛错的存储（存储不可用/空间不足）；读取正常返回空 */
  function createThrowingStorage(): StorageLike {
    return {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError: 存储空间不足');
      },
      removeItem: () => undefined,
    };
  }

  it('setItem 抛错：writeError 有提示、childGrade 引用保持新值、startAdventure 仍可用', () => {
    const state = createTestState(createThrowingStorage());

    state.setChildGrade(3);

    // 内存态保持已选年级在界面上可见
    expect(state.childGrade.value).toBe(3);
    // 写失败汇入 writeError，提示"本次进度可能无法保存"
    expect(state.writeError.value).not.toBeNull();
    expect(state.writeError.value).toContain('本次进度可能无法保存');

    // 不阻断学生继续练习：今日冒险仍可生成并进入练习
    const result = state.startAdventure();
    expect(result.kind).toBe('ready');
    if (result.kind === 'ready') {
      expect(result.session.queue.length).toBeGreaterThan(0);
      expect(state.session.value).not.toBeNull();
    }
    // 会话持久化同样失败：writeError 保持提示，不抛出、不阻断
    expect(state.writeError.value).toContain('本次进度可能无法保存');
  });
});

// ============ 3. 过滤后两段均空（Req 2.6） ============

describe('过滤后两段均空（Req 2.6）', () => {
  /**
   * 构造"仅高年级可出题 + childGrade=1"场景：
   * 全部年级 ≤1 的知识点（题库可入队题 + 口算生成器覆盖）预置已掌握记录
   * （不到点、不进复习段、有新知识点段记录而不作新知识点枚举）；
   * 另预置一条到点未掌握的高年级记录（复习段候选，被年级过滤排除）。
   */
  function seedLowGradeMastered(state: AppState): Record<string, MasteryRecord> {
    const bank = state.bank;
    expect(bank, '真实种子题库必须加载成功').not.toBeNull();
    const records: Record<string, MasteryRecord> = {};
    for (const q of bank!.queueEligible) {
      if (q.grade <= 1) records[q.knowledgePointId] = masteredRecord(q.knowledgePointId);
    }
    for (const g of state.generators) {
      if (g.grade <= 1) records[g.knowledgePointId] = masteredRecord(g.knowledgePointId);
    }
    // 非平凡性前置：场景内确实存在低年级内容（否则测试退化）
    expect(Object.keys(records).length).toBeGreaterThan(0);
    // 到点未掌握的高年级知识点：未设置时会进入复习段，childGrade=1 时必须排除
    const highGrade = bank!.queueEligible.find((q) => q.grade >= 5);
    expect(highGrade, '种子题库应含高年级可入队题').toBeDefined();
    records[highGrade!.knowledgePointId] = dueRecord(highGrade!.knowledgePointId);
    return records;
  }

  it('仅高年级内容可出题 + childGrade=1：startAdventure 返回 empty 且不生成会话', () => {
    const storage = createMemoryStorage();
    const state = createTestState(storage);
    state.store.write('mastery', seedLowGradeMastered(state));

    state.setChildGrade(1);
    const result = state.startAdventure();

    // 复习段与新知识点段过滤后均空：沿用既有无可用题行为
    expect(result.kind).toBe('empty');
    // 不生成当日会话（首页据此提示并停留，不进入练习界面）
    expect(state.store.read('session:today')).toBeNull();
    expect(state.session.value).toBeNull();
  });

  it('首页点击"今日冒险"：展示无可用题提示并停留首页，不导航练习页', async () => {
    const storage = createMemoryStorage();
    const state = createTestState(storage);
    state.store.write('mastery', seedLowGradeMastered(state));
    state.setChildGrade(1);
    setSharedAppState(state);

    const router = createTestRouter();
    await router.push('/');
    await router.isReady();
    const wrapper = mount(HomePage, { global: { plugins: [router] } });
    await nextTick();

    await wrapper.find('.adventure-button').trigger('click');
    await nextTick();

    // 提示展示（沿用既有 Req 1.7 无可用题提示条）
    const banner = wrapper.find('.home-page__banner');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('明天再来冒险');
    // 停留首页：未导航练习页
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('同一掌握度数据未设置 childGrade 时可正常生成（对照：空队列来自过滤）', () => {
    const storage = createMemoryStorage();
    const state = createTestState(storage);
    state.store.write('mastery', seedLowGradeMastered(state));

    // 未设置（null）不过滤：高年级新知识点使队列非空
    expect(state.childGrade.value).toBeNull();
    const result = state.startAdventure();
    expect(result.kind).toBe('ready');
  });
});

// ============ 4. 学科页年级流程不受扰（Req 2.8） ============

describe('学科页年级流程不受扰（Req 2.8）', () => {
  /** 学科页"先选年级再练习"流程输出（与 SubjectPage 同口径：filterBankForGrade + 五参 buildTodayQueue + session:subjects 组合键读取） */
  function subjectGradeFlow(
    state: AppState,
    subject: Subject,
    grade: number,
  ): {
    filteredAll: readonly unknown[];
    queue: QueueItem[];
    existingSession: TodaySession | null;
    sessions: EntityTypeMap['session:subjects'];
  } {
    const gradeIndex = filterBankForGrade(state.bank!, subject, grade);
    const generators =
      subject === 'math' ? filterGeneratorsForGrade(state.generators, grade) : [];
    // 学科页流程不读取、不参考 childGrade：既有五参调用
    const queue = buildTodayQueue(
      state.store.read('mastery'),
      gradeIndex,
      NOW,
      SESSION_CONFIG,
      generators,
    );
    const sessions = state.store.read('session:subjects');
    const existingSession = sessions[subjectGradeKey(subject, grade)] ?? null;
    return { filteredAll: gradeIndex.all, queue, existingSession, sessions };
  }

  /** 预置一组学科组合会话（非空 session:subjects），放大"不受扰"可观测性 */
  function seedSubjectSessions(state: AppState): void {
    const session: TodaySession = {
      date: localDateString(NOW),
      queue: [
        {
          kind: 'bank',
          questionId: 'cn-g6a-u1-poem-0001',
          knowledgePointId: 'cn.g6.shi.001',
          subject: 'chinese',
          type: 'poem_chain',
          difficulty: 2,
          source: 'new',
        },
      ],
      currentIndex: 0,
      streak: 0,
      consecutiveWrong: 0,
      difficultyOffset: 0,
      levelStartedAt: NOW - 60_000,
      elapsedMs: 0,
      status: 'active',
      results: [],
    };
    state.store.write('session:subjects', { [subjectGradeKey('chinese', 6)]: session });
  }

  it('存入 childGrade 后学科页年级流程输出与存入前完全一致', () => {
    const state = createTestState(createMemoryStorage());
    seedSubjectSessions(state);

    const cases: Array<[Subject, number]> = [
      ['chinese', 6],
      ['math', 3],
      ['english', 4],
    ];

    // 存入前：各学科学年级流程输出快照（未设置 childGrade）
    const before = cases.map(([subject, grade]) => subjectGradeFlow(state, subject, grade));
    // 非平凡性前置：过滤结果与生成队列非空
    for (const snap of before) {
      expect(snap.filteredAll.length).toBeGreaterThan(0);
      expect(snap.queue.length).toBeGreaterThan(0);
    }

    // 家长存入孩子年级
    state.setChildGrade(2);
    expect(state.store.read('childGrade')).toBe(2);

    // 存入后：同一流程输出与存入前逐一深相等
    const after = cases.map(([subject, grade]) => subjectGradeFlow(state, subject, grade));
    for (let i = 0; i < cases.length; i += 1) {
      const [subject, grade] = cases[i];
      const label = `${subject}:g${grade}`;
      expect(after[i].filteredAll, `${label} 过滤后题库索引应不变`).toEqual(before[i].filteredAll);
      expect(after[i].queue, `${label} 五参生成队列应不变`).toEqual(before[i].queue);
      expect(after[i].existingSession, `${label} 组合会话读取应不变`).toEqual(
        before[i].existingSession,
      );
      expect(after[i].sessions, 'session:subjects 实体应不受扰').toEqual(before[i].sessions);
    }
    // 预置的组合会话逐值保持（设置 childGrade 不触碰学科练习进度）
    expect(after[0].existingSession?.queue[0].knowledgePointId).toBe('cn.g6.shi.001');
  });
});

// ============ 5. 升级保留（Req 4.8、3.1） ============

describe('升级保留（Req 4.8、3.1）', () => {
  /** 昨日日期的今日会话（一期格式既有数据；今日启动应触发重新生成而非清除） */
  function yesterdaySession(): TodaySession {
    return {
      date: localDateString(NOW - DAY_MS),
      queue: [
        {
          kind: 'bank',
          questionId: 'cn-g6a-u1-poem-0001',
          knowledgePointId: 'cn.g6.shi.001',
          subject: 'chinese',
          type: 'poem_chain',
          difficulty: 2,
          source: 'review',
        },
      ],
      currentIndex: 1,
      streak: 1,
      consecutiveWrong: 0,
      difficultyOffset: 0,
      levelStartedAt: NOW - DAY_MS,
      elapsedMs: 300_000,
      status: 'done',
      results: [
        {
          questionRef: 'cn-g6a-u1-poem-0001',
          knowledgePointId: 'cn.g6.shi.001',
          correct: true,
          retried: false,
          stars: 5,
          answeredAt: NOW - DAY_MS + 60_000,
        },
      ],
    };
  }

  /** 一期/二期格式全部既有实体（无 childGrade 键） */
  function seedLegacyEntities(storage: StorageLike): EntityTypeMap {
    const seedStore = createLocalStore({ storage });
    const mastery: Record<string, MasteryRecord> = {
      // 到点未掌握的高年级记录：未设置不过滤时必须出现在复习段
      'cn.g6.shi.001': dueRecord('cn.g6.shi.001'),
    };
    const wrongSet: WrongSet = {
      items: [
        {
          questionRef: 'cn-g6a-u1-poem-0001',
          subject: 'chinese',
          grade: 6,
          knowledgePointId: 'cn.g6.shi.001',
          wrongAt: NOW - DAY_MS,
          wrongCount: 2,
        },
      ],
    };
    const wallet: StarWallet = { balance: 45, totalEarned: 120 };
    const collection: IslandCollection = { items: ['pet-fox', 'deco-treehouse'] };
    const sessionToday = yesterdaySession();
    const sessionSubjects: EntityTypeMap['session:subjects'] = {
      [subjectGradeKey('math', 3)]: yesterdaySession(),
    };
    const oralBest = { 'gen-g3-add': { best: 12, achievedAt: NOW - DAY_MS } };
    const settings = { soundOn: false };
    const lastGrade: LastGrade = { chinese: 2, math: 3 };

    seedStore.write('mastery', mastery);
    seedStore.write('wrongSet', wrongSet);
    seedStore.write('wallet', wallet);
    seedStore.write('collection', collection);
    seedStore.write('session:today', sessionToday);
    seedStore.write('session:subjects', sessionSubjects);
    seedStore.write('oralBest', oralBest);
    seedStore.write('settings', settings);
    seedStore.write('lastGrade', lastGrade);

    return {
      mastery,
      wrongSet,
      wallet,
      collection,
      'session:today': sessionToday,
      'session:subjects': sessionSubjects,
      oralBest,
      settings,
      lastGrade,
      childGrade: null,
    };
  }

  it('预置一期/二期各实体（无 childGrade 键）启动：既有数据逐键不变、childGrade 为 null', () => {
    const { storage, snapshot } = createInspectableStorage();
    const seeded = seedLegacyEntities(storage);
    const beforeBoot = snapshot();

    // 本功能版本首次启动（升级路径）
    const state = createTestState(storage);

    // childGrade 缺失 → 按未设置 null 启动（Req 4.4）
    expect(state.childGrade.value).toBeNull();

    // 既有数据逐键不变：经 Local_Store 读回与预置值深相等
    const entities = Object.keys(seeded) as EntityName[];
    for (const entity of entities) {
      if (entity === 'childGrade') continue;
      expect(state.store.read(entity), `既有实体 ${entity} 启动后应保持不变`).toEqual(
        seeded[entity],
      );
    }
    // 启动过程不新增、不删除、不修改任何存储键（原始字符串逐字节相等）
    expect(snapshot()).toEqual(beforeBoot);
    // 未产生任何备份键（childGrade 缺失不建备份，Req 4.4）
    for (const key of snapshot().keys()) {
      expect(key).not.toContain(':backup:');
    }

    // 错题集/星星/掌握度等既有数据在应用态可见（响应式引用恢复）
    expect(state.wallet.value).toEqual(seeded.wallet);
    expect(state.soundOn.value).toBe(false);
    expect(state.session.value).toEqual(seeded['session:today']);
  });

  it('升级后今日冒险按未设置不过滤生成：与既有五参调用输出深相等（Req 3.1）', () => {
    const { storage } = createInspectableStorage();
    seedLegacyEntities(storage);
    const state = createTestState(storage);

    // 既有五参调用（未设置不过滤口径）作为期望输出
    const bank = state.bank;
    expect(bank).not.toBeNull();
    const expected = buildTodayQueue(
      state.store.read('mastery'),
      bank!,
      NOW,
      SESSION_CONFIG,
      state.generators,
    );
    expect(expected.length).toBeGreaterThan(0);

    // childGrade 为 null：startAdventure 生成的队列与既有五参调用完全一致
    expect(state.childGrade.value).toBeNull();
    const result = state.startAdventure();
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.resumed).toBe(false);
    expect(result.session.queue).toEqual(expected);

    // 不过滤的直接证据：到点未掌握的六年级知识点出现在复习段首位
    expect(result.session.queue[0].knowledgePointId).toBe('cn.g6.shi.001');
    expect(result.session.queue[0].source).toBe('review');

    // 生成后既有实体（除当日会话正常更新外）仍保持不变
    expect(state.store.read('mastery')).toEqual({
      'cn.g6.shi.001': dueRecord('cn.g6.shi.001'),
    });
    expect(state.store.read('wallet')).toEqual({ balance: 45, totalEarned: 120 });
    expect(state.store.read('wrongSet').items).toHaveLength(1);
  });
});
