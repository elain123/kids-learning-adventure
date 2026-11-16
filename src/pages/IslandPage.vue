<template>
  <div class="island-page">
    <!-- 顶部栏：返回首页（≥44×44px 触控区域）+ 标题 + 已收集计数（Req 5.8） -->
    <header class="island-header">
      <RouterLink to="/" class="back-home" data-testid="back-home" aria-label="返回首页">
        🏠 首页
      </RouterLink>
      <h1 class="island-title">我的小岛</h1>
      <div class="collect-counter" data-testid="collect-counter" aria-live="polite">
        ⭐ 已收集 {{ collectedCount }}/{{ COLLECTIBLE_TOTAL }}
      </div>
    </header>

    <!-- 收集进度条 -->
    <div class="progress-track" role="progressbar" :aria-valuenow="collectedCount" :aria-valuemax="COLLECTIBLE_TOTAL">
      <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
    </div>

    <!-- 小岛场景：天空 + 草地（宠物区）+ 沙滩（装扮区） -->
    <div class="island-scene">
      <div class="sky-decor" aria-hidden="true">
        <span class="sun">☀️</span>
        <span class="cloud cloud-a">☁️</span>
        <span class="cloud cloud-b">⛅</span>
      </div>

      <!-- 宠物区（草地） -->
      <section class="zone pets-zone" data-testid="pets-zone" aria-label="宠物区">
        <h2 class="zone-title">🐾 宠物</h2>
        <div class="card-grid">
          <div
            v-for="item in pets"
            :key="item.id"
            class="collect-card"
            :class="{ locked: !isCollected(item.id) }"
            :data-item-id="item.id"
          >
            <span class="card-emoji" aria-hidden="true">{{ isCollected(item.id) ? emojiFor(item.id) : '❓' }}</span>
            <span class="card-name">{{ isCollected(item.id) ? item.name : '未收集' }}</span>
          </div>
        </div>
      </section>

      <!-- 装扮区（沙滩） -->
      <section class="zone deco-zone" data-testid="decorations-zone" aria-label="装扮区">
        <h2 class="zone-title">🏝️ 装扮</h2>
        <div class="card-grid">
          <div
            v-for="item in decorations"
            :key="item.id"
            class="collect-card"
            :class="{ locked: !isCollected(item.id) }"
            :data-item-id="item.id"
          >
            <span class="card-emoji" aria-hidden="true">{{ isCollected(item.id) ? emojiFor(item.id) : '❓' }}</span>
            <span class="card-name">{{ isCollected(item.id) ? item.name : '未收集' }}</span>
          </div>
        </div>
      </section>
    </div>

    <!-- 鼓励文案 -->
    <p v-if="collectedCount === 0" class="island-hint" data-testid="island-hint">
      小岛还空空的，快去闯关攒星星开宝箱，把伙伴接回家吧！🎁
    </p>
    <p v-else-if="collectedCount < COLLECTIBLE_TOTAL" class="island-hint" data-testid="island-hint">
      继续闯关开宝箱，把剩下的伙伴都收集齐吧！💪
    </p>
    <p v-else class="island-hint complete" data-testid="island-hint">
      🎉 太棒了！12 件宝贝全部收集完成！
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * 小岛展示页（Island_Page）
 *
 * _Requirements: 5.8_：展示 Island_Collection 中全部已收集的宠物与装扮，
 * 并展示已收集数量与可收集总数（"已收集 N/12"，N = collection.items.length，
 * 总数 = COLLECTIBLE_TOTAL）。
 *
 * 实现要点：
 * - 收藏数据经 Local_Store 适配器读取（collection 实体，{ items: string[] }）；
 * - 未收集物品显示为灰色 ❓ 剪影卡，方便孩子看到还可以收集什么；
 * - 响应式刷新（Req 5.9 模式）：挂载时读取一次，之后每 500ms 轮询
 *   Local_Store（localStore 调度写入 <1s 落盘，轮询保证变化后 1 秒内上屏），
 *   并监听 storage 事件即时感知其他标签页的变更；
 * - 卡通圆角风格；返回首页按钮触控区域 ≥44×44px（Req 12.2）。
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { COLLECTIBLE_ITEMS, COLLECTIBLE_TOTAL } from '../types';
import type { IslandCollection } from '../types';
import { createLocalStore } from '../data/localStore';
import collectiblesSeed from '../data/seed/collectibles.json';

// ---- 可收集物 emoji 映射：以种子数据 collectibles.json 为准，缺 emoji 的物品本地兜底 ----

const SEED_EMOJIS: Record<string, string> = {};
for (const item of collectiblesSeed.items) {
  if ('emoji' in item && typeof item.emoji === 'string' && item.emoji.length > 0) {
    SEED_EMOJIS[item.id] = item.emoji;
  }
}

/** 种子中未配置 emoji 的物品兜底（deco-lighthouse 无 emoji 字段） */
const FALLBACK_EMOJIS: Record<string, string> = {
  'deco-lighthouse': '🗼',
};

function emojiFor(id: string): string {
  return SEED_EMOJIS[id] ?? FALLBACK_EMOJIS[id] ?? '🎁';
}

// ---- 收藏状态（响应式） ----

const store = createLocalStore();
const collection = ref<IslandCollection>(store.read('collection'));

const collectedIds = computed(() => new Set(collection.value.items));
/** 已收集数量（Req 5.8：N 取自 collection.items.length） */
const collectedCount = computed(() => collection.value.items.length);
const progressPercent = computed(() =>
  Math.min(100, Math.round((collectedCount.value / COLLECTIBLE_TOTAL) * 100)),
);

const pets = COLLECTIBLE_ITEMS.filter((item) => item.kind === 'pet');
const decorations = COLLECTIBLE_ITEMS.filter((item) => item.kind === 'decoration');

function isCollected(id: string): boolean {
  return collectedIds.value.has(id);
}

// ---- 变化感知：轮询 + 跨标签页 storage 事件 ----

function refresh(): void {
  const latest = store.read('collection');
  const current = collection.value.items;
  const changed =
    latest.items.length !== current.length ||
    latest.items.some((id) => !current.includes(id));
  if (changed) {
    collection.value = latest;
  }
}

function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === store.keyFor('collection')) {
    refresh();
  }
}

let pollTimer: number | undefined;

onMounted(() => {
  refresh();
  // 500ms 轮询：配合 localStore 调度写入（<1s 落盘），变化后 1 秒内上屏
  pollTimer = window.setInterval(refresh, 500);
  window.addEventListener('storage', onStorage);
});

onBeforeUnmount(() => {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
  }
  window.removeEventListener('storage', onStorage);
});
</script>

<style scoped>
/* ============ 页面整体：海洋渐变背景 ============ */

.island-page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 16px 16px 32px;
  background: linear-gradient(180deg, #aee7ff 0%, #7fd4f7 45%, #4fb3e8 100%);
  font-family: 'Comic Sans MS', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

/* ============ 顶部栏 ============ */

.island-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  max-width: 720px;
  margin: 0 auto 12px;
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
  color: #2b7a4b;
  font-size: 18px;
  font-weight: bold;
  text-decoration: none;
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.12);
}

.back-home:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12);
}

.island-title {
  flex: 1 1 auto;
  margin: 0;
  font-size: 28px;
  color: #ffffff;
  text-shadow: 0 2px 0 rgba(30, 110, 160, 0.55);
  text-align: center;
}

/* 已收集计数（Req 5.8）：醒目徽章 */
.collect-counter {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 18px;
  border-radius: 999px;
  background: #ffcf3f;
  color: #7a4a00;
  font-size: 20px;
  font-weight: bold;
  box-shadow: 0 3px 0 rgba(150, 100, 0, 0.35);
}

/* ============ 进度条 ============ */

.progress-track {
  max-width: 720px;
  margin: 0 auto 16px;
  height: 16px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #ffd94d, #ffb03a);
  transition: width 0.4s ease;
}

/* ============ 小岛场景 ============ */

.island-scene {
  position: relative;
  max-width: 720px;
  margin: 0 auto;
  padding: 56px 16px 20px;
  border-radius: 28px;
  overflow: hidden;
  background: linear-gradient(180deg, #c9f0ff 0%, #c9f0ff 30%, #8fdc7f 30%, #6fce62 68%, #ffe1a1 68%, #ffd27a 100%);
  box-shadow: 0 6px 0 rgba(20, 90, 140, 0.18);
}

.sky-decor {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  pointer-events: none;
}

.sky-decor .sun {
  position: absolute;
  top: 8px;
  right: 20px;
  font-size: 34px;
}

.sky-decor .cloud {
  position: absolute;
  font-size: 26px;
  opacity: 0.9;
}

.sky-decor .cloud-a {
  top: 10px;
  left: 24px;
}

.sky-decor .cloud-b {
  top: 16px;
  left: 42%;
  font-size: 22px;
}

/* ============ 分区（宠物 / 装扮） ============ */

.zone {
  margin-bottom: 18px;
  padding: 12px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.35);
}

.zone-title {
  margin: 0 0 10px;
  font-size: 22px;
  color: #205020;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
}

.deco-zone .zone-title {
  color: #6b4a12;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 12px;
}

/* ============ 收集卡（圆角卡通） ============ */

.collect-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 110px;
  padding: 10px 6px;
  border-radius: 20px;
  background: #ffffff;
  border: 3px solid #ffe08a;
  box-shadow: 0 4px 0 rgba(120, 90, 20, 0.18);
}

.card-emoji {
  font-size: 44px;
  line-height: 1;
}

.card-name {
  font-size: 15px;
  font-weight: bold;
  color: #4a3a10;
}

/* 未收集：灰色剪影卡（❓ 占位） */
.collect-card.locked {
  background: #dfe6ea;
  border: 3px dashed #a8b6bd;
  box-shadow: none;
}

.collect-card.locked .card-emoji {
  filter: grayscale(1);
  opacity: 0.65;
}

.collect-card.locked .card-name {
  color: #7d8b93;
}

/* ============ 底部鼓励文案 ============ */

.island-hint {
  max-width: 720px;
  margin: 16px auto 0;
  padding: 12px 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.85);
  color: #3a6a2a;
  font-size: 17px;
  font-weight: bold;
  text-align: center;
}

.island-hint.complete {
  background: #fff3c2;
  color: #8a5a00;
}

/* ============ 小屏适配（≥320px 无横向滚动） ============ */

@media (max-width: 420px) {
  .island-title {
    font-size: 24px;
  }

  .collect-counter {
    font-size: 18px;
  }

  .card-grid {
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 10px;
  }

  .card-emoji {
    font-size: 38px;
  }
}
</style>
