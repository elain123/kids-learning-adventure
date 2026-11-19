/**
 * 当日不受扰链路集成测试（child-grade-setting 任务 8.2）
 *
 * 在 jsdom + 内存 localStorage（jsdom 自带 localStorage 即内存实现，全应用共享：
 * App_State 与各页面直读的 createLocalStore() 默认都落在它上面）+ 注入时钟
 * （vi.useFakeTimers 控制 Date.now）中驱动真实 App.vue + 真实路由 + 真实种子题库，
 * 走完"家长修改年级当日不受扰、次日生效"链路：
 *
 *   预置 Child_Grade=6（家长此前已设置）→ 当日生成并作答部分题目（队列含
 *   三至四年级内容）→ 休息回首页 → 经 Parent_Settings 入口完成家长确认、
 *   把年级从六年级改为一年级并保存（立即落盘，Req 1.6）
 *   → 当日再点"今日冒险"：续练原会话——已存储会话逐字段不变、练习队列
 *   与下一道未完成题不变（Req 3.3，当日不重新生成，Req 3.5 的"当日不受扰"半）
 *   → 下一道未完成题为年级超限项（grade 3 > 1），仍保留在队列中并正常作答
 *   入账（Req 3.3 的"超限项仍保留可作答"）
 *   → 时钟推进到次日：新会话按新年级过滤，每个队列项的题目年级/生成器年级/
 *   知识点年级段均 ≤ 1，昨日已作答的超限知识点不混入复习段（Req 2.9、3.5）。
 *
 * 与 tests/property/childGradeTiming.props.spec.ts（Property 6，App_State 层）
 * 的关系：本测试走完整 UI/存储路径（首页入口 → 家长确认门禁 → 年级选择保存 →
 * 练习页真实 DOM 作答 → localStorage 逐字段快照比对），覆盖属性测试不经过的
 * 页面接线与真实作答链路。
 *
 * 确定性保障：
 * - 种子题库固定：无复习记录时今日队列为题库前 50 个新知识点（语文三至四年级
 *   内容在前，driver 断言全部为题库题；种子变化会显式失败而非静默走错路径）；
 * - 家长确认挑战从 DOM 文本解析 a + b 并作答，不依赖随机源定盘；
 * - Audio_Service 共享实例方法全部 stub，避免 jsdom 无 Web Audio 的噪音。
 *
 * Validates: Requirements 2.9, 3.3, 3.5
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
import ParentSettingsPage from '@/pages/ParentSettingsPage.vue';
import { createAppState, setSharedAppState, type AppState } from '@/stores/appState';
import { audioService } from '@/services/audioService';
import { nextUnanswered } from '@/engine/adventureEngine';
import { localDateString } from '@/engine/reviewEngine';
import { kpIdGrade } from '@/engine/kpId';
import type { Question, QueueItem, TodaySession } from '@/types';

// ============ Local_Store 键（kla:v1:{accountId}:{entity}，accountId=default） ============

const KEY_PREFIX = 'kla:v1:default';
const SESSION_KEY = `${KEY_PREFIX}:session:today`;
const CHILD_GRADE_KEY = `${KEY_PREFIX}:childGrade`;

function readStorage<T>(key: string): T {
  const raw = localStorage.getItem(key);
  expect(raw, `localStorage 应存在键 ${key}`).not.toBeNull();
  return JSON.parse(raw as string) as T;
}

// ============ 应用启动 / 关闭 ============

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
  { path: '/parent-settings', name: 'parent-settings', component: ParentSettingsPage },
];

/** 以 jsdom localStorage 启动应用并停在首页 */
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

/** 等待路由、事件处理与 Vue 渲染全部落地 */
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

/** 推进 1 秒假时钟：让 Local_Store 的 800ms 调度写（掌握度/错题本等）落盘 */
async function flushScheduledWrites(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1000);
  await settle();
}

// ============ 作答驱动（按题型走真实 DOM 交互，与 mainFlow.spec.ts 同口径） ============

/** 当前题对应的题库题（本链路断言队列全部为题库题） */
function currentQuestion(): Question {
  const item = nextUnanswered(session());
  expect(item, '应存在下一道未答题').not.toBeNull();
  expect(item?.kind, '今日队列应全部为题库题（种子固定）').toBe('bank');
  const q = appState.bank?.byId.get(item?.questionId as string);
  expect(q, `题库应包含题目 ${item?.questionId}`).toBeDefined();
  return q as Question;
}

/** 点选题型：选项乱序展示，按选项文本定位按钮 */
async function answerChoice(q: Question, correct: boolean): Promise<void> {
  const options = q.options ?? [];
  const buttons = page().findAll('.choice-pad__option');
  expect(buttons.length, 'ChoicePad 选项数应与题目选项一致').toBe(options.length);
  const correctIds = new Set(q.answer.choice ?? []);
  const target = options.find((o) => (correct ? correctIds.has(o.id) : !correctIds.has(o.id)));
  expect(target, '应能找到目标选项').toBeDefined();
  const button = buttons.find((b) => b.text() === target?.text);
  expect(button, `选项按钮“${target?.text}”应存在`).toBeDefined();
  await button!.trigger('click');
}

/** 生字听写：按顺序点字卡拼合，填满自动提交（种子字卡文本题内无重复） */
async function answerDictation(q: Question, correct: boolean): Promise<void> {
  const order = q.answer.order ?? [];
  expect(order.length).toBeGreaterThanOrEqual(2);
  // 答错：右旋一位（已对全部种子验证不等于正确序列）
  const seq = correct ? order : [order[order.length - 1], ...order.slice(0, order.length - 1)];
  for (const id of seq) {
    const text = (q.options ?? []).find((o) => o.id === id)?.text ?? '';
    const tile = page()
      .findAll('.dictation-card__tile')
      .find((b) => b.text() === text);
    expect(tile, `听写字卡 ${text} 应存在`).toBeDefined();
    await tile?.trigger('click');
  }
}

/** pairs 归一化：种子使用二元组数组，兼容映射对象 */
function pairsEntries(q: Question): Array<readonly [string, string]> {
  const pairs = q.answer.pairs;
  expect(pairs, '拖拽题应有 pairs 答案').toBeDefined();
  return Array.isArray(pairs)
    ? (pairs as Array<readonly [string, string]>)
    : Object.entries(pairs as Record<string, string>);
}

/** 拖拽配对：点按后备交互（点选项→点槽位），填满自动提交 */
async function answerDragMatch(q: Question, correct: boolean): Promise<void> {
  const entries = pairsEntries(q);
  const options = q.options ?? [];
  const optionText = (id: string): string => options.find((o) => o.id === id)?.text ?? '';

  // 每个目标槽的作答选项：答对取正确选项；答错交换最后两槽的选项（槽数 ≥2，种子保证）
  const plan = new Map<string, string>();
  if (correct || entries.length < 2) {
    for (const [t, c] of entries) plan.set(t, c);
  } else {
    const last = entries.length - 1;
    for (let i = 0; i < entries.length; i++) {
      const [t] = entries[i];
      if (i === last - 1) plan.set(t, entries[last][1]);
      else if (i === last) plan.set(t, entries[last - 1][1]);
      else plan.set(t, entries[i][1]);
    }
  }

  for (const [targetId] of entries) {
    const choiceText = optionText(plan.get(targetId) as string);
    const chip = page()
      .findAll('.chip-in-tray')
      .find((b) => b.text() === choiceText);
    expect(chip, `备选区应存在选项 ${choiceText}`).toBeDefined();
    // 点按后备：pointerdown + pointerup（无位移）选中选项
    await chip?.trigger('pointerdown', { clientX: 0, clientY: 0, pointerId: 1 });
    await chip?.trigger('pointerup', { clientX: 0, clientY: 0, pointerId: 1 });
    const slot = page().find(`button[aria-label="${optionText(targetId)} 的作答槽"]`);
    expect(slot.exists(), `目标槽 ${optionText(targetId)} 应存在`).toBe(true);
    await slot.trigger('click');
    await nextTick();
  }
}

/** 当前题作答（本链路今日队列固定为语文题库题，见 driver 断言） */
async function answerCurrent(correct: boolean): Promise<void> {
  const q = currentQuestion();
  switch (q.type) {
    case 'dictation':
      return answerDictation(q, correct);
    case 'pinyin':
    case 'polyphone':
    case 'poem_chain':
    case 'judge':
    case 'choice':
      return answerChoice(q, correct);
    case 'similar_char':
    case 'word_match':
    case 'idiom_fill':
      return answerDragMatch(q, correct);
    default:
      throw new Error(`作答驱动未覆盖题型 ${q.type}（种子变化需显式扩展驱动）`);
  }
}

/** 首对一题并跳过庆祝进入下一题 */
async function answerCurrentCorrectAndProceed(): Promise<void> {
  await answerCurrent(true);
  expect(has('celebration-overlay'), '首对应展示庆祝动画').toBe(true);
  await clickTestId('celebration-overlay');
  await flushScheduledWrites();
}

// ============ 反馈弹层与导航驱动 ============

function has(testid: string): boolean {
  return page().find(`[data-testid="${testid}"]`).exists();
}

async function clickTestId(testid: string): Promise<void> {
  const el = page().find(`[data-testid="${testid}"]`);
  expect(el.exists(), `元素 ${testid} 应存在`).toBe(true);
  await el.trigger('click');
  await settle();
}

/** 离开练习页回首页：组边界展示小组结算时点"休息"，否则点顶栏"退出"（均保存进度） */
async function leavePracticeToHome(): Promise<void> {
  if (has('group-settlement')) {
    await clickTestId('rest-btn');
  } else {
    await clickTestId('exit-btn');
  }
  expect(router.currentRoute.value.path).toBe('/');
}

/** 首页点击"今日冒险"并等待练习页就绪 */
async function clickAdventure(): Promise<void> {
  const button = page().find('.adventure-button');
  expect(button.exists(), '首页应有"今日冒险"按钮').toBe(true);
  await button.trigger('click');
  await settle();
}

// ============ 年级断言 ============

/** 队列项年级来源解析：题目数值 grade / 生成器 grade / kpId 年级段 */
function itemGrades(item: QueueItem): { questionGrade: number; kpGrade: number } {
  let questionGrade: number;
  if (item.kind === 'bank') {
    const q = appState.bank?.byId.get(item.questionId as string);
    expect(q, `队列项题目 ${item.questionId} 必须存在于题库`).toBeDefined();
    questionGrade = (q as Question).grade;
  } else {
    const gen = appState.generators.find((g) => g.id === item.generatorParamsId);
    expect(gen, `队列项生成器 ${item.generatorParamsId} 必须存在`).toBeDefined();
    questionGrade = (gen as { grade: number }).grade;
  }
  const kpGrade = kpIdGrade(item.knowledgePointId);
  expect(kpGrade, `队列项知识点 ${item.knowledgePointId} 的年级段必须可解析`).not.toBeNull();
  return { questionGrade, kpGrade: kpGrade as number };
}

/** 断言队列每项年级（题目/生成器与知识点年级段两个来源）均 ≤ childGrade */
function expectQueueWithinGrade(queue: readonly QueueItem[], childGrade: number): void {
  for (const item of queue) {
    const { questionGrade, kpGrade } = itemGrades(item);
    expect(questionGrade, `队列项 ${item.knowledgePointId} 题目/生成器年级须 ≤ ${childGrade}`)
      .toBeLessThanOrEqual(childGrade);
    expect(kpGrade, `队列项 ${item.knowledgePointId} 知识点年级段须 ≤ ${childGrade}`)
      .toBeLessThanOrEqual(childGrade);
  }
}

// ============ 测试 ============

describe('当日不受扰链路：当日改年级不扰动已生成会话，次日新队列按新年级过滤', () => {
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

  it('修改年级当日续练不变（超限项可答），次日新队列按新年级过滤（Req 2.9/3.3/3.5）', async () => {
    // ---------- 0. 预置：家长此前已设置 Child_Grade=6（本链路验证"修改"而非"首设"） ----------
    localStorage.setItem(CHILD_GRADE_KEY, '6');

    // ---------- 1. 当日生成会话并作答部分题目 ----------
    await bootApp();
    expect(appState.childGrade.value, '启动应恢复预置的 Child_Grade').toBe(6);
    await clickAdventure();
    expect(router.currentRoute.value.path).toBe('/practice');
    const created = session();
    expect(created.status).toBe('active');
    expect(created.currentIndex).toBe(0);
    expect(created.queue.length).toBeGreaterThan(0);
    expect(created.queue.every((item) => item.kind === 'bank')).toBe(true);
    // Child_Grade=6 时与未过滤等价（Req 3.1 同口径）：队列含三至四年级内容
    const createdGrades = created.queue.map((item) => itemGrades(item).questionGrade);
    expect(Math.max(...createdGrades), '当日队列应含高年级内容（供后续超限断言）')
      .toBeGreaterThan(1);

    // 作答前 2 题（首对），进度落盘后回首页
    await answerCurrentCorrectAndProceed();
    await answerCurrentCorrectAndProceed();
    expect(session().currentIndex).toBe(2);
    expect(session().results).toHaveLength(2);
    await leavePracticeToHome();

    // ---------- 2. 变更前快照（自 Local_Store 读回，与后续比较同一口径） ----------
    const preSession = readStorage<TodaySession>(SESSION_KEY);
    expect(preSession.currentIndex).toBe(2);
    const preQueue = preSession.queue;
    const preNext = nextUnanswered(preSession);
    expect(preNext, '应存在下一道未完成题').not.toBeNull();

    // ---------- 3. 家长经 UI 修改年级：六年级 → 一年级（Req 1.6，立即落盘） ----------
    await page().find('.parent-entry').trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/parent-settings');
    // 家长确认：从 DOM 解析挑战题并作答（不依赖随机源定盘）
    expect(has('parent-gate')).toBe(true);
    const challengeText = page().find('[data-testid="gate-challenge"]').text();
    const match = /请家长回答：\s*(\d+)\s*\+\s*(\d+)\s*=\s*\?/.exec(challengeText);
    expect(match, `挑战题文本应可解析：${challengeText}`).not.toBeNull();
    const answer = Number(match?.[1]) + Number(match?.[2]);
    await page().find('[data-testid="gate-input"]').setValue(String(answer));
    await clickTestId('gate-confirm');
    // 年级选择：选一年级并保存
    expect(has('grade-picker')).toBe(true);
    const gradeOne = page().find('[data-grade="1"]');
    expect(gradeOne.exists(), '应有一年级选项').toBe(true);
    await gradeOne.trigger('click');
    await settle();
    await clickTestId('save-grade');
    // 生效说明（Req 3.5 的"自明天起生效"），并立即落盘（Req 1.6/4.1/4.2）
    expect(has('save-effect-note')).toBe(true);
    expect(appState.childGrade.value).toBe(1);
    expect(readStorage<number>(CHILD_GRADE_KEY)).toBe(1);
    await clickTestId('back-home');
    expect(router.currentRoute.value.path).toBe('/');

    // ---------- 4. 当日续练：队列与下一道未完成题不变（Req 3.3，当日不重新生成） ----------
    await clickAdventure();
    expect(router.currentRoute.value.path).toBe('/practice');
    expect(session().queue, '续练队列应与变更前深相等').toEqual(preQueue);
    expect(session().currentIndex).toBe(2);
    expect(session().results).toHaveLength(2);
    expect(nextUnanswered(session()), '下一道未完成题应与变更前一致').toEqual(preNext);
    // 已存储会话逐字段不变（当日不重建、不触碰，Req 3.5 的"当日不受扰"半）
    expect(readStorage<TodaySession>(SESSION_KEY)).toEqual(preSession);
    // 下一道未完成题为年级超限项（语文三年级 > 一年级），仍保留在队列中
    const nextItem = nextUnanswered(session());
    expect(nextItem).not.toBeNull();
    const { questionGrade } = itemGrades(nextItem as QueueItem);
    expect(questionGrade, '下一道未完成题应为年级超限项（grade > 1）').toBeGreaterThan(1);

    // ---------- 5. 年级超限项仍可正常作答入账（Req 3.3） ----------
    await answerCurrentCorrectAndProceed();
    expect(session().currentIndex, '超限题作答应推进进度').toBe(3);
    expect(session().results).toHaveLength(3);
    expect(session().results[2].knowledgePointId).toBe((nextItem as QueueItem).knowledgePointId);
    expect(session().results[2].correct).toBe(true);
    await leavePracticeToHome();
    // 作答后落盘的会话仍基于原队列（仅进度推进，队列本身不变）
    const storedAfterAnswer = readStorage<TodaySession>(SESSION_KEY);
    expect(storedAfterAnswer.queue).toEqual(preQueue);
    expect(storedAfterAnswer.currentIndex).toBe(3);

    // ---------- 6. 时钟推进到次日：新队列按新年级过滤（Req 2.9、3.5） ----------
    vi.setSystemTime(new Date(2025, 5, 16, 8, 0, 0));
    await clickAdventure();
    expect(router.currentRoute.value.path).toBe('/practice');
    const nextDay = session();
    expect(nextDay.date, '次日应生成新会话').toBe(localDateString(Date.now()));
    expect(nextDay.date).not.toBe(preSession.date);
    expect(nextDay.currentIndex).toBe(0);
    expect(nextDay.queue.length, '一年级内容应可组成次日队列').toBeGreaterThan(0);
    // 每个队列项年级均 ≤ 1（Req 2.9：下次生成起按新年级过滤）
    expectQueueWithinGrade(nextDay.queue, 1);
    // 昨日已作答的年级超限知识点（已建立掌握度记录且到点）不混入次日复习段
    const answeredKpIds = new Set(preSession.results.map((r) => r.knowledgePointId));
    const nextDayKpIds = new Set(nextDay.queue.map((item) => item.knowledgePointId));
    for (const kpId of answeredKpIds) {
      expect(nextDayKpIds.has(kpId), `超限复习知识点 ${kpId} 不应出现在次日队列`).toBe(false);
    }
    // 新会话已持久化，孩子年级保持为 1
    expect(readStorage<TodaySession>(SESSION_KEY).date).toBe(nextDay.date);
    expect(readStorage<number>(CHILD_GRADE_KEY)).toBe(1);
  });
});
