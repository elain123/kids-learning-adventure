/**
 * 题型交互组件单元测试（任务 12.6）
 *
 * 覆盖五个题型交互组件：ChoicePad / DragMatch / NumericKeypad / WordCard / DictationCard。
 * - ChoicePad：渲染全部选项、点选 emit select 并高亮、disabled 锁定、图片选项渲染 img
 * - DragMatch：点按后备交互（tap fallback：点选项 → 点槽位）完成配对、填满自动提交
 *   pairs Record、点已填槽位取消分配、disabled 锁定、expose 的 reset()，
 *   以及基础 pointerdown/move/up 拖拽序列
 *   （jsdom 的 getBoundingClientRect 一律返回全 0 矩形，指针落在 (0,0) 即命中首个槽位）
 * - NumericKeypad：数字追加、单个小数点规则（空串点小数自动补 0）、退格、确认解析并
 *   归一化（"007"→7）、空/非法输入禁止确认、disabled 锁定、不渲染 input 元素
 *   （回显为纯文本，不唤起系统键盘）
 * - WordCard：挂载自动播放发音恰一次（Req 8.3）、重播按钮按次重播（Req 8.6）、
 *   音频失败显示提示且图片/拼写保留、选项仍可作答（Req 8.7）、
 *   answer 负载携带 correctOptionId
 * - DictationCard：挂载自动播放读音恰一次（Req 6.3）、重听不限次（Req 6.6）、
 *   点按字卡按序拼合、长度达标自动提交有序 id（judge 顺序判定规则）、
 *   点已填槽位取下字卡、音频失败提示且作答不受影响（Req 8.7）
 *
 * 44×44px 触控区域验证方法（Req 12.2）：jsdom 不应用 SFC scoped CSS，计算样式不可靠，
 * 故采用两层断言——(1) 渲染出的交互元素携带约定 class（元素与规则的连接）；
 * (2) 通过 Vite `?raw` 导入 SFC 源码，解析 <style> 中对应 class 规则的
 * min-width / min-height px 声明，断言均 ≥44px。
 *
 * 鼠标与触摸统一事件（Req 11.4）：组件作答路径全部经由 click 或 Pointer Events 触发，
 * 浏览器会把触摸转换为同一事件流，本文件的 click / pointer 事件序列即等价于触摸行为。
 *
 * _Requirements: 8.7, 11.4, 12.2_
 */

import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { Question, QuestionOption } from '@/types';
import ChoicePad from '@/components/question/ChoicePad.vue';
import DragMatch from '@/components/question/DragMatch.vue';
import NumericKeypad from '@/components/question/NumericKeypad.vue';
import WordCard from '@/components/question/WordCard.vue';
import DictationCard from '@/components/question/DictationCard.vue';
import { AudioPlaybackError, type AudioService } from '@/services/audioService';

// SFC 源码（?raw 导入），用于解析 scoped CSS 中的触控区域声明
import choicePadSource from '@/components/question/ChoicePad.vue?raw';
import dragMatchSource from '@/components/question/DragMatch.vue?raw';
import numericKeypadSource from '@/components/question/NumericKeypad.vue?raw';
import wordCardSource from '@/components/question/WordCard.vue?raw';
import dictationCardSource from '@/components/question/DictationCard.vue?raw';

// ============ 44×44px 触控区域断言辅助 ============

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

// ============ AudioService mock（WordCard / DictationCard 注入） ============

function createAudioMock(): AudioService {
  return {
    playEffect: vi.fn().mockResolvedValue(undefined),
    playPronunciation: vi.fn().mockResolvedValue(undefined),
    speakText: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn(),
    isEffectAvailable: vi.fn().mockReturnValue(true),
  };
}

// ============ ChoicePad ============

const TEXT_OPTIONS: QuestionOption[] = [
  { id: 'a', text: 'róng qiú' },
  { id: 'b', text: 'yóng qiú' },
  { id: 'c', text: 'róng qíu' },
  { id: 'd', text: 'róng jiú' },
];

describe('ChoicePad', () => {
  it('renders all options', () => {
    const wrapper = mount(ChoicePad, { props: { options: TEXT_OPTIONS } });
    const buttons = wrapper.findAll('button.choice-pad__option');
    expect(buttons).toHaveLength(4);
    expect(buttons.map((b) => b.text())).toEqual([
      'róng qiú',
      'yóng qiú',
      'róng qíu',
      'róng jiú',
    ]);
  });

  it('tap emits select with the option id and highlights the option', async () => {
    const wrapper = mount(ChoicePad, { props: { options: TEXT_OPTIONS } });
    const buttons = wrapper.findAll('button.choice-pad__option');
    await buttons[1].trigger('click');
    expect(wrapper.emitted('select')).toEqual([['b']]);
    expect(buttons[1].classes()).toContain('choice-pad__option--selected');
    expect(buttons[1].attributes('aria-selected')).toBe('true');
  });

  it('disabled blocks selection', async () => {
    const wrapper = mount(ChoicePad, { props: { options: TEXT_OPTIONS, disabled: true } });
    const button = wrapper.findAll('button.choice-pad__option')[0];
    expect(button.attributes('disabled')).toBeDefined();
    await button.trigger('click');
    expect(wrapper.emitted('select')).toBeUndefined();
    expect(button.classes()).not.toContain('choice-pad__option--selected');
  });

  it('renders img for image options', () => {
    const wrapper = mount(ChoicePad, {
      props: {
        options: [
          { id: 'a', image: 'img/en/g3/hello.png', text: 'hello' },
          { id: 'b', image: 'img/en/g3/goodbye.png' },
        ],
      },
    });
    const imgs = wrapper.findAll('img.choice-pad__image');
    expect(imgs).toHaveLength(2);
    expect(imgs[0].attributes('src')).toBe('img/en/g3/hello.png');
    expect(imgs[0].attributes('alt')).toBe('hello');
    expect(imgs[1].attributes('alt')).toBe(''); // 无文本选项 alt 为空串
  });

  it('touch target ≥44×44px: option buttons (Req 12.2)', () => {
    const wrapper = mount(ChoicePad, { props: { options: TEXT_OPTIONS } });
    expect(wrapper.find('button.choice-pad__option').exists()).toBe(true);
    expectMinTouchTarget(choicePadSource, '.choice-pad__option');
  });
});

// ============ DragMatch ============

const DRAG_TARGETS: QuestionOption[] = [
  { id: 't1', text: '＿扬' },
  { id: 't2', text: '＿亮' },
];

/** 含一个干扰项（数量多于目标槽） */
const DRAG_CHOICES: QuestionOption[] = [
  { id: 'a', text: '飘' },
  { id: 'b', text: '漂' },
  { id: 'c', text: '荡' },
];

function mountDragMatch(disabled = false): VueWrapper {
  return mount(DragMatch, {
    props: { targets: DRAG_TARGETS, choices: DRAG_CHOICES, disabled },
  });
}

function trayChipWith(wrapper: VueWrapper, text: string): DOMWrapper<Element> {
  const found = wrapper.findAll('button.chip-in-tray').find((c) => c.text() === text);
  if (!found) {
    throw new Error(`备选区未找到选项：${text}`);
  }
  return found;
}

/** 模拟点按：pointerdown + 同坐标 pointerup（位移小于 10px 点按阈值） */
async function tapChip(chip: DOMWrapper<Element>): Promise<void> {
  await chip.trigger('pointerdown', { clientX: 5, clientY: 5, pointerId: 1 });
  await chip.trigger('pointerup', { clientX: 5, clientY: 5, pointerId: 1 });
}

describe('DragMatch', () => {
  it('tap fallback: tap a choice then tap a slot assigns the pair', async () => {
    const wrapper = mountDragMatch();
    await tapChip(trayChipWith(wrapper, '飘'));
    expect(trayChipWith(wrapper, '飘').classes()).toContain('is-selected');
    await wrapper.findAll('button.slot')[0].trigger('click');
    const slot = wrapper.findAll('button.slot')[0];
    expect(slot.classes()).toContain('is-filled');
    expect(slot.text()).toContain('飘');
    expect(wrapper.emitted('submit')).toBeUndefined(); // 未填满不提交
  });

  it('auto-submits the pairs Record when all targets are filled', async () => {
    const wrapper = mountDragMatch();
    await tapChip(trayChipWith(wrapper, '飘'));
    await wrapper.findAll('button.slot')[0].trigger('click');
    await tapChip(trayChipWith(wrapper, '漂'));
    await wrapper.findAll('button.slot')[1].trigger('click');
    const submits = wrapper.emitted('submit');
    expect(submits).toHaveLength(1);
    expect(submits![0][0]).toEqual({ t1: 'a', t2: 'b' }); // 目标槽 id → 选项 id
  });

  it('tapping a filled slot unassigns the choice back to the tray', async () => {
    const wrapper = mountDragMatch();
    await tapChip(trayChipWith(wrapper, '飘'));
    await wrapper.findAll('button.slot')[0].trigger('click');
    expect(wrapper.findAll('button.slot')[0].classes()).toContain('is-filled');
    await wrapper.findAll('button.slot')[0].trigger('click');
    const slot = wrapper.findAll('button.slot')[0];
    expect(slot.classes()).not.toContain('is-filled');
    expect(slot.text()).toContain('拖到这里');
    expect(wrapper.findAll('button.chip-in-tray')).toHaveLength(3); // 选项回到备选区
  });

  it('disabled locks assignment', async () => {
    const wrapper = mountDragMatch(true);
    await tapChip(trayChipWith(wrapper, '飘'));
    expect(trayChipWith(wrapper, '飘').classes()).not.toContain('is-selected');
    await wrapper.findAll('button.slot')[0].trigger('click');
    expect(wrapper.findAll('button.slot')[0].classes()).not.toContain('is-filled');
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('basic pointer drag sequence drops the choice onto the hit slot', async () => {
    const wrapper = mountDragMatch();
    const chip = trayChipWith(wrapper, '飘');
    // jsdom 的 getBoundingClientRect 全部返回 0 矩形，指针落在 (0,0) 时命中第一个槽位
    await chip.trigger('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
    await chip.trigger('pointermove', { clientX: 0, clientY: 0, pointerId: 1 });
    // 位移 ≥10px → 进入拖拽态并显示拖拽幽灵，目标槽吸附高亮
    expect(wrapper.find('.drag-ghost').exists()).toBe(true);
    expect(wrapper.findAll('button.slot')[0].classes()).toContain('is-hover');
    await chip.trigger('pointerup', { clientX: 0, clientY: 0, pointerId: 1 });
    const firstSlot = wrapper.findAll('button.slot')[0];
    expect(firstSlot.classes()).toContain('is-filled');
    expect(firstSlot.text()).toContain('飘');
    expect(wrapper.find('.drag-ghost').exists()).toBe(false);
  });

  it('exposed reset() clears assignments (for retry after a wrong answer)', async () => {
    const wrapper = mountDragMatch();
    await tapChip(trayChipWith(wrapper, '飘'));
    await wrapper.findAll('button.slot')[0].trigger('click');
    expect(wrapper.findAll('button.slot')[0].classes()).toContain('is-filled');
    (wrapper.vm as unknown as { reset(): void }).reset();
    await nextTick();
    expect(wrapper.findAll('button.slot')[0].classes()).not.toContain('is-filled');
    expect(wrapper.findAll('button.chip-in-tray')).toHaveLength(3);
  });

  it('touch targets ≥44×44px: slots and chips (Req 12.2)', () => {
    const wrapper = mountDragMatch();
    expect(wrapper.find('button.slot').exists()).toBe(true);
    expect(wrapper.find('button.chip-in-tray').exists()).toBe(true);
    expectMinTouchTarget(dragMatchSource, '.slot');
    expectMinTouchTarget(dragMatchSource, '.chip');
  });
});

// ============ NumericKeypad ============

interface KeypadProps {
  modelValue?: string;
  disabled?: boolean;
  allowNegative?: boolean;
  maxLength?: number;
}

/** 挂载键盘并自更新 v-model（模拟父组件持有输入串） */
function mountKeypad(props: KeypadProps = {}): VueWrapper {
  const wrapper = mount(NumericKeypad, {
    props: {
      ...props,
      'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }),
    },
  });
  return wrapper;
}

function keypadKey(wrapper: VueWrapper, label: string): DOMWrapper<Element> {
  const found = wrapper.findAll('button.numeric-keypad__key').find((b) => b.text() === label);
  if (!found) {
    throw new Error(`未找到按键：${label}`);
  }
  return found;
}

function keypadDisplay(wrapper: VueWrapper): string {
  return wrapper.find('[data-testid="keypad-display"]').text();
}

describe('NumericKeypad', () => {
  it('digit keys append to the input', async () => {
    const wrapper = mountKeypad();
    await keypadKey(wrapper, '1').trigger('click');
    await keypadKey(wrapper, '2').trigger('click');
    await keypadKey(wrapper, '3').trigger('click');
    expect(keypadDisplay(wrapper)).toBe('123');
  });

  it('allows at most one decimal point and pads a leading zero on empty input', async () => {
    const wrapper = mountKeypad();
    await keypadKey(wrapper, '.').trigger('click');
    expect(keypadDisplay(wrapper)).toBe('0.'); // 空串点小数自动补 0
    await keypadKey(wrapper, '5').trigger('click');
    expect(keypadDisplay(wrapper)).toBe('0.5');
    await keypadKey(wrapper, '.').trigger('click'); // 第二个小数点被忽略
    expect(keypadDisplay(wrapper)).toBe('0.5');
  });

  it('backspace removes the last character', async () => {
    const wrapper = mountKeypad();
    await keypadKey(wrapper, '1').trigger('click');
    await keypadKey(wrapper, '2').trigger('click');
    await keypadKey(wrapper, '⌫').trigger('click');
    expect(keypadDisplay(wrapper)).toBe('1');
    await keypadKey(wrapper, '⌫').trigger('click');
    expect(keypadDisplay(wrapper)).toBe('?'); // 清空后显示占位符
  });

  it('confirm emits the parsed number and normalizes the input ("007"→7)', async () => {
    const wrapper = mountKeypad();
    for (const digit of ['0', '0', '7']) {
      await keypadKey(wrapper, digit).trigger('click');
    }
    expect(keypadDisplay(wrapper)).toBe('007');
    await keypadKey(wrapper, '✓ 确定').trigger('click');
    expect(wrapper.emitted('submit')).toEqual([[7]]);
    expect(keypadDisplay(wrapper)).toBe('7'); // 归一化串经 v-model 回写
  });

  it('confirm stays disabled on empty or invalid input', async () => {
    const wrapper = mountKeypad({ allowNegative: true });
    expect(keypadKey(wrapper, '✓ 确定').attributes('disabled')).toBeDefined(); // 空串
    await keypadKey(wrapper, '±').trigger('click'); // 仅负号不是合法数字
    expect(keypadDisplay(wrapper)).toBe('-');
    expect(keypadKey(wrapper, '✓ 确定').attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('± toggles the sign when allowNegative is enabled', async () => {
    const wrapper = mountKeypad({ allowNegative: true });
    await keypadKey(wrapper, '3').trigger('click');
    await keypadKey(wrapper, '±').trigger('click');
    expect(keypadDisplay(wrapper)).toBe('-3');
    await keypadKey(wrapper, '±').trigger('click');
    expect(keypadDisplay(wrapper)).toBe('3');
  });

  it('disabled locks all keys', async () => {
    const wrapper = mountKeypad({ modelValue: '5', disabled: true });
    const keys = wrapper.findAll('button.numeric-keypad__key');
    expect(keys.every((k) => k.attributes('disabled') !== undefined)).toBe(true);
    await keypadKey(wrapper, '1').trigger('click');
    expect(keypadDisplay(wrapper)).toBe('5');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('renders no input element (system keyboard never appears)', () => {
    const wrapper = mountKeypad();
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.find('[data-testid="keypad-display"]').element.tagName).toBe('DIV');
  });

  it('touch target ≥44×44px: keys (Req 12.2)', () => {
    const wrapper = mountKeypad();
    expect(wrapper.find('button.numeric-keypad__key').exists()).toBe(true);
    expectMinTouchTarget(numericKeypadSource, '.numeric-keypad__key');
  });
});

// ============ WordCard ============

const WORD_AUDIO_URL = 'audio/en/g3/hello.mp3';

const WORD_CARD_QUESTION: Question = {
  id: 'en-test-wcard-001',
  subject: 'english',
  grade: 3,
  volume: 'A',
  unit: 'm1',
  type: 'word_card',
  knowledgePointId: 'en.g3.greetings',
  difficulty: 1,
  stem: '看图片、听发音，选出正确的单词拼写',
  media: { audio: WORD_AUDIO_URL, image: 'img/en/g3/hello.png' },
  options: [
    { id: 'a', text: 'hallo' },
    { id: 'b', text: 'hello' },
    { id: 'c', text: 'helo' },
    { id: 'd', text: 'hullo' },
  ],
  answer: { choice: ['b'] },
  hint: '它由 h-e-l-l-o 五个字母组成。',
  analysis: 'hello 你好，见面打招呼用语。',
  phase: 1,
};

/** 干扰项题池：4 张拼写互异的单词卡（≥3 个互异干扰拼写，满足 4 选项构造） */
const WORD_CARD_POOL: Question[] = ['goodbye', 'morning', 'apple', 'banana'].map((word, i) => ({
  id: `en-test-pool-${i}`,
  subject: 'english',
  grade: 3,
  volume: 'A',
  unit: 'm1',
  type: 'word_card',
  knowledgePointId: 'en.g3.other',
  difficulty: 1,
  stem: `看图片、听发音，选出“${word}”`,
  media: { audio: `audio/en/g3/${word}.mp3`, image: `img/en/g3/${word}.png` },
  options: [
    { id: 'a', text: word },
    { id: 'b', text: `${word}x` },
  ],
  answer: { choice: ['a'] },
  hint: '',
  analysis: '',
  phase: 1,
}));

/** 固定随机源，构造结果可复现（正确选项凭拼写文本识别，与洗牌位置无关） */
function mountWordCard(audio: AudioService): VueWrapper {
  return mount(WordCard, {
    props: {
      question: WORD_CARD_QUESTION,
      pool: WORD_CARD_POOL,
      audioService: audio,
      rand: () => 0.5,
    },
  });
}

describe('WordCard', () => {
  it('auto-plays the pronunciation exactly once on mount (Req 8.3)', async () => {
    const audio = createAudioMock();
    mountWordCard(audio);
    await flushPromises();
    expect(audio.playPronunciation).toHaveBeenCalledTimes(1);
    expect(audio.playPronunciation).toHaveBeenCalledWith(WORD_AUDIO_URL); // 音频文件优先
    expect(audio.speakText).not.toHaveBeenCalled(); // 文件可用时不回退 TTS
  });

  it('replay button replays the pronunciation once per tap (Req 8.6)', async () => {
    const audio = createAudioMock();
    const wrapper = mountWordCard(audio);
    await flushPromises();
    await wrapper.find('button.word-card__replay').trigger('click');
    await flushPromises();
    expect(audio.playPronunciation).toHaveBeenCalledTimes(2);
    await wrapper.find('button.word-card__replay').trigger('click');
    await flushPromises();
    expect(audio.playPronunciation).toHaveBeenCalledTimes(3);
  });

  it('audio failure shows a hint while image/spelling remain and options stay answerable (Req 8.7)', async () => {
    const audio = createAudioMock();
    // 音频文件与 TTS 兜底均失败才显示提示
    vi.mocked(audio.playPronunciation).mockRejectedValue(new AudioPlaybackError(WORD_AUDIO_URL));
    vi.mocked(audio.speakText).mockRejectedValue(new AudioPlaybackError('hello'));
    const wrapper = mountWordCard(audio);
    await flushPromises();
    const hint = wrapper.find('.word-card__audio-error');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain('音频播放失败');
    // 图片与拼写仍可见
    expect(wrapper.find('img.word-card__image').exists()).toBe(true);
    expect(wrapper.find('.word-card__spelling').text()).toBe('hello');
    // 选项仍可作答
    const correct = wrapper
      .findAll('button.choice-pad__option')
      .find((b) => b.text() === 'hello');
    expect(correct).toBeDefined();
    await correct!.trigger('click');
    expect(wrapper.emitted('answer')).toHaveLength(1);
  });

  it('selecting an option emits answer payload carrying correctOptionId', async () => {
    const wrapper = mountWordCard(createAudioMock());
    await flushPromises();
    const options = wrapper.findAll('button.choice-pad__option');
    expect(options).toHaveLength(4); // 9.3 构造器恰产出 4 选项
    const correct = options.find((b) => b.text() === 'hello');
    expect(correct).toBeDefined();
    await correct!.trigger('click');
    const correctPayload = wrapper.emitted('answer')![0][0] as {
      selectedOptionId: string;
      correctOptionId: string;
    };
    expect(correctPayload.correctOptionId).toMatch(/^[a-d]$/);
    expect(correctPayload.selectedOptionId).toBe(correctPayload.correctOptionId);
    // 点干扰项：selectedOptionId ≠ correctOptionId，correctOptionId 不变
    const wrong = options.find((b) => b.text() !== 'hello');
    await wrong!.trigger('click');
    const wrongPayload = wrapper.emitted('answer')![1][0] as {
      selectedOptionId: string;
      correctOptionId: string;
    };
    expect(wrongPayload.selectedOptionId).not.toBe(wrongPayload.correctOptionId);
    expect(wrongPayload.correctOptionId).toBe(correctPayload.correctOptionId);
  });

  it('touch target ≥44×44px: replay button (Req 12.2)', () => {
    const wrapper = mountWordCard(createAudioMock());
    expect(wrapper.find('button.word-card__replay').exists()).toBe(true);
    expectMinTouchTarget(wordCardSource, '.word-card__replay');
  });
});

// ============ DictationCard ============

const DICTATION_AUDIO_URL = 'audio/cn/g3/rongmao.mp3';

const DICTATION_QUESTION: Question = {
  id: 'cn-test-dict-0001',
  subject: 'chinese',
  grade: 3,
  volume: 'A',
  unit: 'u1',
  type: 'dictation',
  knowledgePointId: 'cn.g3.zi.001',
  difficulty: 1,
  stem: '听读音，按顺序点选汉字，拼出听到的词语',
  media: { audio: DICTATION_AUDIO_URL },
  options: [
    { id: 'a', text: '绒' },
    { id: 'b', text: '毛' },
    { id: 'c', text: '线' },
    { id: 'd', text: '尾' },
  ],
  answer: { order: ['a', 'b'] },
  hint: '第一个字是绞丝旁',
  analysis: '“绒毛”指细软的毛。',
  phase: 1,
};

function mountDictation(audio: AudioService, disabled = false): VueWrapper {
  return mount(DictationCard, {
    props: { question: DICTATION_QUESTION, audioService: audio, disabled },
  });
}

function tileWith(wrapper: VueWrapper, text: string): DOMWrapper<Element> {
  const found = wrapper.findAll('button.dictation-card__tile').find((t) => t.text() === text);
  if (!found) {
    throw new Error(`未找到字卡：${text}`);
  }
  return found;
}

describe('DictationCard', () => {
  it('auto-plays the pronunciation exactly once on mount (Req 6.3)', async () => {
    const audio = createAudioMock();
    mountDictation(audio);
    await flushPromises();
    expect(audio.playPronunciation).toHaveBeenCalledTimes(1);
    expect(audio.playPronunciation).toHaveBeenCalledWith(DICTATION_AUDIO_URL); // 音频文件优先
  });

  it('replay button replays the pronunciation without limit (Req 6.6)', async () => {
    const audio = createAudioMock();
    const wrapper = mountDictation(audio);
    await flushPromises();
    await wrapper.find('button.dictation-card__replay').trigger('click');
    await wrapper.find('button.dictation-card__replay').trigger('click');
    await flushPromises();
    expect(audio.playPronunciation).toHaveBeenCalledTimes(3); // 自动 1 次 + 重听 2 次
  });

  it('tap tiles compose in order and auto-submit ordered ids when length matches', async () => {
    const wrapper = mountDictation(createAudioMock());
    await flushPromises();
    await tileWith(wrapper, '绒').trigger('click');
    const slots = wrapper.findAll('button.dictation-card__slot');
    expect(slots[0].classes()).toContain('dictation-card__slot--filled');
    expect(slots[0].text()).toContain('绒');
    expect(tileWith(wrapper, '绒').attributes('disabled')).toBeDefined(); // 已用字卡置灰
    expect(wrapper.emitted('answer')).toBeUndefined(); // 未填满不提交
    await tileWith(wrapper, '毛').trigger('click');
    expect(wrapper.emitted('answer')).toEqual([[['a', 'b']]]); // 有序 id 序列对接 judge order 规则
  });

  it('submits ids in tap order (judge order rule)', async () => {
    const wrapper = mountDictation(createAudioMock());
    await flushPromises();
    await tileWith(wrapper, '毛').trigger('click');
    await tileWith(wrapper, '绒').trigger('click');
    expect(wrapper.emitted('answer')).toEqual([[['b', 'a']]]); // 顺序即作答，错序如实提交
  });

  it('tapping a filled slot removes the char back to the tray', async () => {
    const wrapper = mountDictation(createAudioMock());
    await flushPromises();
    await tileWith(wrapper, '绒').trigger('click');
    await wrapper.findAll('button.dictation-card__slot')[0].trigger('click');
    const slot = wrapper.findAll('button.dictation-card__slot')[0];
    expect(slot.classes()).not.toContain('dictation-card__slot--filled');
    expect(slot.text()).toBe('1'); // 槽位恢复序号占位
    expect(tileWith(wrapper, '绒').attributes('disabled')).toBeUndefined(); // 字卡回到托盘可用
    expect(wrapper.emitted('answer')).toBeUndefined();
  });

  it('disabled locks tiles while replay stays available', async () => {
    const audio = createAudioMock();
    const wrapper = mountDictation(audio, true);
    await flushPromises();
    await tileWith(wrapper, '绒').trigger('click');
    expect(wrapper.findAll('button.dictation-card__slot')[0].classes()).not.toContain(
      'dictation-card__slot--filled',
    );
    expect(wrapper.emitted('answer')).toBeUndefined();
    await wrapper.find('button.dictation-card__replay').trigger('click'); // 重听不受锁定影响
    await flushPromises();
    expect(audio.playPronunciation).toHaveBeenCalledTimes(2);
  });

  it('audio failure shows a hint and answering is unaffected (Req 8.7)', async () => {
    const audio = createAudioMock();
    // 音频文件与 TTS 兜底均失败才显示提示
    vi.mocked(audio.playPronunciation).mockRejectedValue(
      new AudioPlaybackError(DICTATION_AUDIO_URL),
    );
    vi.mocked(audio.speakText).mockRejectedValue(new AudioPlaybackError('绒毛'));
    const wrapper = mountDictation(audio);
    await flushPromises();
    const hint = wrapper.find('.dictation-card__audio-error');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain('音频播放失败');
    await tileWith(wrapper, '绒').trigger('click');
    await tileWith(wrapper, '毛').trigger('click');
    expect(wrapper.emitted('answer')).toEqual([[['a', 'b']]]);
  });

  it('touch targets ≥44×44px: replay button, slots and tiles (Req 12.2)', async () => {
    const wrapper = mountDictation(createAudioMock());
    await flushPromises();
    expect(wrapper.find('button.dictation-card__replay').exists()).toBe(true);
    expect(wrapper.find('button.dictation-card__slot').exists()).toBe(true);
    expect(wrapper.find('button.dictation-card__tile').exists()).toBe(true);
    expectMinTouchTarget(dictationCardSource, '.dictation-card__replay');
    expectMinTouchTarget(dictationCardSource, '.dictation-card__slot');
    expectMinTouchTarget(dictationCardSource, '.dictation-card__tile');
  });
});
