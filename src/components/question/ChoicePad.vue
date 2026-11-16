<template>
  <div class="choice-pad" role="listbox" :aria-disabled="disabled">
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      class="choice-pad__option"
      :class="{ 'choice-pad__option--selected': option.id === currentSelectedId }"
      :disabled="disabled"
      role="option"
      :aria-selected="option.id === currentSelectedId"
      @click="onSelect(option.id)"
    >
      <img
        v-if="option.image"
        class="choice-pad__image"
        :src="option.image"
        :alt="option.text ?? ''"
        draggable="false"
      />
      <span v-if="option.text" class="choice-pad__text">{{ option.text }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { QuestionOption } from '../../types';

/**
 * ChoicePad 点选组件（题型交互组件）
 *
 * 适用题型：拼音选择、多音字辨析、判断、选择、单词卡图片/拼写 4 选 1。
 * 交互：点选某个选项后高亮，并通过 'select' 事件把选项 id 交给父组件提交判定。
 *
 * - 大号圆角选项卡，卡通风格（Requirement 12.1）
 * - 每个可点击选项触控区域不小于 44×44px（Requirement 12.2）
 * - 作答后父组件传入 disabled 防止重复提交
 *
 * Validates: Requirements 6.4, 7.2, 8.4, 12.2
 */
const props = withDefaults(
  defineProps<{
    /** 选项列表（可含 text 和/或 image） */
    options: QuestionOption[];
    /** 当前选中项 id（受控）；不传时组件内部维护选中态 */
    selectedId?: string;
    /** 作答后禁用，防止重复提交 */
    disabled?: boolean;
  }>(),
  {
    selectedId: undefined,
    disabled: false,
  }
);

const emit = defineEmits<{
  /** 点选某个选项，携带选项 id，由父组件提交判定 */
  (e: 'select', id: string): void;
}>();

/** 内部选中态：随受控 prop selectedId 同步，点选时本地更新并 emit */
const currentSelectedId = ref<string | undefined>(props.selectedId);

watch(
  () => props.selectedId,
  (val) => {
    currentSelectedId.value = val;
  }
);

function onSelect(id: string): void {
  if (props.disabled) return;
  currentSelectedId.value = id;
  emit('select', id);
}
</script>

<style scoped>
.choice-pad {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: center;
  align-items: stretch;
}

/* 大号圆角选项卡：触控区域 >= 44x44px（Requirement 12.2），卡通圆角（Requirement 12.1） */
.choice-pad__option {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 44px;
  min-height: 44px;
  padding: 16px 24px;
  border: 3px solid #ffd166;
  border-radius: 20px;
  background-color: #fffdf5;
  color: #4a3b2a;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.3;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 4px 0 #f0b429;
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease,
    background-color 0.12s ease,
    border-color 0.12s ease;
}

.choice-pad__option:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 2px 0 #f0b429;
}

.choice-pad__option--selected {
  background-color: #ffe8a3;
  border-color: #ff9f1c;
  box-shadow: 0 4px 0 #e07b00;
}

.choice-pad__option:disabled {
  cursor: default;
  opacity: 0.75;
}

.choice-pad__image {
  width: 96px;
  height: 96px;
  object-fit: contain;
  border-radius: 12px;
  pointer-events: none;
}

.choice-pad__text {
  display: block;
  text-align: center;
  word-break: break-word;
}

@media (max-width: 480px) {
  .choice-pad {
    gap: 12px;
  }

  .choice-pad__option {
    flex: 1 1 40%;
    padding: 14px 16px;
    font-size: 20px;
  }
}
</style>
