<!--
  NumericKeypad 屏幕大数字键盘组件

  依据 tasks.md 12.3（Validates: Requirements 7.2, 11.4, 12.2）：
  - 适用口算速算/填空/几何计算等答案为数字的题型（判定走 src/engine/judge.ts 的 number 比对，浮点容差 1e-9）
  - Req 7.2：屏幕键盘作答，不调用系统键盘 —— 当前输入以样式化文本渲染，不使用任何可聚焦的 input 元素
  - Req 11.4：鼠标与触摸均可操作 —— 全部按键使用 click 事件（触摸端浏览器会派发 click），
    并以 touch-action: manipulation 消除双击缩放延迟
  - Req 12.2：每个按键触控区域不小于 44×44px（实际最小 56×56px），圆角卡通风格

  输入规则：
  - 至多一个小数点；空串直接点小数点自动补前导 0（"0."）
  - 确认时归一化前导零（"007"→7、".5"→0.5、"5."→5），通过 update:modelValue 回写归一化串
  - allowNegative（默认 false）开启后提供 ± 正负号键
  - maxLength（可选）限制输入串总长度（含负号与小数点）
  - 仅当当前输入是合法数字时确认键可用，点击发出 submit(parsedNumber)
  - disabled 锁定全部按键（答题后锁定）
-->
<template>
  <div class="numeric-keypad" :class="{ 'numeric-keypad--disabled': disabled }">
    <!-- 当前输入回显：纯文本渲染，非 input 元素，不会唤起系统键盘 -->
    <div class="numeric-keypad__display" role="status" aria-live="polite" data-testid="keypad-display">
      <span v-if="modelValue !== ''" class="numeric-keypad__value">{{ modelValue }}</span>
      <span v-else class="numeric-keypad__placeholder" aria-hidden="true">?</span>
    </div>

    <div class="numeric-keypad__grid">
      <button
        v-for="digit in digitKeys"
        :key="digit"
        type="button"
        class="numeric-keypad__key numeric-keypad__key--digit"
        :disabled="disabled"
        :aria-label="`数字 ${digit}`"
        @click="onDigit(digit)"
      >
        {{ digit }}
      </button>

      <!-- 第四行：正负号（可选）/ 0 / 小数点 -->
      <button
        v-if="allowNegative"
        type="button"
        class="numeric-keypad__key numeric-keypad__key--sign"
        :disabled="disabled"
        aria-label="正负号"
        @click="onToggleSign"
      >
        ±
      </button>
      <span v-else class="numeric-keypad__spacer" aria-hidden="true"></span>
      <button
        type="button"
        class="numeric-keypad__key numeric-keypad__key--digit"
        :disabled="disabled"
        aria-label="数字 0"
        @click="onDigit('0')"
      >
        0
      </button>
      <button
        type="button"
        class="numeric-keypad__key numeric-keypad__key--dot"
        :disabled="disabled"
        aria-label="小数点"
        @click="onDot"
      >
        .
      </button>

      <!-- 第五行：删除 / 确认（确认键占两格，更醒目） -->
      <button
        type="button"
        class="numeric-keypad__key numeric-keypad__key--backspace"
        :disabled="disabled"
        aria-label="删除"
        @click="onBackspace"
      >
        ⌫
      </button>
      <button
        type="button"
        class="numeric-keypad__key numeric-keypad__key--confirm"
        :disabled="!canSubmit"
        aria-label="确认答案"
        @click="onConfirm"
      >
        ✓ 确定
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  /** 当前输入串（v-model），由父组件持有并在换题时重置 */
  modelValue?: string;
  /** 答题后锁定键盘 */
  disabled?: boolean;
  /** 是否允许负数（提供 ± 键），默认 false */
  allowNegative?: boolean;
  /** 输入串最大长度（含负号与小数点），不传则不限制 */
  maxLength?: number;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  disabled: false,
  allowNegative: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'submit', value: number): void;
}>();

/** 1-9 数字键（前三行），0 单独放在第四行 */
const digitKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** 合法数字串：可选负号 + （整数[可带小数] | 纯小数），如 "7"、"5."、".5"、"-3.25" */
const NUMBER_PATTERN = /^-?(\d+\.?\d*|\.\d+)$/;

function isValidNumberString(s: string): boolean {
  return NUMBER_PATTERN.test(s);
}

/** 仅当未锁定且当前输入是合法数字时，确认键可用 */
const canSubmit = computed(() => !props.disabled && isValidNumberString(props.modelValue));

/** 追加字符前的长度守卫 */
function canAppend(current: string): boolean {
  return props.maxLength === undefined || current.length < props.maxLength;
}

function onDigit(digit: string): void {
  if (props.disabled || !canAppend(props.modelValue)) {
    return;
  }
  emit('update:modelValue', props.modelValue + digit);
}

function onDot(): void {
  if (props.disabled || props.modelValue.includes('.') || !canAppend(props.modelValue)) {
    return; // 至多一个小数点
  }
  // 空串或仅有负号时自动补前导 0，避免出现 "." / "-." 中间态
  if (props.modelValue === '') {
    emit('update:modelValue', '0.');
    return;
  }
  if (props.modelValue === '-') {
    emit('update:modelValue', '-0.');
    return;
  }
  emit('update:modelValue', props.modelValue + '.');
}

function onBackspace(): void {
  if (props.disabled || props.modelValue === '') {
    return;
  }
  emit('update:modelValue', props.modelValue.slice(0, -1));
}

function onToggleSign(): void {
  if (props.disabled || !props.allowNegative) {
    return;
  }
  if (props.modelValue.startsWith('-')) {
    emit('update:modelValue', props.modelValue.slice(1));
    return;
  }
  if (!canAppend(props.modelValue)) {
    return;
  }
  emit('update:modelValue', '-' + props.modelValue);
}

function onConfirm(): void {
  if (props.disabled || !isValidNumberString(props.modelValue)) {
    return;
  }
  const parsed = Number(props.modelValue);
  if (!Number.isFinite(parsed)) {
    return;
  }
  // 归一化（前导零/尾随小数点/纯小数前补 0），如 "007"→"7"、".5"→"0.5"、"5."→"5"、"-0"→"0"
  const normalized = String(parsed);
  if (normalized !== props.modelValue) {
    emit('update:modelValue', normalized);
  }
  emit('submit', parsed);
}
</script>

<style scoped>
.numeric-keypad {
  width: 100%;
  max-width: 320px;
  margin: 0 auto;
  user-select: none;
  -webkit-user-select: none;
}

/* 输入回显区：纯文本，非输入框 */
.numeric-keypad__display {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 56px;
  padding: 8px 16px;
  margin-bottom: 12px;
  background: #ffffff;
  border: 3px solid #ffd166;
  border-radius: 16px;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.06);
}

.numeric-keypad__value {
  font-size: 28px;
  font-weight: 700;
  color: #2d2a32;
  letter-spacing: 1px;
  word-break: break-all;
}

.numeric-keypad__placeholder {
  font-size: 28px;
  font-weight: 700;
  color: #c3c0cc;
}

.numeric-keypad__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

/* 按键：触控区域 56×56px（≥44×44px，Req 12.2），圆角卡通造型 */
.numeric-keypad__key {
  min-width: 56px;
  min-height: 56px;
  padding: 8px;
  border: none;
  border-radius: 16px;
  font-size: 24px;
  font-weight: 700;
  font-family: inherit;
  color: #2d2a32;
  background: #ffffff;
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.15);
  cursor: pointer;
  touch-action: manipulation; /* 触摸端直接触发 click，无双击缩放延迟（Req 11.4） */
  transition: transform 0.08s ease, box-shadow 0.08s ease;
}

.numeric-keypad__key:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.15);
}

.numeric-keypad__key:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.numeric-keypad__key--digit {
  background: #ffffff;
}

.numeric-keypad__key--dot,
.numeric-keypad__key--sign {
  background: #e8f4ff;
}

.numeric-keypad__key--backspace {
  background: #ffd166;
}

.numeric-keypad__key--confirm {
  grid-column: span 2;
  background: #06d6a0;
  color: #ffffff;
  font-size: 22px;
}

.numeric-keypad__key--confirm:disabled {
  background: #9be7cf;
}

.numeric-keypad__spacer {
  min-width: 56px;
  min-height: 56px;
}

.numeric-keypad--disabled .numeric-keypad__display {
  border-color: #d8d5e0;
  background: #f4f3f7;
}
</style>
