<!--
  学科入口页 + Grade_Selector（/subject/:id，id ∈ chinese | math | english）

  契约（multi-grade-mistake-book _Requirements: 1.1-1.6, 3.1, 3.3, 3.4_）：
  - 语文大陆 / 数学王国 / 英语岛三个主题入口，各配独立卡通形象与主题配色
    （一期 Req 13.1、12.1 保留），星星余额展示与首页一致；
  - 英雄区下方展示年级网格：语文/数学按一年级至六年级升序共 6 个年级按钮，
    英语按三年级至六年级升序共 4 个（外研版三年级起点，不展示一、二年级，
    Req 1.1、1.2）；每个年级按钮触控区域 ≥44×44px（Req 1.4）；
  - 读取 Local_Store 的 Last_Grade 实体，经 markedGrade 计算标记：该学科
    Last_Grade 对应按钮显示"上次 ⭐"标记与差异化配色，其余按钮样式一致，
    至多标记一个（Req 1.5）；从未选择过年级时全部按钮样式一致、无任何标记
    （Req 1.6）；
  - 点击年级按钮即进入该学科该年级练习（Req 1.3：除年级外无任何前置选择，
    不再有独立的"开始冒险"按钮）：
      a. 先经 schedule 写入 Last_Grade（1 秒内落盘，Req 6.2）；
      b. 读取 session:subjects["{subject}:{grade}"] 组合会话；
      c. 今日该组合会话已完成 → 展示完成庆祝画面，不进入练习（Req 1.5 口径）；
      d. 今日该组合会话有未答题 → 导航 /practice?subject={s}&grade={g} 续练；
      e. 否则经 filterBankForGrade + filterGeneratorsForGrade 过滤后调用既有
         buildTodayQueue 生成新会话（队列中每道题学科与年级均等于所选值，
         Req 3.1），createTodaySession 建会话后按组合键写入 session:subjects
         （其余组合键逐值不变，Req 3.3），再导航 /practice?subject={s}&grade={g}；
      f. 生成队列为空（该年级无可用题）→ 提示"该年级暂无可用题目"并停留在
         Grade_Selector，不进入练习界面（Req 3.4）；
  - 首页"今日冒险"入口及其 session:today 流程不在本页改动范围（Req 1.7）；
  - 题库整体加载失败 → fatal 提示并停止进入练习流程（一期 Req 9.5 保留）；
  - 非法学科 id 显示"迷路"提示并可返回首页；
  - 页面不出现任何二期功能入口（无阅读理解 / 跟读评分 / 多步骤应用题 /
    家长报告 / 多账号，一期 Req 13.6 保留）。
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
      <section v-if="bankFatal" class="grade-card error-card" data-testid="bank-error">
        <div class="card-emoji" aria-hidden="true">😵</div>
        <h2 class="card-title">题库加载失败</h2>
        <p class="card-text">题目们迷路了，请稍后再回来看看吧！</p>
      </section>

      <!-- Grade_Selector：年级网格（Req 1.1、1.2；触控区域 ≥44×44px，Req 1.4） -->
      <section v-else class="grade-card" data-testid="grade-selector">
        <h2 class="card-title">🎒 选择你的年级</h2>
        <div class="grade-grid">
          <button
            v-for="grade in gradeOptions"
            :key="grade"
            type="button"
            class="grade-btn"
            :class="{ 'grade-btn--marked': grade === marked }"
            :data-grade="grade"
            data-testid="grade-option"
            @click="onSelectGrade(grade)"
          >
            <span class="grade-btn__label">{{ grade }}年级</span>
            <span
              v-if="grade === marked"
              class="grade-btn__mark"
              data-testid="last-grade-mark"
            >上次 ⭐</span>
          </button>
        </div>
      </section>

      <!-- 该年级无可用题：停留 Grade_Selector，不进入练习（Req 3.4） -->
      <p v-if="emptyGradeNotice" class="notice" data-testid="empty-grade-notice">
        该年级暂无可用题目
      </p>
      <p v-if="writeWarning" class="notice" data-testid="write-warning">
        本次进度可能无法保存
      </p>
    </main>

    <!-- 完成庆祝弹层：今日该学科该年级会话已完成时点击年级按钮展示（Req 1.5 口径） -->
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
import chineseG1Json from '../data/seed/questions-chinese-g1.json';
import chineseG2Json from '../data/seed/questions-chinese-g2.json';
import chineseG5Json from '../data/seed/questions-chinese-g5.json';
import chineseG6Json from '../data/seed/questions-chinese-g6.json';
import mathG1Json from '../data/seed/questions-math-g1.json';
import mathG2Json from '../data/seed/questions-math-g2.json';
import mathG5Json from '../data/seed/questions-math-g5.json';
import mathG6Json from '../data/seed/questions-math-g6.json';
import englishG5Json from '../data/seed/questions-english-g5.json';
import englishG6Json from '../data/seed/questions-english-g6.json';
import generatorsG1Json from '../data/seed/generators-math-g1.json';
import generatorsG2Json from '../data/seed/generators-math-g2.json';
import generatorsG5Json from '../data/seed/generators-math-g5.json';
import generatorsG6Json from '../data/seed/generators-math-g6.json';

import {
  buildQuestionIndex,
  filterBankForGrade,
  filterGeneratorsForGrade,
  loadQuestionBank,
  type QuestionIndex,
} from '../data/questionBank';
import { createLocalStore } from '../data/localStore';
import { buildTodayQueue, shouldGenerateTodayQueue } from '../engine/reviewEngine';
import { createTodaySession, nextUnanswered } from '../engine/adventureEngine';
import { gradeOptionsFor, markedGrade, type LastGrade } from '../engine/gradeSelector';
import { saveSubjectSession, subjectGradeKey, type SubjectGradeKey } from '../engine/subjectSession';
import type {
  GeneratorParams,
  QueueItem,
  SessionConfig,
  Subject,
  TodaySession,
} from '../types';

// ============ 主题定义：三学科卡通形象与配色（一期 Req 13.1、12.1，保留不变） ============

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

// ============ 题库加载（启动校验，坏题跳过；整体损坏则 fatal，一期 Req 9.3-9.5 保留） ============

interface BankLoad {
  index: QuestionIndex | null;
  fatal: string | null;
}

let bankCache: BankLoad | null = null;

function getBank(): BankLoad {
  if (bankCache !== null) return bankCache;
  // 聚合全部年级种子文件（既有三、四年级文件在前且内容不变，Req 2.4/2.7），
  // 保持一期学科队列的确定性顺序不变
  const questions = [
    ...chineseJson.questions,
    ...mathJson.questions,
    ...englishJson.questions,
    ...chineseG1Json.questions,
    ...chineseG2Json.questions,
    ...chineseG5Json.questions,
    ...chineseG6Json.questions,
    ...mathG1Json.questions,
    ...mathG2Json.questions,
    ...mathG5Json.questions,
    ...mathG6Json.questions,
    ...englishG5Json.questions,
    ...englishG6Json.questions,
  ];
  const result = loadQuestionBank(JSON.stringify({ version: 1, questions }));
  bankCache =
    'fatal' in result
      ? { index: null, fatal: result.fatal }
      : { index: buildQuestionIndex(result.questions), fatal: null };
  return bankCache;
}

/** 全部口算生成器参数（仅数学学科使用，聚合各年级生成器文件，种子 JSON 结构经校验器约束） */
const ALL_GENERATORS = [
  ...generatorsJson.generators,
  ...generatorsG1Json.generators,
  ...generatorsG2Json.generators,
  ...generatorsG5Json.generators,
  ...generatorsG6Json.generators,
] as unknown as GeneratorParams[];

// ============ 页面状态 ============

const route = useRoute();
const router = useRouter();

const store = createLocalStore({
  onWriteError: () => {
    // Req 6.8（一期 Req 10.6 同口径）：调度写失败时提示，内存态继续可用
    writeWarning.value = true;
  },
});

const bank = getBank();
const bankFatal = bank.fatal;

const starBalance = ref(0);
/** 本设备各学科 Last_Grade（Local_Store lastGrade 实体的内存镜像） */
const lastGrade = ref<LastGrade>({});
const showCelebration = ref(false);
const emptyGradeNotice = ref(false);
const writeWarning = ref(false);

function resolveSubjectId(raw: unknown): Subject | null {
  const id = Array.isArray(raw) ? raw[0] : raw;
  return id === 'chinese' || id === 'math' || id === 'english' ? id : null;
}

const subjectId = computed<Subject | null>(() => resolveSubjectId(route.params.id));
const theme = computed<SubjectTheme | null>(() =>
  subjectId.value === null ? null : THEMES[subjectId.value],
);

/** 本学科可选年级（升序）：语文/数学 6 个、英语 4 个（Req 1.1、1.2） */
const gradeOptions = computed<readonly number[]>(() =>
  subjectId.value === null ? [] : gradeOptionsFor(subjectId.value),
);

/**
 * 应标记"上次 ⭐"的年级：该学科 Last_Grade 属于本学科可选年级时返回该年级，
 * 否则为 null（不显示任何标记）；任意形态下至多标记一个按钮（Req 1.5、1.6）。
 */
const marked = computed<number | null>(() =>
  subjectId.value === null ? null : markedGrade(lastGrade.value, subjectId.value),
);

/** 刷新星星余额与 Last_Grade 展示 */
function refresh(): void {
  starBalance.value = store.read('wallet').balance;
  lastGrade.value = store.read('lastGrade');
  emptyGradeNotice.value = false;
}

// 同一组件实例在 /subject/:id 间切换时重算展示；首次挂载立即刷新
watch(subjectId, refresh, { immediate: true });

/**
 * 生成该学科该年级今日队列：与首页"今日冒险"同一条 Review_Engine 生成管线，
 * 仅将题库索引与口算生成器按学科+年级过滤，保证队列中每道题目的学科属性与
 * 年级属性均等于学生所选学科与年级（Req 3.1）；该年级无可用题时返回空队列。
 */
function buildSubjectGradeQueue(subject: Subject, grade: number, now: number): QueueItem[] {
  if (bank.index === null) return [];
  const gradeIndex = filterBankForGrade(bank.index, subject, grade);
  const generators =
    subject === 'math' ? filterGeneratorsForGrade(ALL_GENERATORS, grade) : [];
  const mastery = store.read('mastery');
  return buildTodayQueue(mastery, gradeIndex, now, SUBJECT_SESSION_CONFIG, generators);
}

function goHome(): void {
  router.push({ name: 'home' });
}

/**
 * 点击年级按钮：直接进入该学科该年级练习（Req 1.3，除年级外无其他前置选择）。
 * 流程（Req 1.3、3.1、3.3、3.4、6.2）：
 * a. schedule 写入 Last_Grade（1 秒内落盘）；
 * b. 读取 session:subjects["{subject}:{grade}"] 组合会话；
 * c. 今日该组合会话已完成 → 展示完成庆祝画面，不进入练习（Req 1.5 口径）；
 * d. 今日该组合会话有未答题 → 导航 /practice?subject={s}&grade={g} 续练；
 * e. 否则按学科+年级过滤后生成新会话，写入组合键（其余组合键逐值不变），再导航；
 * f. 生成队列为空 → 提示"该年级暂无可用题目"并停留在 Grade_Selector（Req 3.4）。
 */
function onSelectGrade(grade: number): void {
  const current = subjectId.value;
  if (current === null || bankFatal !== null) return;
  emptyGradeNotice.value = false;
  writeWarning.value = false;

  // a. 写入 Last_Grade（schedule 调度，1 秒内落盘，Req 6.2）；内存镜像同步更新标记
  const updatedLastGrade: LastGrade = { ...lastGrade.value, [current]: grade };
  lastGrade.value = updatedLastGrade;
  store.schedule('lastGrade', updatedLastGrade);

  const now = Date.now();
  // b. 读取该学科该年级组合会话
  const sessions = store.read('session:subjects');
  const key = subjectGradeKey(current, grade);
  const existing = sessions[key] ?? null;

  if (
    existing !== null &&
    existing.queue.length > 0 &&
    !shouldGenerateTodayQueue(existing, now)
  ) {
    if (nextUnanswered(existing) === null) {
      // c. 今日已完成 → 完成庆祝画面
      showCelebration.value = true;
      return;
    }
    // d. 有未答题 → 沿用该组合会话续练
    router.push({ name: 'practice', query: { subject: current, grade: String(grade) } });
    return;
  }

  // e. 生成新的学科年级会话并写入组合键
  const queue = buildSubjectGradeQueue(current, grade, now);
  if (queue.length === 0) {
    // f. 空队列 → 提示并停留（Req 3.4）
    emptyGradeNotice.value = true;
    return;
  }
  const session = createTodaySession(queue, now);
  try {
    store.write(
      'session:subjects',
      saveSubjectSession(sessions, key, session) as Record<SubjectGradeKey, TodaySession>,
    );
  } catch {
    // Req 6.8：写失败提示"本次进度可能无法保存"，仍进入练习（由练习页按既有状态兜底）
    writeWarning.value = true;
  }
  router.push({ name: 'practice', query: { subject: current, grade: String(grade) } });
}
</script>

<style scoped>
/* ============ 通用卡通基底（一期 Req 12.1 卡通风格、圆角造型，保留不变） ============ */

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

/* 全部按钮触控区域 ≥ 44×44px（一期 Req 12.2） */
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

/* 年级选择卡片（Grade_Selector 容器） */
.grade-card {
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
  margin: 0 0 14px;
  font-size: 20px;
  font-weight: 900;
}

.card-text {
  margin: 0 0 14px;
  font-size: 17px;
  font-weight: 700;
}

.error-card {
  background: #fff3f0;
  color: #9d3b2e;
}

/* 年级网格：语文/数学 6 个、英语 4 个年级按钮（Req 1.1、1.2） */
.grade-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

/*
 * 年级按钮（触控区域 ≥44×44px，Req 1.4）：
 * 未标记按钮共享同一样式（Req 1.6：无 Last_Grade 时全部按钮一致）。
 */
.grade-btn {
  min-width: 44px;
  min-height: 64px;
  padding: 8px 4px;
  border: none;
  border-radius: 20px;
  background: linear-gradient(180deg, #fff8ec, #ffeccb);
  color: #5a4a42;
  font-size: 20px;
  font-weight: 900;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.grade-btn:active {
  transform: translateY(3px);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12);
}

.grade-btn__label {
  line-height: 1.2;
}

/*
 * Last_Grade 标记按钮：差异化配色 + "上次 ⭐"图标标记，与其余按钮可见区分
 * （Req 1.5）；至多一个按钮携带该修饰（markedGrade 至多返回一个年级）。
 */
.grade-btn--marked {
  background: linear-gradient(180deg, #ffd166, #ff9f1c);
  color: #7a3e00;
  box-shadow: 0 4px 0 rgba(180, 100, 0, 0.45);
}

.grade-btn__mark {
  font-size: 12px;
  font-weight: 800;
  color: #a3540a;
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
