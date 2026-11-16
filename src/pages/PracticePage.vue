<template>
  <div class="practice-page">
    <!-- 顶栏：退出（保存进度回首页，Req 2.8）+ Streak 实时计数（Req 4.4）+ 星星余额 -->
    <header class="practice-page__topbar">
      <button type="button" class="exit-btn" data-testid="exit-btn" @click="onExit">
        ✕ 退出
      </button>
      <div class="topbar-right">
        <span class="streak-pill" data-testid="streak" role="status" aria-label="连胜计数">
          🔥 连胜 {{ streak }}
        </span>
        <span class="star-pill" role="status" aria-label="星星余额">⭐ {{ wallet.balance }}</span>
      </div>
    </header>

    <!-- 进度元信息：第 X 组第 Y 题（Req 2.1）、难度徽章（信息展示）、口算倒计时（Req 7.4） -->
    <div class="practice-page__meta">
      <span v-if="progress" class="progress-pill" data-testid="progress" role="status">
        第 {{ progress.group }} 组 · 第 {{ progress.indexInGroup }} 题
      </span>
      <span
        v-if="effectiveDifficulty !== null"
        class="difficulty-pill"
        data-testid="difficulty-badge"
        role="status"
      >
        难度 Lv.{{ effectiveDifficulty
        }}<template v-if="session?.difficultyOffset === -1">（已自动调低 💪）</template>
      </span>
      <span
        v-if="isOralCurrent && countdownText !== ''"
        class="countdown-pill"
        :class="{ 'countdown-pill--urgent': (countdownMs ?? 0) <= 60_000 }"
        data-testid="countdown"
        role="timer"
      >
        ⏱ {{ countdownText }}
      </span>
    </div>

    <!-- 存储写失败提示（Req 10.6）：界面进度可见可继续 -->
    <div v-if="writeError" class="write-error" data-testid="write-error-banner" role="alert">
      💾 {{ writeError }}
    </div>

    <main v-if="session" class="practice-page__body">
      <!-- 题库题缺失 / 生成器参数缺失的防御卡（种子契约保证不发生，此处可跳过） -->
      <div v-if="unrenderable" class="missing-card" data-testid="missing-question" role="alert">
        <p class="missing-card__text">这道题迷路了，跳过它继续冒险吧！</p>
        <button
          type="button"
          class="big-btn big-btn--primary"
          data-testid="skip-question-btn"
          @click="skipUnrenderable"
        >
          跳过 ▶
        </button>
      </div>

      <!-- 题区：按题型渲染 12.x 交互组件 -->
      <section v-else-if="currentItem" class="question-area" data-testid="question-area">
        <p
          v-if="stemText !== '' && currentItem.type !== 'dictation'"
          class="question-area__stem"
          data-testid="question-stem"
        >
          {{ stemText }}
        </p>

        <!-- 生字听写：听写卡（自动播放读音、点选拼合） -->
        <DictationCard
          v-if="currentItem.type === 'dictation' && currentQuestion"
          :key="componentKey"
          :question="currentQuestion"
          :disabled="inputLocked"
          @answer="onDictationAnswer"
        />
        <!-- 拼音/多音字/古诗文接龙/判断/选择：点选（选项乱序展示，按 id 判定） -->
        <ChoicePad
          v-else-if="isChoiceType && currentQuestion"
          :key="componentKey"
          :options="shuffledOptions"
          :disabled="inputLocked"
          @select="onChoiceSelect"
        />
        <!-- 形近字/词语搭配/成语填空/单位换算（配对型）：拖拽 -->
        <DragMatch
          v-else-if="isDragType && currentQuestion"
          :key="componentKey"
          :targets="dragSplit.targets"
          :choices="dragSplit.choices"
          :disabled="inputLocked"
          @submit="onDragSubmit"
        />
        <!-- 口算（生成题）/填空/几何/单位换算（数值型）：数字键盘 -->
        <NumericKeypad
          v-else-if="isNumericType"
          :key="componentKey"
          v-model="keypadInput"
          :disabled="inputLocked"
          @submit="onNumericSubmit"
        />
        <!-- 英语单词卡：图片 + 拼写 + 4 选 1 -->
        <WordCard
          v-else-if="currentItem.type === 'word_card' && currentQuestion"
          :key="componentKey"
          :question="currentQuestion"
          :pool="englishPool"
          :disabled="inputLocked"
          @answer="onWordCardAnswer"
        />
      </section>
    </main>

    <!-- Hint 条：首错展示提示、不给答案，保留同一题重试（Req 4.1） -->
    <div v-if="hintEvent" class="hint-bar" data-testid="hint-bar" role="status">
      <span class="hint-bar__icon" aria-hidden="true">💡</span>
      <span class="hint-bar__text">{{ hintEvent.hint }}</span>
      <span class="hint-bar__retry">再试一次吧！</span>
    </div>

    <!-- 重试答对鼓励条（本题按答错记账，无星星，Req 4.3） -->
    <div
      v-if="encouragementMsg"
      class="encouragement-bar"
      data-testid="encouragement-bar"
      role="status"
      @click="proceedNow"
    >
      🌟 {{ encouragementMsg }}
    </div>

    <!-- 再错答案解析卡：答案 + ≤100 字解析 + 鼓励文案 + 下一题入口（Req 4.2） -->
    <div v-if="revealEvent" class="reveal-overlay">
      <div
        class="reveal-card"
        data-testid="reveal-card"
        role="dialog"
        aria-modal="true"
        aria-label="答案解析"
      >
        <div class="reveal-card__emoji" aria-hidden="true">📖</div>
        <p class="reveal-card__answer">
          <strong>正确答案：</strong>{{ formatRevealAnswer(revealEvent) }}
        </p>
        <p class="reveal-card__analysis">{{ revealEvent.analysis }}</p>
        <p class="reveal-card__encouragement">{{ revealEvent.encouragement }}</p>
        <button
          type="button"
          class="big-btn big-btn--primary"
          data-testid="next-question-btn"
          @click="proceedNow"
        >
          下一题 ▶
        </button>
      </div>
    </div>

    <!-- 答对庆祝动画（≤3 秒，Req 12.3）；点击可提前进入下一题 -->
    <div
      v-if="celebration"
      class="celebration-overlay"
      data-testid="celebration-overlay"
      @click="proceedNow"
    >
      <div class="celebration-burst" aria-hidden="true">🎉 ⭐ 🎊</div>
      <p class="celebration-text">答对啦！</p>
    </div>

    <!-- 小组结算弹层：完成一组 3 题后展示"继续/休息"（Req 2.3） -->
    <div
      v-if="overlay === 'group'"
      class="settlement-overlay"
      data-testid="group-settlement"
      role="dialog"
      aria-modal="true"
      aria-label="小组结算"
    >
      <div class="settlement-card">
        <div class="settlement-card__emoji" aria-hidden="true">🏅</div>
        <h2 class="settlement-card__title">本组完成！</h2>
        <p class="settlement-card__subtitle">做得真棒，要继续还是休息一下？</p>
        <div class="settlement-card__actions">
          <button
            type="button"
            class="big-btn big-btn--primary"
            data-testid="continue-btn"
            @click="onGroupContinue"
          >
            ▶ 继续
          </button>
          <button
            type="button"
            class="big-btn big-btn--rest"
            data-testid="rest-btn"
            @click="onRest"
          >
            😴 休息
          </button>
        </div>
      </div>
    </div>

    <!-- 10 分钟到点提示弹层（Req 2.2/2.6）；口算关到时附自动结算信息（Req 7.4-7.8） -->
    <div
      v-if="overlay === 'timeup'"
      class="settlement-overlay"
      data-testid="timeup-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="休息时间提示"
    >
      <div class="settlement-card">
        <div class="settlement-card__emoji" aria-hidden="true">⏰</div>
        <h2 class="settlement-card__title">时间到啦！</h2>
        <p v-if="timeupOralView" class="settlement-card__subtitle" data-testid="timeup-oral-settle">
          口算关自动结算：本关答对 {{ timeupOralView.score }} 题<template
            v-if="timeupOralView.previousBest !== null"
            >，历史最佳 {{ timeupOralView.previousBest }} 题</template
          >
          <span v-if="timeupOralView.isNewRecord" class="new-record-badge" data-testid="new-record-badge"
            >🏆 新纪录！</span
          >
        </p>
        <p v-else class="settlement-card__subtitle">已经玩了 10 分钟啦，要继续还是休息一下？</p>
        <div class="settlement-card__actions">
          <button
            type="button"
            class="big-btn big-btn--primary"
            data-testid="continue-btn"
            @click="onTimeupContinue"
          >
            ▶ 继续
          </button>
          <button
            type="button"
            class="big-btn big-btn--rest"
            data-testid="rest-btn"
            @click="onRest"
          >
            😴 休息
          </button>
        </div>
      </div>
    </div>

    <!-- 关卡结算弹层：+10 星星（Req 5.2）；口算关"本关答对 vs 历史最佳"与新纪录（Req 7.6-7.8） -->
    <div
      v-if="overlay === 'level'"
      class="settlement-overlay"
      data-testid="level-settlement"
      role="dialog"
      aria-modal="true"
      aria-label="关卡结算"
    >
      <div class="settlement-card">
        <div class="settlement-card__emoji" aria-hidden="true">🏆</div>
        <h2 class="settlement-card__title">关卡完成！</h2>
        <p v-if="justAwarded" class="settlement-card__stars" data-testid="level-stars">
          +{{ LEVEL_COMPLETION_STARS }} ⭐ 关卡完成奖励
        </p>
        <div v-if="oralSettlements.length > 0" class="oral-settles" data-testid="oral-best-compare">
          <p v-for="st in oralSettlements" :key="st.genParamsId" class="oral-settle-line">
            口算关：本关答对 {{ st.score }} 题 vs 历史最佳 {{ st.best }} 题
            <span v-if="st.isNewRecord" class="new-record-badge" data-testid="new-record-badge"
              >🏆 新纪录！</span
            >
          </p>
        </div>
        <p class="settlement-card__subtitle">今天的冒险全部完成啦！</p>
        <button
          type="button"
          class="big-btn big-btn--primary"
          data-testid="level-home-btn"
          @click="onLevelHome"
        >
          🏠 返回首页
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 练习页（/practice）与小组/关卡结算弹层 —— 纯函数引擎层的薄壳接线
 *
 * 题型 → 组件映射（12.x 交互组件）：
 * - dictation → DictationCard；pinyin/polyphone/poem_chain/judge/choice → ChoicePad
 *   （judge：选项 id 't'/'f' 或文案"正确/错误"映射为 bool 作答）；
 * - similar_char/word_match/idiom_fill/unit_conv(pairs) → DragMatch；
 * - blank/geometry/unit_conv(number)/oral → NumericKeypad
 *   （oral：kind='generated'，按 generatorParamsId 经 generateOralQuestion 生成，
 *   judgeGenerated 判定）；
 * - word_card → WordCard（题池 = 题库全部一期单词卡）。
 *
 * 作答流程（Req 4.1-4.8、5.1、6.5、8.5）：
 * - 组件作答事件 → judge 本地判定（1 秒内）→ applyFirstAnswer/applyRetry 定盘；
 * - 首对：feedback.onCorrect 庆祝（≤3 秒）+ addStars 发星（Req 5.1/5.9）；
 * - 首错：feedback.onFirstWrong → Hint 条（不给答案）+ 待重试态（同一题重挂作答组件）；
 * - 重对：按答错记账（Req 4.3，掌握度 applyAnswer(false) + Wrong_Set），鼓励文案后推进；
 * - 重错：feedback.onSecondWrong → 答案 + ≤100 字解析 + 鼓励 + 下一题入口（Req 4.2）。
 *
 * 掌握度与错题本：每题定盘时恰好记账一次（首对/重对/重错）；答错 requeue 时
 * 按 Req 3.4 向当日队列尾追加 source='retry' 的队列项（若会话恰好已 done 则回到 active）。
 *
 * 计时与结算：
 * - 口算关展示 10 分钟倒计时（Req 7.4），到时自动结算：未作答不计入答对数，
 *   越过该题并更新历史最佳（Req 7.5-7.8）；
 * - 关卡 10 分钟到点提示"继续/休息"（Req 2.2/2.6），"继续"重置本段计时起点；
 * - 小组完成展示"继续/休息"（Req 2.3）；"休息"/退出：保存进度回首页（Req 2.8）；
 * - 关卡完成（会话 done）：+10 星星（Req 5.2，仅本次页面会话内由作答推进到 done 时
 *   发放一次；重进已完成会话只展示不重复发放），口算关展示历史最佳对比与新纪录。
 *
 * 持久化口径（Req 2.4/10.2，变化后 1 秒内落盘）：
 * - 会话：appState.saveSession 立即写入（进度优先）；
 * - mastery/wrongSet/oralBest：store.schedule 调度写入（800ms < 1s），
 *   离开页面前 store.flush 强制落盘；
 * - 中途退出/休息时将本段计时折入 elapsedMs 并重置段起点（重进后续走，Req 2.5/2.7）。
 *
 * 难度下调展示说明：队列项题目在生成时已固定，difficultyOffset 无法改变既有题目，
 * 本页仅按 clampDifficulty 作信息展示（难度徽章与"已自动调低"标注），属信息性展示。
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 4.1, 4.2, 4.4, 5.2,
 *            7.4, 7.5, 7.6, 7.7, 7.8, 10.2
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import ChoicePad from '../components/question/ChoicePad.vue';
import DictationCard from '../components/question/DictationCard.vue';
import DragMatch from '../components/question/DragMatch.vue';
import NumericKeypad from '../components/question/NumericKeypad.vue';
import WordCard from '../components/question/WordCard.vue';

import { useAppState } from '../stores/appState';
import {
  applyFirstAnswer,
  applyRetry,
  clampDifficulty,
  groupIntoGroups,
  nextUnanswered,
} from '../engine/adventureEngine';
import { applyAnswer, localDateString } from '../engine/reviewEngine';
import { checkLevelClock, elapsedMs, remainingMs, settleOralLevel } from '../engine/sessionClock';
import { LEVEL_COMPLETION_STARS, awardLevelCompletion, updateOralBest } from '../engine/oralBest';
import { judgeGenerated, judgeQuestion, type StudentAnswer } from '../engine/judge';
import { generateOralQuestion } from '../engine/mathGenerator';
import { pickEncouragement } from '../data/encouragement';
import type { WrongSetItem } from '../data/localStore';
import type {
  AnswerRevealEvent,
  CelebrationEvent,
  HintEvent,
} from '../services/feedback';
import type {
  Difficulty,
  GeneratedQuestion,
  MasteryRecord,
  Question,
  QuestionOption,
  QueueItem,
  Subject,
  TodaySession,
} from '../types';

const appState = useAppState();
const router = useRouter();

// 共享响应式状态（App_State 为唯一状态源）
const session = appState.session;
const wallet = appState.wallet;
const writeError = appState.writeError;
const config = appState.sessionConfig;

/** 庆祝动画可见时长（≤ feedback 的 3 秒上限，Req 12.3） */
const CELEBRATION_VISIBLE_MS = 1200;
/** 重试答对鼓励条可见时长 */
const ENCOURAGEMENT_VISIBLE_MS = 1500;
/** 倒计时/关卡时钟 tick 间隔 */
const TICK_MS = 500;

// ============ 页面瞬时状态 ============

/** 当前口算生成题（kind='generated' 时由 watch 生成并缓存） */
const currentOral = ref<GeneratedQuestion | null>(null);
/** 数字键盘输入串（v-model） */
const keypadInput = ref('');
/** 作答组件重挂计数：首错重试时 +1 强制重挂，清空上次作答痕迹 */
const retryKey = ref(0);
/** 待重试态（首错后保留同一题，重试限 1 次） */
const pendingRetry = ref(false);
/** 首错 Hint 事件（Req 4.1） */
const hintEvent = ref<HintEvent | null>(null);
/** 再错答案解析事件（Req 4.2） */
const revealEvent = ref<AnswerRevealEvent | null>(null);
/** 重试答对鼓励文案 */
const encouragementMsg = ref<string | null>(null);
/** 答对庆祝事件（Req 12.3） */
const celebration = ref<CelebrationEvent | null>(null);
/** 当前展示的结算/提示弹层 */
const overlay = ref<'group' | 'timeup' | 'level' | null>(null);
/** 关卡时钟 tick 时钟（倒计时显示与到点检查共用） */
const nowTick = ref(Date.now());
/** 口算关到时自动结算信息（timeup 弹层展示） */
const timeupOralView = ref<OralSettleView | null>(null);
/** 关卡结算展示用口算结算列表 */
const oralSettlements = ref<OralSettleView[]>([]);
/** 本次页面会话内是否已发放过关卡完成 +10（防重复发放） */
const levelAwarded = ref(false);
/** 本次结算是否刚刚发放 +10（控制"+10 星星"文案展示） */
const justAwarded = ref(false);

/** 口算关结算展示信息 */
interface OralSettleView {
  genParamsId: string;
  score: number;
  best: number;
  previousBest: number | null;
  isNewRecord: boolean;
}

/** 本页面实例内已结算的口算关视图（genParamsId → 结算时快照，防重复结算） */
const oralViews = new Map<string, OralSettleView>();

/** 正被作答题目的快照（定盘后展示答案解析/错题记账用；定盘会推进 currentIndex） */
interface AnsweredSnapshot {
  item: QueueItem;
  question: Question | null;
  oral: GeneratedQuestion | null;
  /** 错题本 questionRef：题库题 id 或生成器完整签名 gen:{paramsId}:{operandsHash} */
  ref: string;
}
const answeredSnapshot = ref<AnsweredSnapshot | null>(null);

// ============ 当前题目解析 ============

const currentItem = computed<QueueItem | null>(() => {
  const s = session.value;
  return s === null ? null : nextUnanswered(s);
});

const currentQuestion = computed<Question | null>(() => {
  const item = currentItem.value;
  if (item === null || item.kind !== 'bank' || item.questionId === undefined) {
    return null;
  }
  return appState.bank?.byId.get(item.questionId) ?? null;
});

/** 当前题不可渲染（题库题缺失 / 生成器参数缺失）：展示防御跳过卡 */
const unrenderable = computed<boolean>(() => {
  const item = currentItem.value;
  if (item === null) return false;
  if (item.kind === 'bank') return currentQuestion.value === null;
  return currentOral.value === null;
});

/** 题干文本（生成题取生成结果，题库题取题目 stem） */
const stemText = computed<string>(() => {
  const item = currentItem.value;
  if (item === null) return '';
  if (item.kind === 'generated') return currentOral.value?.stem ?? '';
  return currentQuestion.value?.stem ?? '';
});

/** 作答组件重挂键：换题（currentIndex 变化）或重试（retryKey+1）时重挂 */
const componentKey = computed<string>(
  () => `${session.value?.currentIndex ?? 0}:${retryKey.value}`,
);

// ============ 题型分派 ============

const isChoiceType = computed<boolean>(() => {
  const t = currentItem.value?.type;
  return t === 'pinyin' || t === 'polyphone' || t === 'poem_chain' || t === 'judge' || t === 'choice';
});

const isDragType = computed<boolean>(() => {
  const item = currentItem.value;
  if (item === null) return false;
  if (item.type === 'similar_char' || item.type === 'word_match' || item.type === 'idiom_fill') {
    return true;
  }
  // 单位换算配对型（拖拽）；数值型走数字键盘
  return item.type === 'unit_conv' && currentQuestion.value?.answer.pairs !== undefined;
});

const isNumericType = computed<boolean>(() => {
  const item = currentItem.value;
  if (item === null) return false;
  if (item.type === 'blank' || item.type === 'geometry' || item.type === 'oral') {
    return true;
  }
  return item.type === 'unit_conv' && currentQuestion.value?.answer.number !== undefined;
});

/** 单词卡题池：题库全部一期单词卡（干扰项来源） */
const englishPool = computed<Question[]>(() => {
  if (!appState.bank) return [];
  return (appState.bank.bySubject.get('english') ?? []).filter(
    (q) => q.type === 'word_card' && q.phase === 1,
  );
});

/** DragMatch 目标槽/选项拆分：answer.pairs 的键为目标槽，其余选项为可拖选项 */
function splitPairOptions(q: Question): { targets: QuestionOption[]; choices: QuestionOption[] } {
  const options = q.options ?? [];
  const targetIds = new Set<string>();
  const pairs = q.answer.pairs;
  if (pairs !== undefined) {
    if (Array.isArray(pairs)) {
      for (const entry of pairs as ReadonlyArray<readonly [string, string]>) {
        targetIds.add(entry[0]);
      }
    } else {
      for (const targetId of Object.keys(pairs)) {
        targetIds.add(targetId);
      }
    }
  }
  return {
    targets: options.filter((o) => targetIds.has(o.id)),
    choices: options.filter((o) => !targetIds.has(o.id)),
  };
}

const dragSplit = computed<{ targets: QuestionOption[]; choices: QuestionOption[] }>(() =>
  currentQuestion.value !== null
    ? splitPairOptions(currentQuestion.value)
    : { targets: [], choices: [] },
);

// ============ 点选题选项乱序 ============

/** Fisher-Yates 洗牌（返回新数组，不改原数组） */
function shuffleOptions(options: readonly QuestionOption[]): QuestionOption[] {
  const arr = [...options];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * 点选题展示选项：每道题乱序一次（judge 按选项 id 判定，与展示顺序无关），
 * 避免正确答案总在固定位置缺乏挑战；判断题保持 正确/错误 原序。
 */
const shuffledOptions = ref<QuestionOption[]>([]);
watch(
  currentQuestion,
  (q) => {
    const options = q?.options ?? [];
    shuffledOptions.value =
      q !== null && currentItem.value?.type !== 'judge' && options.length > 1
        ? shuffleOptions(options)
        : [...options];
  },
  { immediate: true, flush: 'sync' },
);

// ============ Streak / 进度 / 难度 / 倒计时展示 ============

/** Streak 实时计数（Req 4.4） */
const streak = computed<number>(() => session.value?.streak ?? 0);

/** 进度"第 X 组 第 Y 题"：经 groupIntoGroups 按每组 3 题编排（Req 2.1） */
const progress = computed<{ group: number; totalGroups: number; indexInGroup: number } | null>(
  () => {
    const s = session.value;
    if (!s || s.queue.length === 0) return null;
    const groups = groupIntoGroups(s.queue, config.groupSize);
    const idx = Math.min(s.currentIndex, s.queue.length - 1);
    const size = config.groupSize as number;
    return {
      group: Math.floor(idx / size) + 1,
      totalGroups: groups.length,
      indexInGroup: (idx % size) + 1,
    };
  },
);

/** 学科题库最低难度（clampDifficulty 下限，Req 4.7） */
function minDifficultyFor(subject: Subject): Difficulty {
  const list = appState.bank?.bySubject.get(subject) ?? [];
  let min = 5;
  for (const q of list) {
    if (q.difficulty < min) min = q.difficulty;
  }
  return min as Difficulty;
}

/**
 * 难度徽章（信息性展示）：队列项题目在生成时已固定，difficultyOffset 无法改变
 * 既有题目，此处仅按 clampDifficulty 展示连错下调后的等效难度。
 */
const effectiveDifficulty = computed<Difficulty | null>(() => {
  const item = currentItem.value;
  const s = session.value;
  if (!item || !s) return null;
  return clampDifficulty(item.difficulty, s.difficultyOffset, minDifficultyFor(item.subject));
});

/** 当前是否为口算题（展示 10 分钟倒计时，Req 7.4） */
const isOralCurrent = computed<boolean>(() => currentItem.value?.type === 'oral');

const countdownMs = computed<number | null>(() => {
  const s = session.value;
  if (!s || !isOralCurrent.value) return null;
  return remainingMs(s, nowTick.value, config);
});

const countdownText = computed<string>(() => {
  const ms = countdownMs.value;
  if (ms === null) return '';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
});

/** 作答锁定：庆祝/鼓励/解析卡/弹层展示期间禁止再作答 */
const inputLocked = computed<boolean>(
  () =>
    celebration.value !== null ||
    encouragementMsg.value !== null ||
    revealEvent.value !== null ||
    overlay.value !== null,
);

// ============ 换题编排：生成口算题、清瞬时反馈 ============

// flush:'sync'：保证 saveSession 推进 currentIndex 后、本轮作答反馈（庆祝/Hint 等）
// 设置之前完成清理与口算题生成，顺序稳定可预期。
watch(
  currentItem,
  (item, prev) => {
    if (item === prev) return;
    // 新题就位：清空上一题的瞬时反馈与作答痕迹
    hintEvent.value = null;
    revealEvent.value = null;
    encouragementMsg.value = null;
    celebration.value = null;
    pendingRetry.value = false;
    keypadInput.value = '';
    retryKey.value += 1;
    if (item !== null && item.kind === 'generated') {
      const params = appState.generators.find((g) => g.id === item.generatorParamsId);
      // 生成题不持久化：重进/换题时按参数重新随机生成（Req 7.3 数值随机）
      currentOral.value = params ? generateOralQuestion(params, Math.random) : null;
    } else {
      currentOral.value = null;
    }
  },
  { immediate: true, flush: 'sync' },
);

// ============ 掌握度 / 错题本记账（每题定盘恰好一次） ============

/** 应用掌握度状态机并调度写入（800ms < 1s 落盘，Req 10.2）；返回是否需当日重出 */
function persistMastery(knowledgePointId: string, correct: boolean, now: number): boolean {
  const records = appState.store.read('mastery');
  const { record, requeue } = applyAnswer(records[knowledgePointId] ?? null, correct, now);
  // rec=null 时引擎返回空 knowledgePointId，壳层补写实际知识点 id
  const finalRecord: MasteryRecord = { ...record, knowledgePointId };
  appState.store.schedule('mastery', { ...records, [knowledgePointId]: finalRecord });
  return requeue;
}

/** 追加错题本（重对与重错均入，retriedCorrect 区分，Req 4.3） */
function appendWrongSet(
  questionRef: string,
  knowledgePointId: string,
  wrongAt: number,
  retriedCorrect: boolean,
): void {
  const wrongSet = appState.store.read('wrongSet');
  const item: WrongSetItem = { questionRef, knowledgePointId, wrongAt, retriedCorrect };
  appState.store.schedule('wrongSet', { items: [...wrongSet.items, item] });
}

// ============ 作答判定入口（组件事件 → judge → 引擎定盘） ============

/** 判断题选项 id → bool：优先按 't'/'f' 或"正确"文案识别真值选项 */
function mapJudgeSelection(q: Question, selectedId: string): boolean {
  const options = q.options ?? [];
  const trueOption = options.find((o) => o.id === 't' || o.text === '正确');
  if (trueOption) return selectedId === trueOption.id;
  return (options.find((o) => o.id === selectedId)?.text ?? '') === '正确';
}

function onChoiceSelect(optionId: string): void {
  if (inputLocked.value) return;
  const q = currentQuestion.value;
  if (!q) return;
  const student: StudentAnswer =
    q.type === 'judge' ? { bool: mapJudgeSelection(q, optionId) } : { choice: [optionId] };
  resolveAnswer(judgeQuestion(q, student));
}

function onDragSubmit(pairs: Record<string, string>): void {
  if (inputLocked.value) return;
  const q = currentQuestion.value;
  if (!q) return;
  resolveAnswer(judgeQuestion(q, { pairs }));
}

function onNumericSubmit(value: number): void {
  if (inputLocked.value) return;
  const item = currentItem.value;
  if (!item) return;
  if (item.kind === 'generated') {
    const oral = currentOral.value;
    if (!oral) return;
    resolveAnswer(judgeGenerated(oral, value));
    return;
  }
  const q = currentQuestion.value;
  if (!q) return;
  resolveAnswer(judgeQuestion(q, { number: value }));
}

function onWordCardAnswer(payload: { selectedOptionId: string; correctOptionId: string }): void {
  if (inputLocked.value) return;
  // 与 judge choice 规则同义：所选选项 id 与正确选项 id 一致（Req 8.5）
  resolveAnswer(payload.selectedOptionId === payload.correctOptionId);
}

function onDictationAnswer(order: string[]): void {
  if (inputLocked.value) return;
  const q = currentQuestion.value;
  if (!q) return;
  resolveAnswer(judgeQuestion(q, { order }));
}

// ============ 作答定盘（首答 / 重试） ============

/** 生成题的 Hint/解析替代文案（生成题无题库 hint/analysis 字段） */
const GENERATED_HINT = '再仔细算一算，你一定可以算出来的！';

function resolveAnswer(correct: boolean): void {
  const s = session.value;
  const item = currentItem.value;
  if (!s || !item || s.status !== 'active') return;

  const now = Date.now();
  // 定盘前快照：定盘会推进 currentIndex，答案解析与错题记账需引用本题
  answeredSnapshot.value = {
    item,
    question: currentQuestion.value,
    oral: currentOral.value,
    ref:
      item.kind === 'bank'
        ? item.questionId ?? ''
        : currentOral.value?.signature ?? `gen:${item.generatorParamsId ?? ''}`,
  };

  if (!pendingRetry.value) {
    // ---- 首次作答定盘 ----
    const outcome = applyFirstAnswer(s, correct, now);
    if (correct) {
      // 首对：掌握度按答对更新（首对 requeue 恒 false）、发星、庆祝（Req 5.1/12.3）
      persistMastery(item.knowledgePointId, true, now);
      appState.saveSession(outcome.session);
      appState.addStars(outcome.stars);
      celebration.value = appState.feedback.onCorrect();
      appState.feedback.onStars(outcome.stars);
      scheduleProceed(CELEBRATION_VISIBLE_MS);
    } else {
      // 首错：保存计数转移（streak 归零/连错+1），Hint 条不给答案，进入待重试（Req 4.1）
      appState.saveSession(outcome.session);
      const q = answeredSnapshot.value.question;
      hintEvent.value = appState.feedback.onFirstWrong(q ?? { hint: GENERATED_HINT });
      pendingRetry.value = true;
      keypadInput.value = '';
      retryKey.value += 1; // 重挂作答组件，清空上次作答痕迹供重试
    }
    return;
  }

  // ---- 重试定盘（重试机会仅此一次） ----
  pendingRetry.value = false;
  hintEvent.value = null;
  const outcome = applyRetry(s, correct, now);
  let next = outcome.session;
  // 重试答对按答错记（Req 4.3）：掌握度一律按答错更新；答错当日重出（Req 3.4）
  const requeue = persistMastery(item.knowledgePointId, false, now);
  if (requeue) {
    const retryItem: QueueItem = { ...item, source: 'retry' };
    next = {
      ...next,
      queue: [...next.queue, retryItem],
      // 末题重试时会话可能已被标记 done：追加重出项后回到 active
      status: next.status === 'done' ? 'active' : next.status,
    };
  }
  const snap = answeredSnapshot.value;
  appendWrongSet(snap.ref, item.knowledgePointId, now, correct);
  appState.saveSession(next);

  if (correct) {
    // 重对：鼓励文案（无星星，本题按答错记账）后推进
    encouragementMsg.value = pickEncouragement();
    scheduleProceed(ENCOURAGEMENT_VISIBLE_MS);
  } else {
    // 重错：答案 + ≤100 字解析 + 鼓励文案 + 下一题入口（Req 4.2）
    const q = snap.question;
    revealEvent.value = appState.feedback.onSecondWrong(
      q ?? {
        answer: { number: snap.oral?.answer ?? 0 },
        analysis: `正确答案是 ${snap.oral?.answer ?? ''}。`,
      },
    );
  }
}

// ============ 推进编排：庆祝/鼓励后 → 小组结算 / 关卡结算 / 下一题 ============

let proceedTimer: ReturnType<typeof setTimeout> | undefined;
let tickTimer: ReturnType<typeof setInterval> | undefined;

function clearProceedTimer(): void {
  if (proceedTimer !== undefined) {
    clearTimeout(proceedTimer);
    proceedTimer = undefined;
  }
}

function scheduleProceed(ms: number): void {
  clearProceedTimer();
  proceedTimer = setTimeout(() => {
    proceedTimer = undefined;
    proceed();
  }, ms);
}

/** 点击庆祝/鼓励/解析卡按钮：立即推进（不等定时器） */
function proceedNow(): void {
  clearProceedTimer();
  proceed();
}

/** 推进：会话完成 → 关卡结算；组边界 → 小组结算；否则直接进入下一题 */
function proceed(): void {
  celebration.value = null;
  encouragementMsg.value = null;
  revealEvent.value = null;
  const s = session.value;
  if (!s) return;
  if (s.status === 'done') {
    showLevelSettlement(true);
    return;
  }
  if (
    s.currentIndex > 0 &&
    s.currentIndex % (config.groupSize as number) === 0 &&
    s.currentIndex < s.queue.length
  ) {
    overlay.value = 'group';
  }
}

/** 跳过不可渲染题（防御路径）：不记结果直接推进 */
function skipUnrenderable(): void {
  const s = session.value;
  if (!s) return;
  const nextIndex = s.currentIndex + 1;
  appState.saveSession({
    ...s,
    currentIndex: nextIndex,
    status: nextIndex >= s.queue.length ? 'done' : s.status,
  });
  proceed();
}

// ============ 口算关结算（到时自动结算 + 关卡完成结算） ============

/** 结算一道口算关：更新历史最佳并持久化（Req 7.5-7.8），同一生成器参数仅结算一次 */
function settleOneOralItem(s: TodaySession, item: QueueItem): OralSettleView | null {
  const genId = item.generatorParamsId;
  if (!genId) return null;
  const kpResults = s.results.filter((r) => r.knowledgePointId === item.knowledgePointId);
  const kpQueue = s.queue.filter((q) => q.knowledgePointId === item.knowledgePointId);
  // 未作答题目不计入答对题数（Req 7.5）：仅统计 correct=true 的作答
  const settle = settleOralLevel(kpResults, kpQueue);
  const records = appState.store.read('oralBest');
  const out = updateOralBest(records, genId, settle.correct, Date.now());
  if (out.records !== records) {
    appState.store.schedule('oralBest', out.records);
  }
  const view: OralSettleView = {
    genParamsId: genId,
    score: settle.correct,
    best: out.records[genId]?.best ?? settle.correct,
    previousBest: out.previousBest,
    isNewRecord: out.isNewRecord,
  };
  oralViews.set(genId, view);
  return view;
}

/** 结算会话内全部口算关（已结算的读取快照，不重复更新纪录） */
function settleAllOralItems(s: TodaySession): OralSettleView[] {
  const views: OralSettleView[] = [];
  for (const item of s.queue) {
    if (item.kind !== 'generated' || !item.generatorParamsId) continue;
    let view = oralViews.get(item.generatorParamsId);
    if (!view) {
      view = settleOneOralItem(s, item) ?? undefined;
    }
    if (view) views.push(view);
  }
  return views;
}

// ============ 关卡时钟：10 分钟倒计时、到点提示与口算自动结算 ============

function onTick(): void {
  nowTick.value = Date.now();
  const s = session.value;
  if (!s || s.status !== 'active') return;
  // 弹层/庆祝/解析卡展示期间不触发到点检查；下个 tick 会重试
  if (overlay.value !== null) return;
  if (celebration.value !== null || encouragementMsg.value !== null || revealEvent.value !== null) {
    return;
  }
  if (checkLevelClock(s, nowTick.value, config) === null) return;

  const item = nextUnanswered(s);
  if (item && item.type === 'oral' && item.kind === 'generated') {
    // 口算关到时自动结算（Req 7.4/7.5）：到时未作答（含首错待重试）一律不再作答，
    // 未作答题目不计入本关答对题数
    timeupOralView.value = settleOneOralItem(s, item);
    pendingRetry.value = false;
    hintEvent.value = null;
    const nextIndex = s.currentIndex + 1;
    const done = nextIndex >= s.queue.length;
    appState.saveSession({
      ...s,
      currentIndex: nextIndex,
      status: done ? 'done' : 'active',
    });
    if (done) {
      showLevelSettlement(true);
    } else {
      overlay.value = 'timeup';
    }
  } else {
    // 非口算题到点：展示"继续/休息"提示（Req 2.2/2.6）
    timeupOralView.value = null;
    overlay.value = 'timeup';
  }
}

// ============ 弹层操作 ============

/** 小组结算"继续"：展示下一道未答题（Req 2.3/2.7） */
function onGroupContinue(): void {
  overlay.value = null;
}

/** 10 分钟提示"继续"：重置本段关卡计时起点（Req 2.6；引擎事件不可重复消费的约定由壳层履行） */
function onTimeupContinue(): void {
  const s = session.value;
  if (s) {
    appState.saveSession({ ...s, elapsedMs: 0, levelStartedAt: Date.now() });
  }
  overlay.value = null;
  timeupOralView.value = null;
  // 口算跳题后若恰落在组边界，补展示小组结算
  const s2 = session.value;
  if (
    s2 &&
    s2.status === 'active' &&
    s2.currentIndex > 0 &&
    s2.currentIndex % (config.groupSize as number) === 0 &&
    s2.currentIndex < s2.queue.length
  ) {
    overlay.value = 'group';
  }
}

/** 将本段计时折入 elapsedMs 并重置段起点（退出/休息/卸载时冻结关卡时钟） */
function persistClockSegment(): void {
  const s = session.value;
  if (!s) return;
  appState.saveSession({
    ...s,
    elapsedMs: elapsedMs(s, Date.now()),
    levelStartedAt: Date.now(),
  });
}

/** 强制落盘全部调度待写值（mastery/wrongSet/oralBest），失败汇入 writeError（Req 10.6） */
function flushPendingWrites(): void {
  try {
    appState.store.flush();
  } catch (error) {
    writeError.value = error instanceof Error ? error.message : String(error);
  }
}

/** "休息"：保存进度回首页（Req 2.8） */
function onRest(): void {
  persistClockSegment();
  flushPendingWrites();
  void router.push('/');
}

/** 退出按钮：同"休息"，保存进度回首页（Req 2.4/2.8） */
function onExit(): void {
  persistClockSegment();
  flushPendingWrites();
  void router.push('/');
}

/** 关卡结算"返回首页" */
function onLevelHome(): void {
  flushPendingWrites();
  void router.push('/');
}

// ============ 关卡结算（Req 5.2、7.6-7.8） ============

function showLevelSettlement(award: boolean): void {
  const s = session.value;
  if (!s) return;
  if (award && !levelAwarded.value) {
    // +10 关卡完成星星（Req 5.2）：仅本次页面会话由作答推进到 done 时发放一次
    appState.setWallet(awardLevelCompletion(appState.wallet.value));
    appState.feedback.onStars(LEVEL_COMPLETION_STARS);
    levelAwarded.value = true;
    justAwarded.value = true;
  }
  oralSettlements.value = settleAllOralItems(s);
  overlay.value = 'level';
}

// ============ 答案解析卡文案 ============

function optionText(q: Question | null, id: string): string {
  return q?.options?.find((o) => o.id === id)?.text ?? id;
}

/** 将标准答案渲染为学生可读文本（判断→正确/错误；数值→数字；点选/接龙→选项文案） */
function formatRevealAnswer(evt: AnswerRevealEvent): string {
  const a = evt.answer;
  const q = answeredSnapshot.value?.question ?? null;
  if (a.number !== undefined) return String(a.number);
  if (a.bool !== undefined) return a.bool ? '正确' : '错误';
  if (a.choice !== undefined) return a.choice.map((id) => optionText(q, id)).join('、');
  if (a.order !== undefined) return a.order.map((id) => optionText(q, id)).join('');
  if (a.pairs !== undefined) {
    const pairs = a.pairs;
    const entries: ReadonlyArray<readonly [string, string]> = Array.isArray(pairs)
      ? (pairs as ReadonlyArray<readonly [string, string]>)
      : Object.entries(pairs);
    return entries.map(([t, o]) => `${optionText(q, t)} → ${optionText(q, o)}`).join('，');
  }
  return '';
}

// ============ 挂载 / 卸载：恢复进度、计时与落盘 ============

// 首次渲染前同步今日会话：appState.session 是跨页面共享的内存态，可能残留
// 上一个学科的旧会话；若待 onMounted 才刷新，首帧会按旧会话挂载旧题型卡并
// 自动播音，切换会话后新卡片再播音，形成跨学科音频叠加。
appState.refreshSession();

onMounted(() => {
  // 重进时从 Local_Store 恢复进度，下一未答题为续练起点（Req 2.5/2.7）
  const s = appState.session.value;
  if (s === null || s.date !== localDateString(Date.now())) {
    // 无当日会话或会话跨日：回首页经"今日冒险"重新生成（Req 3.8/3.9）
    void router.replace('/');
    return;
  }
  // 已完成会话直接进入关卡结算展示，不重复发放 +10（Req 5.2）
  levelAwarded.value = s.status === 'done';
  if (s.status === 'done') {
    showLevelSettlement(false);
  }
  tickTimer = setInterval(onTick, TICK_MS);
});

onBeforeUnmount(() => {
  clearProceedTimer();
  if (tickTimer !== undefined) {
    clearInterval(tickTimer);
    tickTimer = undefined;
  }
  // 中途退出：保存进度（含冻结关卡时钟），重进恢复下一未答题（Req 2.4/2.5）
  persistClockSegment();
  flushPendingWrites();
});
</script>

<style scoped>
/* ============ 页面容器（卡通圆角风格，与首页一致，Req 12.1） ============ */

.practice-page {
  position: relative;
  min-height: 100dvh;
  overflow-x: hidden;
  box-sizing: border-box;
  padding: 12px 16px 40px;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: linear-gradient(180deg, #7ec8f7 0%, #b8e6ff 45%, #d9f4e3 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.practice-page__topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  max-width: 560px;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 退出按钮：触控区域 ≥44×44px（Req 12.2） */
.exit-btn {
  min-width: 76px;
  min-height: 44px;
  padding: 8px 16px;
  border: 3px solid #ffd166;
  border-radius: 999px;
  background-color: rgba(255, 253, 245, 0.95);
  color: #4a3b2a;
  font-size: 17px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 3px 0 #f0b429;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.exit-btn:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #f0b429;
}

.streak-pill,
.star-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 8px 14px;
  border: 3px solid #ffd166;
  border-radius: 999px;
  background-color: rgba(255, 253, 245, 0.95);
  box-shadow: 0 3px 0 #f0b429;
  font-size: 18px;
  font-weight: 700;
  color: #4a3b2a;
}

.streak-pill {
  border-color: #ffadad;
  box-shadow: 0 3px 0 #e07a7a;
}

.practice-page__meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  width: 100%;
  max-width: 560px;
}

.progress-pill,
.difficulty-pill,
.countdown-pill {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 6px 14px;
  border: 2px solid #9bf6ff;
  border-radius: 999px;
  background-color: rgba(255, 253, 245, 0.92);
  color: #4a3b2a;
  font-size: 15px;
  font-weight: 700;
}

.difficulty-pill {
  border-color: #caffbf;
}

.countdown-pill {
  border-color: #ffb703;
  background-color: #fff3d6;
  font-variant-numeric: tabular-nums;
}

.countdown-pill--urgent {
  border-color: #ff8a80;
  background-color: #fff3f0;
  color: #b3261e;
  animation: countdown-blink 1s ease-in-out infinite;
}

@keyframes countdown-blink {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.06);
  }
}

/* 写失败提示（Req 10.6） */
.write-error {
  width: 100%;
  max-width: 560px;
  box-sizing: border-box;
  padding: 10px 16px;
  border: 3px solid #ff8a80;
  border-radius: 16px;
  background-color: #fff3f0;
  color: #b3261e;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
}

.practice-page__body {
  width: 100%;
  max-width: 560px;
}

/* ============ 题区 ============ */

.question-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  width: 100%;
  padding: 20px 16px;
  box-sizing: border-box;
  border: 4px solid #ffd166;
  border-radius: 28px;
  background-color: rgba(255, 253, 245, 0.95);
  box-shadow: 0 6px 0 #f0b429;
}

.question-area__stem {
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  color: #4a3b2a;
  line-height: 1.5;
  text-align: center;
  word-break: break-word;
}

/* ============ Hint 条（Req 4.1） ============ */

.hint-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  max-width: 560px;
  box-sizing: border-box;
  padding: 14px 18px;
  border: 3px solid #4d96ff;
  border-radius: 18px;
  background: linear-gradient(180deg, #cfe3ff 0%, #e6f0ff 100%);
  color: #1d4f9c;
  font-size: 18px;
  font-weight: 700;
  animation: bar-pop 0.25s ease;
}

.hint-bar__icon {
  font-size: 22px;
}

.hint-bar__retry {
  color: #e07b00;
}

/* ============ 鼓励条（重试答对） ============ */

.encouragement-bar {
  width: 100%;
  max-width: 560px;
  box-sizing: border-box;
  padding: 14px 18px;
  border: 3px solid #74c69d;
  border-radius: 18px;
  background: linear-gradient(180deg, #d8f3dc 0%, #b7e4c7 100%);
  color: #1b4332;
  font-size: 18px;
  font-weight: 700;
  text-align: center;
  cursor: pointer;
  user-select: none;
  animation: bar-pop 0.25s ease;
}

@keyframes bar-pop {
  0% {
    transform: translateY(8px);
    opacity: 0;
  }
  100% {
    transform: translateY(0);
    opacity: 1;
  }
}

/* ============ 答案解析卡（Req 4.2） ============ */

.reveal-overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  background-color: rgba(43, 45, 66, 0.45);
}

.reveal-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 380px;
  padding: 28px 22px;
  border: 4px solid #4d96ff;
  border-radius: 28px;
  background-color: #fffdf5;
  box-shadow: 0 10px 0 #3b78d8, 0 20px 40px rgba(0, 0, 0, 0.25);
  animation: card-pop 0.3s ease;
}

.reveal-card__emoji {
  font-size: 44px;
}

.reveal-card__answer {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #4a3b2a;
  text-align: center;
  line-height: 1.5;
  word-break: break-word;
}

.reveal-card__analysis {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #8a7358;
  text-align: center;
  line-height: 1.6;
}

.reveal-card__encouragement {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #2b5d34;
  text-align: center;
}

/* ============ 答对庆祝（≤3 秒，Req 12.3） ============ */

.celebration-overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background-color: rgba(255, 209, 102, 0.28);
  cursor: pointer;
  user-select: none;
}

.celebration-burst {
  font-size: 64px;
  animation: burst-pop 0.5s ease;
}

@keyframes burst-pop {
  0% {
    transform: scale(0.4);
    opacity: 0;
  }
  60% {
    transform: scale(1.15);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.celebration-text {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
  color: #5b3a00;
  text-shadow: 0 2px 0 rgba(255, 255, 255, 0.8);
}

/* ============ 结算弹层（小组/10 分钟提示/关卡） ============ */

.settlement-overlay {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  background-color: rgba(43, 45, 66, 0.55);
}

.settlement-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: 100%;
  max-width: 380px;
  padding: 32px 24px;
  border: 4px solid #ffd166;
  border-radius: 28px;
  background-color: #fffdf5;
  box-shadow: 0 10px 0 #f0b429, 0 20px 40px rgba(0, 0, 0, 0.25);
  animation: card-pop 0.3s ease;
}

@keyframes card-pop {
  0% {
    transform: scale(0.75);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.settlement-card__emoji {
  font-size: 52px;
}

.settlement-card__title {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  color: #4a3b2a;
  text-align: center;
}

.settlement-card__subtitle {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #8a7358;
  text-align: center;
  line-height: 1.6;
}

.settlement-card__stars {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: #b8860b;
}

.oral-settles {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.oral-settle-line {
  margin: 0;
  padding: 10px 14px;
  border: 2px solid #9bf6ff;
  border-radius: 14px;
  background-color: #f0fbff;
  font-size: 16px;
  font-weight: 700;
  color: #155e75;
  text-align: center;
  line-height: 1.6;
}

.new-record-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffd166 0%, #ffb703 100%);
  color: #5b3a00;
  font-size: 14px;
  font-weight: 800;
  animation: countdown-blink 1.2s ease-in-out infinite;
}

/* "继续/休息"两个大按钮：触控区域 ≥44×44px（实际 ≥56px，Req 2.3/12.2） */
.settlement-card__actions {
  display: flex;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
  width: 100%;
}

.big-btn {
  min-width: 140px;
  min-height: 56px;
  padding: 14px 28px;
  border-radius: 999px;
  font-size: 20px;
  font-weight: 800;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.big-btn--primary {
  border: 3px solid #ff9f1c;
  background: linear-gradient(180deg, #ffd166 0%, #ffb703 100%);
  color: #5b3a00;
  box-shadow: 0 5px 0 #e07b00;
}

.big-btn--primary:active {
  transform: translateY(3px);
  box-shadow: 0 2px 0 #e07b00;
}

.big-btn--rest {
  border: 3px solid #74c69d;
  background: linear-gradient(180deg, #d8f3dc 0%, #95d5b2 100%);
  color: #1b4332;
  box-shadow: 0 5px 0 #52b788;
}

.big-btn--rest:active {
  transform: translateY(3px);
  box-shadow: 0 2px 0 #52b788;
}

/* ============ 防御卡 ============ */

.missing-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: 100%;
  box-sizing: border-box;
  padding: 28px 20px;
  border: 4px solid #ffd166;
  border-radius: 28px;
  background-color: rgba(255, 253, 245, 0.95);
  box-shadow: 0 6px 0 #f0b429;
}

.missing-card__text {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #4a3b2a;
  text-align: center;
}

/* 窄屏适配：字号收缩，避免横向滚动 */
@media (max-width: 480px) {
  .question-area__stem {
    font-size: 20px;
  }

  .celebration-burst {
    font-size: 52px;
  }

  .celebration-text {
    font-size: 26px;
  }

  .big-btn {
    min-width: 120px;
    font-size: 18px;
  }
}
</style>
