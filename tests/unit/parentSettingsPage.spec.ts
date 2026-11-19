/**
 * ParentSettingsPage 组件单元测试（child-grade-setting 任务 6.2）
 *
 * 覆盖 /parent-settings 页面两步状态机（gate → picker）的组件行为：
 *
 * 1. 挂载后仅展示家长确认门禁、DOM 中无任何年级选项（Req 1.2）；
 * 2. 答对门禁进入年级选择界面（Req 1.2）；
 * 3. 答错显示错误提示、自动更换新题、停留门禁且 Local_Store 中 childGrade
 *    不变（Req 1.3）；
 * 4. 取消直接返回首页且 childGrade 存储不变（Req 1.3）；
 * 5. 6 个年级按钮按一年级至六年级固定升序，每个触控区域 ≥44×44px（Req 1.4）；
 * 6. 未设置时全部未选中、保存按钮禁用且显示未设置提示（Req 1.5、1.8）；
 * 7. 已设置时当前年级按钮带差异化标记（颜色 + ✓ 图标；参数化抽查 1/4/6
 *    年级，Req 1.9）；
 * 8. 选择保存后 Local_Store 值与"当前设置"展示一致并展示"自明天起生效"
 *    说明（Req 1.6、3.5）；
 * 9. 已设置后重新选择保存覆盖原值（Req 1.7）。
 *
 * 测试定盘：组件 rand 属性注入序列随机源（() => 0 → a=12、b=12、answer=24；
 * 0.5 → a=31、b=31、answer=62），门禁挑战与"答错换新题"均可确定性断言。
 * App_State 经 createAppState({storage: createMemoryStorage()}) 创建并
 * setSharedAppState 注入（与 tests/unit/pages.spec.ts 同一约定）；childGrade
 * 预置经 createLocalStore({storage}).write('childGrade', g)，断言经
 * state.store.read('childGrade') 读回。
 *
 * 44×44px 触控区域验证方法（Req 1.4）：与 tests/unit/questionComponents.spec.ts、
 * pages.spec.ts 同一两层断言——(1) 渲染出的年级按钮携带约定 class；
 * (2) 经 Vite `?raw` 导入 SFC 源码，解析 <style> 中 .ps-grade-btn 规则的
 * min-width / min-height px 声明，断言均 ≥44px。辅助函数 cssRuleBodies /
 * declaredPx / expectMinTouchTarget 复制自 questionComponents.spec.ts（同源同口径）。
 *
 * _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 3.5_
 */

import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import ParentSettingsPage from '@/pages/ParentSettingsPage.vue';

// SFC 源码（?raw 导入），用于解析 scoped CSS 中的触控区域声明
import parentSettingsPageSource from '@/pages/ParentSettingsPage.vue?raw';

import { createAppState, setSharedAppState, type AppState } from '@/stores/appState';
import {
  createLocalStore,
  createMemoryStorage,
  type StorageLike,
} from '@/data/localStore';
import type { AudioService } from '@/services/audioService';

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

/** 断言某 class 的规则同时声明 min-width 与 min-height 且均 ≥44px（Req 1.4） */
function expectMinTouchTarget(sfcSource: string, classSelector: string): void {
  const bodies = cssRuleBodies(sfcSource, classSelector);
  expect(bodies, `${classSelector} 应存在样式规则`).not.toBe('');
  for (const prop of ['min-width', 'min-height'] as const) {
    const px = declaredPx(bodies, prop);
    expect(px, `${classSelector} 应声明 ${prop}`).not.toBeNull();
    expect(px as number, `${classSelector} 的 ${prop} 应 ≥44px`).toBeGreaterThanOrEqual(44);
  }
}

// ============ 公共测试辅助 ============

/** 静音 Audio_Service（注入 App_State，避免 jsdom 媒体告警干扰；本页不断言音频行为） */
const silentAudio: AudioService = {
  playEffect: () => Promise.resolve(),
  playPronunciation: () => Promise.resolve(),
  speakText: () => Promise.resolve(),
  stopAll: () => undefined,
  isEffectAvailable: () => false,
};

/**
 * 序列随机源：依次吐出给定值，用尽后重复最后一个值。
 * 门禁挑战每次消耗两个随机数（a、b 各一），归一化映射：
 * 0 → 操作数 12；0.5 → 操作数 31（12 + floor(0.5 × 38)）。
 */
function sequenceRand(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

/** 默认定盘随机源：挑战恒为 12 + 12 = 24 */
const DEFAULT_RAND = () => 0;

/** 默认挑战答案（rand = () => 0 时 a=12、b=12） */
const DEFAULT_ANSWER = '24';

/** 年级中文标签（与组件 gradeLabel 一致） */
const GRADE_LABELS = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'] as const;

/** 测试路由：与 src/router/index.ts 同路径骨架，组件以空桩替代（页面本体直接挂载） */
function createTestRouter(): Router {
  const stub = { template: '<div />' };
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: stub },
      { path: '/parent-settings', name: 'parent-settings', component: stub },
    ],
  });
}

interface MountOptions {
  /** 预置孩子年级（模拟此前已设置并关闭浏览器后重开）；缺省为未设置 */
  seedGrade?: number;
  /** 注入组件的随机源（挑战定盘）；缺省恒 0（挑战 12 + 12 = 24） */
  rand?: () => number;
}

interface Mounted {
  wrapper: VueWrapper;
  router: Router;
  state: AppState;
  storage: StorageLike;
}

/** 创建内存存储 App_State 并注入共享实例，挂载 ParentSettingsPage */
async function mountParentSettingsPage(options: MountOptions = {}): Promise<Mounted> {
  const storage = createMemoryStorage();
  if (options.seedGrade !== undefined) {
    // 模拟家长此前设置并关闭浏览器：同一底层存储上预置 childGrade
    createLocalStore({ storage }).write('childGrade', options.seedGrade);
  }
  const state = createAppState({ storage, audio: silentAudio });
  setSharedAppState(state);

  const router = createTestRouter();
  await router.push('/parent-settings');
  await router.isReady();
  const wrapper = mount(ParentSettingsPage, {
    props: { rand: options.rand ?? DEFAULT_RAND },
    global: { plugins: [router] },
  });
  await nextTick();
  return { wrapper, router, state, storage };
}

/** 输入答案并点击确认，完成家长确认进入年级选择 */
async function answerGate(wrapper: VueWrapper, answer: string): Promise<void> {
  await wrapper.find('[data-testid="gate-input"]').setValue(answer);
  await wrapper.find('[data-testid="gate-confirm"]').trigger('click');
  await nextTick();
}

/** 以默认定盘答案通过门禁（12 + 12 = 24） */
async function passGate(wrapper: VueWrapper): Promise<void> {
  await answerGate(wrapper, DEFAULT_ANSWER);
}

afterEach(() => {
  setSharedAppState(null);
});

// ============ 门禁步骤（Req 1.2、1.3） ============

describe('家长确认门禁（Req 1.2、1.3）', () => {
  it('挂载后仅展示门禁，DOM 中无任何年级选项（Req 1.2）', async () => {
    const { wrapper } = await mountParentSettingsPage();

    // 仅门禁卡可见
    expect(wrapper.find('[data-testid="parent-gate"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="gate-challenge"]').text()).toContain(
      '请家长回答：12 + 12 = ?',
    );
    expect(wrapper.find('[data-testid="gate-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="gate-confirm"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="gate-cancel"]').exists()).toBe(true);

    // 不渲染任何年级选项：picker 容器、年级按钮、data-grade 属性、年级文案均缺席
    expect(wrapper.find('[data-testid="grade-picker"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="grade-option"]')).toHaveLength(0);
    expect(wrapper.findAll('[data-grade]')).toHaveLength(0);
    for (const label of GRADE_LABELS) {
      expect(wrapper.text()).not.toContain(label);
    }
  });

  it('答对门禁进入年级选择界面（Req 1.2）', async () => {
    const { wrapper } = await mountParentSettingsPage();

    await passGate(wrapper);

    expect(wrapper.find('[data-testid="parent-gate"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="grade-picker"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="grade-option"]')).toHaveLength(6);
  });

  it('答错显示错误提示、更换新题、停留门禁且 childGrade 存储不变（Req 1.3）', async () => {
    // 序列随机源：首题 12 + 12 = 24，答错后新题 31 + 31 = 62
    const { wrapper, state } = await mountParentSettingsPage({
      seedGrade: 4,
      rand: sequenceRand([0, 0, 0.5, 0.5]),
    });
    const challengeBefore = wrapper.find('[data-testid="gate-challenge"]').text();
    expect(challengeBefore).toContain('12 + 12');

    await answerGate(wrapper, '1');

    // 错误提示可见
    const error = wrapper.find('[data-testid="gate-error"]');
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain('回答不正确，请再试一次');
    // 自动更换新题
    const challengeAfter = wrapper.find('[data-testid="gate-challenge"]').text();
    expect(challengeAfter).not.toBe(challengeBefore);
    expect(challengeAfter).toContain('31 + 31');
    // 输入框已清空
    expect(
      (wrapper.find('[data-testid="gate-input"]').element as HTMLInputElement).value,
    ).toBe('');
    // 停留门禁：不展示年级选择
    expect(wrapper.find('[data-testid="parent-gate"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="grade-picker"]').exists()).toBe(false);
    // childGrade 存储与响应式引用均不变
    expect(state.store.read('childGrade')).toBe(4);
    expect(state.childGrade.value).toBe(4);
  });

  it('取消返回首页且 childGrade 存储不变（Req 1.3）', async () => {
    const { wrapper, router, state } = await mountParentSettingsPage({ seedGrade: 3 });
    expect(router.currentRoute.value.path).toBe('/parent-settings');

    await wrapper.find('[data-testid="gate-cancel"]').trigger('click');
    await flushPromises();

    // 返回首页，未展示年级选择界面
    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.find('[data-testid="grade-picker"]').exists()).toBe(false);
    // childGrade 存储与响应式引用均不变
    expect(state.store.read('childGrade')).toBe(3);
    expect(state.childGrade.value).toBe(3);
  });
});

// ============ 年级选择界面（Req 1.4-1.9、3.5） ============

describe('孩子年级设置界面（Req 1.4-1.9、3.5）', () => {
  it('6 个年级按钮按一年级至六年级升序，每个触控区域 ≥44×44px（Req 1.4）', async () => {
    const { wrapper } = await mountParentSettingsPage();
    await passGate(wrapper);

    const options = wrapper.findAll('[data-testid="grade-option"]');
    expect(options).toHaveLength(6);
    // 固定升序：data-grade 依次为 1..6，文案依次为一年级..六年级
    options.forEach((option, index) => {
      expect(option.attributes('data-grade')).toBe(String(index + 1));
      expect(option.text()).toContain(GRADE_LABELS[index]);
      // 渲染出的按钮携带约定 class（触控尺寸声明的挂载点）
      expect(option.classes()).toContain('ps-grade-btn');
    });

    // SFC 样式静态断言：.ps-grade-btn 声明 min-width 与 min-height 且均 ≥44px
    expectMinTouchTarget(parentSettingsPageSource, '.ps-grade-btn');
  });

  it('未设置时全部未选中、保存禁用且显示未设置提示（Req 1.5、1.8）', async () => {
    const { wrapper, state } = await mountParentSettingsPage();
    expect(state.childGrade.value).toBeNull();
    await passGate(wrapper);

    // 未设置提示可见（Req 1.8），"当前设置"展示缺席
    const hint = wrapper.find('[data-testid="unset-hint"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain('还未设置孩子年级');
    expect(wrapper.find('[data-testid="current-setting"]').exists()).toBe(false);

    // 全部 6 个选项均未选中、无当前设置标记（Req 1.5）
    const options = wrapper.findAll('[data-testid="grade-option"]');
    expect(options).toHaveLength(6);
    for (const option of options) {
      expect(option.classes()).not.toContain('ps-grade-btn--selected');
      expect(option.classes()).not.toContain('ps-grade-btn--current');
    }
    expect(wrapper.findAll('[data-testid="current-grade-mark"]')).toHaveLength(0);

    // 选择前保存按钮禁用（Req 1.5：不提供可触发的保存确认操作）
    expect(
      wrapper.find('[data-testid="save-grade"]').attributes('disabled'),
    ).toBeDefined();
  });

  it.each([1, 4, 6])(
    '已设置 childGrade=%i 时当前年级按钮带差异化标记（Req 1.9）',
    async (grade) => {
      const { wrapper } = await mountParentSettingsPage({ seedGrade: grade });
      await passGate(wrapper);

      // "当前设置"展示与存储一致
      expect(wrapper.find('[data-testid="current-setting"]').text()).toContain(
        `当前设置：${GRADE_LABELS[grade - 1]}`,
      );

      // 恰好当前年级一个按钮带差异化 class 与 ✓ 标记，其余按钮均不带
      const currentOptions = wrapper
        .findAll('[data-testid="grade-option"]')
        .filter((option) => option.classes().includes('ps-grade-btn--current'));
      expect(currentOptions).toHaveLength(1);
      expect(currentOptions[0].attributes('data-grade')).toBe(String(grade));
      expect(currentOptions[0].find('[data-testid="current-grade-mark"]').exists()).toBe(
        true,
      );
      expect(currentOptions[0].text()).toContain('✓');
      expect(wrapper.findAll('[data-testid="current-grade-mark"]')).toHaveLength(1);
    },
  );

  it('选择保存后存储值与"当前设置"展示一致并展示"自明天起生效"说明（Req 1.6、3.5）', async () => {
    const { wrapper, state } = await mountParentSettingsPage();
    await passGate(wrapper);

    await wrapper.find('[data-grade="3"]').trigger('click');
    await wrapper.find('[data-testid="save-grade"]').trigger('click');
    await nextTick();

    // Local_Store 持久化值与响应式引用一致
    expect(state.store.read('childGrade')).toBe(3);
    expect(state.childGrade.value).toBe(3);
    // "当前设置"展示与存储值一致，未设置提示消失
    expect(wrapper.find('[data-testid="current-setting"]').text()).toContain(
      '当前设置：三年级',
    );
    expect(wrapper.find('[data-testid="unset-hint"]').exists()).toBe(false);
    // "自明天起生效"说明可见（Req 3.5）
    const note = wrapper.find('[data-testid="save-effect-note"]');
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain('自明天起');
    // 保存后当前年级标记落在三年级按钮上
    const current = wrapper.find('[data-grade="3"]');
    expect(current.classes()).toContain('ps-grade-btn--current');
    expect(current.find('[data-testid="current-grade-mark"]').exists()).toBe(true);
  });

  it('已设置后重新选择保存覆盖原值（Req 1.7）', async () => {
    const { wrapper, state } = await mountParentSettingsPage({ seedGrade: 2 });
    await passGate(wrapper);
    // 非平凡性前置：进入时当前设置为二年级
    expect(wrapper.find('[data-testid="current-setting"]').text()).toContain(
      '当前设置：二年级',
    );

    await wrapper.find('[data-grade="5"]').trigger('click');
    await wrapper.find('[data-testid="save-grade"]').trigger('click');
    await nextTick();

    // 新值覆盖原值：存储、引用与展示均为五年级
    expect(state.store.read('childGrade')).toBe(5);
    expect(state.childGrade.value).toBe(5);
    expect(wrapper.find('[data-testid="current-setting"]').text()).toContain(
      '当前设置：五年级',
    );
    // 差异化标记移至五年级按钮，原二年级按钮不再带标记
    expect(wrapper.find('[data-grade="5"]').classes()).toContain('ps-grade-btn--current');
    expect(wrapper.find('[data-grade="2"]').classes()).not.toContain(
      'ps-grade-btn--current',
    );
    expect(wrapper.findAll('[data-testid="current-grade-mark"]')).toHaveLength(1);
    // 生效说明可见
    expect(wrapper.find('[data-testid="save-effect-note"]').exists()).toBe(true);
  });
});
