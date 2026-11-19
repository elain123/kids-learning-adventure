<template>
  <div class="home-page">
    <!-- 卡通地图背景层（纯装饰，CSS 绘制天空/山丘 + emoji 角色与景物，无外部资源） -->
    <div class="home-page__map" aria-hidden="true">
      <span class="map-sun">🌞</span>
      <span class="map-cloud map-cloud--1">☁️</span>
      <span class="map-cloud map-cloud--2">☁️</span>
      <div class="map-hill map-hill--back"></div>
      <div class="map-hill map-hill--front"></div>
      <span class="map-castle">🏰</span>
      <span class="map-tree map-tree--1">🌳</span>
      <span class="map-tree map-tree--2">🌲</span>
      <span class="map-tree map-tree--3">🌳</span>
      <span class="map-flower map-flower--1">🌷</span>
      <span class="map-flower map-flower--2">🌼</span>
      <!-- 卡通角色形象（Req 12.1） -->
      <span class="map-character map-character--fox">🦊</span>
      <span class="map-character map-character--panda">🐼</span>
      <span class="map-character map-character--penguin">🐧</span>
    </div>

    <div class="home-page__content">
      <!-- 顶栏：星星余额（变化 1 秒内刷新，Req 5.9）+ 家长入口（child-grade-setting Req 1.1）+ 音效开关（Req 12.5） -->
      <header class="home-page__topbar">
        <div class="star-balance" role="status" aria-label="星星余额">
          <span class="star-balance__icon" aria-hidden="true">⭐</span>
          <span class="star-balance__count">{{ wallet.balance }}</span>
        </div>
        <div class="home-page__topbar-actions">
          <!-- Parent_Settings 入口：仅导航 /parent-settings，不启动任何练习（Req 1.1）；
               Child_Grade 未设置时显示红点角标（Req 1.8） -->
          <button
            type="button"
            class="parent-entry"
            :aria-label="childGrade === null ? '家长设置（还未设置孩子年级）' : '家长设置'"
            @click="goParentSettings"
          >
            <span class="parent-entry__icon" aria-hidden="true">👨‍👩‍👧</span>
            <span class="parent-entry__label">家长</span>
            <span
              v-if="childGrade === null"
              class="parent-entry__badge"
              aria-hidden="true"
            ></span>
          </button>
          <button
            type="button"
            class="sound-toggle"
            :aria-label="soundOn ? '关闭音效' : '开启音效'"
            :aria-pressed="soundOn"
            @click="toggleSound"
          >
            <span aria-hidden="true">{{ soundOn ? '🔊' : '🔇' }}</span>
          </button>
        </div>
      </header>

      <h1 class="home-page__title">
        <span class="home-page__title-mascot" aria-hidden="true">🦄</span>
        趣味学习冒险
      </h1>

      <!-- 题库整体加载失败：常显提示并停留首页，停止进入练习流程（Req 9.5） -->
      <div v-if="bankError" class="home-page__banner home-page__banner--error" role="alert">
        📦 题库加载失败，请重新打开应用再试
      </div>
      <!-- 无可出题：提示并停留首页，不进入练习界面（Req 1.7） -->
      <div v-else-if="showEmptyPrompt" class="home-page__banner" role="status">
        🌙 今天没有可以出的题目啦，明天再来冒险吧！
      </div>

      <!-- 今日冒险大按钮：首页唯一练习入口（Req 1.1），无科目/难度前置选择 -->
      <button
        type="button"
        class="adventure-button"
        :class="{ 'adventure-button--done': todayDone }"
        :disabled="bankError !== null"
        @click="onAdventureClick"
      >
        <template v-if="todayDone">
          <span class="adventure-button__icon" aria-hidden="true">✅</span>
          <span class="adventure-button__label">今日冒险已完成</span>
        </template>
        <template v-else>
          <span class="adventure-button__icon" aria-hidden="true">🗺️</span>
          <span class="adventure-button__label">今日冒险</span>
        </template>
      </button>

      <!-- 三科主题入口（主题形象入口，非练习前置选择，Req 13.1） -->
      <nav class="home-page__subjects" aria-label="学科主题入口">
        <router-link class="subject-entry subject-entry--chinese" to="/subject/chinese">
          <span class="subject-entry__icon" aria-hidden="true">📚</span>
          <span class="subject-entry__name">语文大陆</span>
        </router-link>
        <router-link class="subject-entry subject-entry--math" to="/subject/math">
          <span class="subject-entry__icon" aria-hidden="true">🏰</span>
          <span class="subject-entry__name">数学王国</span>
        </router-link>
        <router-link class="subject-entry subject-entry--english" to="/subject/english">
          <span class="subject-entry__icon" aria-hidden="true">🏝️</span>
          <span class="subject-entry__name">英语岛</span>
        </router-link>
      </nav>

      <!-- 宝箱与小岛入口 -->
      <nav class="home-page__extras" aria-label="宝箱与小岛入口">
        <router-link class="extra-entry" to="/box">
          <span aria-hidden="true">🎁</span>
          <span>宝箱</span>
        </router-link>
        <router-link class="extra-entry" to="/island">
          <span aria-hidden="true">⛱️</span>
          <span>我的小岛</span>
        </router-link>
      </nav>
    </div>

    <!-- 完成庆祝画面：当日全部完成后点击按钮展示，不进入练习（Req 1.5） -->
    <div
      v-if="showCelebration"
      class="celebration-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="今日冒险完成庆祝"
      @click.self="closeCelebration"
    >
      <span
        v-for="piece in confettiPieces"
        :key="piece.id"
        class="celebration-overlay__confetti"
        :style="{ left: piece.left, animationDelay: piece.delay }"
        aria-hidden="true"
        >{{ piece.emoji }}</span
      >
      <div class="celebration-card">
        <div class="celebration-card__emoji" aria-hidden="true">🎉🏆🎉</div>
        <p class="celebration-card__title">今日冒险全部完成！</p>
        <p class="celebration-card__subtitle">你太棒了，明天再来继续冒险吧！</p>
        <button type="button" class="celebration-card__close" @click="closeCelebration">
          太棒了！
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 首页地图页
 *
 * - 卡通地图背景与卡通角色（Req 12.1），全部按钮圆角、触控区域 ≥44×44px（Req 12.2）；
 * - "今日冒险"大按钮为首页唯一练习入口，无科目/难度前置选择（Req 1.1）；
 *   点击经 startAdventure 编排：当日有未答题则续练、未生成则生成（Req 1.3/1.4），
 *   随后直接导航 /practice 展示第一题，无任何中间选择页面（Req 1.2）；
 * - 当日全部完成后按钮呈"已完成"态，再次点击展示完成庆祝画面而不进入练习（Req 1.5）；
 * - 星星余额响应式展示，变化 1 秒内刷新（Req 5.9）；
 * - 宝箱（/box）与小岛（/island）入口；音效开关接 Feedback_Service（默认开，Req 12.5）；
 * - 顶栏家长入口（child-grade-setting Req 1.1）：仅导航 /parent-settings，不启动任何练习；
 *   Child_Grade 未设置时按钮带红点角标（child-grade-setting Req 1.8），已设置后不显示；
 * - 题库整体加载失败常显"题库加载失败"并停留首页（Req 9.5）；
 *   无可出题时提示并停留首页（Req 1.7）。
 *
 * Validates: Requirements 1.1, 1.2, 1.5, 1.7, 5.9, 9.5, 12.1, 12.5
 * Validates: child-grade-setting Requirements 1.1, 1.8
 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAppState } from '../stores/appState';

const appState = useAppState();
const router = useRouter();

// 共享响应式状态（星星余额变化即时刷新，Req 5.9）
const wallet = appState.wallet;
const soundOn = appState.soundOn;
const bankError = appState.bankError;
const todayDone = appState.todayDone;
// 孩子年级（child-grade-setting Req 4.3）：null = 未设置，驱动家长入口未设置角标（Req 1.8）
const childGrade = appState.childGrade;

/** 无可出题提示（Req 1.7） */
const showEmptyPrompt = ref(false);
/** 完成庆祝画面（Req 1.5） */
const showCelebration = ref(false);

/** 庆祝彩带（emoji，纯 CSS 动画） */
const confettiPieces = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  emoji: ['🎊', '⭐', '🎈', '✨'][i % 4],
  left: `${(i * 83) % 100}%`,
  delay: `${(i % 6) * 0.25}s`,
}));

onMounted(() => {
  // 从练习/宝箱页返回时同步最新会话（驱动"已完成"态，Req 1.5）
  appState.refreshSession();
});

/** 点击"今日冒险"：主流程编排（Req 1.2/1.3/1.4/1.5/1.7/9.5） */
function onAdventureClick(): void {
  const result = appState.startAdventure();
  switch (result.kind) {
    case 'ready':
      // 直接导航练习页展示第一题，无任何中间选择页面（Req 1.2）
      showEmptyPrompt.value = false;
      showCelebration.value = false;
      void router.push('/practice');
      break;
    case 'done':
      // 全部完成：展示完成庆祝画面而不进入练习（Req 1.5）
      showEmptyPrompt.value = false;
      showCelebration.value = true;
      break;
    case 'empty':
      // 无可出题：提示并停留首页（Req 1.7）
      showEmptyPrompt.value = true;
      break;
    case 'fatal':
      // 题库加载失败：常显提示并保持停留首页（Req 9.5）
      break;
  }
}

/** 音效开关（Req 12.5、12.6、12.7：经 Feedback_Service 持久化） */
function toggleSound(): void {
  appState.setSoundOn(!soundOn.value);
}

/** 家长入口：仅导航 /parent-settings，不启动任何练习（child-grade-setting Req 1.1） */
function goParentSettings(): void {
  void router.push('/parent-settings');
}

function closeCelebration(): void {
  showCelebration.value = false;
}
</script>

<style scoped>
/* ============ 页面容器与卡通地图背景（Req 12.1） ============ */

.home-page {
  position: relative;
  min-height: 100dvh;
  overflow-x: hidden;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.home-page__map {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: linear-gradient(180deg, #7ec8f7 0%, #b8e6ff 45%, #d9f4e3 100%);
}

.map-sun {
  position: absolute;
  top: 4%;
  right: 8%;
  font-size: 64px;
  filter: drop-shadow(0 0 18px rgba(255, 214, 64, 0.8));
  animation: sun-glow 4s ease-in-out infinite;
}

@keyframes sun-glow {
  0%,
  100% {
    transform: scale(1) rotate(0deg);
  }
  50% {
    transform: scale(1.08) rotate(8deg);
  }
}

.map-cloud {
  position: absolute;
  font-size: 56px;
  opacity: 0.95;
  animation: cloud-drift 12s ease-in-out infinite;
}

.map-cloud--1 {
  top: 8%;
  left: 6%;
}

.map-cloud--2 {
  top: 16%;
  left: 55%;
  font-size: 44px;
  animation-delay: -6s;
}

@keyframes cloud-drift {
  0%,
  100% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(28px);
  }
}

.map-hill {
  position: absolute;
  bottom: -18%;
  border-radius: 50% 50% 0 0;
}

.map-hill--back {
  left: -20%;
  width: 75%;
  height: 42%;
  background: #8fd694;
}

.map-hill--front {
  right: -25%;
  width: 90%;
  height: 36%;
  background: #6ec173;
}

.map-castle {
  position: absolute;
  bottom: 22%;
  right: 10%;
  font-size: 72px;
}

.map-tree {
  position: absolute;
  font-size: 44px;
}

.map-tree--1 {
  bottom: 16%;
  left: 8%;
}

.map-tree--2 {
  bottom: 24%;
  left: 22%;
  font-size: 38px;
}

.map-tree--3 {
  bottom: 12%;
  right: 32%;
  font-size: 40px;
}

.map-flower {
  position: absolute;
  font-size: 28px;
}

.map-flower--1 {
  bottom: 8%;
  left: 14%;
}

.map-flower--2 {
  bottom: 6%;
  right: 18%;
}

/* 卡通角色：轻轻跳动（Req 12.1） */
.map-character {
  position: absolute;
  font-size: 52px;
  animation: character-bounce 2.4s ease-in-out infinite;
}

.map-character--fox {
  bottom: 14%;
  left: 38%;
}

.map-character--panda {
  bottom: 10%;
  left: 55%;
  animation-delay: -0.8s;
}

.map-character--penguin {
  bottom: 18%;
  right: 24%;
  animation-delay: -1.6s;
}

@keyframes character-bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

/* ============ 前景内容 ============ */

.home-page__content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  max-width: 100%;
  min-height: 100dvh;
  padding: 16px 20px 40px;
  box-sizing: border-box;
}

.home-page__topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  max-width: 560px;
}

/* 星星余额（Req 5.9：响应式引用即时刷新） */
.star-balance {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 8px 18px;
  border: 3px solid #ffd166;
  border-radius: 999px;
  background-color: rgba(255, 253, 245, 0.95);
  box-shadow: 0 3px 0 #f0b429;
}

.star-balance__icon {
  font-size: 22px;
}

.star-balance__count {
  font-size: 22px;
  font-weight: 700;
  color: #4a3b2a;
}

/* 音效开关：触控区域 ≥44×44px（Req 12.2），圆角（Req 12.1） */
.sound-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  min-height: 48px;
  padding: 8px;
  border: 3px solid #ffd166;
  border-radius: 50%;
  background-color: rgba(255, 253, 245, 0.95);
  font-size: 22px;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 3px 0 #f0b429;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.sound-toggle:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #f0b429;
}

/* 顶栏右侧动作区：家长入口 + 音效开关 */
.home-page__topbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

/* Parent_Settings 入口（child-grade-setting Req 1.1）：触控区域 ≥44×44px，造型同音效开关 */
.parent-entry {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 48px;
  min-height: 48px;
  padding: 8px 14px;
  border: 3px solid #ffd166;
  border-radius: 999px;
  background-color: rgba(255, 253, 245, 0.95);
  color: #4a3b2a;
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 3px 0 #f0b429;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.parent-entry:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #f0b429;
}

.parent-entry__icon {
  font-size: 22px;
}

/* 未设置角标（child-grade-setting Req 1.8）：红点提示家长完成孩子年级设置 */
.parent-entry__badge {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 14px;
  height: 14px;
  border: 2px solid #fffdf5;
  border-radius: 50%;
  background-color: #e63946;
}

.home-page__title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0 0;
  font-size: 34px;
  font-weight: 800;
  color: #2b5d34;
  text-shadow: 0 2px 0 rgba(255, 255, 255, 0.7);
}

.home-page__title-mascot {
  font-size: 40px;
}

/* 提示条（题库失败 Req 9.5 / 无可出题 Req 1.7） */
.home-page__banner {
  max-width: 560px;
  width: 100%;
  box-sizing: border-box;
  padding: 14px 18px;
  border: 3px solid #ffd166;
  border-radius: 18px;
  background-color: rgba(255, 253, 245, 0.97);
  color: #4a3b2a;
  font-size: 18px;
  font-weight: 600;
  text-align: center;
}

.home-page__banner--error {
  border-color: #ff8a80;
  background-color: #fff3f0;
  color: #b3261e;
}

/* 今日冒险大按钮：唯一练习入口（Req 1.1），圆角造型（Req 12.1） */
.adventure-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 240px;
  min-height: 120px;
  padding: 24px 48px;
  border: 4px solid #ff9f1c;
  border-radius: 36px;
  background: linear-gradient(180deg, #ffd166 0%, #ffb703 100%);
  color: #5b3a00;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 8px 0 #e07b00, 0 12px 24px rgba(224, 123, 0, 0.35);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.adventure-button:active:not(:disabled) {
  transform: translateY(4px);
  box-shadow: 0 4px 0 #e07b00, 0 8px 16px rgba(224, 123, 0, 0.3);
}

.adventure-button__icon {
  font-size: 52px;
}

.adventure-button__label {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 2px;
}

/* 已完成态（Req 1.5） */
.adventure-button--done {
  border-color: #74c69d;
  background: linear-gradient(180deg, #b7e4c7 0%, #95d5b2 100%);
  color: #1b4332;
  box-shadow: 0 8px 0 #52b788, 0 12px 24px rgba(82, 183, 136, 0.35);
}

.adventure-button--done:active:not(:disabled) {
  box-shadow: 0 4px 0 #52b788, 0 8px 16px rgba(82, 183, 136, 0.3);
}

.adventure-button:disabled {
  cursor: default;
  opacity: 0.6;
}

/* 三科主题入口（主题形象入口，非练习前置选择） */
.home-page__subjects {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px;
  width: 100%;
  max-width: 560px;
}

.subject-entry {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1 1 30%;
  min-width: 96px;
  min-height: 96px;
  padding: 14px 12px;
  border: 3px solid #ffd166;
  border-radius: 24px;
  background-color: rgba(255, 253, 245, 0.95);
  color: #4a3b2a;
  font-size: 18px;
  font-weight: 700;
  text-decoration: none;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 4px 0 #f0b429;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.subject-entry:active {
  transform: translateY(2px);
  box-shadow: 0 2px 0 #f0b429;
}

.subject-entry__icon {
  font-size: 36px;
}

.subject-entry--chinese {
  border-color: #ffadad;
  box-shadow: 0 4px 0 #e07a7a;
}

.subject-entry--math {
  border-color: #9bf6ff;
  box-shadow: 0 4px 0 #4ec3d8;
}

.subject-entry--english {
  border-color: #caffbf;
  box-shadow: 0 4px 0 #7ac74f;
}

/* 宝箱与小岛入口：触控区域 ≥44×44px（Req 12.2） */
.home-page__extras {
  display: flex;
  justify-content: center;
  gap: 16px;
}

.extra-entry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
  min-width: 120px;
  padding: 10px 22px;
  border: 3px solid #ffd166;
  border-radius: 999px;
  background-color: rgba(255, 253, 245, 0.95);
  color: #4a3b2a;
  font-size: 18px;
  font-weight: 700;
  text-decoration: none;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 4px 0 #f0b429;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.extra-entry:active {
  transform: translateY(2px);
  box-shadow: 0 2px 0 #f0b429;
}

/* ============ 完成庆祝画面（Req 1.5） ============ */

.celebration-overlay {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  background-color: rgba(43, 45, 66, 0.55);
  overflow: hidden;
}

.celebration-overlay__confetti {
  position: absolute;
  top: -8%;
  font-size: 32px;
  animation: confetti-fall 2.8s linear infinite;
}

@keyframes confetti-fall {
  0% {
    transform: translateY(0) rotate(0deg);
    opacity: 1;
  }
  100% {
    transform: translateY(120vh) rotate(360deg);
    opacity: 0.6;
  }
}

.celebration-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: 100%;
  max-width: 360px;
  padding: 32px 24px;
  border: 4px solid #ffd166;
  border-radius: 28px;
  background-color: #fffdf5;
  box-shadow: 0 10px 0 #f0b429, 0 20px 40px rgba(0, 0, 0, 0.25);
  animation: card-pop 0.35s ease;
}

@keyframes card-pop {
  0% {
    transform: scale(0.7);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.celebration-card__emoji {
  font-size: 48px;
}

.celebration-card__title {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  color: #4a3b2a;
  text-align: center;
}

.celebration-card__subtitle {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #8a7358;
  text-align: center;
}

.celebration-card__close {
  min-width: 160px;
  min-height: 52px;
  padding: 12px 32px;
  border: 3px solid #ff9f1c;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffd166 0%, #ffb703 100%);
  color: #5b3a00;
  font-size: 20px;
  font-weight: 800;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 4px 0 #e07b00;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.celebration-card__close:active {
  transform: translateY(2px);
  box-shadow: 0 2px 0 #e07b00;
}

/* 窄屏适配：标题与大按钮字号收缩，避免横向滚动（Req 11.2 基础保障） */
@media (max-width: 480px) {
  .home-page__title {
    font-size: 28px;
  }

  .adventure-button {
    min-width: 200px;
    min-height: 104px;
    padding: 20px 36px;
  }

  .adventure-button__icon {
    font-size: 44px;
  }

  .adventure-button__label {
    font-size: 26px;
  }

  .map-character {
    font-size: 42px;
  }

  .map-castle {
    font-size: 56px;
  }
}
</style>
