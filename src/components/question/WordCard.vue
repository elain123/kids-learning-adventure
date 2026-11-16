<template>
  <div class="word-card" :class="{ 'is-disabled': disabled }">
    <!-- 卡片展示区：图片 + 拼写（音频/图片失败时仍可用，Req 8.7） -->
    <div class="word-card__display">
      <img
        v-if="cardImage && !imageFailed"
        class="word-card__image"
        :src="cardImage"
        :alt="cardSpelling ?? '单词图片'"
        draggable="false"
        @error="imageFailed = true"
      />
      <div v-if="cardSpelling" class="word-card__spelling">{{ cardSpelling }}</div>

      <!-- 重播按钮：不限次重播放音（Req 8.6），触控区域 ≥44×44px（Req 12.2） -->
      <button
        v-if="hasSpeech"
        type="button"
        class="word-card__replay"
        :disabled="disabled"
        aria-label="重播发音"
        @click="replay"
      >
        <span class="word-card__replay-icon" aria-hidden="true">🔊</span>
        <span class="word-card__replay-text">重播发音</span>
      </button>
    </div>

    <!-- 音频失败提示：不阻塞作答（Req 8.7） -->
    <p v-if="audioFailed" class="word-card__audio-error" role="alert">
      音频播放失败，请按图片和拼写作答
    </p>

    <!-- 作答区：9.3 选项构造器产出 4 选项，ChoicePad 点选作答（Req 8.4） -->
    <ChoicePad
      v-if="builtOptions !== null"
      :options="builtOptions.options"
      :selected-id="selectedOptionId"
      :disabled="disabled"
      @select="onSelect"
    />
    <p v-else class="word-card__options-error" role="alert">
      本题选项加载失败，请跳过本题
    </p>
  </div>
</template>

<script lang="ts">
/** AudioService 的 provide/inject 注入键（应用根部 provide 后全局生效） */
export const AUDIO_SERVICE_INJECT_KEY = 'kla-audio-service';
</script>

<script setup lang="ts">
/**
 * WordCard 单词卡组件（题型交互组件）
 *
 * 依据 design.md「题型交互组件」与 tasks.md 12.4：
 * - 卡片展示图片 + 拼写（Req 8.2）
 * - 展示时自动朗读发音一次（Req 8.3）；重播按钮不限次重播（Req 8.6），
 *   触控区域 ≥44×44px（Req 12.2）
 * - 发音方案：优先播放 media.audio 音频文件（public/audio/...，由
 *   scripts/generate_audio.py 预生成）；文件缺失或播放失败时回退 TTS
 *   （Web Speech API）朗读本卡正确拼写（如 "hello"）
 * - 文件与 TTS 均失败：显示"音频播放失败"提示，
 *   图片与拼写仍可见、作答不受影响（Req 8.7）
 * - 作答：调用 9.3 的 buildWordCardOptions 构造 4 选项（1 正确 + 3 干扰），
 *   渲染 ChoicePad 点选；点选后 emit('answer', { selectedOptionId, correctOptionId })，
 *   由父组件交 judge 的 choice 规则判定（Req 8.4）
 * - AudioService 可注入：优先 props.audioService，其次 provide/inject
 *   （注入键 'kla-audio-service'），最后回退到共享默认实例，便于单元测试 mock
 * - mode 可选 'image' | 'spelling'；缺省按题目形态自动判定
 *   （选项以图片为主 → image，否则 → spelling）
 */

import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Question } from '../../types';
import {
  buildWordCardOptions,
  extractWordCardImage,
  extractWordCardSpelling,
  type WordCardOptionMode,
  type WordCardOptionsResult,
} from '../../engine/wordCardOptions';
import {
  AudioPlaybackError,
  audioService as defaultAudioService,
  type AudioService,
} from '../../services/audioService';
import ChoicePad from './ChoicePad.vue';

interface Props {
  /** 当前单词卡题目（type 必须为 'word_card'） */
  question: Question;
  /** 干扰项题池（通常为同学科/年级的全部单词卡；可含本题，会自动排除） */
  pool: readonly Question[];
  /** 可注入的 AudioService（测试时传入 mock）；不传则取 inject 或共享默认实例 */
  audioService?: AudioService;
  /** 选项模式；缺省按题目形态自动判定（选项含图片 → 'image'，否则 → 'spelling'） */
  mode?: WordCardOptionMode;
  /** 作答锁定（答题判定后禁止再改） */
  disabled?: boolean;
  /** 随机源（与 Math.random 同契约），测试可注入确定性随机 */
  rand?: () => number;
}

const props = withDefaults(defineProps<Props>(), {
  audioService: undefined,
  mode: undefined,
  disabled: false,
  rand: undefined,
});

const emit = defineEmits<{
  /** 点选某个选项；携带所选选项 id 与正确选项 id，由父组件交 judge 判定 */
  (e: 'answer', payload: { selectedOptionId: string; correctOptionId: string }): void;
}>();

// ============ 注入的音频服务 ============

const injectedAudioService = inject<AudioService | null>(AUDIO_SERVICE_INJECT_KEY, null);
const service = computed<AudioService>(
  () => props.audioService ?? injectedAudioService ?? defaultAudioService,
);

const randomSource = computed<() => number>(() => props.rand ?? Math.random);

// ============ 卡片展示内容 ============

/** 卡片图片：优先 media.image，否则取正确选项图片（Req 8.2） */
const cardImage = computed<string | null>(() => extractWordCardImage(props.question));
/** 卡片拼写：answer.choice 指向的选项文本，或从题干引号中提取（Req 8.2） */
const cardSpelling = computed<string | null>(() => extractWordCardSpelling(props.question));
/** 是否有发音来源（音频文件或可 TTS 朗读的拼写文本，任一即可） */
const hasSpeech = computed<boolean>(
  () =>
    (cardSpelling.value ?? '') !== '' ||
    (typeof props.question.media?.audio === 'string' && props.question.media.audio !== ''),
);
/** 卡片图片是否加载失败（图片资源缺失时隐藏 img，仅展示拼写，不阻塞作答） */
const imageFailed = ref(false);

// ============ 选项构造（接 9.3 构造器） ============

/** 实际使用的选项模式：props.mode 优先，否则按题目形态自动判定 */
const effectiveMode = computed<WordCardOptionMode>(() => {
  if (props.mode !== undefined) {
    return props.mode;
  }
  const options = props.question.options ?? [];
  const hasImageOption = options.some((o) => typeof o.image === 'string' && o.image !== '');
  const hasTextOption = options.some((o) => typeof o.text === 'string' && o.text !== '');
  // 选项只有图片、没有文本时按图片 4 选 1；其余一律按拼写 4 选 1
  return hasImageOption && !hasTextOption ? 'image' : 'spelling';
});

/** 构造的 4 选项结果；构造彻底失败（两种模式均抛错）时为 null */
const builtOptions = ref<WordCardOptionsResult | null>(null);

/**
 * 构造 4 选项：先按生效模式构造，image 模式小池不足时降级到 spelling 模式
 * （spelling 模式对非空正确拼写恒可构造，见 wordCardOptions.ts 的小池兜底）。
 */
function rebuildOptions(): void {
  try {
    builtOptions.value = buildWordCardOptions(
      props.question,
      props.pool,
      randomSource.value,
      effectiveMode.value,
    );
    return;
  } catch {
    // 落入降级：image 模式题池图片不足时换 spelling 模式
  }
  if (effectiveMode.value !== 'spelling') {
    try {
      builtOptions.value = buildWordCardOptions(
        props.question,
        props.pool,
        randomSource.value,
        'spelling',
      );
      return;
    } catch {
      // 继续落入失败态
    }
  }
  builtOptions.value = null;
}

// ============ 发音朗读（TTS 自动一次 + 不限次重播） ============

/** 音频是否播放失败（用于降级提示，Req 8.7） */
const audioFailed = ref(false);

/** 播放发音：音频文件优先，失败回退 TTS 朗读拼写；均失败仅展示提示，绝不抛出阻塞作答 */
async function playPronunciation(): Promise<void> {
  const url = props.question.media?.audio;
  if (typeof url === 'string' && url !== '') {
    try {
      await service.value.playPronunciation(url);
      audioFailed.value = false;
      return;
    } catch {
      // 音频文件缺失/播放失败：继续回退 TTS
    }
  }
  const text = cardSpelling.value;
  if (text === null || text === '') {
    audioFailed.value = true;
    return;
  }
  try {
    await service.value.speakText(text);
    audioFailed.value = false;
  } catch (err) {
    if (err instanceof AudioPlaybackError) {
      audioFailed.value = true;
    } else {
      // 非预期错误同样按失败降级处理，不影响作答
      audioFailed.value = true;
    }
  }
}

/** 重播按钮：不限次重播（Req 8.6） */
function replay(): void {
  void playPronunciation();
}

// ============ 作答 ============

/** 当前选中选项 id（受控传给 ChoicePad） */
const selectedOptionId = ref<string | undefined>(undefined);

/** 点选某个选项：记录选中态并上抛给父组件判定 */
function onSelect(selectedId: string): void {
  if (props.disabled || builtOptions.value === null) {
    return;
  }
  selectedOptionId.value = selectedId;
  emit('answer', {
    selectedOptionId: selectedId,
    correctOptionId: builtOptions.value.correctOptionId,
  });
}

// ============ 生命周期：展示时自动播放一次（Req 8.3） ============

/** 换题重置：清选中态、清失败提示、重构选项、自动播放一次 */
function resetForQuestion(): void {
  selectedOptionId.value = undefined;
  audioFailed.value = false;
  imageFailed.value = false;
  rebuildOptions();
  void playPronunciation();
}

onMounted(resetForQuestion);

onBeforeUnmount(() => {
  // 卸载即停止发音：避免离开练习页/题型切换后音频继续播放，与下一张卡片叠加
  service.value.stopAll();
});

watch(
  () => props.question.id,
  () => resetForQuestion(),
);
</script>

<style scoped>
.word-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  width: 100%;
}

/* ---- 卡片展示区：大号圆角卡通卡片（Req 12.1） ---- */
.word-card__display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 360px;
  padding: 24px;
  border: 4px solid #ffd166;
  border-radius: 28px;
  background: linear-gradient(180deg, #fffdf5 0%, #fff3d6 100%);
  box-shadow: 0 6px 0 #f0b429;
}

.word-card__image {
  width: 180px;
  height: 180px;
  object-fit: contain;
  border-radius: 20px;
  background-color: #ffffff;
}

.word-card__spelling {
  font-size: 34px;
  font-weight: 800;
  color: #4a3b2a;
  letter-spacing: 2px;
  line-height: 1.2;
  word-break: break-word;
  text-align: center;
}

/* ---- 重播按钮：触控区域 ≥44×44px（Req 12.2） ---- */
.word-card__replay {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 44px;
  min-height: 44px;
  padding: 10px 20px;
  border: 3px solid #4d96ff;
  border-radius: 22px;
  background: linear-gradient(180deg, #cfe3ff 0%, #a8c9ff 100%);
  color: #1d4f9c;
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 4px 0 #3b78d8;
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease;
}

.word-card__replay:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 2px 0 #3b78d8;
}

.word-card__replay:disabled {
  cursor: default;
  opacity: 0.6;
}

.word-card__replay-icon {
  font-size: 22px;
  line-height: 1;
}

/* ---- 音频失败提示：醒目但不阻塞作答（Req 8.7） ---- */
.word-card__audio-error {
  margin: 0;
  padding: 10px 18px;
  border: 2px solid #ff9f1c;
  border-radius: 16px;
  background-color: #fff1d6;
  color: #8a5a00;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
}

.word-card__options-error {
  margin: 0;
  padding: 10px 18px;
  border: 2px solid #e07b7b;
  border-radius: 16px;
  background-color: #fdecec;
  color: #8a2a2a;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
}

/* ---- 锁定态 ---- */
.is-disabled .word-card__display {
  filter: saturate(0.9);
}

@media (max-width: 480px) {
  .word-card__display {
    padding: 18px;
  }

  .word-card__image {
    width: 140px;
    height: 140px;
  }

  .word-card__spelling {
    font-size: 28px;
  }
}
</style>
