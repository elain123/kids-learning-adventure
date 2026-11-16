<!--
  学科入口页（/subject/:id，id ∈ chinese | math | english）

  契约（_Requirements: 13.1, 13.2, 13.6_）：
  - 语文大陆 / 数学王国 / 英语岛三个主题入口，各配独立卡通形象与主题配色（Req 13.1、12.1）；
  - 展示该学科今日进度：由 Local_Store 中的今日会话（Today_Session）推导"已答 X / Y 题"；
    尚无今日会话时按当前掌握度预生成该学科今日队列，展示"今天为你准备了 Y 道趣味题目"（不落盘）；
  - "开始冒险"大按钮由"今日冒险"同一机制驱动对应学科会话（Req 13.2）：
      · 今日已存在该学科会话（队列全部属于本学科）→ 沿用并续玩，不重生成；
      · 否则以按学科过滤的题库索引调用 Review_Engine.buildTodayQueue 生成新会话
        （复习题在前、新知识点题在后，与首页"今日冒险"同一条生成管线），
        createTodaySession 建会话后写入 Local_Store，再直接进入 /practice；
    全程不提供难度 / 年级 / 单元等任何科目外前置选择；
  - 今日该学科会话已完成时展示完成庆祝画面，不再进入练习（与 Req 1.5 首页口径一致）；
  - 页面不出现任何二期功能入口（无阅读理解 / 跟读评分 / 多步骤应用题 / 家长报告 / 多账号，Req 13.6）；
  - 非法学科 id 显示"迷路"提示并可返回首页；
  - 全部可点击元素触控区域 ≥ 44×44px（Req 12.2），星星余额展示与首页一致。
-->
<template>
  <!-- 合法学科页 -->
  <div v-if="theme" class="subject-page" :class="`theme-${theme.id}`" data-testid="subject-page">
    <header class="top-bar">
      <button type="button" class="nav-btn" data-testid="back-home" @click="goHome">← 返回地图</button>
      <div class="star-pill" data-testid="star-balance" aria-label="星星余额">⭐ {{ starBalance }}</div>
    </header>

    <main class="hero">
      <span class="deco deco-1" aria-hidden="true">{{ theme.decos[0] }}</span>
      <span class="deco deco-2" aria-hidden="true">{{ theme.decos[1] }}</span>
      <span class="deco deco-3" aria-hidden="true">{{ theme.decos[2] }}</span>

      <div class="mascot" aria-hidden="true">{{ theme.mascot }}</div>
      <h1 class="subject-name">{{ theme.name }}</h1>
      <p class="slogan">{{ theme.slogan }}</p>

      <!-- 题库整体加载失败：停止进入练习流程（Req 9.5） -->
      <section v-if="bankFatal" class="progress-card error-card" data-testid="bank-error">
        <div class="card-emoji" aria-hidden="true">😵</div>
        <h2 class="card-title">题库加载失败</h2>
        <p class="card-text">题目们迷路了，请稍后再回来看看吧！</p>
      </section>

      <!-- 今日进度卡片 -->
      <section v-else-if="progress" class="progress-card" data-testid="today-progress">
        <h2 class="card-title">📅 今日进度</h2>

        <template v-if="progress.total > 0">
          <p v-if="progress.planned" class="card-text">
            今天为你准备了 <strong>{{ progress.total }}</strong> 道趣味题目！
          </p>
          <p v-else class="card-text">
            已答 <strong>{{ progress.answered }}</strong> / {{ progress.total }} 题
          </p>
          <div class="progress-track" role="progressbar" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-fill" :style="{ width: `${progressPercent}%` }"></div>
          </div>
          <p v-if="progress.done" class="done-badge" data-testid="done-badge">🎉 今日冒险已完成！</p>
        </template>

        <p v-else class="card-text" data-testid="empty-today">
          今天的题目都练完啦，去别的地方看看吧！
        </p>
      </section>

      <!-- 开始冒险大按钮：唯一练习入口，无任何前置选择（Req 13.2） -->
      <button
        v-if="!bankFatal && progress && progress.total > 0"
        type="button"
        class="start-btn"
        data-testid="start-adventure"
        @click="onStart"
      >
        {{ startLabel }}
      </button>

      <p v-if="emptyNotice" class="notice" data-testid="empty-notice">
        今天没有可以冒险的题目，去别的主题看看吧！
      </p>
      <p v-if="writeWarning" class="notice" data-testid="write-warning">
        本次进度可能无法保存
      </p>
    </main>

    <!-- 完成庆祝弹层：今日该学科会话已完成时点击按钮展示（Req 1.5 口径） -->
    <div v-if="showCelebration" class="overlay" data-testid="celebration" @click.self="showCelebration = false">
      <div class="celebration-card">
        <div class="cele-mascot" aria-hidden="true">{{ theme.mascot }}</div>
        <div class="cele-emoji" aria-hidden="true">🎉</div>
        <h2 class="cele-title">太棒了！</h2>
        <p class="cele-text">
          今天的{{ theme.subjectName }}冒险已经全部完成啦，明天再来继续探索吧！
        </p>
        <button type="button" class="cele-btn" data-testid="celebration-home" @click="goHome">🏠 返回冒险地图</button>
      </div>
    </div>
  </div>

  <!-- 非法学科 id：迷路提示 + 返回首页 -->
  <div v-else class="subject-page not-found-page" data-testid="subject-not-found">
    <div class="nf-card">
      <div class="nf-emoji" aria-hidden="true">🧭</div>
      <h1 class="nf-title">迷路啦！</h1>
      <p class="nf-text">没有找到这个神秘的地方，回冒险地图看看吧！</p>
      <button type="button" class="cele-btn" data-testid="not-found-home" @click="goHome">🏠 返回冒险地图</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import chineseJson from '../data/seed/questions-chinese.json';
import mathJson from '../data/seed/questions-math.json';
import englishJson from '../data/seed/questions-english.json';
import generatorsJson from '../data/seed/generators-math.json';

import {
  buildQuestionIndex,
  loadQuestionBank,
  type QuestionIndex,
} from '../data/questionBank';
import { createLocalStore } from '../data/localStore';
import { buildTodayQueue, shouldGenerateTodayQueue } from '../engine/reviewEngine';
import { createTodaySession } from '../engine/adventureEngine';
import type {
  GeneratorParams,
  QueueItem,
  SessionConfig,
  Subject,
} from '../types';

// ============ 主题定义：三学科卡通形象与配色（Req 13.1、12.1） ============

interface SubjectTheme {
  id: Subject;
  /** 主题地名，如 语文大陆 */
  name: string;
  /** 学科名，如 语文 */
  subjectName: string;
  /** 卡通吉祥物（emoji 形象） */
  mascot: string;
  slogan: string;
  /** 氛围装饰 emoji */
  decos: [string, string, string];
}

const THEMES: Record<Subject, SubjectTheme> = {
  chinese: {
    id: 'chinese',
    name: '语文大陆',
    subjectName: '语文',
    mascot: '🐼',
    slogan: '和熊猫小书生一起，踏上神奇的识字读诗之旅！',
    decos: ['🏔️', '📜', '🎋'],
  },
  math: {
    id: 'math',
    name: '数学王国',
    subjectName: '数学',
    mascot: '🦉',
    slogan: '和猫头鹰小法师一起，解开数字王国的秘密！',
    decos: ['🏰', '🔢', '✨'],
  },
  english: {
    id: 'english',
    name: '英语岛',
    subjectName: '英语',
    mascot: '🦜',
    slogan: '和鹦鹉多多一起，快乐收集单词宝石！',
    decos: ['🏝️', '🌊', '🐚'],
  },
};

// ============ 会话配置（与"今日冒险"机制同一条生成管线的上限配置） ============

const SUBJECT_SESSION_CONFIG: SessionConfig = {
  groupSize: 3,
  levelTargetMs: 10 * 60 * 1000,
  maxNewPerSession: 12,
  maxReviewPerSession: 12,
};

// ============ 题库加载（启动校验，坏题跳过；整体损坏则 fatal，Req 9.3-9.5） ============

interface BankLoad {
  index: QuestionIndex | null;
  fatal: string | null;
}

let bankCache: BankLoad | null = null;

function getBank(): BankLoad {
  if (bankCache !== null) return bankCache;
  const questions = [
    ...chineseJson.questions,
    ...mathJson.questions,
    ...englishJson.questions,
  ];
  const result = loadQuestionBank(JSON.stringify({ version: 1, questions }));
  bankCache =
    'fatal' in result
      ? { index: null, fatal: result.fatal }
      : { index: buildQuestionIndex(result.questions), fatal: null };
  return bankCache;
}

/** 全部口算生成器参数（仅数学学科使用，种子 JSON 结构经校验器约束） */
const ALL_GENERATORS = generatorsJson.generators as unknown as GeneratorParams[];

/** 按学科过滤题库索引：学科会话只从本学科知识点出题（Req 13.2） */
function filterIndexBySubject(index: QuestionIndex, subjectId: Subject): QuestionIndex {
  return buildQuestionIndex(index.all.filter((q) => q.subject === subjectId));
}

// ============ 页面状态 ============

const route = useRoute();
const router = useRouter();

const store = createLocalStore({
  onWriteError: () => {
    // Req 10.6：调度写失败时提示，内存态继续可用
    writeWarning.value = true;
  },
});

const bank = getBank();
const bankFatal = bank.fatal;

/** 学科今日进度（由今日会话推导；planned=true 表示尚无会话、为预生成预览） */
interface SubjectProgress {
  answered: number;
  total: number;
  done: boolean;
  planned: boolean;
}

const progress = ref<SubjectProgress | null>(null);
const starBalance = ref(0);
const showCelebration = ref(false);
const emptyNotice = ref(false);
const writeWarning = ref(false);

function resolveSubjectId(raw: unknown): Subject | null {
  const id = Array.isArray(raw) ? raw[0] : raw;
  return id === 'chinese' || id === 'math' || id === 'english' ? id : null;
}

const subjectId = computed<Subject | null>(() => resolveSubjectId(route.params.id));
const theme = computed<SubjectTheme | null>(() =>
  subjectId.value === null ? null : THEMES[subjectId.value],
);

/**
 * 生成该学科今日队列：与首页"今日冒险"同一条 Review_Engine 生成管线，
 * 仅将题库索引与口算生成器按学科过滤，保证复习题在前、新知识点题在后、
 * 到点判定与上限语义一致（Req 13.2）。
 */
function buildSubjectQueue(subject: Subject, now: number): QueueItem[] {
  if (bank.index === null) return [];
  const subjectIndex = filterIndexBySubject(bank.index, subject);
  const subjectGenerators = subject === 'math' ? ALL_GENERATORS : [];
  const mastery = store.read('mastery');
  return buildTodayQueue(mastery, subjectIndex, now, SUBJECT_SESSION_CONFIG, subjectGenerators);
}

/** 刷新星星余额与今日进度展示 */
function refresh(): void {
  const current = subjectId.value;
  starBalance.value = store.read('wallet').balance;
  if (current === null || bankFatal !== null) {
    progress.value = null;
    return;
  }
  const now = Date.now();
  const existing = store.read('session:today');
  if (existing !== null && !shouldGenerateTodayQueue(existing, now)) {
    // 今日已有会话：全部属于本学科 → 直接推导；混合队列 → 取本学科部分
    const scoped = existing.queue.every((q) => q.subject === current);
    const subjectItems = scoped
      ? existing.queue
      : existing.queue.filter((q) => q.subject === current);
    if (subjectItems.length > 0) {
      const answeredCount = scoped
        ? Math.min(existing.currentIndex, existing.queue.length)
        : existing.queue.slice(0, existing.currentIndex).filter((q) => q.subject === current)
            .length;
      progress.value = {
        answered: answeredCount,
        total: subjectItems.length,
        done:
          existing.status === 'done' ||
          (subjectItems.length > 0 && answeredCount >= subjectItems.length),
        planned: false,
      };
      return;
    }
  }
  // 尚无今日会话（或会话不含本学科题目）：预生成预览，不写盘
  const planned = buildSubjectQueue(current, now);
  progress.value = { answered: 0, total: planned.length, done: false, planned: true };
}

// 同一组件实例在 /subject/:id 间切换时重算进度；首次挂载立即刷新
watch(subjectId, refresh, { immediate: true });

const progressPercent = computed(() => {
  const p = progress.value;
  if (p === null || p.total <= 0) return 0;
  return Math.min(100, Math.round((p.answered / p.total) * 100));
});

const startLabel = computed(() => {
  const p = progress.value;
  if (p !== null && p.done) return '已完成 🎉';
  if (p !== null && !p.planned && p.answered > 0) return '继续冒险 🚀';
  return '开始冒险 🚀';
});

function goHome(): void {
  router.push({ name: 'home' });
}

/**
 * 开始冒险：由"今日冒险"机制驱动本学科会话（Req 13.2）。
 * - 今日该学科会话已完成 → 展示完成庆祝画面，不进入练习（Req 1.5 口径）；
 * - 今日该学科会话已存在且有未完成题 → 沿用并直接进入 /practice 续玩（Req 3.9 口径）；
 * - 否则生成新的学科会话写入 Local_Store 后进入 /practice；
 * - 队列无可用题 → 停留本页并提示（Req 1.7 口径）。
 */
function onStart(): void {
  const current = subjectId.value;
  if (current === null || bankFatal !== null) return;
  emptyNotice.value = false;
  writeWarning.value = false;

  if (progress.value?.done) {
    showCelebration.value = true;
    return;
  }

  const now = Date.now();
  const existing = store.read('session:today');
  if (
    existing !== null &&
    !shouldGenerateTodayQueue(existing, now) &&
    existing.queue.length > 0 &&
    existing.queue.every((q) => q.subject === current)
  ) {
    // 沿用今日该学科会话续玩
    router.push({ name: 'practice' });
    return;
  }

  const queue = buildSubjectQueue(current, now);
  if (queue.length === 0) {
    emptyNotice.value = true;
    return;
  }
  const session = createTodaySession(queue, now);
  try {
    store.write('session:today', session);
  } catch {
    // Req 10.6：写失败提示"本次进度可能无法保存"，仍进入练习（由练习页按既有状态兜底）
    writeWarning.value = true;
  }
  router.push({ name: 'practice' });
}
</script>

<style scoped>
/* ============ 通用卡通基底（Req 12.1 卡通风格、圆角造型） ============ */

.subject-page {
  min-height: 100vh;
  min-height: 100dvh;
  box-sizing: border-box;
  padding: 16px 16px 48px;
  font-family: 'Comic Sans MS', 'Chalkboard SE', 'PingFang SC', 'Hiragino Sans GB',
    'Microsoft YaHei', sans-serif;
  color: #ffffff;
  position: relative;
  overflow-x: hidden;
}

/* 三主题配色：语文大陆（暖红橙）/ 数学王国（蓝紫王国）/ 英语岛（海岛青绿） */
.theme-chinese {
  background: linear-gradient(160deg, #ffb347 0%, #ff7e5f 55%, #e84c3d 100%);
}

.theme-math {
  background: linear-gradient(160deg, #5b9bd5 0%, #4a6fa5 55%, #6c5b9e 100%);
}

.theme-english {
  background: linear-gradient(160deg, #3ec6a7 0%, #2fa88f 55%, #58b368 100%);
}

.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  max-width: 480px;
  margin: 0 auto;
}

/* 全部按钮触控区域 ≥ 44×44px（Req 12.2） */
.nav-btn {
  min-width: 44px;
  min-height: 44px;
  padding: 0 18px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #5a4a42;
  font-size: 16px;
  font-weight: 800;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.12);
  transition: transform 0.12s ease;
}

.nav-btn:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12);
}

.star-pill {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 999px;
  background: #ffffff;
  color: #b8860b;
  font-size: 18px;
  font-weight: 900;
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.12);
}

.hero {
  position: relative;
  max-width: 480px;
  margin: 0 auto;
  padding-top: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

/* 漂浮装饰 emoji */
.deco {
  position: absolute;
  font-size: 40px;
  opacity: 0.85;
  animation: float 4s ease-in-out infinite;
  pointer-events: none;
}

.deco-1 {
  top: 8px;
  left: 4px;
}

.deco-2 {
  top: 40px;
  right: 8px;
  animation-delay: 1.2s;
}

.deco-3 {
  top: 150px;
  left: 16px;
  animation-delay: 2.1s;
}

.mascot {
  font-size: 96px;
  line-height: 1.1;
  animation: bob 2.2s ease-in-out infinite;
  filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.25));
}

.subject-name {
  margin: 8px 0 0;
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 2px;
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.15);
}

.slogan {
  margin: 8px 0 20px;
  font-size: 16px;
  font-weight: 700;
  opacity: 0.95;
}

/* 今日进度卡片 */
.progress-card {
  width: 100%;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.96);
  color: #5a4a42;
  border-radius: 28px;
  padding: 20px 24px;
  box-shadow: 0 8px 0 rgba(0, 0, 0, 0.1), 0 16px 32px rgba(0, 0, 0, 0.12);
  margin-bottom: 24px;
}

.card-emoji {
  font-size: 48px;
}

.card-title {
  margin: 0 0 10px;
  font-size: 20px;
  font-weight: 900;
}

.card-text {
  margin: 0 0 14px;
  font-size: 17px;
  font-weight: 700;
}

.card-text strong {
  font-size: 22px;
  color: #e2711d;
}

.progress-track {
  height: 18px;
  border-radius: 999px;
  background: #eee6da;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #ffd166, #ff9f1c);
  transition: width 0.4s ease;
}

.done-badge {
  display: inline-block;
  margin: 12px 0 0;
  padding: 6px 16px;
  border-radius: 999px;
  background: #d8f3dc;
  color: #2d6a4f;
  font-size: 16px;
  font-weight: 900;
}

.error-card {
  background: #fff3f0;
  color: #9d3b2e;
}

/* 开始冒险大按钮（触控区域远大于 44×44px） */
.start-btn {
  min-width: 240px;
  min-height: 64px;
  padding: 0 44px;
  border: none;
  border-radius: 999px;
  font-size: 26px;
  font-weight: 900;
  font-family: inherit;
  letter-spacing: 2px;
  color: #ffffff;
  cursor: pointer;
  box-shadow: 0 6px 0 rgba(0, 0, 0, 0.18), 0 14px 28px rgba(0, 0, 0, 0.2);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.start-btn:active {
  transform: translateY(4px);
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.18), 0 6px 12px rgba(0, 0, 0, 0.18);
}

.theme-chinese .start-btn {
  background: linear-gradient(180deg, #ff5f6d, #c9184a);
}

.theme-math .start-btn {
  background: linear-gradient(180deg, #4361ee, #3a0ca3);
}

.theme-english .start-btn {
  background: linear-gradient(180deg, #06d6a0, #118ab2);
}

.notice {
  margin: 16px 0 0;
  padding: 10px 20px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: #9d3b2e;
  font-size: 15px;
  font-weight: 800;
}

/* 完成庆祝弹层 */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 20;
}

.celebration-card,
.nf-card {
  background: #ffffff;
  color: #5a4a42;
  border-radius: 32px;
  padding: 32px 28px;
  max-width: 360px;
  width: 100%;
  text-align: center;
  box-shadow: 0 12px 0 rgba(0, 0, 0, 0.1), 0 24px 48px rgba(0, 0, 0, 0.25);
}

.cele-mascot {
  font-size: 72px;
  animation: bob 2.2s ease-in-out infinite;
}

.cele-emoji {
  font-size: 40px;
  margin-top: 4px;
}

.cele-title,
.nf-title {
  margin: 8px 0;
  font-size: 28px;
  font-weight: 900;
}

.cele-text,
.nf-text {
  margin: 0 0 20px;
  font-size: 16px;
  font-weight: 700;
}

.cele-btn {
  min-width: 200px;
  min-height: 48px;
  padding: 0 28px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffb703, #fb8500);
  color: #ffffff;
  font-size: 18px;
  font-weight: 900;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.15);
  transition: transform 0.12s ease;
}

.cele-btn:active {
  transform: translateY(3px);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.15);
}

/* 迷路页 */
.not-found-page {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg, #8ec5fc, #c9a7eb);
}

.nf-emoji {
  font-size: 72px;
  animation: bob 2.2s ease-in-out infinite;
}

/* 卡通动效 */
@keyframes bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0) rotate(-4deg);
  }
  50% {
    transform: translateY(-12px) rotate(4deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mascot,
  .deco,
  .cele-mascot,
  .nf-emoji {
    animation: none;
  }
}
</style>
