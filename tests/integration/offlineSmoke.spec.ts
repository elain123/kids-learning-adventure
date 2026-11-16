/**
 * 断网冒烟与写失败提示测试（任务 16.2）
 *
 * 场景一（Req 10.5 断网冒烟）：模拟设备无网络（navigator.onLine=false，fetch 与
 * XMLHttpRequest 全部替换为计数 stub，任何网络尝试都会留痕）。应用完全从本地启动
 * （种子题库随包静态打包、进度经 localStorage 读写），断网状态下完成
 * "答题 → 即时判定 → 进度保存 → 星星发放 → 错题收集"全流程，并验证断网关闭重开后
 * 进度从本地恢复；全程断言零网络调用。
 *
 * 场景二（Req 10.6 写失败提示）：会话进行中令 localStorage.setItem 抛错（模拟存储
 * 不可用或空间不足），作答触发写盘后断言界面展示"本次进度可能无法保存"提示
 * （data-testid="write-error-banner"），且当前会话内答题进度在界面上保持可见
 * （Streak/星星余额/第 X 组第 Y 题即时刷新）、学生可继续作答（currentIndex 持续推进）；
 * 存储内旧值保持不变，佐证"进度未保存"的提示语意。
 *
 * 确定性保障与 tests/integration/mainFlow.spec.ts 相同：固定系统时间 2025-06-15、
 * Audio_Service 全 stub、Local_Store 的 800ms 调度写经 1 秒假时钟落盘。
 *
 * Validates: Requirements 10.5, 10.6
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
import { createAppState, setSharedAppState, type AppState } from '@/stores/appState';
import { audioService } from '@/services/audioService';
import { nextUnanswered } from '@/engine/adventureEngine';
import type { MasteryRecord, Question, StarWallet, TodaySession } from '@/types';
import type { WrongSet } from '@/data/localStore';

// ============ Local_Store 键（kla:v1:{accountId}:{entity}，一期 accountId=default） ============

const KEY_PREFIX = 'kla:v1:default';
const WALLET_KEY = `${KEY_PREFIX}:wallet`;
const SESSION_KEY = `${KEY_PREFIX}:session:today`;
const MASTERY_KEY = `${KEY_PREFIX}:mastery`;
const WRONGSET_KEY = `${KEY_PREFIX}:wrongSet`;

function readStorage<T>(key: string): T {
  const raw = localStorage.getItem(key);
  expect(raw, `localStorage 应存在键 ${key}`).not.toBeNull();
  return JSON.parse(raw as string) as T;
}

// ============ 应用启动（打开应用 / 关闭重开） ============

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

/** 关闭应用（不清理 localStorage，模拟关闭后重开） */
async function closeApp(): Promise<void> {
  if (wrapper !== null) {
    wrapper.unmount();
    wrapper = null;
  }
  setSharedAppState(null);
  await settle();
}

/** 等待事件处理与 Vue 渲染全部落地 */
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

/**
 * 推进 1 秒假时钟：让 Local_Store 的 800ms 调度写落盘（Req 10.2：变化后 1 秒内写入）。
 * 掌握度/错题本按"读存储 → 合并 → 调度写"链路工作，两次作答间推进 1 秒模拟真实节奏，
 * 保证下一题读到的是已落盘状态。
 */
async function flushScheduledWrites(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1000);
  await settle();
}

/** 当前题对应的题库题（本链路断言队列全部为题库题） */
function currentQuestion(): Question {
  const item = nextUnanswered(session());
  expect(item, '应存在下一道未答题').not.toBeNull();
  expect(item?.kind, '今日队列应全部为题库题（种子固定）').toBe('bank');
  const q = appState.bank?.byId.get(item?.questionId as string);
  expect(q, `题库应包含题目 ${item?.questionId}`).toBeDefined();
  return q as Question;
}

// ============ 作答驱动（按题型走真实 DOM 交互，与 mainFlow.spec.ts 同口径） ============

/** 点选题型（拼音/多音字/古诗文接龙）：选项乱序展示，按选项文本定位按钮 */
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

/** 拖拽配对（形近字/词语搭配/成语填空）：点按后备交互（点选项→点槽位），填满自动提交 */
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

// ============ 反馈与结算弹层驱动 ============

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

/** 答对后的庆祝动画：点击提前进入下一题（不等待定时器） */
async function proceedFromCelebration(): Promise<void> {
  expect(has('celebration-overlay'), '首对应展示庆祝动画').toBe(true);
  await clickTestId('celebration-overlay');
}

/** 小组结算/10 分钟提示若展示则点"继续" */
async function consumeOverlaysWithContinue(): Promise<void> {
  for (let guard = 0; guard < 10; guard++) {
    if (has('group-settlement') || has('timeup-overlay')) {
      await clickTestId('continue-btn');
      continue;
    }
    break;
  }
}

// ============ 测试 ============

describe('断网冒烟与写失败提示', () => {
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
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('断网冒烟：无网络完成答题/判定/保存/星星/错题全流程（Req 10.5）', async () => {
    // ---------- 0. 断网模拟：onLine=false；fetch/XMLHttpRequest 替换为计数 stub ----------
    // 任何网络尝试（含隐式资源请求）都会命中 stub 留痕，末尾断言零调用即证明全程纯本地。
    vi.spyOn(Navigator.prototype, 'onLine', 'get').mockReturnValue(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const xhrOpenSpy = vi
      .spyOn(XMLHttpRequest.prototype, 'open')
      .mockImplementation(() => undefined);
    const xhrSendSpy = vi
      .spyOn(XMLHttpRequest.prototype, 'send')
      .mockImplementation(() => undefined);
    expect(navigator.onLine, '设备应处于断网状态').toBe(false);

    // ---------- 1. 断网启动应用：种子题库随包静态打包，首页正常渲染 ----------
    await bootApp();
    await page().find('.adventure-button').trigger('click');
    await settle();
    expect(router.currentRoute.value.path, '断网应可直接进入练习页').toBe('/practice');
    expect(has('question-area'), '断网应可展示第一题').toBe(true);
    expect(session().queue.length).toBeGreaterThan(0);

    // ---------- 2. 第 1 题首对：即时判定（本地同步定盘）+ 5 星星即时到账 ----------
    const q1 = currentQuestion();
    await answerCurrent(true);
    // 判定即时且纯本地：未推进任何计时器/未发任何请求，结果已同步定盘
    expect(session().results).toHaveLength(1);
    expect(session().results[0].correct).toBe(true);
    expect(session().results[0].stars).toBe(5);
    expect(session().streak).toBe(1);
    expect(appState.wallet.value.balance, '星星应立即发放到钱包').toBe(5);
    expect(page().find('.star-pill').text(), '星星余额界面即时刷新').toContain('5');
    await proceedFromCelebration();
    expect(session().currentIndex).toBe(1);
    await flushScheduledWrites();

    // ---------- 3. 第 2 题：首错 Hint → 再错解析 → 错题收集（retriedCorrect=false） ----------
    const q2 = currentQuestion();
    await answerCurrent(false);
    expect(page().find('[data-testid="hint-bar"]').text(), '首错应展示 Hint').toContain(q2.hint);
    await answerCurrent(false);
    expect(has('reveal-card'), '再错应展示答案解析卡').toBe(true);
    await clickTestId('next-question-btn');
    expect(session().results[1].correct).toBe(false);
    expect(session().results[1].retried).toBe(true);
    await flushScheduledWrites();
    // 进度保存：会话与错题本均已落盘
    let storedSession = readStorage<TodaySession>(SESSION_KEY);
    expect(storedSession.currentIndex, '断网下进度应保存到本地').toBe(2);
    expect(storedSession.results).toHaveLength(2);
    let storedWrongSet = readStorage<WrongSet>(WRONGSET_KEY);
    expect(storedWrongSet.items).toHaveLength(1);
    expect(storedWrongSet.items[0].questionRef).toBe(q2.id);
    expect(storedWrongSet.items[0].retriedCorrect).toBe(false);

    // ---------- 4. 第 3 题：首错 → 重试答对 → 按答错记账（错题收集 retriedCorrect=true） ----------
    const q3 = currentQuestion();
    await answerCurrent(false);
    await answerCurrent(true);
    await clickTestId('encouragement-bar');
    const r3 = session().results[2];
    expect(r3.retried, '重试作答应标记 retried').toBe(true);
    expect(r3.correct, '重试答对按答错记账').toBe(false);
    expect(r3.stars, '重试答对不发星星').toBe(0);
    await flushScheduledWrites();
    // 小组结算（完成 3 题）→ 继续
    await consumeOverlaysWithContinue();
    expect(session().currentIndex).toBe(3);

    // ---------- 5. 断网全流程落盘核验：会话/钱包/错题本/掌握度 ----------
    storedSession = readStorage<TodaySession>(SESSION_KEY);
    expect(storedSession.currentIndex).toBe(3);
    expect(storedSession.results).toHaveLength(3);
    storedWrongSet = readStorage<WrongSet>(WRONGSET_KEY);
    expect(storedWrongSet.items).toHaveLength(2);
    expect(storedWrongSet.items.map((i) => [i.questionRef, i.retriedCorrect])).toEqual([
      [q2.id, false],
      [q3.id, true],
    ]);
    const storedWallet = readStorage<StarWallet>(WALLET_KEY);
    expect(storedWallet.balance, '断网下星星应发放并落盘').toBe(5);
    const storedMastery = readStorage<Record<string, MasteryRecord>>(MASTERY_KEY);
    expect(storedMastery[q1.knowledgePointId]?.level, '首对知识点应建立 1 级掌握度').toBe(1);

    // ---------- 6. 全程零网络调用 ----------
    expect(fetchSpy, '不得发起 fetch 请求').not.toHaveBeenCalled();
    expect(xhrOpenSpy, '不得发起 XMLHttpRequest').not.toHaveBeenCalled();
    expect(xhrSendSpy, '不得发起 XMLHttpRequest').not.toHaveBeenCalled();

    // ---------- 7. 断网关闭重开：进度从本地恢复，可续练下一未答题 ----------
    await closeApp();
    await bootApp();
    expect(navigator.onLine, '重开后仍处于断网').toBe(false);
    expect(appState.wallet.value.balance, '钱包应从本地恢复').toBe(5);
    expect(page().find('.star-balance__count').text()).toBe('5');
    await page().find('.adventure-button').trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/practice');
    expect(session().currentIndex, '应恢复到下一未答题位置').toBe(3);
    expect(page().find('[data-testid="progress"]').text()).toContain('第 2 组');
    expect(page().find('[data-testid="progress"]').text()).toContain('第 1 题');
    expect(appState.store.read('wrongSet').items, '错题本应从本地恢复').toHaveLength(2);
    expect(has('question-area'), '断网重开应可继续作答').toBe(true);

    // 重开流程依旧零网络调用
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpenSpy).not.toHaveBeenCalled();
    expect(xhrSendSpy).not.toHaveBeenCalled();
  });

  it('写失败提示：存储写失败提示"本次进度可能无法保存"且进度可见可继续（Req 10.6）', async () => {
    // ---------- 1. 正常启动并进入练习：基线会话已落盘 ----------
    await bootApp();
    await page().find('.adventure-button').trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/practice');
    expect(readStorage<TodaySession>(SESSION_KEY).currentIndex, '基线会话应已落盘').toBe(0);

    // ---------- 2. 存储写失败：setItem 抛错（存储不可用或空间不足） ----------
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('存储不可用或空间不足', 'QuotaExceededError');
    });

    // ---------- 3. 作答触发写盘：界面提示"本次进度可能无法保存" ----------
    await answerCurrent(true);
    await settle();
    const banner = page().find('[data-testid="write-error-banner"]');
    expect(banner.exists(), '写失败应展示提示条').toBe(true);
    expect(banner.text()).toContain('本次进度可能无法保存');
    expect(setItemSpy, '作答应触发了写盘（且失败）').toHaveBeenCalled();

    // ---------- 4. 会话内进度界面保持可见（内存态即时刷新） ----------
    expect(session().currentIndex).toBe(1);
    expect(session().streak).toBe(1);
    expect(page().find('[data-testid="streak"]').text()).toContain('1');
    expect(page().find('.star-pill').text(), '星星余额内存态可见').toContain('5');
    expect(page().find('[data-testid="progress"]').text()).toContain('第 2 题');
    // 存储确未更新（佐证"无法保存"的提示语意）
    expect(readStorage<TodaySession>(SESSION_KEY).currentIndex, '存储应停在写失败前').toBe(0);
    expect(localStorage.getItem(WALLET_KEY), '钱包应从未成功落盘').toBeNull();

    // ---------- 5. 学生可继续作答：第 2 题再次首对，进度继续推进 ----------
    await proceedFromCelebration();
    await answerCurrent(true);
    await settle();
    expect(session().currentIndex, '应可继续作答并推进').toBe(2);
    expect(session().streak).toBe(2);
    expect(appState.wallet.value.balance).toBe(10);
    expect(page().find('[data-testid="streak"]').text()).toContain('2');
    expect(page().find('.star-pill').text()).toContain('10');
    expect(page().find('[data-testid="progress"]').text()).toContain('第 3 题');

    // ---------- 6. 调度写落盘同样失败：提示保持可见，存储仍未更新 ----------
    await flushScheduledWrites();
    const bannerAfterFlush = page().find('[data-testid="write-error-banner"]');
    expect(bannerAfterFlush.exists(), '调度写失败后提示应保持').toBe(true);
    expect(bannerAfterFlush.text()).toContain('本次进度可能无法保存');
    expect(readStorage<TodaySession>(SESSION_KEY).currentIndex, '存储应仍未更新').toBe(0);

    // ---------- 7. 继续前进：第 3 题正常渲染可作答 ----------
    await proceedFromCelebration();
    expect(has('question-area'), '写失败后应可继续练习').toBe(true);
    expect(session().currentIndex).toBe(2);
  });
});
