/**
 * 页面单元测试（任务 13.6）
 *
 * 覆盖四个页面：
 * - HomePage：首页仅"今日冒险"一个练习入口（Req 1.1）；学科入口链接 /subject/*、
 *   宝箱/小岛入口链接 /box|/island，不存在第二个练习入口；当日会话全部完成后
 *   按钮呈"已完成"态，点击展示庆祝画面而不进入练习（Req 1.5）。
 *   测试经 createAppState({storage: createMemoryStorage()}) 创建独立 App_State
 *   并 setSharedAppState 注入，避免污染应用共享实例。
 * - BoxPage："开启（30 星星）"按钮旁标注"每次消耗 ⭐×30"（Req 5.3）；余额 <30
 *   点击开启 → 星星不足提示 + 去闯关引导，钱包不变（Req 5.5）；余额充足 →
 *   900ms 揭示后展示新收藏/重复返还卡片（Req 5.4/5.6/5.7，fake timers 推进
 *   REVEAL_DELAY_MS）。页面直接经 Local_Store 读写 jsdom localStorage，
 *   测试按键 `kla:v1:default:{entity}` 播种钱包与收藏。
 * - IslandPage：播种 3 件收藏 → "已收集 3/12"计数（Req 5.8）；未收集物品
 *   渲染锁定 ❓ 卡；宠物区/装扮区各 6 张收集卡。
 * - SubjectPage：/subject/chinese 渲染语文大陆主题、吉祥物与唯一开始冒险按钮；
 *   非法学科 id 渲染迷路提示（Req 13.1/13.2）。
 * - MVP 约束（Req 13.6）：四个页面的可点击元素（button/a）均不含二期功能
 *   入口文案（阅读理解/跟读/应用题/家长/多账号）。
 *
 * 44×44px 触控区域验证方法（Req 12.2）：与 tests/unit/questionComponents.spec.ts
 * 同一两层断言——(1) 渲染出的交互元素携带约定 class；(2) 经 Vite `?raw` 导入
 * SFC 源码，解析 <style> 中对应 class 规则的 min-width / min-height px 声明，
 * 断言均 ≥44px（胶囊形元素仅声明 min-height，按 ≥44px 断言高度）。
 * 辅助函数 cssRuleBodies / declaredPx / expectMinTouchTarget 复制自
 * questionComponents.spec.ts（同源同口径）。
 *
 * _Requirements: 1.1, 5.3, 5.8, 12.2, 13.6_
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import HomePage from '@/pages/HomePage.vue';
import SubjectPage from '@/pages/SubjectPage.vue';
import BoxPage from '@/pages/BoxPage.vue';
import IslandPage from '@/pages/IslandPage.vue';

// SFC 源码（?raw 导入），用于解析 scoped CSS 中的触控区域声明
import homePageSource from '@/pages/HomePage.vue?raw';
import subjectPageSource from '@/pages/SubjectPage.vue?raw';
import boxPageSource from '@/pages/BoxPage.vue?raw';
import islandPageSource from '@/pages/IslandPage.vue?raw';

import { createAppState, setSharedAppState, type AppState } from '@/stores/appState';
import { createMemoryStorage } from '@/data/localStore';
import { createTodaySession } from '@/engine/adventureEngine';
import { COLLECTIBLE_ITEMS, COLLECTIBLE_TOTAL, TREASURE_BOX_COST } from '@/types';
import type { QueueItem, StarWallet, TodaySession } from '@/types';

// ============ 44×44px 触控区域断言辅助（复制自 questionComponents.spec.ts） ============

/** 提取 SFC <style> 中某 class 选择器的全部规则体（不匹配 xxx--modifier / xxx-suffix 变体） */
function cssRuleBodies(sfcSource: string, classSelector: string): string {
  const css = [...sfcSource.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n');
  const escaped = classSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ruleRe = new RegExp(`${escaped}(?![\\w-])[^{}]*\\{([^{}]*)\\}`, 'g');
  return [...css.matchAll(ruleRe)].map((m) => m[1]).join('\n');
}

/** 从规则体中读取某属性的 px 数值（取首条声明）；未声明返回 null */
function declaredPx(ruleBodies: string, prop: 'min-width' | 'min-height'): number | null {
  const match = ruleBodies.match(new RegExp(`${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`));
  return match !== null ? Number(match[1]) : null;
}

/** 断言某 class 的规则同时声明 min-width 与 min-height 且均 ≥44px（Req 12.2） */
function expectMinTouchTarget(sfcSource: string, classSelector: string): void {
  const bodies = cssRuleBodies(sfcSource, classSelector);
  expect(bodies, `${classSelector} 应存在样式规则`).not.toBe('');
  for (const prop of ['min-width', 'min-height'] as const) {
    const px = declaredPx(bodies, prop);
    expect(px, `${classSelector} 应声明 ${prop}`).not.toBeNull();
    expect(px as number, `${classSelector} 的 ${prop} 应 ≥44px`).toBeGreaterThanOrEqual(44);
  }
}

/** 胶囊形元素仅声明 min-height：断言其 ≥44px（Req 12.2） */
function expectMinTouchHeight(sfcSource: string, classSelector: string): void {
  const bodies = cssRuleBodies(sfcSource, classSelector);
  expect(bodies, `${classSelector} 应存在样式规则`).not.toBe('');
  const px = declaredPx(bodies, 'min-height');
  expect(px, `${classSelector} 应声明 min-height`).not.toBeNull();
  expect(px as number, `${classSelector} 的 min-height 应 ≥44px`).toBeGreaterThanOrEqual(44);
}

// ============ 公共挂载辅助 ============

/** 测试路由：与 src/router/index.ts 同路径骨架，组件以空桩替代（不触发真实页面加载） */
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

/** 创建独立 App_State（内存存储）并注入为共享实例，供 HomePage 的 useAppState 获取 */
function createTestAppState(): AppState {
  const state = createAppState({ storage: createMemoryStorage() });
  setSharedAppState(state);
  return state;
}

async function mountHomePage(router: Router): Promise<VueWrapper> {
  await router.push('/');
  await router.isReady();
  const wrapper = mount(HomePage, { global: { plugins: [router] } });
  await nextTick();
  return wrapper;
}

async function mountSubjectPage(router: Router, subjectId: string): Promise<VueWrapper> {
  await router.push(`/subject/${subjectId}`);
  await router.isReady();
  const wrapper = mount(SubjectPage, { global: { plugins: [router] } });
  await nextTick();
  return wrapper;
}

async function mountBoxPage(router: Router): Promise<VueWrapper> {
  await router.push('/box');
  await router.isReady();
  const wrapper = mount(BoxPage, { global: { plugins: [router] } });
  await nextTick();
  return wrapper;
}

async function mountIslandPage(router: Router): Promise<VueWrapper> {
  await router.push('/island');
  await router.isReady();
  const wrapper = mount(IslandPage, { global: { plugins: [router] } });
  await nextTick();
  return wrapper;
}

// ============ Local_Store 播种辅助（BoxPage / IslandPage 直读 jsdom localStorage） ============

const WALLET_KEY = 'kla:v1:default:wallet';
const COLLECTION_KEY = 'kla:v1:default:collection';

function seedWallet(balance: number): void {
  const wallet: StarWallet = { balance, totalEarned: balance };
  localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
}

function readSeededWallet(): StarWallet {
  return JSON.parse(localStorage.getItem(WALLET_KEY) as string) as StarWallet;
}

function seedCollection(items: string[]): void {
  localStorage.setItem(COLLECTION_KEY, JSON.stringify({ items }));
}

function readSeededCollectionItems(): string[] {
  const raw = localStorage.getItem(COLLECTION_KEY);
  return raw === null ? [] : (JSON.parse(raw) as { items: string[] }).items;
}

// ============ HomePage 首页 ============

/** 合法队列项（经 isTodaySession 校验），供构造当日会话 */
const DONE_QUEUE: QueueItem[] = [
  {
    kind: 'bank',
    questionId: 'cn-test-done-0001',
    knowledgePointId: 'cn.g3.zi.001',
    subject: 'chinese',
    type: 'dictation',
    difficulty: 1,
    source: 'new',
  },
];

/** 构造"当日已全部完成"的会话（nextUnanswered 返回 null，驱动 Req 1.5 已完成态） */
function buildDoneSession(): TodaySession {
  const created = createTodaySession(DONE_QUEUE, Date.now());
  return { ...created, currentIndex: created.queue.length, status: 'done' };
}

describe('HomePage 首页', () => {
  afterEach(() => {
    setSharedAppState(null);
  });

  it('"今日冒险"是首页唯一练习入口，无科目/难度前置选择（Req 1.1）', async () => {
    createTestAppState();
    const wrapper = await mountHomePage(createTestRouter());

    // 恰有一个"今日冒险"练习入口按钮
    const adventureButtons = wrapper.findAll('.adventure-button');
    expect(adventureButtons).toHaveLength(1);
    expect(adventureButtons[0].text()).toContain('今日冒险');

    // 学科入口仅为主题入口链接（/subject/*），非练习前置选择
    const subjectEntries = wrapper.findAll('.subject-entry');
    expect(subjectEntries).toHaveLength(3);
    for (const entry of subjectEntries) {
      expect(entry.attributes('href')).toMatch(/^\/subject\//);
    }

    // 宝箱与小岛入口链接 /box 与 /island
    const extraEntries = wrapper.findAll('.extra-entry');
    expect(extraEntries).toHaveLength(2);
    const extraHrefs = extraEntries.map((e) => e.attributes('href'));
    expect(extraHrefs).toContain('/box');
    expect(extraHrefs).toContain('/island');

    // 全页按钮仅"今日冒险"与音效开关两个，不存在第二个练习入口；
    // 也没有任何链接直达 /practice（绕过今日冒险机制的入口）
    expect(wrapper.findAll('button')).toHaveLength(2);
    expect(wrapper.findAll('a[href*="/practice"]')).toHaveLength(0);
  });

  it('当日全部完成后按钮呈"已完成"态，点击展示庆祝画面而不进入练习（Req 1.5）', async () => {
    const appState = createTestAppState();
    appState.saveSession(buildDoneSession());

    const router = createTestRouter();
    const wrapper = await mountHomePage(router);

    // 按钮呈已完成态
    const button = wrapper.find('.adventure-button');
    expect(button.classes()).toContain('adventure-button--done');
    expect(button.text()).toContain('今日冒险已完成');

    // 点击 → 展示完成庆祝画面，不导航 /practice
    await button.trigger('click');
    await nextTick();
    const overlay = wrapper.find('.celebration-overlay');
    expect(overlay.exists()).toBe(true);
    expect(overlay.text()).toContain('今日冒险全部完成');
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('可点击元素触控区域 ≥44×44px（Req 12.2）', async () => {
    createTestAppState();
    const wrapper = await mountHomePage(createTestRouter());

    // 第一层：交互元素携带约定 class
    expect(wrapper.find('.adventure-button').exists()).toBe(true);
    expect(wrapper.find('.subject-entry').exists()).toBe(true);
    expect(wrapper.find('.extra-entry').exists()).toBe(true);
    expect(wrapper.find('.sound-toggle').exists()).toBe(true);

    // 第二层：SFC scoped CSS 声明的 min-width/min-height ≥44px
    expectMinTouchTarget(homePageSource, '.adventure-button');
    expectMinTouchTarget(homePageSource, '.subject-entry');
    expectMinTouchTarget(homePageSource, '.extra-entry');
    expectMinTouchTarget(homePageSource, '.sound-toggle');
  });
});

// ============ BoxPage 宝箱页 ============

describe('BoxPage 宝箱页', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('"开启（30 星星）"按钮旁标注"每次消耗 ⭐×30"（Req 5.3）', async () => {
    seedWallet(0);
    const wrapper = await mountBoxPage(createTestRouter());

    const openRow = wrapper.find('.open-row');
    expect(openRow.exists()).toBe(true);
    // 开启按钮标注消耗 30 星星
    const openButton = openRow.find('[data-testid="open-box"]');
    expect(openButton.exists()).toBe(true);
    expect(openButton.text()).toContain(`${TREASURE_BOX_COST} 星星`);
    // 按钮旁消耗标注
    const costLabel = openRow.find('[data-testid="cost-label"]');
    expect(costLabel.exists()).toBe(true);
    expect(costLabel.text()).toBe(`每次消耗 ⭐×${TREASURE_BOX_COST}`);

    wrapper.unmount();
  });

  it('余额不足：阻止开启，提示星星不足并提供"去闯关"引导，钱包不变（Req 5.5）', async () => {
    seedWallet(20);
    const wrapper = await mountBoxPage(createTestRouter());

    await wrapper.find('[data-testid="open-box"]').trigger('click');
    await nextTick();

    // 星星不足提示 + 去闯关引导
    const tip = wrapper.find('[data-testid="insufficient-tip"]');
    expect(tip.exists()).toBe(true);
    expect(tip.text()).toContain('星星不足');
    expect(tip.text()).toContain(`${TREASURE_BOX_COST} 颗星星`);
    const goPractice = tip.find('[data-testid="go-practice"]');
    expect(goPractice.exists()).toBe(true);
    expect(goPractice.attributes('href')).toBe('/');

    // 钱包不变（界面与落盘均为 20），且无产出卡片
    expect(wrapper.find('[data-testid="star-balance"]').text()).toContain('20');
    expect(readSeededWallet().balance).toBe(20);
    expect(wrapper.find('[data-testid="result-new"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="result-duplicate"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it('余额充足且收藏为空：扣 30 星，揭示后展示新收藏卡片（Req 5.4/5.6）', async () => {
    vi.useFakeTimers();
    seedWallet(50);
    seedCollection([]);
    const wrapper = await mountBoxPage(createTestRouter());

    await wrapper.find('[data-testid="open-box"]').trigger('click');
    // 余额即时扣减上屏（Req 5.9）
    expect(wrapper.find('[data-testid="star-balance"]').text()).toContain('20');

    // 揭示前产出卡片未展示；推进 900ms 揭示延迟后出现新收藏卡片
    expect(wrapper.find('[data-testid="result-new"]').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(900);
    await nextTick();

    const resultNew = wrapper.find('[data-testid="result-new"]');
    expect(resultNew.exists()).toBe(true);
    expect(resultNew.text()).toContain('新收藏');
    const goIsland = resultNew.find('[data-testid="go-island"]');
    expect(goIsland.exists()).toBe(true);
    expect(goIsland.attributes('href')).toBe('/island');

    // 落盘：钱包 50-30=20，收藏新增 1 件（12 件可收集物之一）
    expect(readSeededWallet().balance).toBe(20);
    const items = readSeededCollectionItems();
    expect(items).toHaveLength(1);
    expect(COLLECTIBLE_ITEMS.some((item) => item.id === items[0])).toBe(true);

    wrapper.unmount();
  });

  it('已集齐时产出重复物品：返还 5 星且不重复入收藏（Req 5.7）', async () => {
    vi.useFakeTimers();
    seedWallet(50);
    seedCollection(COLLECTIBLE_ITEMS.map((item) => item.id)); // 12 件全收集
    const wrapper = await mountBoxPage(createTestRouter());

    await wrapper.find('[data-testid="open-box"]').trigger('click');
    await vi.advanceTimersByTimeAsync(900);
    await nextTick();

    const resultDuplicate = wrapper.find('[data-testid="result-duplicate"]');
    expect(resultDuplicate.exists()).toBe(true);
    expect(resultDuplicate.text()).toContain('返还 5 星星');

    // 50 - 30 + 5 = 25；收藏仍为 12 件不重复
    expect(wrapper.find('[data-testid="star-balance"]').text()).toContain('25');
    expect(readSeededWallet().balance).toBe(25);
    expect(readSeededCollectionItems()).toHaveLength(COLLECTIBLE_TOTAL);

    wrapper.unmount();
  });

  it('可点击元素触控区域 ≥44×44px（Req 12.2）', async () => {
    seedWallet(20);
    const wrapper = await mountBoxPage(createTestRouter());
    // 触发星星不足态，使"去闯关"入口渲染出来
    await wrapper.find('[data-testid="open-box"]').trigger('click');
    await nextTick();

    // 第一层：交互元素携带约定 class / testid
    expect(wrapper.find('[data-testid="back-home"].back-home').exists()).toBe(true);
    expect(wrapper.find('[data-testid="star-balance"].star-balance').exists()).toBe(true);
    expect(wrapper.find('[data-testid="open-box"].open-btn').exists()).toBe(true);
    expect(wrapper.find('[data-testid="go-practice"].go-practice').exists()).toBe(true);

    // 第二层：min-width + min-height 均 ≥44px；胶囊标注/按钮按 min-height ≥44px
    expectMinTouchTarget(boxPageSource, '.back-home');
    expectMinTouchTarget(boxPageSource, '.open-btn');
    expectMinTouchHeight(boxPageSource, '.star-balance');
    expectMinTouchHeight(boxPageSource, '.go-practice');

    wrapper.unmount();
  });
});

// ============ IslandPage 小岛页 ============

describe('IslandPage 小岛页', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('播种 3 件收藏 → "已收集 3/12"计数（Req 5.8）', async () => {
    seedCollection(['pet-fox', 'pet-panda', 'deco-castle']);
    const wrapper = await mountIslandPage(createTestRouter());

    const counter = wrapper.find('[data-testid="collect-counter"]');
    expect(counter.exists()).toBe(true);
    expect(counter.text()).toContain(`已收集 3/${COLLECTIBLE_TOTAL}`);

    wrapper.unmount();
  });

  it('未收集物品显示锁定 ❓ 卡；宠物区与装扮区各渲染 6 张收集卡（Req 5.8）', async () => {
    seedCollection(['pet-fox']);
    const wrapper = await mountIslandPage(createTestRouter());

    // 已收集卡：显示 emoji 与名称，不带 locked
    const foxCard = wrapper.find('[data-item-id="pet-fox"]');
    expect(foxCard.exists()).toBe(true);
    expect(foxCard.classes()).not.toContain('locked');
    expect(foxCard.text()).toContain('小狐狸');
    expect(foxCard.text()).not.toContain('❓');

    // 未收集卡：locked 灰卡 + ❓ 占位
    const lockedCard = wrapper.find('[data-item-id="pet-penguin"]');
    expect(lockedCard.exists()).toBe(true);
    expect(lockedCard.classes()).toContain('locked');
    expect(lockedCard.text()).toContain('❓');
    expect(lockedCard.text()).toContain('未收集');

    // 宠物区 / 装扮区各 6 张卡
    const petsZone = wrapper.find('[data-testid="pets-zone"]');
    const decorationsZone = wrapper.find('[data-testid="decorations-zone"]');
    expect(petsZone.findAll('.collect-card')).toHaveLength(6);
    expect(decorationsZone.findAll('.collect-card')).toHaveLength(6);

    wrapper.unmount();
  });

  it('返回首页按钮触控区域 ≥44×44px（Req 12.2）', async () => {
    seedCollection([]);
    const wrapper = await mountIslandPage(createTestRouter());

    const backHome = wrapper.find('[data-testid="back-home"].back-home');
    expect(backHome.exists()).toBe(true);
    expect(backHome.attributes('href')).toBe('/');
    expectMinTouchTarget(islandPageSource, '.back-home');

    wrapper.unmount();
  });
});

// ============ SubjectPage 学科页 ============

describe('SubjectPage 学科页', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('/subject/chinese 渲染语文大陆主题、吉祥物与唯一"开始冒险"按钮（Req 13.1/13.2）', async () => {
    const wrapper = await mountSubjectPage(createTestRouter(), 'chinese');

    const page = wrapper.find('[data-testid="subject-page"]');
    expect(page.exists()).toBe(true);
    expect(page.classes()).toContain('theme-chinese');
    expect(wrapper.find('.subject-name').text()).toBe('语文大陆');
    expect(wrapper.find('.mascot').text()).toBe('🐼');

    // 今日进度卡片（尚无会话 → 预生成预览，不落盘）
    const progress = wrapper.find('[data-testid="today-progress"]');
    expect(progress.exists()).toBe(true);
    expect(progress.text()).toContain('今天为你准备了');

    // 唯一开始冒险按钮，无任何科目外前置选择
    const startButtons = wrapper.findAll('[data-testid="start-adventure"]');
    expect(startButtons).toHaveLength(1);
    expect(startButtons[0].text()).toContain('开始冒险');

    // 星星余额与返回地图入口
    expect(wrapper.find('[data-testid="star-balance"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="back-home"]').exists()).toBe(true);
  });

  it('非法学科 id 渲染迷路提示与返回首页入口', async () => {
    const wrapper = await mountSubjectPage(createTestRouter(), 'mars');

    const notFound = wrapper.find('[data-testid="subject-not-found"]');
    expect(notFound.exists()).toBe(true);
    expect(notFound.text()).toContain('迷路啦');
    expect(wrapper.find('[data-testid="subject-page"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="not-found-home"]').exists()).toBe(true);
  });

  it('可点击元素触控区域 ≥44×44px（Req 12.2）', async () => {
    const wrapper = await mountSubjectPage(createTestRouter(), 'chinese');
    const lostWrapper = await mountSubjectPage(createTestRouter(), 'mars');

    // 第一层：交互元素携带约定 class（cele-btn 在迷路页常态渲染）
    expect(wrapper.find('[data-testid="back-home"].nav-btn').exists()).toBe(true);
    expect(wrapper.find('[data-testid="start-adventure"].start-btn').exists()).toBe(true);
    expect(lostWrapper.find('.cele-btn').exists()).toBe(true);

    // 第二层：min-width + min-height 均 ≥44px
    expectMinTouchTarget(subjectPageSource, '.nav-btn');
    expectMinTouchTarget(subjectPageSource, '.start-btn');
    expectMinTouchTarget(subjectPageSource, '.cele-btn');
  });
});

// ============ MVP 界面无二期功能入口（Req 13.6） ============

/** 二期功能入口关键词：阅读理解 / 跟读评分 / 多步骤应用题 / 家长报告 / 多账号 */
const PHASE2_ENTRY_KEYWORDS = ['阅读理解', '跟读', '应用题', '家长', '多账号'];

/** 断言页面全部可点击元素（button/a）文本均不含二期功能入口关键词 */
function expectNoPhase2Entries(wrapper: VueWrapper, pageName: string): void {
  const clickables = wrapper.findAll('button, a');
  expect(clickables.length, `${pageName} 应至少渲染若干可点击元素`).toBeGreaterThan(0);
  for (const el of clickables) {
    for (const keyword of PHASE2_ENTRY_KEYWORDS) {
      expect(
        el.text().includes(keyword),
        `${pageName} 不应出现二期功能入口 "${keyword}"（元素文本：${el.text()}）`,
      ).toBe(false);
    }
  }
}

describe('MVP 界面无二期功能入口（Req 13.6）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    setSharedAppState(null);
    localStorage.clear();
  });

  it('首页 / 学科页 / 宝箱页 / 小岛页的可点击元素均不含二期功能入口', async () => {
    createTestAppState();
    const homeWrapper = await mountHomePage(createTestRouter());
    expectNoPhase2Entries(homeWrapper, '首页');

    const subjectWrapper = await mountSubjectPage(createTestRouter(), 'math');
    expectNoPhase2Entries(subjectWrapper, '数学王国学科页');

    const englishWrapper = await mountSubjectPage(createTestRouter(), 'english');
    expectNoPhase2Entries(englishWrapper, '英语岛学科页');

    seedWallet(50);
    const boxWrapper = await mountBoxPage(createTestRouter());
    expectNoPhase2Entries(boxWrapper, '宝箱页');
    boxWrapper.unmount();

    const islandWrapper = await mountIslandPage(createTestRouter());
    expectNoPhase2Entries(islandWrapper, '小岛页');
    islandWrapper.unmount();
  });
});
