/**
 * 升级冒烟测试（child-grade-setting 任务 8.3）
 *
 * 在 jsdom + 内存 localStorage（全应用共享：createLocalStore() 默认落在它上面）
 * 中模拟"本功能版本首次启动"的升级路径：
 *
 *   预置一期/二期格式全部既有实体（mastery / wrongSet / wallet / collection /
 *   session:today / session:subjects / oralBest / settings / lastGrade，
 *   无 childGrade 键）
 *   → 启动应用（真实 App.vue + 真实路由 + 真实种子题库）
 *   → childGrade 按未设置 null 启动（Req 4.4）；既有数据逐键不变（Req 4.8：
 *     经 Local_Store 读回与预置值深相等、存储原始字符串逐字节相等、
 *     不新增/删除键、不产生任何备份键）
 *   → 既有数据在界面层可见：首页星星余额 45（Star_Wallet）、小岛页收藏计数
 *     与错题集徽标 1（Wrong_Set + Mastery 派生未掌握计数）、错题集页条目
 *     题干/年级/"未掌握"标识（掌握度派生可见）
 *   → 点击"今日冒险"生成新会话：childGrade 为 null 时按未设置不过滤生成
 *     （Req 3.1）——队列与既有五参 buildTodayQueue 调用输出深相等，到点
 *     未掌握的六年级知识点直接进入复习段首位（不被过滤的直接证据）
 *
 * 确定性保障与 tests/integration/mainFlow.spec.ts 相同：固定系统时间
 * 2025-06-15、Audio_Service 全 stub、真实种子题库静态打包。
 *
 * Validates: Requirements 3.1, 4.4, 4.8
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter, type Router, type RouteRecordRaw } from 'vue-router';

import App from '@/App.vue';
import HomePage from '@/pages/HomePage.vue';
import SubjectPage from '@/pages/SubjectPage.vue';
import PracticePage from '@/pages/PracticePage.vue';
import BoxPage from '@/pages/BoxPage.vue';
import IslandPage from '@/pages/IslandPage.vue';
import WrongSetPage from '@/pages/WrongSetPage.vue';
import {
  createAppState,
  setSharedAppState,
  SESSION_CONFIG,
  type AppState,
} from '@/stores/appState';
import { audioService } from '@/services/audioService';
import { createLocalStore, type EntityName, type EntityTypeMap } from '@/data/localStore';
import { buildTodayQueue, localDateString } from '@/engine/reviewEngine';
import { subjectGradeKey } from '@/engine/subjectSession';
import type { LastGrade } from '@/engine/gradeSelector';
import type { WrongSet } from '@/engine/wrongSet';
import type {
  IslandCollection,
  MasteryRecord,
  StarWallet,
  TodaySession,
} from '@/types';

// ============ Local_Store 键（kla:v1:{accountId}:{entity}，一期 accountId=default） ============

const KEY_PREFIX = 'kla:v1:default';

/** 固定系统时间：2025-06-15 08:00（本地时间），日期取月中避免跨月边界 */
const NOW = new Date(2025, 5, 15, 8, 0, 0).getTime();
const DAY_MS = 24 * 3600 * 1000;

/** 全量 localStorage 原始字符串快照（升级前后逐字节比较用） */
function snapshotStorage(): Map<string, string> {
  const snap = new Map<string, string>();
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i) as string;
    snap.set(key, localStorage.getItem(key) as string);
  }
  return snap;
}

// ============ 一期/二期格式既有数据预置（无 childGrade 键） ============

/** 昨日日期的今日会话（既有数据形态；今日启动应触发重新生成而非清除） */
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

/**
 * 预置一期/二期全部既有实体（经 Local_Store 写入 jsdom localStorage，与真实
 * 旧版本落盘路径一致），返回各实体预置值供逐键比对。不预置 childGrade 键。
 */
function seedLegacyEntities(): EntityTypeMap {
  const seedStore = createLocalStore();
  const mastery: Record<string, MasteryRecord> = {
    // 到点未掌握的六年级记录：未设置不过滤时必须出现在复习段（不被过滤的直接证据）
    'cn.g6.shi.001': {
      knowledgePointId: 'cn.g6.shi.001',
      level: 1,
      totalCorrect: 1,
      totalWrong: 0,
      nextReviewAt: NOW - 1000,
      mastered: false,
      lastAnswerAt: NOW - 2000,
    },
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

// ============ 应用启动（打开应用 / 关闭应用） ============

let wrapper: VueWrapper | null = null;
let appState: AppState;
let router: Router;

/**
 * 测试路由：与 src/router/index.ts 同路径同名，但以静态 import 挂载页面组件，
 * 避免 lazy import 在 fake timers 下的加载时序不确定性（导航语义完全一致）。
 */
const testRoutes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomePage },
  { path: '/subject/:id', name: 'subject', component: SubjectPage },
  { path: '/practice', name: 'practice', component: PracticePage },
  { path: '/box', name: 'box', component: BoxPage },
  { path: '/island', name: 'island', component: IslandPage },
  { path: '/island/wrong', name: 'wrong-set', component: WrongSetPage },
];

/** 以同一 jsdom localStorage 启动应用并停在首页（模拟本功能版本首次启动） */
async function bootApp(): Promise<void> {
  appState = createAppState({ audio: audioService });
  setSharedAppState(appState);
  router = createRouter({ history: createMemoryHistory(), routes: testRoutes });
  await router.push('/');
  await router.isReady();
  wrapper = mount(App, { global: { plugins: [router] } });
  await settle();
}

/** 关闭应用（不清理 localStorage） */
async function closeApp(): Promise<void> {
  if (wrapper !== null) {
    wrapper.unmount();
    wrapper = null;
  }
  setSharedAppState(null);
  await settle();
}

/** 等待路由导航、事件处理与 Vue 渲染全部落地 */
async function settle(): Promise<void> {
  await flushPromises();
  await nextTick();
  await nextTick();
}

function page(): VueWrapper {
  expect(wrapper, '应用应处于已挂载状态').not.toBeNull();
  return wrapper as VueWrapper;
}

// ============ 测试 ============

describe('升级冒烟：一期/二期既有数据启动保留（Req 3.1, 4.4, 4.8）', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 15, 8, 0, 0));
    // 音频静默：jsdom 无 Web Audio/媒体播放实现
    vi.spyOn(audioService, 'playEffect').mockResolvedValue(undefined);
    vi.spyOn(audioService, 'playPronunciation').mockResolvedValue(undefined);
    vi.spyOn(audioService, 'speakText').mockResolvedValue(undefined);
    vi.spyOn(audioService, 'stopAll').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await closeApp();
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('启动：既有数据逐键不变、错题集/星星/掌握度界面可见、childGrade 为 null（Req 4.4/4.8）', async () => {
    // ---------- 0. 预置一期/二期全部既有实体（无 childGrade 键） ----------
    const seeded = seedLegacyEntities();
    const beforeBoot = snapshotStorage();
    expect(localStorage.getItem(`${KEY_PREFIX}:childGrade`), '预置不应包含 childGrade 键').toBeNull();

    // ---------- 1. 本功能版本首次启动（升级路径） ----------
    await bootApp();

    // childGrade 缺失 → 按未设置 null 启动，且不创建备份副本（Req 4.4）
    expect(appState.childGrade.value).toBeNull();

    // 既有数据逐键不变：经 Local_Store 读回与预置值深相等（Req 4.8）
    const entities = Object.keys(seeded) as EntityName[];
    for (const entity of entities) {
      if (entity === 'childGrade') continue;
      expect(appState.store.read(entity), `既有实体 ${entity} 启动后应保持不变`).toEqual(
        seeded[entity],
      );
    }
    // 启动过程不新增、不删除、不修改任何存储键（原始字符串逐字节相等）
    expect(snapshotStorage()).toEqual(beforeBoot);
    // 不产生任何备份键（全部实体合法、childGrade 缺失不建备份）
    for (const key of snapshotStorage().keys()) {
      expect(key).not.toContain(':backup:');
    }

    // ---------- 2. 首页：星星余额可见（Star_Wallet 恢复，Req 5.9 同口径） ----------
    expect(page().find('.star-balance__count').text()).toBe('45');
    // 昨日会话原样恢复（不因升级清除或重置），音效设置恢复
    expect(appState.session.value).toEqual(seeded['session:today']);
    expect(appState.soundOn.value).toBe(false);

    // ---------- 3. 小岛页：收藏计数与错题集徽标可见（Wrong_Set + Mastery 派生） ----------
    const islandEntry = page()
      .findAll('.extra-entry')
      .find((e) => e.attributes('href') === '/island');
    expect(islandEntry, '首页应有小岛入口').toBeDefined();
    await islandEntry?.trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/island');
    expect(page().find('[data-testid="collect-counter"]').text()).toContain('已收集 2/');
    // 错题集徽标：未掌握计数经 wrongSet + mastery 派生（掌握度数据参与界面展示）
    expect(page().find('[data-testid="wrong-set-badge"]').text()).toContain('1');

    // ---------- 4. 错题集页：条目题干/年级/掌握标识可见（数据未被升级破坏） ----------
    await page().find('[data-testid="wrong-set-entry"]').trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/island/wrong');
    const items = page().findAll('[data-testid="wrong-item"]');
    expect(items).toHaveLength(1);
    const bank = appState.bank;
    expect(bank, '真实种子题库必须加载成功').not.toBeNull();
    const stem = bank!.byId.get('cn-g6a-u1-poem-0001')?.stem;
    expect(stem, '预置错题引用应在题库中可解析').toBeDefined();
    expect(items[0].find('[data-testid="item-stem"]').text()).toBe(stem);
    expect(items[0].find('[data-testid="item-grade"]').text()).toContain('6');
    // 掌握标识经 mastery 派生：预置记录 mastered=false → "未掌握"
    expect(items[0].find('[data-testid="item-badge"]').text()).toBe('未掌握');

    // 页面浏览不写存储：既有数据仍逐字节不变
    expect(snapshotStorage()).toEqual(beforeBoot);
  });

  it('今日冒险：childGrade 为 null 时按未设置不过滤生成（Req 3.1/4.8）', async () => {
    // ---------- 0. 预置并启动 ----------
    const seeded = seedLegacyEntities();
    await bootApp();
    expect(appState.childGrade.value).toBeNull();

    // 既有五参调用（未设置不过滤口径）作为期望输出
    const bank = appState.bank;
    expect(bank, '真实种子题库必须加载成功').not.toBeNull();
    const expected = buildTodayQueue(
      appState.store.read('mastery'),
      bank!,
      NOW,
      SESSION_CONFIG,
      appState.generators,
    );
    expect(expected.length).toBeGreaterThan(0);

    // ---------- 1. 点击"今日冒险"：昨日会话已过期 → 当日首次生成 ----------
    await page().find('.adventure-button').trigger('click');
    await settle();
    expect(router.currentRoute.value.path, '应导航练习页').toBe('/practice');

    // childGrade 为 null：生成队列与既有五参调用完全一致（不过滤，Req 3.1）
    const generated = appState.session.value;
    expect(generated, '生成后会话应存在').not.toBeNull();
    expect(generated!.date).toBe(localDateString(NOW));
    expect(generated!.queue).toEqual(expected);

    // 不过滤的直接证据：到点未掌握的六年级知识点出现在复习段首位
    expect(generated!.queue[0].knowledgePointId).toBe('cn.g6.shi.001');
    expect(generated!.queue[0].source).toBe('review');

    // ---------- 2. 生成后既有实体（除当日会话正常更新外）仍保持不变 ----------
    const preservedEntities: EntityName[] = [
      'mastery',
      'wrongSet',
      'wallet',
      'collection',
      'session:subjects',
      'oralBest',
      'settings',
      'lastGrade',
    ];
    for (const entity of preservedEntities) {
      expect(appState.store.read(entity), `${entity} 生成后应保持不变`).toEqual(seeded[entity]);
    }
    // 仍不产生 childGrade 键与备份键
    expect(localStorage.getItem(`${KEY_PREFIX}:childGrade`)).toBeNull();
    for (const key of snapshotStorage().keys()) {
      expect(key).not.toContain(':backup:');
    }
    // 当日会话已正常持久化（今日冒险行为在设置前保持既有形态）
    expect(appState.store.read('session:today')).toEqual(generated);
  });
});
