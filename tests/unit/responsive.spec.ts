/**
 * 布局适配（响应式多视口）单元测试（任务 15.2）
 *
 * jsdom 局限性说明（本文件的断言策略由此决定）：
 * jsdom 没有真实布局引擎——getBoundingClientRect 一律返回全 0 矩形，
 * 外部 CSS（全局 responsive.css 与 SFC scoped 样式）不参与计算样式，
 * scrollWidth/clientWidth 等几何度量恒为 0 或视口默认值。
 * 因此"无横向滚动"与"控件完整可视"无法用几何断言直接验证，
 * 本文件采用四层混合策略验证同一契约：
 *
 * 1. CSS 源码断言（jsdom 下稳健）：经 Vite `?raw` 导入
 *    src/styles/responsive.css 源码，断言 Req 11.2/11.3 赖以成立的全局规则
 *    真实存在——通用 border-box、html/body/#app overflow-x 防护链、
 *    媒体元素 max-width:100%、body min-width:320px 需求基线、≤480px 紧凑
 *    断点、orientation:landscape 横屏规则、刘海屏安全区与触摸默认行为；
 * 2. SFC 样式静态分析：经 `?raw` 导入五个页面与五个题型组件源码，
 *    解析 <style> 中全部固定 px 的 width/min-width 声明，断言没有任何
 *    超过 320px 基线的固定宽（超宽固定宽是 320px 视口横向溢出的结构性
 *    来源）；并断言页面根容器带 overflow-x 防护（或声明 border-box 交由
 *    全局防护链兜底）、组件根容器使用流式模式（width:100% / flex-wrap /
 *    max-width 上限）。
 *    白名单（记录在案）：NumericKeypad 根 max-width:320px 恰好等于 320px
 *    视口宽，配合 width:100% 与全局 border-box 在 320px 起不溢出；
 *    各 max-width:320~720px 为"上限约束"而非固定宽，容器随视口收缩，
 *    静态分析只检查 width/min-width、不检查 max-width；
 * 3. 多视口挂载冒烟（控件完整可视的代理断言）：在 320×568 / 768×1024 /
 *    1440×900 / 568×320（手机横屏）四种视口下挂载 ChoicePad、NumericKeypad、
 *    DragMatch 与首页（经 setSharedAppState 注入内存存储 App_State），
 *    断言全部主控件（选项、按键、槽位与备选区、今日冒险大按钮、学科与
 *    宝箱/小岛入口）渲染在 DOM 中且无 hidden 属性、内联样式非 display:none
 *    ——元素存在且非隐藏即"完整可视"在 jsdom 下的可验证代理；
 *    视口经 Object.defineProperty 改写 window.innerWidth/innerHeight 并
 *    派发 resize 事件模拟；
 * 4. resize 状态保持（Req 11.5）：首页与练习页挂载后依次切换四种视口，
 *    断言 appState.session/wallet 引用不变（布局自适应纯由 CSS 媒体查询
 *    承担，不注册任何 resize/orientationchange 状态处理器），首页星星余额、
 *    练习页连胜计数与"第 X 组第 Y 题"展示保持不变。
 *
 * _Requirements: 11.2, 11.3, 11.5_
 */

// node:fs 的 ambient 声明位于 src/env.d.ts（项目未安装 @types/node）
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { routes } from '@/router';
import { createAppState, setSharedAppState, type AppState } from '@/stores/appState';
import { createMemoryStorage } from '@/data/localStore';
import type { AudioService } from '@/services/audioService';
import type { QuestionOption } from '@/types';

import ChoicePad from '@/components/question/ChoicePad.vue';
import NumericKeypad from '@/components/question/NumericKeypad.vue';
import DragMatch from '@/components/question/DragMatch.vue';
import HomePage from '@/pages/HomePage.vue';
import PracticePage from '@/pages/PracticePage.vue';

// 练习页渲染听写卡/单词卡时组件缺省回退到共享 audioService：
// 以静音实现替换，避免 jsdom 的 HTMLMediaElement not-implemented 噪音
// （本文件不断言音频行为，音频契约由 questionComponents.spec.ts 覆盖）
vi.mock('@/services/audioService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/audioService')>();
  return {
    ...original,
    audioService: {
      playEffect: () => Promise.resolve(),
      playPronunciation: () => Promise.resolve(),
      speakText: () => Promise.resolve(),
      stopAll: () => undefined,
      isEffectAvailable: () => false,
    },
  };
});

// 全局响应式基础样式源码：`.css?raw` 会被 Vitest 的 CSS 处理管线吞掉（返回空串），
// 故改经 node:fs 直读文件内容（Vitest 运行于 Node，fs 可用；工作目录即项目根，
// import.meta.url 在 jsdom 环境下指向 http 源而非 file:，不能用 fileURLToPath）
const responsiveCss: string = readFileSync('src/styles/responsive.css', 'utf-8');

// ?raw 源码导入：SFC <style> 静态分析用
import homePageSource from '@/pages/HomePage.vue?raw';
import subjectPageSource from '@/pages/SubjectPage.vue?raw';
import practicePageSource from '@/pages/PracticePage.vue?raw';
import boxPageSource from '@/pages/BoxPage.vue?raw';
import islandPageSource from '@/pages/IslandPage.vue?raw';
import choicePadSource from '@/components/question/ChoicePad.vue?raw';
import numericKeypadSource from '@/components/question/NumericKeypad.vue?raw';
import dragMatchSource from '@/components/question/DragMatch.vue?raw';
import wordCardSource from '@/components/question/WordCard.vue?raw';
import dictationCardSource from '@/components/question/DictationCard.vue?raw';

// ============ 视口模拟 ============

const ORIGINAL_INNER_WIDTH = window.innerWidth;
const ORIGINAL_INNER_HEIGHT = window.innerHeight;

/** jsdom 视口模拟：改写 innerWidth/innerHeight 并派发 resize 事件 */
function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: height,
  });
  window.dispatchEvent(new Event('resize'));
}

/** 需求基线 / 平板 / 桌面 / 手机横屏代表视口 */
const VIEWPORTS = [
  { label: '手机竖屏 320×568（需求基线）', width: 320, height: 568 },
  { label: '平板竖屏 768×1024', width: 768, height: 1024 },
  { label: '桌面 1440×900', width: 1440, height: 900 },
  { label: '手机横屏 568×320', width: 568, height: 320 },
] as const;

afterEach(() => {
  // 复位视口与共享 App_State，避免跨用例污染
  setViewport(ORIGINAL_INNER_WIDTH, ORIGINAL_INNER_HEIGHT);
  setSharedAppState(null);
});

// ============ CSS 静态分析辅助 ============

/** 提取 SFC 全部 <style> 块的 CSS 文本 */
function extractCss(sfcSource: string): string {
  return [...sfcSource.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n');
}

/** 提取某选择器的全部规则体（不匹配 xxx--modifier / xxx-suffix / xxx__child 变体） */
function cssRuleBodies(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ruleRe = new RegExp(`${escaped}(?![\\w-])[^{}]*\\{([^{}]*)\\}`, 'g');
  return [...css.matchAll(ruleRe)].map((m) => m[1]).join('\n');
}

interface WidthDeclaration {
  selector: string;
  prop: 'width' | 'min-width';
  value: number;
}

/**
 * 解析 CSS 中全部固定 px 的 width / min-width 声明。
 * 不解析 max-width——上限约束只收缩容器，不造成横向溢出（见白名单说明）。
 */
function findFixedWidthDeclarations(css: string): WidthDeclaration[] {
  const out: WidthDeclaration[] = [];
  for (const rule of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim();
    const body = rule[2];
    for (const d of body.matchAll(/(?<![-\w])width\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      out.push({ selector, prop: 'width', value: Number(d[1]) });
    }
    for (const d of body.matchAll(/(?<![-\w])min-width\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      out.push({ selector, prop: 'min-width', value: Number(d[1]) });
    }
  }
  return out;
}

/** 页面与题型组件的 SFC 源码清单（静态分析对象） */
const SFC_SOURCES = [
  { name: 'HomePage（首页）', source: homePageSource },
  { name: 'SubjectPage（学科页）', source: subjectPageSource },
  { name: 'PracticePage（练习页，含小组/关卡结算弹层）', source: practicePageSource },
  { name: 'BoxPage（宝箱页）', source: boxPageSource },
  { name: 'IslandPage（小岛页）', source: islandPageSource },
  { name: 'ChoicePad（点选组件）', source: choicePadSource },
  { name: 'NumericKeypad（数字键盘）', source: numericKeypadSource },
  { name: 'DragMatch（拖拽配对）', source: dragMatchSource },
  { name: 'WordCard（单词卡）', source: wordCardSource },
  { name: 'DictationCard（听写卡）', source: dictationCardSource },
] as const;

// ============ 挂载辅助 ============

/** 静音 Audio_Service（注入 App_State，避免 jsdom 媒体告警干扰） */
const silentAudio: AudioService = {
  playEffect: () => Promise.resolve(),
  playPronunciation: () => Promise.resolve(),
  speakText: () => Promise.resolve(),
  stopAll: () => undefined,
  isEffectAvailable: () => false,
};

/** 以内存存储创建 App_State 并挂载首页（返回共享状态供状态断言） */
async function mountHomePage(): Promise<{ wrapper: VueWrapper; state: AppState }> {
  const state = createAppState({ storage: createMemoryStorage(), audio: silentAudio });
  setSharedAppState(state);
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/');
  await router.isReady();
  const wrapper = mount(HomePage, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, state };
}

/** 控件完整可视代理断言：元素存在于 DOM、无 hidden 属性、内联样式非 display:none */
function expectControlVisible(el: DOMWrapper<Element>, label: string): void {
  expect(el.exists(), `${label} 应渲染在 DOM 中`).toBe(true);
  expect(el.attributes('hidden'), `${label} 不应携带 hidden 属性`).toBeUndefined();
  const inlineStyle = (el.attributes('style') ?? '').replace(/\s+/g, '');
  expect(inlineStyle, `${label} 不应内联 display:none`).not.toContain('display:none');
}

/** 按选择器查找并做完整可视代理断言 */
function expectVisibleBySelector(wrapper: VueWrapper, selector: string): void {
  expectControlVisible(wrapper.find(selector), selector);
}

// ============ 1. 全局响应式基础样式源码断言 ============

describe('全局响应式基础样式 responsive.css 源码断言（Req 11.2/11.3）', () => {
  it('通用盒模型：*, *::before, *::after 统一 border-box（width:100%+padding 不溢出）', () => {
    expect(responsiveCss).toMatch(/\*[^{}]*\{[^{}]*box-sizing:\s*border-box/);
  });

  it('横向滚动防护链：html / body / #app 均声明 overflow-x: hidden（Req 11.2）', () => {
    expect(cssRuleBodies(responsiveCss, 'html')).toMatch(/overflow-x:\s*hidden/);
    expect(cssRuleBodies(responsiveCss, 'body')).toMatch(/overflow-x:\s*hidden/);
    expect(cssRuleBodies(responsiveCss, '#app')).toMatch(/overflow-x:\s*hidden/);
  });

  it('需求基线：body 声明 min-width: 320px（支持 320px 及以上宽度，Req 11.2）', () => {
    expect(cssRuleBodies(responsiveCss, 'body')).toMatch(/min-width:\s*320px/);
  });

  it('媒体元素守卫：img/video/canvas/audio/svg 声明 max-width: 100%（Req 11.2/11.3）', () => {
    expect(cssRuleBodies(responsiveCss, 'img')).toMatch(/max-width:\s*100%/);
  });

  it('断点与横屏：含 ≤480px 紧凑断点与 orientation: landscape 横屏规则（Req 11.5）', () => {
    expect(responsiveCss).toContain('@media (max-width: 480px)');
    expect(responsiveCss).toMatch(/@media\s*\(orientation:\s*landscape\)/);
  });

  it('刘海屏安全区与触摸默认行为（Req 11.3/11.4）', () => {
    expect(responsiveCss).toContain('env(safe-area-inset-bottom');
    expect(responsiveCss).toContain('touch-action: manipulation');
  });

  it('五个页面均被 #app 前缀的全局规则覆盖（安全区/横向防护，Req 11.2/11.3）', () => {
    for (const pageClass of [
      '.home-page',
      '.subject-page',
      '.practice-page',
      '.box-page',
      '.island-page',
    ]) {
      expect(responsiveCss, `#app ${pageClass} 规则应存在`).toContain(`#app ${pageClass}`);
    }
  });
});

// ============ 2. SFC 样式静态分析 ============

describe('页面/组件 SFC 样式静态分析：320px 基线无结构性横向溢出（Req 11.2/11.3）', () => {
  for (const { name, source } of SFC_SOURCES) {
    it(`${name} 无超过 320px 的固定 width/min-width px 声明`, () => {
      const offenders = findFixedWidthDeclarations(extractCss(source)).filter(
        (d) => d.value > 320,
      );
      expect(offenders, `${name} 存在超宽固定宽声明：${JSON.stringify(offenders)}`).toEqual([]);
    });

    it(`${name} 使用流式/自适应布局模式（max-width 上限 / flex-wrap / width:100% / 断点）`, () => {
      expect(extractCss(source), `${name} 应使用流式或自适应布局模式`).toMatch(
        /max-width\s*:|flex-wrap|width\s*:\s*100%|minmax|auto-fill|@media/,
      );
    });
  }

  it('全局样式自身同样无超过 320px 的固定 width/min-width px 声明', () => {
    const offenders = findFixedWidthDeclarations(responsiveCss).filter((d) => d.value > 320);
    expect(offenders, `responsive.css 存在超宽固定宽声明：${JSON.stringify(offenders)}`).toEqual(
      [],
    );
  });

  it('白名单（记录在案）：NumericKeypad 根 width:100% + max-width:320px，恰好容纳 320px 视口', () => {
    const bodies = cssRuleBodies(extractCss(numericKeypadSource), '.numeric-keypad');
    expect(bodies).toMatch(/width:\s*100%/);
    expect(bodies).toMatch(/max-width:\s*320px/);
    // 320px ≤ 320px 视口宽：配合全局 border-box 与 margin-inline:auto，需求基线上不溢出
  });

  // 页面根容器横向防护：home/subject/practice 自带 overflow-x:hidden；
  // box/island 声明 border-box，横向溢出由全局 html/body/#app 防护链兜底
  // （防护链存在性已在上一 describe 断言）
  const PAGE_ROOT_GUARDS = [
    { name: 'HomePage', source: homePageSource, root: '.home-page', ownGuard: true },
    { name: 'SubjectPage', source: subjectPageSource, root: '.subject-page', ownGuard: true },
    { name: 'PracticePage', source: practicePageSource, root: '.practice-page', ownGuard: true },
    { name: 'BoxPage', source: boxPageSource, root: '.box-page', ownGuard: false },
    { name: 'IslandPage', source: islandPageSource, root: '.island-page', ownGuard: false },
  ] as const;

  for (const { name, source, root, ownGuard } of PAGE_ROOT_GUARDS) {
    it(`${name} 根容器${ownGuard ? '自带 overflow-x: hidden 防护' : '声明 border-box（交由全局防护链兜底）'}`, () => {
      const bodies = cssRuleBodies(extractCss(source), root);
      expect(bodies, `${root} 应存在样式规则`).not.toBe('');
      if (ownGuard) {
        expect(bodies).toMatch(/overflow-x:\s*hidden/);
      } else {
        expect(bodies).toMatch(/box-sizing:\s*border-box/);
      }
    });
  }

  // 题型组件根容器流式模式（320px 起不溢出的布局手段）
  const COMPONENT_ROOT_FLUID = [
    {
      name: 'ChoicePad',
      source: choicePadSource,
      root: '.choice-pad',
      pattern: /flex-wrap:\s*wrap/,
    },
    {
      name: 'DragMatch',
      source: dragMatchSource,
      root: '.drag-match',
      pattern: /width:\s*100%/,
    },
    {
      name: 'NumericKeypad',
      source: numericKeypadSource,
      root: '.numeric-keypad',
      pattern: /max-width:\s*320px/,
    },
    { name: 'WordCard', source: wordCardSource, root: '.word-card', pattern: /width:\s*100%/ },
    {
      name: 'DictationCard',
      source: dictationCardSource,
      root: '.dictation-card',
      pattern: /width:\s*100%/,
    },
  ] as const;

  for (const { name, source, root, pattern } of COMPONENT_ROOT_FLUID) {
    it(`${name} 根容器为流式布局（${root} 匹配 ${pattern.source}）`, () => {
      const bodies = cssRuleBodies(extractCss(source), root);
      expect(bodies, `${root} 应存在样式规则`).not.toBe('');
      expect(bodies).toMatch(pattern);
    });
  }
});

// ============ 3. 多视口挂载冒烟 ============

const SMOKE_OPTIONS: QuestionOption[] = [
  { id: 'a', text: 'róng qiú' },
  { id: 'b', text: 'yóng qiú' },
  { id: 'c', text: 'róng qíu' },
  { id: 'd', text: 'róng jiú' },
];

const SMOKE_DRAG_TARGETS: QuestionOption[] = [
  { id: 't1', text: '＿扬' },
  { id: 't2', text: '＿亮' },
];

/** 含一个干扰项（数量多于目标槽） */
const SMOKE_DRAG_CHOICES: QuestionOption[] = [
  { id: 'a', text: '飘' },
  { id: 'b', text: '漂' },
  { id: 'c', text: '荡' },
];

describe('多视口挂载冒烟：答题控件与首页主控件完整渲染（Req 11.3）', () => {
  for (const viewport of VIEWPORTS) {
    it(`${viewport.label}：选项/按键/槽位/入口全部渲染且非隐藏`, async () => {
      setViewport(viewport.width, viewport.height);
      expect(window.innerWidth).toBe(viewport.width);
      expect(window.innerHeight).toBe(viewport.height);

      // ChoicePad：全部选项按钮完整渲染
      const choicePad = mount(ChoicePad, { props: { options: SMOKE_OPTIONS } });
      const options = choicePad.findAll('button.choice-pad__option');
      expect(options).toHaveLength(4);
      options.forEach((o) => expectControlVisible(o, '选项按钮'));
      choicePad.unmount();

      // NumericKeypad：9 数字键 + 0 + 小数点 + 退格 + 确认 = 13 键
      const keypad = mount(NumericKeypad);
      const keys = keypad.findAll('button.numeric-keypad__key');
      expect(keys).toHaveLength(13);
      keys.forEach((k) => expectControlVisible(k, '键盘按键'));
      keypad.unmount();

      // DragMatch：目标槽 + 备选区 chips 完整渲染
      const dragMatch = mount(DragMatch, {
        props: { targets: SMOKE_DRAG_TARGETS, choices: SMOKE_DRAG_CHOICES },
      });
      const slots = dragMatch.findAll('button.slot');
      const chips = dragMatch.findAll('button.chip-in-tray');
      expect(slots).toHaveLength(2);
      expect(chips).toHaveLength(3);
      slots.forEach((s) => expectControlVisible(s, '目标槽'));
      chips.forEach((c) => expectControlVisible(c, '备选选项'));
      dragMatch.unmount();

      // 首页：今日冒险大按钮、音效开关、三科入口、宝箱/小岛入口、星星余额
      const { wrapper: home } = await mountHomePage();
      expectVisibleBySelector(home, 'button.adventure-button');
      expectVisibleBySelector(home, 'button.sound-toggle');
      expectVisibleBySelector(home, '.star-balance__count');
      const subjectEntries = home.findAll('.subject-entry');
      const extraEntries = home.findAll('.extra-entry');
      expect(subjectEntries).toHaveLength(3);
      expect(extraEntries).toHaveLength(2);
      subjectEntries.forEach((e) => expectControlVisible(e, '学科入口'));
      extraEntries.forEach((e) => expectControlVisible(e, '宝箱/小岛入口'));
      home.unmount();
    });
  }
});

// ============ 4. resize 状态保持（Req 11.5） ============

describe('视口变化时状态保持（Req 11.5）', () => {
  it('resize 后 App_State 会话/钱包引用不变，首页星星余额与主按钮展示不变', async () => {
    const { wrapper: home, state } = await mountHomePage();
    state.addStars(35);
    const start = state.startAdventure();
    expect(start.kind).toBe('ready');
    await flushPromises();

    // 以当前（种子加载与 refreshSession 后）引用为基准：
    // 布局自适应纯由 CSS 承担，resize 不应触碰任何状态
    const sessionRef = state.session.value;
    const walletRef = state.wallet.value;
    expect(sessionRef).not.toBeNull();
    expect(home.find('.star-balance__count').text()).toBe('35');

    for (const viewport of VIEWPORTS) {
      setViewport(viewport.width, viewport.height);
      await nextTick();
      expect(state.session.value, `${viewport.label} 后会话引用被改动`).toBe(sessionRef);
      expect(state.wallet.value, `${viewport.label} 后钱包引用被改动`).toBe(walletRef);
      expect(home.find('.star-balance__count').text(), `${viewport.label} 后星星余额展示`).toBe(
        '35',
      );
      expectVisibleBySelector(home, 'button.adventure-button');
    }
    home.unmount();
  });

  it('横竖屏切换后练习页连胜计数与"第 X 组第 Y 题"展示保持不变', async () => {
    const state = createAppState({ storage: createMemoryStorage(), audio: silentAudio });
    setSharedAppState(state);
    const start = state.startAdventure();
    expect(start.kind).toBe('ready');

    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/practice');
    await router.isReady();
    const practice = mount(PracticePage, { global: { plugins: [router] } });
    await flushPromises();

    const sessionRef = state.session.value;
    const streakBefore = practice.find('[data-testid="streak"]').text();
    const progressBefore = practice.find('[data-testid="progress"]').text();
    expect(streakBefore).toContain('连胜 0');
    expect(progressBefore).toContain('第 1 组');

    for (const viewport of VIEWPORTS) {
      setViewport(viewport.width, viewport.height);
      await nextTick();
      expect(state.session.value, `${viewport.label} 后会话引用被改动`).toBe(sessionRef);
      expect(practice.find('[data-testid="streak"]').text(), `${viewport.label} 后连胜展示`).toBe(
        streakBefore,
      );
      expect(
        practice.find('[data-testid="progress"]').text(),
        `${viewport.label} 后进度展示`,
      ).toBe(progressBefore);
    }
    practice.unmount();
  });
});
