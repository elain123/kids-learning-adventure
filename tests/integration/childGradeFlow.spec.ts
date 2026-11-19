/**
 * 家长设置主链路集成测试（child-grade-setting 任务 8.1）
 *
 * 在 jsdom + 内存 localStorage（jsdom 自带 localStorage 即内存实现，全应用共享，
 * 与 tests/integration/mainFlow.spec.ts 同一约定）中驱动真实 App.vue + 真实路由 +
 * 真实种子题库，走完家长设置主链路：
 *
 *   首页点击 Parent_Settings 入口（仅导航 /parent-settings，不启动任何练习，Req 1.1）
 *   → 完成家长确认（门禁挑战经路由 props 注入定盘随机源 () => 0，恒为 12 + 12 = 24，
 *     答对才展示年级选项，Req 1.2）
 *   → 选择三年级保存（setChildGrade 立即落盘，界面展示"当前设置：三年级"与
 *     "自明天起生效"说明，Req 1.6、3.5）
 *   → 返回首页：入口未设置角标消失（Req 1.8）
 *   → 注入时钟推进到次日（vi.setSystemTime），点击"今日冒险"生成新会话：
 *     队列各项年级 ≤ 3（题目 grade / 生成器 grade / kpId 年级段三个来源逐一核验，
 *     Req 2.1、3.5）；预置的五年级到点复习知识点被过滤（Req 2.3），
 *     三年级到点复习知识点正常进入复习段
 *   → 关闭重开（同一 localStorage、新 App_State 实例）：childGrade 恢复为 3、
 *     角标仍不显示（Req 4.3），当日已生成会话沿用、队列不变（Req 3.3）
 *
 * 非平凡性保障（过滤确实生效，而非碰巧全 ≤3）：
 * - 预置掌握度含一个五年级到点未掌握记录（cn.g5.zi.001，nextReviewAt 早于三年级
 *   记录）。直接以同一输入调用 buildTodayQueue 不传入 childGrade 时，该知识点
 *   排在复习段最前；设置三年级后的会话队列中它必须缺席；
 * - 三年级到点未掌握记录（cn.g3.zi.001）必须出现在复习段，证明队列功能正常、
 *   缺席来自年级过滤而非复习段整体失效。
 *
 * 确定性保障与 mainFlow.spec.ts 相同：固定系统时间起步（2025-06-15 08:00 本地时间）、
 * vi.useFakeTimers 控制 Date.now、Audio_Service 全 stub；种子题库固定使
 * cn.g3.zi.001 / cn.g5.zi.001 均有可入队题（phase=1 一期题型）。
 *
 * Validates: Requirements 1.1, 1.2, 1.6, 1.8, 2.1, 3.5, 4.3
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
import ParentSettingsPage from '@/pages/ParentSettingsPage.vue';
import { createAppState, setSharedAppState, type AppState } from '@/stores/appState';
import { audioService } from '@/services/audioService';
import { buildTodayQueue } from '@/engine/reviewEngine';
import { kpIdGrade } from '@/engine/kpId';
import { INTERVALS_MS } from '@/types';
import type { GeneratorParams, MasteryRecord, QueueItem, TodaySession } from '@/types';

// ============ Local_Store 键（kla:v1:{accountId}:{entity}，一期 accountId=default） ============

const KEY_PREFIX = 'kla:v1:default';
const CHILD_GRADE_KEY = `${KEY_PREFIX}:childGrade`;
const MASTERY_KEY = `${KEY_PREFIX}:mastery`;

function readStorage<T>(key: string): T {
  const raw = localStorage.getItem(key);
  expect(raw, `localStorage 应存在键 ${key}`).not.toBeNull();
  return JSON.parse(raw as string) as T;
}

// ============ 预置数据（到点复习知识点：三年级应入队、五年级应被过滤） ============

/** 种子题库中的观测点（phase=1 一期题型，均有可入队题，种子契约保证） */
const G3_KP_ID = 'cn.g3.zi.001'; // 三年级语文生字（dictation）
const G5_KP_ID = 'cn.g5.zi.001'; // 五年级语文生字（pinyin）

/** 构造到点未掌握的掌握度记录（形状满足 localStore isMasteryRecord 校验） */
function dueMasteryRecord(knowledgePointId: string, nextReviewAt: number): MasteryRecord {
  return {
    knowledgePointId,
    level: 1,
    totalCorrect: 1,
    totalWrong: 0,
    nextReviewAt,
    mastered: false,
    lastAnswerAt: nextReviewAt - INTERVALS_MS[1],
  };
}

// ============ 家长确认门禁定盘（rand = () => 0 → a=12、b=12、answer=24） ============

const GATE_RAND = () => 0;
const GATE_ANSWER = '24';

// ============ 应用启动（打开应用 / 关闭重开） ============

let wrapper: VueWrapper | null = null;
let appState: AppState;
let router: Router;

/**
 * 测试路由：与 src/router/index.ts 同路径同名，但以静态 import 挂载页面组件，
 * 避免 lazy import 在 fake timers 下的加载时序不确定性（导航语义完全一致）。
 * /parent-settings 经路由 props 注入定盘随机源，使门禁挑战恒为 12 + 12 = 24。
 */
const testRoutes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomePage },
  { path: '/subject/:id', name: 'subject', component: SubjectPage },
  { path: '/practice', name: 'practice', component: PracticePage },
  { path: '/box', name: 'box', component: BoxPage },
  { path: '/island', name: 'island', component: IslandPage },
  {
    path: '/parent-settings',
    name: 'parent-settings',
    component: ParentSettingsPage,
    props: { rand: GATE_RAND },
  },
];

/** 以同一 jsdom localStorage 启动（或重启）应用并停在首页 */
async function bootApp(): Promise<void> {
  appState = createAppState({ audio: audioService });
  setSharedAppState(appState);
  router = createRouter({ history: createMemoryHistory(), routes: testRoutes });
  await router.push('/');
  await router.isReady();
  wrapper = mount(App, { global: { plugins: [router] } });
  await settle();
}

/** 关闭应用（不清理 localStorage，模拟关闭浏览器后重开） */
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

function session(): TodaySession {
  const s = appState.session.value;
  expect(s, '今日会话应存在').not.toBeNull();
  return s as TodaySession;
}

/** 是否存在某 testid 元素 */
function has(testid: string): boolean {
  return page().find(`[data-testid="${testid}"]`).exists();
}

async function clickTestId(testid: string): Promise<void> {
  const el = page().find(`[data-testid="${testid}"]`);
  expect(el.exists(), `元素 ${testid} 应存在`).toBe(true);
  await el.trigger('click');
  await settle();
}

/** 队列项年级三来源核验：kpId 年级段可解析且 ≤ 上限；题库题/生成器 grade ≤ 上限 */
function expectQueueGradesWithinLimit(queue: readonly QueueItem[], limit: number): void {
  expect(queue.length, '今日冒险队列应非空').toBeGreaterThan(0);
  const generatorsById = new Map<string, GeneratorParams>(
    appState.generators.map((g) => [g.id, g]),
  );
  for (const item of queue) {
    // 知识点年级（knowledgePointId 年级段解析，Req 2.1 来源三）：必须可解析且 ≤ 上限
    const kpGrade = kpIdGrade(item.knowledgePointId);
    expect(kpGrade, `队列项 ${item.knowledgePointId} 的 kpId 年级段应可解析`).not.toBeNull();
    expect(kpGrade as number, `队列项 ${item.knowledgePointId} 年级应 ≤ ${limit}`)
      .toBeLessThanOrEqual(limit);
    if (item.kind === 'bank') {
      // 题目数值年级（Req 2.1 来源一）
      const q = appState.bank?.byId.get(item.questionId as string);
      expect(q, `题库应包含题目 ${item.questionId}`).toBeDefined();
      expect(q?.grade as number, `题目 ${item.questionId} 年级应 ≤ ${limit}`)
        .toBeLessThanOrEqual(limit);
    } else {
      // 口算生成器年级参数（Req 2.1 来源二）
      const g = generatorsById.get(item.generatorParamsId as string);
      expect(g, `应存在生成器 ${item.generatorParamsId}`).toBeDefined();
      expect(g?.grade as number, `生成器 ${item.generatorParamsId} 年级应 ≤ ${limit}`)
        .toBeLessThanOrEqual(limit);
    }
  }
}

// ============ 测试 ============

describe('家长设置主链路：入口 → 家长确认 → 设三年级 → 次日过滤 → 重开仍生效', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    // 固定系统时间，保证"本地自然日"判定确定（2025-06-15 08:00 本地时间）
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

  it('完整主链路（Req 1.1, 1.2, 1.6, 1.8, 2.1, 3.5, 4.3）', async () => {
    // ---------- 0. 预置掌握度：三年级与五年级各一个到点未掌握记录 ----------
    // 五年级记录 nextReviewAt 更早：不过滤时它排在复习段最前（下方非平凡性断言），
    // 设置三年级后它必须被过滤（Req 2.3）；三年级记录正常进入复习段。
    const day1Now = Date.now();
    localStorage.setItem(
      MASTERY_KEY,
      JSON.stringify({
        [G3_KP_ID]: dueMasteryRecord(G3_KP_ID, day1Now - 60_000),
        [G5_KP_ID]: dueMasteryRecord(G5_KP_ID, day1Now - 120_000),
      }),
    );

    // ---------- 1. 打开应用：Parent_Settings 入口可见且带未设置角标（Req 1.1、1.8） ----------
    await bootApp();
    expect(appState.childGrade.value, 'childGrade 未设置应为 null').toBeNull();
    const parentEntry = page().find('.parent-entry');
    expect(parentEntry.exists(), '首页应有 Parent_Settings 入口').toBe(true);
    expect(page().find('.parent-entry__badge').exists(), '未设置时应显示角标').toBe(true);
    // "今日冒险"大按钮保持首页唯一练习入口（Req 1.1）
    expect(page().findAll('.adventure-button')).toHaveLength(1);

    // ---------- 2. 点击入口：仅导航 /parent-settings，先展示家长确认（Req 1.1、1.2） ----------
    await parentEntry.trigger('click');
    await settle();
    expect(router.currentRoute.value.path, '入口应仅导航家长设置页').toBe('/parent-settings');
    expect(has('parent-gate'), '应先展示家长确认步骤').toBe(true);
    // 家长确认完成前不得展示任何年级选项（Req 1.2）
    expect(page().findAll('[data-testid="grade-option"]')).toHaveLength(0);
    expect(page().find('[data-testid="gate-challenge"]').text()).toContain('12 + 12');

    // ---------- 3. 完成家长确认 → 年级选择界面（Req 1.2）；未设置提示可见（Req 1.8） ----------
    await page().find('[data-testid="gate-input"]').setValue(GATE_ANSWER);
    await clickTestId('gate-confirm');
    expect(has('parent-gate'), '确认通过后门禁应退出').toBe(false);
    expect(has('grade-picker'), '应展示孩子年级设置界面').toBe(true);
    expect(page().findAll('[data-testid="grade-option"]')).toHaveLength(6);
    expect(page().find('[data-testid="unset-hint"]').text()).toContain('还未设置孩子年级');
    expect(
      page().find('[data-testid="save-grade"]').attributes('disabled'),
      '未选择年级前保存应不可用',
    ).toBeDefined();

    // ---------- 4. 选择三年级保存：立即落盘 + 当前设置与生效说明展示（Req 1.6、3.5） ----------
    await page().find('[data-grade="3"]').trigger('click');
    await clickTestId('save-grade');
    expect(readStorage<number>(CHILD_GRADE_KEY), '保存后 Local_Store 应立即可读出新值').toBe(3);
    expect(appState.childGrade.value).toBe(3);
    expect(page().find('[data-testid="current-setting"]').text()).toContain('当前设置：三年级');
    expect(page().find('[data-testid="unset-hint"]').exists(), '未设置提示应消失').toBe(false);
    const effectNote = page().find('[data-testid="save-effect-note"]');
    expect(effectNote.exists(), '应展示生效时机说明').toBe(true);
    expect(effectNote.text()).toContain('自明天起');

    // ---------- 5. 返回首页：入口未设置角标消失（Req 1.8） ----------
    await clickTestId('back-home');
    expect(router.currentRoute.value.path).toBe('/');
    expect(page().find('.parent-entry__badge').exists(), '已设置后角标应消失').toBe(false);

    // ---------- 6. 注入时钟推进到次日（2025-06-16 08:00） ----------
    vi.setSystemTime(new Date(2025, 5, 16, 8, 0, 0));

    // ---------- 7. 今日冒险：新年级自本次生成起生效，队列各项年级 ≤ 3（Req 2.1、3.5） ----------
    await page().find('.adventure-button').trigger('click');
    await settle();
    expect(router.currentRoute.value.path, '应进入练习页').toBe('/practice');
    const day2Queue = session().queue;
    expect(session().date, '会话应属于次日（新自然日首次生成）').toBe('2025-06-16');
    expectQueueGradesWithinLimit(day2Queue, 3);
    // 三年级到点知识点进入复习段（队列功能正常）
    const g3Review = day2Queue.find(
      (item) => item.source === 'review' && item.knowledgePointId === G3_KP_ID,
    );
    expect(g3Review, '三年级到点知识点应出现在复习段').toBeDefined();
    // 五年级到点知识点被过滤（Req 2.3），其掌握度记录不被删除或修改（Req 2.4）
    expect(
      day2Queue.some((item) => item.knowledgePointId === G5_KP_ID),
      '五年级到点知识点不应出现在队列中',
    ).toBe(false);
    expect(
      appState.store.read('mastery')[G5_KP_ID],
      '被过滤知识点的掌握度记录应保持不变',
    ).toEqual(dueMasteryRecord(G5_KP_ID, day1Now - 120_000));
    // 非平凡性：同一输入不过滤时五年级知识点排在复习段最前（nextReviewAt 最早），
    // 证明队列中的缺席来自年级过滤而非数据不可用
    const unfiltered = buildTodayQueue(
      appState.store.read('mastery'),
      appState.bank as NonNullable<AppState['bank']>,
      Date.now(),
      appState.sessionConfig,
      appState.generators,
    );
    expect(unfiltered[0]?.knowledgePointId, '不过滤时五年级知识点应排在复习段最前')
      .toBe(G5_KP_ID);
    expect(unfiltered[0]?.source).toBe('review');

    // ---------- 8. 关闭重开（新 App_State 实例）：设置仍生效（Req 4.3） ----------
    await closeApp();
    await bootApp();
    // 启动即恢复最后一次成功写入的 childGrade（Req 4.3）
    expect(appState.childGrade.value, '重开后 childGrade 应恢复为 3').toBe(3);
    expect(readStorage<number>(CHILD_GRADE_KEY)).toBe(3);
    // 首页入口角标保持隐藏（Req 1.8）
    expect(page().find('.parent-entry__badge').exists()).toBe(false);
    // 当日已生成会话沿用：点击"今日冒险"续练同一队列，未重新生成（Req 3.3）
    await page().find('.adventure-button').trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/practice');
    expect(session().queue, '重开后应续练同一队列（年级过滤结果不变）').toEqual(day2Queue);
    expectQueueGradesWithinLimit(session().queue, 3);
  });
});
