<template>
  <div class="dictation-card" :class="{ 'is-disabled': disabled }">
    <!-- 题干 -->
    <p class="dictation-card__stem">{{ question.stem }}</p>

    <!-- 读音区：重听按钮（不限次，Req 6.6）+ 音频失败提示（Req 8.7 降级模式） -->
    <div class="dictation-card__audio-row">
      <button
        type="button"
        class="dictation-card__replay"
        aria-label="重听读音"
        @click="onReplay"
      >
        <span class="dictation-card__replay-icon" aria-hidden="true">🔊</span>
        <span>重听</span>
      </button>
      <span v-if="audioError" class="dictation-card__audio-error" role="alert">
        音频播放失败，请点"重听"再试一次
      </span>
    </div>

    <!-- 作答槽：按答案长度展示，点按已填槽位可取下该字（提交前可编辑） -->
    <div class="dictation-card__slots" role="list" aria-label="拼出的词语">
      <button
        v-for="i in expectedLength"
        :key="i - 1"
        type="button"
        class="dictation-card__slot"
        :class="{ 'dictation-card__slot--filled': !!composed[i - 1] }"
        :disabled="disabled || !composed[i - 1]"
        :aria-label="
          composed[i - 1]
            ? `第 ${i} 个字 ${optionText(composed[i - 1])}，点按取下`
            : `第 ${i} 个字，待填`
        "
        @click="onSlotTap(i - 1)"
      >
        <span v-if="composed[i - 1]" class="dictation-card__slot-char">
          {{ optionText(composed[i - 1]) }}
        </span>
        <span v-else class="dictation-card__slot-placeholder">{{ i }}</span>
      </button>
    </div>

    <!-- 字卡托盘：大号圆角按钮，点选拼合（不用键盘，Req 6.4） -->
    <div class="dictation-card__tray" aria-label="备选汉字">
      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        class="dictation-card__tile"
        :class="{ 'dictation-card__tile--used': usedIds.has(option.id) }"
        :disabled="disabled || usedIds.has(option.id)"
        @click="onTileTap(option.id)"
      >
        {{ option.text }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * DictationCard 听写卡组件（题型交互组件）
 *
 * 适用题型：生字听写（type='dictation'，answer.order 为有序字卡 id 序列）。
 * 种子数据约定（src/data/seed/questions-chinese.json）：
 * - stem：如"听读音，按顺序点选汉字，拼出听到的词语"
 * - options：字卡（id 形如 a/b/c/...，含干扰字，数量 ≥ 答案字数）
 * - answer.order：正确字卡 id 的有序序列（judge.ts order 规则＝序列严格相等）
 *
 * 读音方案：优先播放 media.audio 音频文件（public/audio/...，由
 * scripts/generate_audio.py 用 edge-tts 预生成）；文件缺失或播放失败时
 * 回退 TTS（Web Speech API）朗读 answer.order 按序拼出的词语（如 绒+毛→"绒毛"）。
 *
 * 行为契约：
 * - 展示（挂载或题目切换）时自动朗读一次（Validates: Requirement 6.3）。
 * - "重听"按钮重复播放读音，不限次数（Validates: Requirement 6.6）；重听不受
 *   disabled 影响，作答锁定后仍可重听。触控区域 ≥44×44px（Req 12.2）。
 * - 音频加载/播放失败：显示"音频播放失败"提示，但字卡点选作答不受影响
 *   （与 WordCard 一致的 Req 8.7 降级模式）。
 * - 点选拼合作答，不使用系统键盘（Validates: Requirement 6.4）：点字卡依次填入
 *   作答槽，字卡被用后置灰；点已填槽位取下该字（其后的字前移）回到托盘，
 *   提交前可随时编辑。字卡与槽位触控区域均 ≥44×44px（Req 12.2）。
 *
 * 提交方式（按任务要求记录选择）：自动提交——当拼合序列长度等于
 * answer.order 长度时立即 emit('answer', order)，order 为字卡 id 的有序数组，
 * 与 judge.ts 的 order 规则直接对接。提交后（未被 disabled 锁定时）取下槽内
 * 字并重新填满会再次提交；父组件可用 defineExpose 的 reset() 清空作答
 * （用于首错后重试同一题）。
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Question } from '../../types/index';
import {
  audioService as defaultAudioService,
  type AudioService,
} from '../../services/audioService';

const props = withDefaults(
  defineProps<{
    /** 生字听写题（type='dictation'） */
    question: Question;
    /** 可注入的 Audio_Service（测试可传 mock；缺省用应用共享实例） */
    audioService?: AudioService;
    /** 作答锁定（判定后禁止再改；重听仍可用） */
    disabled?: boolean;
  }>(),
  {
    audioService: undefined,
    disabled: false,
  }
);

const emit = defineEmits<{
  /** 拼合序列填满时触发；order 为字卡 id 的有序数组（对接 judge.ts order 规则） */
  (e: 'answer', order: string[]): void;
}>();

/** 实际使用的 Audio_Service（prop 注入优先，缺省共享实例） */
const audio = computed<AudioService>(() => props.audioService ?? defaultAudioService);

/** 已拼合的字卡 id 序列（顺序即作答顺序） */
const composed = ref<string[]>([]);
/** 本次填满后是否已提交（防止重复提交） */
const submitted = ref(false);
/** 音频失败提示可见性（Req 8.7：提示但作答不受影响） */
const audioError = ref(false);

/** 备选字卡 */
const options = computed(() => props.question.options ?? []);
/** 期望作答长度（答案字数） */
const expectedLength = computed(() => props.question.answer.order?.length ?? 0);
/** 已使用的字卡 id 集合 */
const usedIds = computed(() => new Set(composed.value));

function optionText(id: string): string {
  return options.value.find((o) => o.id === id)?.text ?? '';
}

// ============ 读音播放（TTS 自动一次 + 不限次重听） ============

/** 朗读文本：answer.order 按序拼出的词语（如 绒+毛→"绒毛"） */
const spokenText = computed<string>(() => {
  const order = props.question.answer.order ?? [];
  return order.map((id) => optionText(id)).join('');
});

/** 播放当前题读音：音频文件优先，失败回退 TTS；均失败时展示提示，作答不受影响（Req 8.7） */
async function playAudio(): Promise<void> {
  const url = props.question.media?.audio;
  if (url) {
    try {
      await audio.value.playPronunciation(url);
      audioError.value = false;
      return;
    } catch {
      // 音频文件缺失/播放失败：继续回退 TTS
    }
  }
  const text = spokenText.value;
  if (!text) {
    audioError.value = true;
    return;
  }
  try {
    await audio.value.speakText(text);
    audioError.value = false;
  } catch {
    // AudioPlaybackError 或其他异常：仅提示，不阻塞作答
    audioError.value = true;
  }
}

/** 重听按钮：重复播放，不限次数（Req 6.6） */
function onReplay(): void {
  void playAudio();
}

onMounted(() => {
  // 展示时自动播放读音一次（Req 6.3）
  void playAudio();
});

onBeforeUnmount(() => {
  audio.value.stopAll();
});

// ============ 点选拼合作答 ============

/** 点选字卡：追加到拼合序列末尾并标记使用 */
function onTileTap(id: string): void {
  if (props.disabled || submitted.value) {
    return;
  }
  if (usedIds.value.has(id)) {
    return;
  }
  if (expectedLength.value <= 0 || composed.value.length >= expectedLength.value) {
    return;
  }
  composed.value = [...composed.value, id];
  maybeSubmit();
}

/** 点按已填槽位：取下该字（其后的字前移），字卡回到托盘，提交前可编辑 */
function onSlotTap(index: number): void {
  if (props.disabled) {
    return;
  }
  if (index < 0 || index >= composed.value.length) {
    return;
  }
  composed.value = composed.value.filter((_, i) => i !== index);
  // 提交后又改动：允许重新填满时再次提交
  submitted.value = false;
}

/** 拼合序列长度等于答案长度时自动提交（对接 judge.ts order 规则） */
function maybeSubmit(): void {
  if (submitted.value || props.disabled) {
    return;
  }
  if (expectedLength.value > 0 && composed.value.length === expectedLength.value) {
    submitted.value = true;
    emit('answer', [...composed.value]);
  }
}

// ============ 对外能力与题目切换 ============

/** 清空全部作答（供首错后重试同一题使用） */
function reset(): void {
  composed.value = [];
  submitted.value = false;
}

defineExpose({ reset });

// 题目切换：重置作答状态并自动播放新题读音一次（Req 6.3）
watch(
  () => props.question.id,
  () => {
    reset();
    audioError.value = false;
    void playAudio();
  }
);
</script>

<style scoped>
.dictation-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  width: 100%;
  user-select: none;
  -webkit-user-select: none;
}

.dictation-card__stem {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #4a3b2a;
  text-align: center;
  line-height: 1.5;
}

/* ---- 读音区 ---- */
.dictation-card__audio-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

/* 重听按钮：触控区域 ≥44×44px（Req 12.2），卡通圆角（Req 12.1） */
.dictation-card__replay {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 44px;
  min-height: 44px;
  padding: 12px 24px;
  border: 3px solid #4d96ff;
  border-radius: 22px;
  background: linear-gradient(180deg, #cfe3ff 0%, #a8c9ff 100%);
  color: #1d4ed8;
  font-size: 20px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 4px 0 #3b82f6;
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease;
}

.dictation-card__replay:active {
  transform: translateY(2px);
  box-shadow: 0 2px 0 #3b82f6;
}

.dictation-card__replay-icon {
  font-size: 24px;
}

.dictation-card__audio-error {
  font-size: 15px;
  font-weight: 600;
  color: #d97706;
  background: #fef3c7;
  border-radius: 12px;
  padding: 6px 12px;
}

/* ---- 作答槽：触控区域 ≥44×44px ---- */
.dictation-card__slots {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

.dictation-card__slot {
  min-width: 56px;
  min-height: 56px;
  padding: 4px;
  border: 3px dashed #f0a840;
  border-radius: 16px;
  background: #fff8ec;
  color: #4a3b2a;
  font-size: 28px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 0.12s ease,
    border-color 0.12s ease,
    background 0.12s ease;
}

.dictation-card__slot--filled {
  border-style: solid;
  border-color: #ffb347;
  background: #ffffff;
}

.dictation-card__slot:disabled {
  cursor: default;
}

.dictation-card__slot-placeholder {
  color: #d9b98a;
  font-size: 16px;
  font-weight: 600;
}

/* ---- 字卡托盘：大号圆角按钮，触控区域 ≥44×44px（Req 12.2, 12.1） ---- */
.dictation-card__tray {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  justify-content: center;
  padding: 14px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.65);
}

.dictation-card__tile {
  min-width: 56px;
  min-height: 56px;
  padding: 8px 16px;
  border: 3px solid #ffd166;
  border-radius: 18px;
  background-color: #fffdf5;
  color: #4a3b2a;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 4px 0 #f0b429;
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease,
    opacity 0.12s ease;
}

.dictation-card__tile:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 2px 0 #f0b429;
}

/* 已使用的字卡置灰 */
.dictation-card__tile--used {
  opacity: 0.35;
  box-shadow: none;
  cursor: default;
}

/* ---- 作答锁定态（重听不受影响） ---- */
.is-disabled .dictation-card__tile,
.is-disabled .dictation-card__slot {
  cursor: default;
  filter: grayscale(0.35);
  opacity: 0.8;
}

@media (max-width: 480px) {
  .dictation-card {
    gap: 16px;
  }

  .dictation-card__slot {
    min-width: 48px;
    min-height: 48px;
    font-size: 24px;
  }

  .dictation-card__tile {
    min-width: 48px;
    min-height: 48px;
    font-size: 24px;
    padding: 6px 12px;
  }
}
</style>
