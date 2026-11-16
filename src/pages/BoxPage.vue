<template>
  <div class="box-page">
    <!-- 顶部栏：返回首页（≥44×44px 触控区域）+ 标题 + 星星余额（始终可见） -->
    <header class="box-header">
      <RouterLink to="/" class="back-home" data-testid="back-home" aria-label="返回首页">
        🏠 首页
      </RouterLink>
      <h1 class="box-title">神秘宝箱</h1>
      <div class="star-balance" data-testid="star-balance" aria-live="polite">
        ⭐ {{ balance }}
      </div>
    </header>

    <!-- 宝箱舞台 -->
    <div class="box-stage">
      <div
        class="chest"
        :class="{ shaking: opening, revealed: resultVisible }"
        data-testid="chest"
        aria-hidden="true"
      >
        <span class="chest-emoji">{{ resultVisible ? '🎁' : '🧰' }}</span>
        <template v-if="opening">
          <span class="sparkle sparkle-a">✨</span>
          <span class="sparkle sparkle-b">✨</span>
          <span class="sparkle sparkle-c">⭐</span>
        </template>
        <template v-else-if="resultVisible">
          <span class="sparkle sparkle-a">🌟</span>
          <span class="sparkle sparkle-b">✨</span>
          <span class="sparkle sparkle-c">💫</span>
        </template>
      </div>

      <!-- 开启入口：按钮旁标注消耗（Req 5.3），按钮触控区域 ≥44×44px（Req 12.2） -->
      <div class="open-row">
        <button
          type="button"
          class="open-btn"
          data-testid="open-box"
          :disabled="opening"
          @click="onOpen"
        >
          🗝️ 开启（{{ TREASURE_BOX_COST }} 星星）
        </button>
        <span class="cost-label" data-testid="cost-label">
          每次消耗 ⭐×{{ TREASURE_BOX_COST }}
        </span>
      </div>

      <!-- 产出展示：新收藏（Req 5.6） -->
      <div
        v-if="resultVisible && outcome === 'new' && producedItem"
        class="result-card result-new"
        data-testid="result-new"
        role="status"
      >
        <div class="result-emoji" aria-hidden="true">{{ emojiFor(producedItem.id) }}</div>
        <p class="result-title">🎉 新收藏！</p>
        <p class="result-name">{{ producedItem.name }}（{{ kindLabel(producedItem.kind) }}）</p>
        <p class="result-sub">已加入你的小岛收藏</p>
        <RouterLink to="/island" class="mini-link" data-testid="go-island">
          去小岛看看 🏝️
        </RouterLink>
      </div>

      <!-- 产出展示：重复返还 5 星（Req 5.7） -->
      <div
        v-else-if="resultVisible && outcome === 'duplicate' && producedItem"
        class="result-card result-duplicate"
        data-testid="result-duplicate"
        role="status"
      >
        <div class="result-emoji" aria-hidden="true">{{ emojiFor(producedItem.id) }}</div>
        <p class="result-title">已拥有，返还 {{ DUPLICATE_REFUND_STARS }} 星星</p>
        <p class="result-name">{{ producedItem.name }}</p>
        <p class="result-sub">+{{ DUPLICATE_REFUND_STARS }} ⭐ 已放回你的星星罐</p>
      </div>

      <!-- 星星不足提示 + 去闯关引导（Req 5.5） -->
      <div
        v-if="insufficientVisible"
        class="result-card result-insufficient"
        data-testid="insufficient-tip"
        role="alert"
      >
        <div class="result-emoji" aria-hidden="true">🌟</div>
        <p class="result-title">星星不足</p>
        <p class="result-sub">
          开启宝箱需要 {{ TREASURE_BOX_COST }} 颗星星，你还差 {{ missing }} 颗，去闯关赢星星吧！
        </p>
        <RouterLink to="/" class="go-practice" data-testid="go-practice">
          🚀 去闯关
        </RouterLink>
      </div>

      <!-- 存储写失败提示（Req 10.6）：内存态继续可用 -->
      <p v-if="saveWarning" class="save-warning" data-testid="save-warning">
        本次进度可能无法保存
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 宝箱页（Treasure_Box 开启页）
 *
 * _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7_
 * - Req 5.3：开启一次固定消耗 30 颗星星，"开启（30 星星）"按钮旁标注消耗数量；
 * - Req 5.4：余额 ≥30 时经 8.1 的 openTreasureBox 扣 30 并从 12 件可收集物中
 *   随机产出 1 件；
 * - Req 5.5：余额 <30 时阻止开启、钱包不变、展示"星星不足"提示并提供
 *   "去闯关"引导入口；
 * - Req 5.6：产出未拥有物品 → "新收藏！"并加入 Island_Collection（持久化）；
 * - Req 5.7：产出已拥有物品 → "已拥有，返还 5 星星"，不重复入收藏；
 * - Req 5.9：星星变化后 1 秒内更新界面余额（同一 ref 即时刷新 + 500ms 轮询
 *   与 storage 事件感知其他页面/标签页的变更）。
 *
 * 实现要点：
 * - 钱包/收藏状态：src/stores/appState.ts 尚未落地（并行任务 13.1 进行中），
 *   本页与 IslandPage 同模式，直接经 Local_Store 适配器读写 + ref 管理；
 *   开启成功后立即 write 落盘（满足变化后 1 秒内写入，Req 10.2），写失败
 *   捕获 LocalStoreWriteError 并提示"本次进度可能无法保存"（Req 10.6）；
 * - 宝箱音效：经 Feedback_Service 的 onTreasure() 播放（开关关闭时服务内部
 *   自动静默）；Audio_Service 不可用时 try/catch 兜底，不阻塞开箱；
 * - 宝箱动画：纯 CSS keyframes（开箱抖动 chest-shake + 星光浮动 sparkle-float），
 *   开箱后 900ms 揭示产出卡片（result-pop 弹入）。
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { DUPLICATE_REFUND_STARS, TREASURE_BOX_COST } from '../types';
import type { CollectibleItem, IslandCollection, StarWallet } from '../types';
import { createLocalStore } from '../data/localStore';
import { openTreasureBox } from '../engine/rewards';
import { createAudioService } from '../services/audioService';
import { createFeedbackService } from '../services/feedback';
import type { FeedbackService } from '../services/feedback';
import collectiblesSeed from '../data/seed/collectibles.json';

// ---- 可收集物 emoji 映射：以种子数据 collectibles.json 为准，缺 emoji 的物品本地兜底 ----

const SEED_EMOJIS: Record<string, string> = {};
for (const item of collectiblesSeed.items) {
  if ('emoji' in item && typeof item.emoji === 'string' && item.emoji.length > 0) {
    SEED_EMOJIS[item.id] = item.emoji;
  }
}

/** 种子中未配置 emoji 的物品兜底（deco-lighthouse 无 emoji 字段），与 IslandPage 保持一致 */
const FALLBACK_EMOJIS: Record<string, string> = {
  'deco-lighthouse': '🗼',
};

function emojiFor(id: string): string {
  return SEED_EMOJIS[id] ?? FALLBACK_EMOJIS[id] ?? '🎁';
}

function kindLabel(kind: CollectibleItem['kind']): string {
  return kind === 'pet' ? '宠物' : '装扮';
}

// ---- 钱包 / 收藏状态（Local_Store 直接读写 + ref） ----

const store = createLocalStore();
const wallet = ref<StarWallet>(store.read('wallet'));
const collection = ref<IslandCollection>(store.read('collection'));

/** 当前星星余额（顶部徽章始终可见） */
const balance = computed(() => wallet.value.balance);
/** 余额是否足以开启一次宝箱 */
const canOpen = computed(() => balance.value >= TREASURE_BOX_COST);
/** 距离可开启还差多少星星（星星不足提示用） */
const missing = computed(() => Math.max(0, TREASURE_BOX_COST - balance.value));

// ---- 宝箱音效（Feedback_Service，开关关闭时内部静默；不可用则跳过声音） ----

let feedback: FeedbackService | null = null;
try {
  feedback = createFeedbackService({ audio: createAudioService(), store });
} catch {
  // 音频环境不可用（如无 AudioContext）：跳过音效，不影响开箱功能
  feedback = null;
}

// ---- 开箱流程状态 ----

/** 开箱动画进行中（期间禁用按钮防止连点） */
const opening = ref(false);
/** 本次产出结果（仅 'new' | 'duplicate'；余额不足走 insufficientVisible 分支） */
const outcome = ref<'new' | 'duplicate' | null>(null);
/** 本次产出的物品 */
const producedItem = ref<CollectibleItem | null>(null);
/** 产出卡片是否揭示（开箱动画结束后展示） */
const resultVisible = ref(false);
/** 星星不足提示是否展示（Req 5.5） */
const insufficientVisible = ref(false);
/** 存储写失败提示（Req 10.6） */
const saveWarning = ref(false);

/** 揭示定时器（卸载时清理） */
let revealTimer: number | undefined;

/** 开箱动画时长（毫秒）：结束后揭示产出；余额在引擎调用时已即时更新，满足 1 秒内上屏 */
const REVEAL_DELAY_MS = 900;

/**
 * 点击"开启（30 星星）"。
 * - 余额 <30：不调用引擎扣减路径，钱包与收藏保持不变，展示"星星不足"
 *   提示与"去闯关"引导入口（Req 5.5）；
 * - 余额 ≥30：调用 8.1 的 openTreasureBox（纯函数，返回新钱包/收藏），
 *   立即更新界面余额并持久化，播放宝箱音效，动画结束后揭示产出。
 */
function onOpen(): void {
  if (opening.value) return;

  insufficientVisible.value = false;
  resultVisible.value = false;
  outcome.value = null;
  producedItem.value = null;

  if (!canOpen.value) {
    // 阻止开启：余额不变（Req 5.5）
    insufficientVisible.value = true;
    return;
  }

  const result = openTreasureBox(wallet.value, collection.value, Math.random);
  if (result.outcome === 'insufficient') {
    // 防御分支：引擎与前置校验一致，正常不会到达
    insufficientVisible.value = true;
    return;
  }

  // 钱包/收藏即时更新（Req 5.9：变化后 1 秒内上屏）
  wallet.value = result.wallet;
  collection.value = result.collection;
  outcome.value = result.outcome;
  producedItem.value = result.item ?? null;

  // 持久化：立即落盘（Req 10.2）；写失败提示且内存态继续可用（Req 10.6）
  try {
    store.write('wallet', result.wallet);
    store.write('collection', result.collection);
    saveWarning.value = false;
  } catch {
    saveWarning.value = true;
  }

  // 宝箱音效（Feedback_Service 内部按音效开关闸门；失败静默降级）
  try {
    feedback?.onTreasure();
  } catch {
    // 音效失败不阻塞开箱
  }

  // 开箱动画：抖动 + 星光，结束后揭示产出卡片
  opening.value = true;
  revealTimer = window.setTimeout(() => {
    opening.value = false;
    resultVisible.value = true;
  }, REVEAL_DELAY_MS);
}

// ---- 变化感知：轮询 + 跨标签页 storage 事件（与 IslandPage 同模式） ----

function refresh(): void {
  const latestWallet = store.read('wallet');
  if (
    latestWallet.balance !== wallet.value.balance ||
    latestWallet.totalEarned !== wallet.value.totalEarned
  ) {
    wallet.value = latestWallet;
  }
  const latestCollection = store.read('collection');
  const current = collection.value.items;
  const changed =
    latestCollection.items.length !== current.length ||
    latestCollection.items.some((id) => !current.includes(id));
  if (changed) {
    collection.value = latestCollection;
  }
}

function onStorage(event: StorageEvent): void {
  if (
    event.key === null ||
    event.key === store.keyFor('wallet') ||
    event.key === store.keyFor('collection')
  ) {
    refresh();
  }
}

let pollTimer: number | undefined;

onMounted(() => {
  refresh();
  // 500ms 轮询：配合 localStore 调度写入（<1s 落盘），变化后 1 秒内上屏（Req 5.9）
  pollTimer = window.setInterval(refresh, 500);
  window.addEventListener('storage', onStorage);
});

onBeforeUnmount(() => {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
  }
  if (revealTimer !== undefined) {
    window.clearTimeout(revealTimer);
  }
  window.removeEventListener('storage', onStorage);
});
</script>

<style scoped>
/* ============ 页面整体：星空紫渐变宝藏背景 ============ */

.box-page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 16px 16px 32px;
  background: linear-gradient(180deg, #3d2b6b 0%, #5b3f9e 55%, #7a5cc0 100%);
  font-family: 'Comic Sans MS', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

/* ============ 顶部栏 ============ */

.box-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  max-width: 720px;
  margin: 0 auto 16px;
}

/* 返回首页：触控区域 ≥44×44px（Req 12.2） */
.back-home {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: 8px 16px;
  border-radius: 999px;
  background: #ffffff;
  color: #4a3390;
  font-size: 18px;
  font-weight: bold;
  text-decoration: none;
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.25);
}

.back-home:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.25);
}

.box-title {
  flex: 1 1 auto;
  margin: 0;
  font-size: 28px;
  color: #ffd94d;
  text-shadow: 0 2px 0 rgba(40, 20, 90, 0.8);
  text-align: center;
}

/* 星星余额徽章：始终可见（Req 5.9） */
.star-balance {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 18px;
  border-radius: 999px;
  background: #ffcf3f;
  color: #7a4a00;
  font-size: 22px;
  font-weight: bold;
  box-shadow: 0 3px 0 rgba(150, 100, 0, 0.45);
}

/* ============ 宝箱舞台 ============ */

.box-stage {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 16px 28px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 0 0 3px rgba(255, 217, 77, 0.35);
  text-align: center;
}

/* ============ 宝箱与动画 ============ */

.chest {
  position: relative;
  display: inline-block;
  margin-bottom: 20px;
}

.chest-emoji {
  display: inline-block;
  font-size: 120px;
  line-height: 1;
  filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.35));
}

/* 开箱抖动动画 */
.chest.shaking .chest-emoji {
  animation: chest-shake 0.9s ease-in-out infinite;
}

/* 揭示后的轻微弹动 */
.chest.revealed .chest-emoji {
  animation: chest-bounce 0.6s ease-out 1;
}

@keyframes chest-shake {
  0%,
  100% {
    transform: rotate(0deg) scale(1);
  }
  20% {
    transform: rotate(-8deg) scale(1.05);
  }
  40% {
    transform: rotate(8deg) scale(1.1);
  }
  60% {
    transform: rotate(-6deg) scale(1.06);
  }
  80% {
    transform: rotate(6deg) scale(1.03);
  }
}

@keyframes chest-bounce {
  0% {
    transform: scale(0.6);
  }
  60% {
    transform: scale(1.15);
  }
  100% {
    transform: scale(1);
  }
}

/* 星光点缀：开箱时与揭示后漂浮 */
.sparkle {
  position: absolute;
  font-size: 28px;
  opacity: 0;
  animation: sparkle-float 1.2s ease-in-out infinite;
  pointer-events: none;
}

.sparkle-a {
  top: -14px;
  left: -18px;
}

.sparkle-b {
  top: 6px;
  right: -22px;
  animation-delay: 0.35s;
}

.sparkle-c {
  bottom: 2px;
  left: -26px;
  animation-delay: 0.7s;
}

@keyframes sparkle-float {
  0%,
  100% {
    opacity: 0;
    transform: translateY(6px) scale(0.7);
  }
  50% {
    opacity: 1;
    transform: translateY(-8px) scale(1.1);
  }
}

/* ============ 开启入口（按钮 + 消耗标注） ============ */

.open-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

/* 开启按钮：触控区域 ≥44×44px（Req 12.2），实际高度 64px 方便小学生点按 */
.open-btn {
  min-width: 220px;
  min-height: 44px;
  padding: 14px 28px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffd94d 0%, #ffb03a 100%);
  color: #6b3d00;
  font-size: 22px;
  font-weight: bold;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 5px 0 #b87a00, 0 8px 14px rgba(0, 0, 0, 0.3);
  transition: transform 0.08s ease, box-shadow 0.08s ease;
}

.open-btn:active:not(:disabled) {
  transform: translateY(3px);
  box-shadow: 0 2px 0 #b87a00, 0 4px 8px rgba(0, 0, 0, 0.3);
}

.open-btn:disabled {
  opacity: 0.65;
  cursor: default;
}

/* 按钮旁的消耗标注（Req 5.3） */
.cost-label {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 4px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: #8a5a00;
  font-size: 16px;
  font-weight: bold;
}

/* ============ 产出卡片 ============ */

.result-card {
  max-width: 420px;
  margin: 0 auto;
  padding: 20px 16px;
  border-radius: 24px;
  background: #fffdf4;
  border: 4px solid #ffd94d;
  box-shadow: 0 6px 0 rgba(120, 80, 10, 0.3);
  animation: result-pop 0.45s ease-out 1;
}

@keyframes result-pop {
  0% {
    opacity: 0;
    transform: scale(0.4);
  }
  70% {
    opacity: 1;
    transform: scale(1.06);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

.result-emoji {
  font-size: 72px;
  line-height: 1;
  margin-bottom: 8px;
}

.result-title {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: bold;
  color: #8a5a00;
}

.result-new .result-title {
  color: #d4680a;
}

.result-duplicate .result-title {
  color: #4a6fd0;
}

.result-insufficient {
  border-color: #9db4ff;
}

.result-insufficient .result-title {
  color: #3d5ab8;
}

.result-name {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: bold;
  color: #4a3a10;
}

.result-sub {
  margin: 0 0 12px;
  font-size: 16px;
  color: #7a6a3a;
}

/* 去小岛看看 / 去闯关：可点击元素触控区域 ≥44×44px（Req 12.2） */
.mini-link,
.go-practice {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 10px 24px;
  border-radius: 999px;
  font-size: 18px;
  font-weight: bold;
  text-decoration: none;
}

.mini-link {
  background: #7fd4f7;
  color: #0d4a66;
  box-shadow: 0 3px 0 rgba(13, 74, 102, 0.4);
}

.go-practice {
  background: linear-gradient(180deg, #8fdc7f 0%, #5cbf4f 100%);
  color: #ffffff;
  box-shadow: 0 4px 0 #3d8a32, 0 6px 10px rgba(0, 0, 0, 0.25);
}

.mini-link:active,
.go-practice:active {
  transform: translateY(2px);
  box-shadow: none;
}

/* ============ 存储写失败提示（Req 10.6） ============ */

.save-warning {
  margin: 16px auto 0;
  max-width: 420px;
  padding: 10px 16px;
  border-radius: 16px;
  background: #ffe3e3;
  color: #a03030;
  font-size: 15px;
  font-weight: bold;
}

/* ============ 小屏适配（≥320px 无横向滚动） ============ */

@media (max-width: 420px) {
  .box-title {
    font-size: 24px;
  }

  .star-balance {
    font-size: 18px;
  }

  .chest-emoji {
    font-size: 96px;
  }

  .open-btn {
    min-width: 200px;
    font-size: 20px;
  }
}
</style>
