<template>
  <div class="drag-match" :class="{ 'is-disabled': disabled }">
    <!-- 目标槽列：每个目标一条（题干含 ＿ 空格） -->
    <div class="targets" role="list">
      <div
        v-for="t in targets"
        :key="t.id"
        class="target-row"
        role="listitem"
      >
        <span class="target-text">{{ t.text }}</span>
        <button
          :ref="(el) => setSlotRef(el, t.id)"
          type="button"
          class="slot"
          :class="{
            'is-filled': !!assignments[t.id],
            'is-hover': hoverTargetId === t.id,
          }"
          :disabled="disabled"
          :aria-label="`${t.text ?? ''} 的作答槽`"
          @click="onSlotTap(t.id)"
        >
          <!-- 已放入的选项 chip（可拖走/点按清除） -->
          <span
            v-if="assignments[t.id]"
            class="chip chip-in-slot"
            :class="{ 'is-drag-source': drag?.active && drag.choiceId === assignments[t.id] }"
            role="button"
            :aria-label="`已放入 ${choiceText(assignments[t.id])}，点按可取回`"
            @pointerdown="onChipPointerDown($event, assignments[t.id], t.id)"
            @pointermove="onChipPointerMove"
            @pointerup="onChipPointerUp"
            @pointercancel="onChipPointerCancel"
            @click.stop
          >
            <img v-if="choiceImage(assignments[t.id])" :src="choiceImage(assignments[t.id])" :alt="choiceText(assignments[t.id])" class="chip-img" />
            <span v-else>{{ choiceText(assignments[t.id]) }}</span>
          </span>
          <span v-else class="slot-placeholder">拖到这里</span>
        </button>
      </div>
    </div>

    <!-- 备选区：未分配的选项 chips -->
    <div class="choices-tray" aria-label="备选答案区">
      <button
        v-for="c in trayChoices"
        :key="c.id"
        type="button"
        class="chip chip-in-tray"
        :class="{
          'is-selected': selectedChoiceId === c.id,
          'is-drag-source': drag?.active && drag.choiceId === c.id,
        }"
        :disabled="disabled"
        :aria-pressed="selectedChoiceId === c.id"
        @pointerdown="onChipPointerDown($event, c.id, null)"
        @pointermove="onChipPointerMove"
        @pointerup="onChipPointerUp"
        @pointercancel="onChipPointerCancel"
      >
        <img v-if="c.image" :src="c.image" :alt="c.text ?? ''" class="chip-img" />
        <span v-else>{{ c.text }}</span>
      </button>
    </div>

    <!-- 拖拽跟随的幽灵 chip（不拦截指针，保证命中检测落在槽位上） -->
    <div
      v-if="drag?.active"
      class="drag-ghost"
      :style="{ left: `${drag.x}px`, top: `${drag.y}px` }"
      aria-hidden="true"
    >
      <img v-if="choiceImage(drag.choiceId)" :src="choiceImage(drag.choiceId)" alt="" class="chip-img" />
      <span v-else>{{ choiceText(drag.choiceId) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * DragMatch 拖拽配对组件（题型交互组件之一）
 *
 * 依据 design.md「题型交互组件」与 tasks.md 12.2：
 * - 适用题型：词语搭配 / 成语填空 / 形近字辨析 / 单位换算（answer.pairs 配对型）
 * - Pointer Events（pointerdown/pointermove/pointerup + setPointerCapture）统一触摸与鼠标拖拽，
 *   仅触摸或仅鼠标均可完成全部作答交互（Validates: Requirements 11.4）
 * - 提供点按后备交互：点按一个选项使其高亮，再点按目标槽即放入（无障碍与全设备可靠性）
 * - 目标槽吸附：拖动经过槽位时槽位高亮，松手落入槽位
 * - 槽位与选项 chip 触控区域均 ≥44×44px（Validates: Requirements 12.2）
 * - 全程无系统键盘（Validates: Requirements 6.4, 7.2）
 * - 支持取消分配：点按已填充槽位取回选项，或把槽内 chip 拖出槽外放回备选区
 *
 * 种子数据约定（见 src/data/seed/questions-chinese.json 与 questions-math.json）：
 * - targets：目标槽（id 形如 t1/t2/...，text 内含 ＿ 空格或待搭配词）
 * - choices：可拖拽选项（id 形如 a/b/c/d...，数量可多于 targets，含干扰项）
 *
 * 提交方式（确认流程的选择，已按任务要求记录）：自动提交。
 * 当所有目标槽都被填入时立即 emit('submit', pairs)，pairs 为 Record<目标id, 选项id>，
 * 与 src/engine/judge.ts 的 pairs 判定（映射归一化）直接对接。
 * 提交后若学生改动分配（未被 disabled 锁定），重新填满时会再次提交。
 * 父组件可通过 defineExpose 的 reset() 清空作答（用于答错后重试同一题）。
 */

import { computed, ref, watch } from 'vue';
import type { QuestionOption } from '../../types/index';

interface Props {
  /** 目标槽（含 ＿ 空格或待搭配词），id 形如 t1/t2/... */
  targets: QuestionOption[];
  /** 可拖拽选项，id 形如 a/b/c/d...（可含干扰项，数量 ≥ targets） */
  choices: QuestionOption[];
  /** 作答锁定（答题判定后禁止再改） */
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), { disabled: false });

const emit = defineEmits<{
  /** 全部目标槽填满时触发；pairs 为目标槽 id → 选项 id 的映射 */
  (e: 'submit', pairs: Record<string, string>): void;
}>();

/** 当前分配：目标槽 id → 选项 id */
const assignments = ref<Record<string, string>>({});
/** 点按后备交互中被选中的选项 id */
const selectedChoiceId = ref<string | null>(null);
/** 拖拽状态；active=false 表示尚未越过点按阈值 */
const drag = ref<{
  choiceId: string;
  /** 拖出来源槽 id；从备选区拖出为 null */
  fromTargetId: string | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
} | null>(null);
/** 拖拽悬停命中的目标槽 id（吸附高亮） */
const hoverTargetId = ref<string | null>(null);
/** 本次填满后是否已提交（防止重复提交） */
const submitted = ref(false);

/** 点按与拖拽的位移阈值（像素）：位移小于该值视为点按 */
const TAP_THRESHOLD_PX = 10;

// ============ 派生状态 ============

const usedChoiceIds = computed(() => new Set(Object.values(assignments.value)));
/** 备选区中尚未分配的选项 */
const trayChoices = computed(() => props.choices.filter((c) => !usedChoiceIds.value.has(c.id)));

function choiceText(id: string): string {
  return props.choices.find((c) => c.id === id)?.text ?? '';
}

function choiceImage(id: string): string | undefined {
  return props.choices.find((c) => c.id === id)?.image;
}

// ============ 槽位引用与命中检测（吸附） ============

const slotRefs = new Map<string, HTMLElement>();

function setSlotRef(el: Element | null, id: string): void {
  if (el instanceof HTMLElement) {
    slotRefs.set(id, el);
  } else {
    slotRefs.delete(id);
  }
}

/** 命中检测：返回指针坐标所在的目标槽 id，未命中返回 null */
function hitTestSlot(x: number, y: number): string | null {
  for (const [id, el] of slotRefs) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return id;
    }
  }
  return null;
}

// ============ 分配操作 ============

/**
 * 将选项放入目标槽。
 * - 来源为另一槽位且目标槽已被占：交换两槽内容
 * - 来源为备选区且目标槽已被占：被顶替的选项回到备选区
 */
function assign(targetId: string, choiceId: string, fromTargetId: string | null): void {
  const next = { ...assignments.value };
  const displaced = next[targetId];
  if (fromTargetId) {
    delete next[fromTargetId];
  }
  next[targetId] = choiceId;
  if (displaced && displaced !== choiceId && fromTargetId) {
    next[fromTargetId] = displaced;
  }
  assignments.value = next;
  selectedChoiceId.value = null;
  maybeSubmit();
}

/** 清空某个目标槽（选项回到备选区） */
function unassign(targetId: string): void {
  if (!assignments.value[targetId]) {
    return;
  }
  const next = { ...assignments.value };
  delete next[targetId];
  assignments.value = next;
  // 提交后又改动：允许重新填满时再次提交
  submitted.value = false;
}

/** 全部目标槽填满且未提交过时自动提交 */
function maybeSubmit(): void {
  if (submitted.value || props.disabled) {
    return;
  }
  const complete = props.targets.length > 0 && props.targets.every((t) => !!assignments.value[t.id]);
  if (complete) {
    submitted.value = true;
    emit('submit', { ...assignments.value });
  }
}

// ============ 点按后备交互（tap fallback） ============

/** 点按选项 chip：备选区选项切换选中；槽内选项取回（或用于替换选中项） */
function handleChipTap(choiceId: string, fromTargetId: string | null): void {
  if (fromTargetId) {
    if (selectedChoiceId.value && selectedChoiceId.value !== choiceId) {
      // 已选中其他选项时点按已填充槽：替换槽内容
      assign(fromTargetId, selectedChoiceId.value, null);
    } else {
      // 点按已填充槽：取回该选项
      unassign(fromTargetId);
    }
    return;
  }
  selectedChoiceId.value = selectedChoiceId.value === choiceId ? null : choiceId;
}

/** 点按目标槽空白区域：有选中项则放入；无选中项且已填充则取回 */
function onSlotTap(targetId: string): void {
  if (props.disabled || drag.value) {
    return;
  }
  if (selectedChoiceId.value) {
    assign(targetId, selectedChoiceId.value, null);
  } else if (assignments.value[targetId]) {
    unassign(targetId);
  }
}

// ============ Pointer Events 拖拽（触摸/鼠标统一） ============

function onChipPointerDown(e: PointerEvent, choiceId: string, fromTargetId: string | null): void {
  if (props.disabled) {
    return;
  }
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  if (typeof el.setPointerCapture === 'function') {
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // 部分环境（如 jsdom）不支持指针捕获，忽略降级
    }
  }
  drag.value = {
    choiceId,
    fromTargetId,
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    active: false,
  };
}

function onChipPointerMove(e: PointerEvent): void {
  if (!drag.value) {
    return;
  }
  drag.value.x = e.clientX;
  drag.value.y = e.clientY;
  if (!drag.value.active) {
    const dx = e.clientX - drag.value.startX;
    const dy = e.clientY - drag.value.startY;
    if (Math.hypot(dx, dy) >= TAP_THRESHOLD_PX) {
      drag.value.active = true;
      selectedChoiceId.value = null;
    }
  }
  if (drag.value.active) {
    hoverTargetId.value = hitTestSlot(e.clientX, e.clientY);
  }
}

function onChipPointerUp(e: PointerEvent): void {
  const d = drag.value;
  if (!d) {
    return;
  }
  drag.value = null;
  hoverTargetId.value = null;
  if (d.active) {
    const slotId = hitTestSlot(e.clientX, e.clientY);
    if (slotId) {
      // 落入槽位（吸附）
      assign(slotId, d.choiceId, d.fromTargetId);
    } else if (d.fromTargetId) {
      // 从槽内拖出到槽外：取回该选项
      unassign(d.fromTargetId);
    }
    // 备选区选项拖到空白处：无操作（自动回位）
  } else {
    handleChipTap(d.choiceId, d.fromTargetId);
  }
}

function onChipPointerCancel(): void {
  drag.value = null;
  hoverTargetId.value = null;
}

// ============ 对外能力 ============

/** 清空全部作答（供答错后重试同一题使用） */
function reset(): void {
  assignments.value = {};
  selectedChoiceId.value = null;
  drag.value = null;
  hoverTargetId.value = null;
  submitted.value = false;
}

defineExpose({ reset });

// 题目切换时重置作答状态
watch(
  () => [props.targets, props.choices],
  () => reset(),
);
</script>

<style scoped>
.drag-match {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  user-select: none;
  -webkit-user-select: none;
}

/* ---- 目标槽列 ---- */
.targets {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.target-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.target-text {
  font-size: 20px;
  font-weight: 700;
  color: #4a3b2a;
  line-height: 1.4;
}

/* 槽位：触控区域 ≥44×44px（Req 12.2） */
.slot {
  min-width: 96px;
  min-height: 44px;
  padding: 4px 8px;
  border: 3px dashed #f0a840;
  border-radius: 16px;
  background: #fff8ec;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: none;
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease,
    background 0.12s ease;
}

.slot.is-filled {
  border-style: solid;
  border-color: #ffb347;
  background: #ffffff;
}

/* 拖拽悬停命中：吸附高亮 */
.slot.is-hover {
  border-color: #ff8c42;
  background: #ffe9c7;
  transform: scale(1.06);
  box-shadow: 0 0 0 4px rgba(255, 140, 66, 0.3);
}

.slot-placeholder {
  color: #c9a066;
  font-size: 14px;
}

/* ---- 选项 chip：圆角卡通造型，触控区域 ≥44×44px ---- */
.chip {
  min-width: 44px;
  min-height: 44px;
  padding: 8px 18px;
  border: 3px solid #ff8c42;
  border-radius: 22px;
  background: linear-gradient(180deg, #ffe1b8 0%, #ffc98a 100%);
  color: #5a3b14;
  font-size: 20px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  touch-action: none;
  box-shadow: 0 3px 0 #e07f2e;
  transition: transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease;
}

.chip:active {
  cursor: grabbing;
}

.chip-img {
  width: 36px;
  height: 36px;
  object-fit: contain;
  border-radius: 10px;
}

/* 点按后备交互：选中高亮 */
.chip.is-selected {
  border-color: #4d96ff;
  background: linear-gradient(180deg, #cfe3ff 0%, #a8c9ff 100%);
  box-shadow: 0 0 0 4px rgba(77, 150, 255, 0.35);
  transform: scale(1.05);
}

/* 拖拽中的源 chip 半透明 */
.chip.is-drag-source {
  opacity: 0.4;
}

.chip-in-slot {
  cursor: grab;
}

/* ---- 备选区 ---- */
.choices-tray {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  padding: 12px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.65);
}

/* ---- 拖拽幽灵：跟随指针，不拦截命中检测 ---- */
.drag-ghost {
  position: fixed;
  z-index: 999;
  transform: translate(-50%, -60%);
  pointer-events: none;
  min-width: 44px;
  min-height: 44px;
  padding: 8px 18px;
  border: 3px solid #ff8c42;
  border-radius: 22px;
  background: linear-gradient(180deg, #ffe1b8 0%, #ffc98a 100%);
  color: #5a3b14;
  font-size: 20px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.25);
  opacity: 0.95;
}

/* ---- 锁定态 ---- */
.is-disabled .slot,
.is-disabled .chip {
  cursor: default;
  filter: grayscale(0.35);
  opacity: 0.8;
}
</style>
