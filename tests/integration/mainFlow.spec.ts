/**
 * 端到端主链路集成测试（任务 16.1）
 *
 * 在 jsdom + 内存 localStorage（jsdom 自带 localStorage 即内存实现，全应用共享：
 * App_State 与各页面直读的 createLocalStore() 默认都落在它上面）中驱动真实
 * App.vue + 真实路由 + 真实种子题库，走完今日冒险主链路：
 *
 *   打开应用（首页仅"今日冒险"一个练习入口，Req 1.1/1.2）
 *   → 点击"今日冒险"，无掌握度记录时经 Review_Engine 自动生成会话并直接展示
 *     第一题（Req 1.2/1.4，种子题前 50 个新知识点入队）
 *   → 答题：首对（Streak 递增、5/10 星星发放与余额即时刷新，Req 4.4/4.6/5.1/5.9）
 *     → 首错 Hint 不给答案（Req 4.1）→ 再错给答案 + ≤100 字解析 + 鼓励文案 +
 *     下一题入口（Req 4.2）；另一题首错 → 重试答对按答错记账、无星星（Req 4.3）
 *   → 小组结算（每 3 题"继续/休息"，Req 2.3）；"休息"保存进度回首页（Req 2.4/2.8）
 *   → 关闭重开：同一 localStorage 重新挂载，"今日冒险"续练并恢复到下一未答题
 *     （Req 1.3/2.5/2.7/10.3）
 *   → 10 分钟关卡计时到点提示"继续/休息"（Req 2.2/2.6，fake timers 推进）
 *   → 答完全部题 → 关卡结算 +10 星星（Req 5.2，Req 1.5 完成口径）
 *   → 星星钱包到账且界面余额刷新（Req 5.9）
 *   → 宝箱页开启（30 星星）→ 扣 30、新物品入 Island_Collection（Req 5.3/5.4/5.6）
 *   → 小岛页展示收藏与"已收集 N/12"计数（Req 5.8）
 *   → 再次关闭重开：钱包/会话/掌握度/错题本/收藏全部恢复为最后写入值
 *     （Req 10.1/10.2/10.3/10.4），首页呈"今日冒险已完成"态（Req 1.5）
 *
 * 确定性保障：
 * - 种子题库固定 → 今日队列固定为语文前 50 个新知识点（driver 断言全部为
 *   题库题，若种子变化会显式失败而不是静默走错路径）；
 * - vi.useFakeTimers 控制 Date.now 与全部定时器：庆祝/鼓励定时器以点击跳过，
 *   关卡 10 分钟到点经 advanceTimersByTime 触发；
 * - Audio_Service 共享实例方法全部 stub（playEffect/playPronunciation/stopAll），
 *   避免 jsdom 无 Web Audio/媒体播放实现带来的噪音；宝箱在 jsdom 无 AudioContext
 *   下本就静默降级，且收藏为空时开箱产出必为新物品，无需注入随机源。
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 1.5, 2.4, 2.5, 3.1, 4.1, 4.2, 4.3,
 *            5.1, 5.2, 5.4, 5.6, 10.1, 10.2, 10.3, 10.4
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
import { LEVEL_COMPLETION_STARS } from '@/engine/oralBest';
import { INTERVALS_MS, COLLECTIBLE_ITEMS, COLLECTIBLE_TOTAL, TREASURE_BOX_COST } from '@/types';
import type { MasteryRecord, Question, StarWallet, TodaySession } from '@/types';
import type { WrongSet } from '@/data/localStore';

// ============ Local_Store 键（kla:v1:{accountId}:{entity}，一期 accountId=default） ============

const KEY_PREFIX = 'kla:v1:default';
const WALLET_KEY = `${KEY_PREFIX}:wallet`;
const SESSION_KEY = `${KEY_PREFIX}:session:today`;
const MASTERY_KEY = `${KEY_PREFIX}:mastery`;
const WRONGSET_KEY = `${KEY_PREFIX}:wrongSet`;
const COLLECTION_KEY = `${KEY_PREFIX}:collection`;

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

/** 等待路由懒加载、事件处理与 Vue 渲染全部落地 */
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
 * 掌握度/错题本按"读存储 → 合并 → 调度写"链路工作，真实使用中两次作答间隔
 * 远超 1 秒（调度写已落盘）；测试中每题作答后推进 1 秒模拟该节奏，保证下一题
 * 读到的是已落盘状态。52 题累计约 52 秒，远低于关卡 10 分钟到点阈值，不会误触发。
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

// ============ 作答驱动（按题型走真实 DOM 交互） ============

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

/** 答对后的庆祝动画：点击提前进入下一题（Req 12.3 ≤3 秒，此处不等待定时器） */
async function proceedFromCelebration(): Promise<void> {
  expect(has('celebration-overlay'), '首对应展示庆祝动画').toBe(true);
  await clickTestId('celebration-overlay');
}

/** 小组结算/10 分钟提示若展示则点"继续"；返回是否消费了弹层 */
async function consumeOverlaysWithContinue(): Promise<void> {
  for (let guard = 0; guard < 10; guard++) {
    if (has('group-settlement')) {
      const overlay = page().find('[data-testid="group-settlement"]');
      expect(overlay.find('[data-testid="continue-btn"]').exists(), '小组结算应有"继续"').toBe(true);
      expect(overlay.find('[data-testid="rest-btn"]').exists(), '小组结算应有"休息"').toBe(true);
      await clickTestId('continue-btn');
      continue;
    }
    if (has('timeup-overlay')) {
      await clickTestId('continue-btn');
      continue;
    }
    break;
  }
}

// ============ 星星与钱包 ============

/** 会话已发星星合计（AnswerResult.stars 之和，不含关卡完成 +10） */
function answerStarsTotal(): number {
  return session().results.reduce((sum, r) => sum + r.stars, 0);
}

function expectWalletBalance(expected: number): void {
  expect(appState.wallet.value.balance, 'App_State 钱包余额').toBe(expected);
  const pill = page().find('.star-pill');
  if (pill.exists()) {
    expect(pill.text(), '练习页星星余额应即时刷新').toContain(String(expected));
  }
}

// ============ 测试 ============

describe('端到端主链路：今日冒险 → 答题 → 结算 → 宝箱 → 小岛 → 重开恢复', () => {
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

  it('完整主链路（Req 1.2-1.5, 2.4-2.6, 3.1, 4.1-4.3, 5.1-5.6, 10.1-10.4）', async () => {
    // ---------- 1. 打开应用：首页仅"今日冒险"一个练习入口（Req 1.1/1.2） ----------
    await bootApp();
    const adventureButtons = page().findAll('.adventure-button');
    expect(adventureButtons).toHaveLength(1);
    expect(adventureButtons[0].text()).toContain('今日冒险');
    expect(page().findAll('a[href*="/practice"]')).toHaveLength(0);
    expect(page().find('.star-balance__count').text()).toBe('0');

    // ---------- 2. 点击"今日冒险"：自动生成会话并直接展示第一题（Req 1.2/1.4） ----------
    await adventureButtons[0].trigger('click');
    await settle();
    expect(router.currentRoute.value.path, '应直接导航练习页，无中间选择页').toBe('/practice');
    // 无掌握度记录 → Review_Engine 从种子题库生成会话并立即持久化（Req 1.4/10.2）
    const created = session();
    expect(created.currentIndex).toBe(0);
    expect(created.status).toBe('active');
    expect(created.results).toHaveLength(0);
    expect(created.queue.length).toBeGreaterThan(0);
    expect(created.queue.every((item) => item.kind === 'bank')).toBe(true);
    const persistedAtStart = readStorage<TodaySession>(SESSION_KEY);
    expect(persistedAtStart.currentIndex).toBe(0);
    expect(persistedAtStart.queue).toHaveLength(created.queue.length);
    // 第一题已展示（Req 1.2/1.3：下一未答题即第一题）
    expect(has('question-area')).toBe(true);
    expect(page().find('[data-testid="progress"]').text()).toContain('第 1 组');
    expect(page().find('[data-testid="progress"]').text()).toContain('第 1 题');

    const firstQuestion = currentQuestion();

    // ---------- 3. 第 1 题首对：Streak 递增 + 5 星星 + 余额即时刷新（Req 4.4/5.1/5.9） ----------
    await answerCurrent(true);
    expect(session().streak).toBe(1);
    expect(session().results).toHaveLength(1);
    expect(session().results[0].stars).toBe(5);
    expectWalletBalance(5);
    expect(page().find('[data-testid="streak"]').text()).toContain('1');
    await proceedFromCelebration();
    expect(session().currentIndex).toBe(1);
    await flushScheduledWrites();

    // ---------- 4. 第 2 题：首错 → Hint 不给答案（Req 4.1）→ 再错 → 答案+解析+鼓励+下一题（Req 4.2） ----------
    const q2 = currentQuestion();
    await answerCurrent(false);
    // Hint 条展示该题提示，不展示正确答案，保留同一题重试（Req 4.1）
    const hintBar = page().find('[data-testid="hint-bar"]');
    expect(hintBar.exists()).toBe(true);
    expect(hintBar.text()).toContain(q2.hint);
    expect(has('reveal-card'), '首错时不得公布答案').toBe(false);
    expect(session().currentIndex, '首错不推进，保留同一题重试').toBe(1);
    expect(session().streak, '首错 Streak 归零').toBe(0);
    expect(session().results, '首错暂不记结果，待重试定盘').toHaveLength(1);
    // 再错：答案 + ≤100 字解析 + 鼓励文案 + 下一题入口（Req 4.2）
    await answerCurrent(false);
    const revealCard = page().find('[data-testid="reveal-card"]');
    expect(revealCard.exists()).toBe(true);
    expect(revealCard.text()).toContain('正确答案');
    const analysisText = revealCard.find('.reveal-card__analysis').text();
    expect([...analysisText].length, '解析不超过 100 字').toBeLessThanOrEqual(100);
    expect(revealCard.find('.reveal-card__encouragement').text().length).toBeGreaterThan(0);
    expect(revealCard.find('[data-testid="next-question-btn"]').exists()).toBe(true);
    await clickTestId('next-question-btn');
    // 重试仍错：按答错记账、无星星（Req 4.3 的另一半由下方重试答对验证）
    const q2Result = session().results[1];
    expect(q2Result.correct).toBe(false);
    expect(q2Result.retried).toBe(true);
    expect(q2Result.stars).toBe(0);
    expectWalletBalance(5);
    // 答错当日重出（Req 3.4）：队尾追加 retry 项
    expect(session().queue).toHaveLength(51);
    expect(session().queue[50].source).toBe('retry');
    expect(session().queue[50].questionId).toBe(q2.id);
    await flushScheduledWrites();

    // ---------- 5. 第 3 题首对 → 小组结算（Req 2.3），点"休息"保存进度回首页（Req 2.4/2.8） ----------
    await answerCurrent(true);
    await proceedFromCelebration();
    expect(session().currentIndex).toBe(3);
    const groupOverlay = page().find('[data-testid="group-settlement"]');
    expect(groupOverlay.exists(), '每 3 题完成应有小组结算').toBe(true);
    expect(groupOverlay.find('[data-testid="continue-btn"]').exists()).toBe(true);
    expect(groupOverlay.find('[data-testid="rest-btn"]').exists()).toBe(true);
    await flushScheduledWrites();
    await clickTestId('rest-btn');
    expect(router.currentRoute.value.path).toBe('/');
    // 进度已保存（Req 2.4）：存储内会话停在下一未答题位置
    const savedAtRest = readStorage<TodaySession>(SESSION_KEY);
    expect(savedAtRest.currentIndex).toBe(3);
    expect(savedAtRest.results).toHaveLength(3);

    // ---------- 6. 关闭重开：恢复进度，续练下一未答题（Req 1.3/2.5/2.7/10.3） ----------
    await closeApp();
    await bootApp();
    await page().find('.adventure-button').trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/practice');
    expect(session().currentIndex).toBe(3);
    expect(page().find('[data-testid="progress"]').text()).toContain('第 2 组');
    expect(page().find('[data-testid="progress"]').text()).toContain('第 1 题');
    // 钱包/结果同步恢复
    expect(appState.wallet.value.balance).toBe(savedAtRest.results.reduce((s, r) => s + r.stars, 0));

    // ---------- 7. 10 分钟关卡计时到点 → "继续/休息"提示（Req 2.2/2.6，fake timers） ----------
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    await settle();
    const timeupOverlay = page().find('[data-testid="timeup-overlay"]');
    expect(timeupOverlay.exists(), '10 分钟到点应展示提示').toBe(true);
    expect(timeupOverlay.find('[data-testid="continue-btn"]').exists()).toBe(true);
    expect(timeupOverlay.find('[data-testid="rest-btn"]').exists()).toBe(true);
    await clickTestId('continue-btn');
    // "继续"后恰在组边界 → 补展示小组结算（壳层约定），继续作答
    await consumeOverlaysWithContinue();

    // ---------- 8. 第 4 题：首错 → 重试答对 → 按答错记账、鼓励文案、无星星（Req 4.3） ----------
    const q4 = currentQuestion();
    await answerCurrent(false);
    expect(page().find('[data-testid="hint-bar"]').text()).toContain(q4.hint);
    await answerCurrent(true);
    const encouragementBar = page().find('[data-testid="encouragement-bar"]');
    expect(encouragementBar.exists(), '重试答对应展示鼓励文案').toBe(true);
    await clickTestId('encouragement-bar');
    const q4Result = session().results[3];
    expect(q4Result.correct, '重试答对按答错记').toBe(false);
    expect(q4Result.retried).toBe(true);
    expect(q4Result.stars, '重试答对不发星星').toBe(0);
    expect(session().queue).toHaveLength(52);
    await consumeOverlaysWithContinue();
    await flushScheduledWrites();

    // ---------- 9. 答完全部剩余题（首对），沿途消费小组结算（Req 2.1/2.3/4.6/5.1） ----------
    const totalQueue = session().queue.length;
    expect(totalQueue).toBe(52);
    for (let guard = 0; session().status === 'active' && guard < 200; guard++) {
      await answerCurrent(true);
      await proceedFromCelebration();
      await consumeOverlaysWithContinue();
      await flushScheduledWrites();
      if (session().status === 'active') {
        // 星星按规则到账：会话进行中余额恒等于已发星星之和（Req 5.1/5.9）
        // （最后一题定盘后会话 done 并触发关卡结算 +10，由步骤 10 单独断言）
        expectWalletBalance(answerStarsTotal());
      }
    }
    expect(session().status, '全部题应答完').toBe('done');
    expect(session().currentIndex).toBe(totalQueue);
    expect(session().results).toHaveLength(totalQueue);
    // Streak 达 3 的倍数翻 10 星（Req 4.6）：结果中应同时存在 5 与 10
    const starValues = new Set(session().results.map((r) => r.stars));
    expect(starValues.has(5)).toBe(true);
    expect(starValues.has(10)).toBe(true);

    // ---------- 10. 关卡结算：+10 星星（Req 5.2），返回首页 ----------
    const earnedByAnswers = answerStarsTotal();
    const levelOverlay = page().find('[data-testid="level-settlement"]');
    expect(levelOverlay.exists(), '会话完成应展示关卡结算').toBe(true);
    expect(levelOverlay.find('[data-testid="level-stars"]').text()).toContain(
      `+${LEVEL_COMPLETION_STARS}`,
    );
    expectWalletBalance(earnedByAnswers + LEVEL_COMPLETION_STARS);
    await clickTestId('level-home-btn');
    expect(router.currentRoute.value.path).toBe('/');
    // 首页余额刷新（Req 5.9），今日已完成态（Req 1.5）
    expect(page().find('.star-balance__count').text()).toBe(
      String(earnedByAnswers + LEVEL_COMPLETION_STARS),
    );
    expect(page().find('.adventure-button').text()).toContain('今日冒险已完成');
    // 落盘值与界面一致（Req 10.2）
    const walletAfterLevel = readStorage<StarWallet>(WALLET_KEY);
    expect(walletAfterLevel.balance).toBe(earnedByAnswers + LEVEL_COMPLETION_STARS);
    expect(walletAfterLevel.totalEarned).toBe(earnedByAnswers + LEVEL_COMPLETION_STARS);

    // ---------- 11. 宝箱页：30 星星开启 → 新物品入收藏（Req 5.3/5.4/5.6） ----------
    expect(walletAfterLevel.balance).toBeGreaterThanOrEqual(TREASURE_BOX_COST);
    const boxEntry = page().findAll('.extra-entry').find((e) => e.attributes('href') === '/box');
    expect(boxEntry, '首页应有宝箱入口').toBeDefined();
    await boxEntry?.trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/box');
    // 按钮旁标注消耗（Req 5.3），余额充足（Req 5.4）
    expect(page().find('[data-testid="cost-label"]').text()).toContain(`${TREASURE_BOX_COST}`);
    expect(page().find('[data-testid="star-balance"]').text()).toContain(
      String(walletAfterLevel.balance),
    );
    await clickTestId('open-box');
    // 开箱动画 900ms 后揭示产出
    await vi.advanceTimersByTimeAsync(900);
    await settle();
    const resultNew = page().find('[data-testid="result-new"]');
    expect(resultNew.exists(), '收藏为空时开箱必为新收藏').toBe(true);
    expect(resultNew.text()).toContain('新收藏');
    // 扣 30 到账（Req 5.4/5.9），新物品入 Island_Collection（Req 5.6）
    const expectedAfterBox = walletAfterLevel.balance - TREASURE_BOX_COST;
    expect(page().find('[data-testid="star-balance"]').text()).toContain(String(expectedAfterBox));
    expect(readStorage<StarWallet>(WALLET_KEY).balance).toBe(expectedAfterBox);
    const collectionItems = readStorage<{ items: string[] }>(COLLECTION_KEY).items;
    expect(collectionItems).toHaveLength(1);
    expect(COLLECTIBLE_ITEMS.some((item) => item.id === collectionItems[0])).toBe(true);

    // ---------- 12. 小岛页：展示收藏与 N/12 计数（Req 5.8） ----------
    await clickTestId('go-island');
    expect(router.currentRoute.value.path).toBe('/island');
    expect(page().find('[data-testid="collect-counter"]').text()).toContain(
      `已收集 1/${COLLECTIBLE_TOTAL}`,
    );
    const itemCard = page().find(`[data-item-id="${collectionItems[0]}"]`);
    expect(itemCard.exists()).toBe(true);
    expect(itemCard.classes()).not.toContain('locked');

    // ---------- 13. 再次关闭重开：全部状态恢复为最后写入值（Req 10.1/10.3/10.4） ----------
    const snapshot = {
      wallet: readStorage<StarWallet>(WALLET_KEY),
      session: readStorage<TodaySession>(SESSION_KEY),
      mastery: readStorage<Record<string, MasteryRecord>>(MASTERY_KEY),
      wrongSet: readStorage<WrongSet>(WRONGSET_KEY),
      collection: readStorage<{ items: string[] }>(COLLECTION_KEY),
    };
    await closeApp();
    await bootApp();

    // 钱包恢复（Req 10.3）
    expect(appState.wallet.value).toEqual(snapshot.wallet);
    // 会话恢复：已完成态、进度与结果逐字段一致（Req 2.5/10.3）
    expect(appState.session.value).toEqual(snapshot.session);
    expect(snapshot.session.status).toBe('done');
    expect(snapshot.session.currentIndex).toBe(snapshot.session.queue.length);
    // 掌握度恢复（Req 3.1/10.3）：首对知识点建立 1 级（10 分钟）间隔
    const firstKpRecord = snapshot.mastery[firstQuestion.knowledgePointId];
    expect(firstKpRecord, '首题知识点应有掌握度记录').toBeDefined();
    expect(firstKpRecord.level).toBe(1);
    expect(firstKpRecord.totalCorrect).toBe(1);
    expect(firstKpRecord.mastered).toBe(false);
    expect(firstKpRecord.nextReviewAt).toBe(firstKpRecord.lastAnswerAt + INTERVALS_MS[1]);
    // 错题本恢复（Req 4.3/10.3）：首错再错题与重试答对题各一条
    expect(snapshot.wrongSet.items).toHaveLength(2);
    const wrongRefs = snapshot.wrongSet.items.map((w) => ({
      questionRef: w.questionRef,
      retriedCorrect: w.retriedCorrect,
    }));
    expect(wrongRefs).toContainEqual({ questionRef: q2.id, retriedCorrect: false });
    expect(wrongRefs).toContainEqual({ questionRef: q4.id, retriedCorrect: true });
    // 收藏恢复（Req 5.6/10.3）
    expect(snapshot.collection.items).toEqual(collectionItems);
    // 首页呈"今日冒险已完成"态，点击展示庆祝画面而不进入练习（Req 1.5）
    const doneButton = page().find('.adventure-button');
    expect(doneButton.classes()).toContain('adventure-button--done');
    expect(doneButton.text()).toContain('今日冒险已完成');
    await doneButton.trigger('click');
    await settle();
    expect(router.currentRoute.value.path, '已完成不应再进入练习').toBe('/');
    expect(page().find('.celebration-overlay').exists()).toBe(true);
    expect(page().find('.celebration-overlay').text()).toContain('今日冒险全部完成');
  });
});
