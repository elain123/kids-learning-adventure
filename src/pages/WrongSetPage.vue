<template>
  <div class="wrong-set-page">
    <!-- 顶栏：返回我的小岛 + 标题 -->
    <header class="wrong-set-header">
      <RouterLink to="/island" class="back-island" data-testid="back-island" aria-label="返回我的小岛">
        🏝️ 我的小岛
      </RouterLink>
      <h1 class="wrong-set-title">📖 错题集</h1>
    </header>

    <!-- 存储写失败提示（Req 6.8）：界面进度可见可继续 -->
    <div v-if="writeError" class="write-error" data-testid="write-error-banner" role="alert">
      💾 {{ writeError }}
    </div>

    <!-- 空状态（Req 5.6）：空状态提示 + "去闯关"引导入口 -->
    <div v-if="isEmpty" class="empty-state" data-testid="empty-state">
      <div class="empty-state__emoji" aria-hidden="true">🌟</div>
      <p class="empty-state__text">错题集空空的，太棒了！去闯关练习，做错的题会自动记到这里。</p>
      <button
        type="button"
        class="big-btn big-btn--primary"
        data-testid="go-adventure-btn"
        @click="goAdventure"
      >
        🗺️ 去闯关
      </button>
    </div>

    <!-- 分组错题列表（Req 5.2）：学科固定序 语文→数学→英语，空分组不出现，组内按 wrongAt 由近到远 -->
    <main v-else class="wrong-set-list">
      <section
        v-for="group in groups"
        :key="group.subject"
        class="wrong-group"
        :data-testid="`wrong-group-${group.subject}`"
      >
        <h2 class="wrong-group__title">
          {{ SUBJECT_EMOJIS[group.subject] }} {{ SUBJECT_LABELS[group.subject] }}
        </h2>
        <ul class="wrong-group__items">
          <li v-for="view in group.items" :key="view.item.questionRef" class="wrong-item-wrap">
            <button
              type="button"
              class="wrong-item"
              data-testid="wrong-item"
              @click="openDetail(view)"
            >
              <!-- 每条展示：题干、学科、年级、最近答错时间与掌握标识（Req 5.3） -->
              <span class="wrong-item__stem" data-testid="item-stem">{{ view.stem }}</span>
              <span class="wrong-item__meta">
                <span class="meta-pill" data-testid="item-subject">{{ SUBJECT_LABELS[view.item.subject] }}</span>
                <span class="meta-pill" data-testid="item-grade">{{ view.item.grade }} 年级</span>
                <span class="meta-pill meta-pill--time" data-testid="item-time">
                  🕐 {{ formatWrongAt(view.item.wrongAt) }}
                </span>
                <span
                  class="meta-pill"
                  :class="view.mastered ? 'meta-pill--mastered' : 'meta-pill--unmastered'"
                  data-testid="item-badge"
                >
                  {{ view.mastered ? '已掌握' : '未掌握' }}
                </span>
              </span>
            </button>
          </li>
        </ul>
      </section>
    </main>

    <!-- 详情层（Req 5.4）：正确答案 + ≤100 字解析；未掌握错题提供"重新作答"（Req 5.5） -->
    <div
      v-if="detail !== null"
      class="detail-overlay"
      data-testid="detail-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="错题详情"
    >
      <div class="detail-card">
        <p class="detail-card__stem" data-testid="detail-stem">{{ detail.view.stem }}</p>
        <p class="detail-card__meta">
          {{ SUBJECT_LABELS[detail.view.item.subject] }} · {{ detail.view.item.grade }} 年级 ·
          {{ detail.view.mastered ? '已掌握' : '未掌握' }}
        </p>

        <!-- 题目已下架兜底：不提供重新作答，记录保留 -->
        <p v-if="detail.resolution.missing" class="detail-card__missing" data-testid="detail-missing">
          😢 题目已下架，无法查看答案与重新作答，这条记录会为你保留。
        </p>
        <template v-else>
          <p class="detail-card__answer" data-testid="detail-answer">
            <strong>正确答案：</strong>{{ detail.resolution.answerText }}
          </p>
          <p class="detail-card__analysis" data-testid="detail-analysis">
            {{ detail.resolution.analysis }}
          </p>
        </template>

        <div class="detail-card__actions">
          <!-- 已掌握错题仅可查看答案解析，不提供重新作答（Req 4.6） -->
          <button
            v-if="canReAnswer"
            type="button"
            class="big-btn big-btn--primary"
            data-testid="reanswer-btn"
            @click="openPractice"
          >
            ✏️ 重新作答
          </button>
          <button
            type="button"
            class="big-btn big-btn--rest"
            data-testid="detail-close-btn"
            @click="closeDetail"
          >
            关闭
          </button>
        </div>
      </div>
    </div>

    <!-- 重新作答层（Req 5.5）：原题复用一期作答组件，一次提交定盘，无 Hint 与重试 -->
    <div
      v-if="practice !== null"
      class="practice-overlay"
      data-testid="practice-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="重新作答"
    >
      <div class="practice-card">
        <p
          v-if="practiceStem !== '' && !isDictationPractice"
          class="practice-card__stem"
          data-testid="practice-stem"
        >
          {{ practiceStem }}
        </p>

        <!-- 生字听写：听写卡（自动播放读音一次、重听不限次、失败降级提示，Req 2.8） -->
        <DictationCard
          v-if="isDictationPractice && practiceQuestion"
          :key="practiceKey"
          :question="practiceQuestion"
          :disabled="settled"
          @answer="onDictationAnswer"
        />
        <!-- 拼音/多音字/古诗文接龙/判断/选择：点选 -->
        <ChoicePad
          v-else-if="isChoicePractice && practiceQuestion"
          :key="practiceKey"
          :options="practice.options"
          :disabled="settled"
          @select="onChoiceSelect"
        />
        <!-- 形近字/词语搭配/成语填空/单位换算（配对型）：拖拽 -->
        <DragMatch
          v-else-if="isDragPractice && practiceQuestion"
          :key="practiceKey"
          :targets="practice.drag.targets"
          :choices="practice.drag.choices"
          :disabled="settled"
          @submit="onDragSubmit"
        />
        <!-- 口算（生成题快照还原 / 无快照降级重新生成）/填空/几何/单位换算（数值型）：数字键盘 -->
        <NumericKeypad
          v-else-if="isNumericPractice"
          :key="practiceKey"
          v-model="keypadInput"
          :disabled="settled"
          @submit="onNumericSubmit"
        />
        <!-- 英语单词卡：图片 + 拼写 + 4 选 1（自动播放一次、重播不限次、失败降级，Req 2.8） -->
        <WordCard
          v-else-if="isWordCardPractice && practiceQuestion"
          :key="practiceKey"
          :question="practiceQuestion"
          :pool="englishPool"
          :disabled="settled"
          @answer="onWordCardAnswer"
        />

        <!-- 一次提交定盘：答对（Req 5.8，applyReAnswerCorrect） -->
        <div
          v-if="settleResult === 'correct'"
          class="practice-card__result practice-card__result--correct"
          data-testid="practice-correct"
          role="status"
        >
          🎉 答对啦！
        </div>
        <!-- 答错（Req 5.9，applyReAnswerWrong）：答案 + ≤100 字解析 + 鼓励 -->
        <div
          v-if="settleResult === 'wrong' && revealEvent !== null"
          class="practice-card__result"
          data-testid="practice-wrong"
          role="status"
        >
          <p class="practice-card__answer">
            <strong>正确答案：</strong>{{ formatAnswerText(revealEvent.answer, practiceQuestion) }}
          </p>
          <p class="practice-card__analysis">{{ revealEvent.analysis }}</p>
          <p class="practice-card__encouragement">{{ revealEvent.encouragement }}</p>
        </div>

        <button
          v-if="settled"
          type="button"
          class="big-btn big-btn--primary"
          data-testid="practice-close-btn"
          @click="closePractice"
        >
          返回错题集
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 错题集查看页（Wrong_Set_View，/island/wrong）—— multi-grade-mistake-book 任务 12.1
 *
 * 依据 .kiro/specs/multi-grade-mistake-book/design.md「页面设计 → Wrong_Set_View」
 * 与「错题重练的作答组件复用」实现：
 * - 分组列表经 3.1 buildWrongSetGroups 构建：学科按 语文→数学→英语 固定顺序、
 *   空分组不显示、组内按最近一次答错时间由近到远（Req 5.2）；每条展示题干、
 *   学科、年级、formatWrongAt 格式化时间（YYYY-MM-DD HH:mm）与"已掌握/未掌握"
 *   文字标识（Req 5.3，mastered 为 mastery 派生标记，Req 4.6）；
 * - 点击条目弹出详情层展示正确答案与 ≤100 字解析（Req 5.4，解析经
 *   truncateAnalysis 兜底截断）；
 * - 未掌握错题提供"重新作答"（Req 5.5）：题库题经 bank.byId 取原题按 type
 *   复用 ChoicePad/DragMatch/NumericKeypad/WordCard/DictationCard 并以既有
 *   judgeQuestion 判定（与闯关练习同一判定管线）；口算生成题优先以错题记录
 *   generated 快照还原原题（NumericKeypad + judgeGenerated），无快照的历史
 *   生成题错题降级为按 questionRef 中的 paramsId 取生成器参数重新生成一题
 *   （随机源经 props.rand 注入，mock 可测）；
 * - 重练不提供 Hint 与重试，一次提交定盘：答对走 applyReAnswerCorrect
 *   （仅写回掌握度，Wrong_Set 不变，Req 5.8），答错走 applyReAnswerWrong
 *   （掌握度重置未掌握、该题 wrongAt=now、wrongCount+1，Req 5.9）；
 *   已掌握错题仅可查看答案解析，不提供重新作答（Req 4.6）；
 * - Wrong_Set 为空时展示空状态提示与"去闯关"引导入口（Req 5.6）；
 * - 错题引用在题库中找不到（题目被移除 / 生成器参数缺失）时展示"题目已下架"
 *   兜底文案且不提供重新作答，记录保留在 Wrong_Set 中（设计 Error Handling 表）；
 * - 重练与列表的媒体行为（自动播放一次、重听/重播不限次、失败降级提示且不影响
 *   作答）与闯关练习一致（Req 2.8）：由复用的 DictationCard/WordCard 内部保证；
 * - 持久化口径与练习页一致：mastery/wrongSet 经 store.schedule 调度写入
 *   （800ms < 1s 落盘，Req 6.2），离开页面前 store.flush 强制落盘，写失败汇入
 *   appState.writeError 提示且不阻断（Req 6.8）；
 * - 数据感知：挂载时读取一次 + 监听 storage 事件感知其他标签页变更；本页重练
 *   定盘直接同步内存引用（同标签页写入不触发 storage 事件）。
 *
 * Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 5.9, 2.8, 4.6
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import ChoicePad from '../components/question/ChoicePad.vue';
import DictationCard from '../components/question/DictationCard.vue';
import DragMatch from '../components/question/DragMatch.vue';
import NumericKeypad from '../components/question/NumericKeypad.vue';
import WordCard from '../components/question/WordCard.vue';

import { useAppState } from '../stores/appState';
import { judgeGenerated, judgeQuestion, type StudentAnswer } from '../engine/judge';
import { generateOralQuestion } from '../engine/mathGenerator';
import {
  applyReAnswerCorrect,
  applyReAnswerWrong,
  buildWrongSetGroups,
  formatWrongAt,
  type WrongSet,
  type WrongSetGroup,
  type WrongSetItem,
  type WrongSetViewItem,
} from '../engine/wrongSet';
import { truncateAnalysis, type AnswerRevealEvent } from '../services/feedback';
import type {
  GeneratedQuestion,
  GeneratorParams,
  MasteryRecord,
  Question,
  QuestionAnswer,
  QuestionOption,
  Subject,
} from '../types';

/** 随机源注入（无快照生成题降级重新生成与选项乱序），默认 Math.random；测试可 mock */
const props = withDefaults(defineProps<{ rand?: () => number }>(), { rand: undefined });

const appState = useAppState();
const router = useRouter();

/** 存储写失败提示（Req 6.8，App_State 唯一状态源） */
const writeError = appState.writeError;

// ============ 常量 ============

/** 学科中文标签 */
const SUBJECT_LABELS: Record<Subject, string> = {
  chinese: '语文',
  math: '数学',
  english: '英语',
};

/** 学科分组标题 emoji */
const SUBJECT_EMOJIS: Record<Subject, string> = {
  chinese: '📚',
  math: '🔢',
  english: '🔤',
};

/** 错题引用缺失（题目已下架）兜底文案 */
const MISSING_TEXT = '题目已下架';

/** 生成题引用前缀：gen:{paramsId}:{operandsHash}（与迁移模块同一口径） */
const GEN_REF_PREFIX = 'gen:';

// ============ 错题集与掌握度（响应式） ============

const wrongSet = ref<WrongSet>(appState.store.read('wrongSet'));
const mastery = ref<Record<string, MasteryRecord>>(appState.store.read('mastery'));

/** 重新读取 Local_Store（挂载与跨标签页 storage 事件） */
function refresh(): void {
  wrongSet.value = appState.store.read('wrongSet');
  mastery.value = appState.store.read('mastery');
}

function onStorage(event: StorageEvent): void {
  if (
    event.key === null ||
    event.key === appState.store.keyFor('wrongSet') ||
    event.key === appState.store.keyFor('mastery')
  ) {
    refresh();
  }
}

onMounted(() => {
  refresh();
  window.addEventListener('storage', onStorage);
});

onBeforeUnmount(() => {
  window.removeEventListener('storage', onStorage);
  // 离开页面前强制落盘全部调度待写值（重练定盘的 mastery/wrongSet）；写失败汇入
  // writeError 提示且不阻断（Req 6.8，与练习页 flushPendingWrites 同一口径）
  try {
    appState.store.flush();
  } catch (error) {
    writeError.value = error instanceof Error ? error.message : String(error);
  }
});

// ============ 题干解析与题目还原 ============

/** 从 gen: 引用解析生成器参数 id（gen:{paramsId}:{operandsHash}） */
function parseGenParamsId(questionRef: string): string | null {
  if (!questionRef.startsWith(GEN_REF_PREFIX)) return null;
  const paramsId = questionRef.slice(GEN_REF_PREFIX.length).split(':')[0];
  return paramsId.length > 0 ? paramsId : null;
}

/** 口算生成题引用（携带快照或 gen: 引用） */
function isGeneratedRef(item: WrongSetItem): boolean {
  return item.generated !== undefined || item.questionRef.startsWith(GEN_REF_PREFIX);
}

/** 查找错题对应的生成器参数（快照 paramsId 优先，其次 gen: 引用解析） */
function findGeneratorParams(item: WrongSetItem): GeneratorParams | null {
  const paramsId = item.generated?.paramsId ?? parseGenParamsId(item.questionRef);
  if (paramsId === null) return null;
  return appState.generators.find((g) => g.id === paramsId) ?? null;
}

/**
 * 列表题干解析（buildWrongSetGroups 的 resolveStem）：
 * - 生成题快照：取快照 stem（原题还原）；
 * - 无快照的历史生成题错题：回退为生成器模板文本（设计 Error Handling 表）；
 * - 题库题：取题目 stem；
 * - 引用缺失（题目被移除 / 生成器参数缺失）："题目已下架"兜底文案。
 */
function resolveStem(item: WrongSetItem): string {
  if (item.generated !== undefined) return item.generated.stem;
  if (item.questionRef.startsWith(GEN_REF_PREFIX)) {
    return findGeneratorParams(item)?.template ?? MISSING_TEXT;
  }
  return appState.bank?.byId.get(item.questionRef)?.stem ?? MISSING_TEXT;
}

/** 分组列表（Req 5.2）：学科固定序、空分组不出现、组内 wrongAt 降序、派生 mastered */
const groups = computed<WrongSetGroup[]>(() =>
  buildWrongSetGroups(wrongSet.value, mastery.value, resolveStem),
);

const isEmpty = computed<boolean>(() => wrongSet.value.items.length === 0);

/** 随机源（注入优先，默认 Math.random） */
const randSource = computed<() => number>(() => props.rand ?? Math.random);

/** 还原口算生成题：快照优先；无快照降级为按 paramsId 重新生成一题（同知识点同模板） */
function resolveOral(item: WrongSetItem): GeneratedQuestion | null {
  const snapshot = item.generated;
  if (snapshot !== undefined) {
    const params = appState.generators.find((g) => g.id === snapshot.paramsId);
    return {
      signature: item.questionRef,
      generatorParamsId: snapshot.paramsId,
      knowledgePointId: item.knowledgePointId,
      subject: 'math',
      type: 'oral',
      difficulty: params?.difficulty ?? 1,
      stem: snapshot.stem,
      operands: snapshot.operands,
      answer: snapshot.answer,
    };
  }
  const params = findGeneratorParams(item);
  if (params === null) return null;
  return generateOralQuestion(params, randSource.value);
}

/** 错题条目解析结果：原题（题库题或生成题）+ 详情层展示用答案与解析 */
interface ItemResolution {
  /** 引用缺失（题目已下架）：不提供重新作答，记录保留 */
  missing: boolean;
  /** 题库题原题（kind=bank） */
  question: Question | null;
  /** 口算生成题（快照还原或降级重新生成） */
  oral: GeneratedQuestion | null;
  /** 详情层展示的正确答案文本 */
  answerText: string;
  /** 详情层展示的解析（≤100 字） */
  analysis: string;
}

const MISSING_RESOLUTION: ItemResolution = {
  missing: true,
  question: null,
  oral: null,
  answerText: '',
  analysis: '',
};

/**
 * 解析错题条目：题库题经 bank.byId 取原题；口算生成题经快照还原或降级重新生成
 * （降级时详情层答案/解析与重新作答题为同一次生成，保证一致）。
 */
function resolveItem(item: WrongSetItem): ItemResolution {
  if (isGeneratedRef(item)) {
    const oral = resolveOral(item);
    if (oral === null) return MISSING_RESOLUTION;
    return {
      missing: false,
      question: null,
      oral,
      answerText: String(oral.answer),
      analysis: `正确答案是 ${oral.answer}。`,
    };
  }
  const question = appState.bank?.byId.get(item.questionRef) ?? null;
  if (question === null) return MISSING_RESOLUTION;
  return {
    missing: false,
    question,
    oral: null,
    answerText: formatAnswerText(question.answer, question),
    analysis: truncateAnalysis(question.analysis),
  };
}

// ============ 答案文本格式化（与练习页 formatRevealAnswer 同一口径） ============

function optionText(q: Question | null, id: string): string {
  return q?.options?.find((o) => o.id === id)?.text ?? id;
}

/** 将标准答案渲染为学生可读文本（判断→正确/错误；数值→数字；点选/接龙→选项文案） */
function formatAnswerText(a: QuestionAnswer, q: Question | null): string {
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

// ============ 详情层（Req 5.4） ============

interface DetailState {
  view: WrongSetViewItem;
  resolution: ItemResolution;
}

const detail = ref<DetailState | null>(null);

/** 点击条目弹出详情层（答案 + ≤100 字解析；解析发生在打开时，降级重新生成仅一次） */
function openDetail(view: WrongSetViewItem): void {
  detail.value = { view, resolution: resolveItem(view.item) };
}

function closeDetail(): void {
  detail.value = null;
}

/** 未掌握且引用可解析的错题提供"重新作答"（Req 5.5）；已掌握仅查看（Req 4.6） */
const canReAnswer = computed<boolean>(
  () => detail.value !== null && !detail.value.view.mastered && !detail.value.resolution.missing,
);

// ============ 重新作答（Req 5.5、5.8、5.9） ============

interface PracticeState {
  view: WrongSetViewItem;
  resolution: ItemResolution;
  /** 点选题展示选项（打开时乱序一次；judge 按选项 id 判定，与展示顺序无关） */
  options: QuestionOption[];
  /** DragMatch 目标槽/选项拆分 */
  drag: { targets: QuestionOption[]; choices: QuestionOption[] };
}

const practice = ref<PracticeState | null>(null);
/** 一次提交定盘（无 Hint 与重试）：判定后锁定作答 */
const settled = ref(false);
const settleResult = ref<'correct' | 'wrong' | null>(null);
/** 答错定盘的答案解析事件（复用 Feedback_Service：答案 + ≤100 字解析 + 鼓励） */
const revealEvent = ref<AnswerRevealEvent | null>(null);
/** 数字键盘输入串（v-model） */
const keypadInput = ref('');
/** 作答组件重挂键：每次重新作答强制重挂，清空上次作答痕迹并重新自动播音一次 */
const practiceSeq = ref(0);

const practiceQuestion = computed<Question | null>(() => practice.value?.resolution.question ?? null);

const practiceStem = computed<string>(() => {
  const p = practice.value;
  if (p === null) return '';
  return p.resolution.oral?.stem ?? p.resolution.question?.stem ?? '';
});

const practiceKey = computed<string>(
  () => `${practice.value?.view.item.questionRef ?? ''}:${practiceSeq.value}`,
);

// ---- 题型分派（与练习页同一映射） ----

const isDictationPractice = computed<boolean>(() => practiceQuestion.value?.type === 'dictation');

const isChoicePractice = computed<boolean>(() => {
  const t = practiceQuestion.value?.type;
  return t === 'pinyin' || t === 'polyphone' || t === 'poem_chain' || t === 'judge' || t === 'choice';
});

const isDragPractice = computed<boolean>(() => {
  const q = practiceQuestion.value;
  if (q === null) return false;
  if (q.type === 'similar_char' || q.type === 'word_match' || q.type === 'idiom_fill') return true;
  return q.type === 'unit_conv' && q.answer.pairs !== undefined;
});

const isNumericPractice = computed<boolean>(() => {
  const p = practice.value;
  if (p === null) return false;
  if (p.resolution.oral !== null) return true;
  const q = practiceQuestion.value;
  if (q === null) return false;
  if (q.type === 'blank' || q.type === 'geometry' || q.type === 'oral') return true;
  return q.type === 'unit_conv' && q.answer.number !== undefined;
});

const isWordCardPractice = computed<boolean>(() => practiceQuestion.value?.type === 'word_card');

/** 单词卡题池：题库全部一期单词卡（干扰项来源，与练习页同一口径） */
const englishPool = computed<Question[]>(() => {
  if (!appState.bank) return [];
  return (appState.bank.bySubject.get('english') ?? []).filter(
    (q) => q.type === 'word_card' && q.phase === 1,
  );
});

/** Fisher-Yates 洗牌（返回新数组，不改原数组；随机源注入可测） */
function shuffleOptions(options: readonly QuestionOption[]): QuestionOption[] {
  const arr = [...options];
  const rand = randSource.value;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

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

/** 从详情层进入重新作答：复用详情已解析的原题（降级重新生成仅发生一次） */
function openPractice(): void {
  const d = detail.value;
  if (d === null || d.resolution.missing) return;
  const q = d.resolution.question;
  const rawOptions = q?.options ?? [];
  detail.value = null;
  practiceSeq.value += 1;
  settled.value = false;
  settleResult.value = null;
  revealEvent.value = null;
  keypadInput.value = '';
  practice.value = {
    view: d.view,
    resolution: d.resolution,
    options:
      q !== null && q.type !== 'judge' && rawOptions.length > 1
        ? shuffleOptions(rawOptions)
        : [...rawOptions],
    drag: q !== null ? splitPairOptions(q) : { targets: [], choices: [] },
  };
}

function closePractice(): void {
  practice.value = null;
  settled.value = false;
  settleResult.value = null;
  revealEvent.value = null;
  keypadInput.value = '';
}

// ---- 作答判定入口（组件事件 → 既有 judge 判定，与闯关练习同一管线） ----

/** 判断题选项 id → bool：优先按 't'/'f' 或"正确"文案识别真值选项 */
function mapJudgeSelection(q: Question, selectedId: string): boolean {
  const options = q.options ?? [];
  const trueOption = options.find((o) => o.id === 't' || o.text === '正确');
  if (trueOption) return selectedId === trueOption.id;
  return (options.find((o) => o.id === selectedId)?.text ?? '') === '正确';
}

function onChoiceSelect(optionId: string): void {
  if (settled.value) return;
  const q = practiceQuestion.value;
  if (q === null) return;
  const student: StudentAnswer =
    q.type === 'judge' ? { bool: mapJudgeSelection(q, optionId) } : { choice: [optionId] };
  settleReAnswer(judgeQuestion(q, student));
}

function onDragSubmit(pairs: Record<string, string>): void {
  if (settled.value) return;
  const q = practiceQuestion.value;
  if (q === null) return;
  settleReAnswer(judgeQuestion(q, { pairs }));
}

function onNumericSubmit(value: number): void {
  if (settled.value) return;
  const p = practice.value;
  if (p === null) return;
  if (p.resolution.oral !== null) {
    settleReAnswer(judgeGenerated(p.resolution.oral, value));
    return;
  }
  const q = practiceQuestion.value;
  if (q === null) return;
  settleReAnswer(judgeQuestion(q, { number: value }));
}

function onWordCardAnswer(payload: { selectedOptionId: string; correctOptionId: string }): void {
  if (settled.value) return;
  // 与 judge choice 规则同义：所选选项 id 与正确选项 id 一致（Req 5.5）
  settleReAnswer(payload.selectedOptionId === payload.correctOptionId);
}

function onDictationAnswer(order: string[]): void {
  if (settled.value) return;
  const q = practiceQuestion.value;
  if (q === null) return;
  settleReAnswer(judgeQuestion(q, { order }));
}

// ---- 一次提交定盘（Req 5.8、5.9；无 Hint 与重试） ----

function settleReAnswer(correct: boolean): void {
  const p = practice.value;
  if (p === null || settled.value) return;
  settled.value = true;
  const now = Date.now();
  const currentMastery = appState.store.read('mastery');
  if (correct) {
    // 答对（Req 5.8）：掌握度按既有间隔状态机 applyAnswer(rec, true, now) 更新；
    // Wrong_Set 不变（该题保留，掌握标记由 mastery 派生自动呈现）
    const result = applyReAnswerCorrect(p.view.item, currentMastery, now);
    mastery.value = result.mastery;
    appState.store.schedule('mastery', result.mastery);
    appState.feedback.onCorrect();
    settleResult.value = 'correct';
  } else {
    // 答错（Req 5.9）：掌握度重置为未掌握；该题 wrongAt=now、wrongCount+1，不新增记录
    const result = applyReAnswerWrong(appState.store.read('wrongSet'), p.view.item, currentMastery, now);
    wrongSet.value = result.set;
    mastery.value = result.mastery;
    appState.store.schedule('wrongSet', result.set);
    appState.store.schedule('mastery', result.mastery);
    const q = p.resolution.question;
    revealEvent.value = appState.feedback.onSecondWrong(
      q ?? {
        answer: { number: p.resolution.oral?.answer ?? 0 },
        analysis: `正确答案是 ${p.resolution.oral?.answer ?? ''}。`,
      },
    );
    settleResult.value = 'wrong';
  }
}

// ============ 空状态引导（Req 5.6） ============

/** "去闯关"引导入口：回首页经"今日冒险"进入闯关练习 */
function goAdventure(): void {
  void router.push('/');
}
</script>

<style scoped>
/* ============ 页面整体（卡通圆角，与首页/小岛页一致，Req 12.1） ============ */

.wrong-set-page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 16px 16px 32px;
  background: linear-gradient(180deg, #ffe3ec 0%, #ffd6e0 45%, #fff1d6 100%);
  font-family: 'Comic Sans MS', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

/* ============ 顶栏 ============ */

.wrong-set-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  max-width: 720px;
  margin: 0 auto 16px;
}

/* 返回我的小岛：触控区域 ≥44×44px（Req 12.2） */
.back-island {
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

.back-island:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12);
}

.wrong-set-title {
  flex: 1 1 auto;
  margin: 0;
  font-size: 28px;
  color: #8a3a5a;
  text-align: center;
  text-shadow: 0 2px 0 rgba(255, 255, 255, 0.7);
}

/* ============ 写失败提示 ============ */

.write-error {
  max-width: 720px;
  margin: 0 auto 12px;
  padding: 10px 18px;
  border: 2px solid #ff9f1c;
  border-radius: 16px;
  background-color: #fff1d6;
  color: #8a5a00;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
}

/* ============ 空状态（Req 5.6） ============ */

.empty-state {
  max-width: 480px;
  margin: 48px auto 0;
  padding: 32px 24px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.92);
  text-align: center;
  box-shadow: 0 6px 0 rgba(160, 80, 110, 0.18);
}

.empty-state__emoji {
  font-size: 56px;
  line-height: 1;
}

.empty-state__text {
  margin: 16px 0 24px;
  font-size: 18px;
  font-weight: bold;
  color: #6a4a5a;
  line-height: 1.6;
}

/* ============ 分组列表（Req 5.2） ============ */

.wrong-set-list {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.wrong-group {
  padding: 12px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.55);
}

.wrong-group__title {
  margin: 0 0 10px;
  font-size: 22px;
  color: #7a3a52;
}

.wrong-group__items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 错题条目卡：整卡可点，触控区域充足 */
.wrong-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 14px 16px;
  border: 3px solid #ffc7d6;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: 0 4px 0 rgba(190, 110, 140, 0.25);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.wrong-item:active {
  transform: translateY(2px);
  box-shadow: 0 2px 0 rgba(190, 110, 140, 0.25);
}

.wrong-item__stem {
  font-size: 18px;
  font-weight: bold;
  color: #4a3040;
  line-height: 1.5;
  word-break: break-word;
}

.wrong-item__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.meta-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  background: #f3ecff;
  color: #5a4a7a;
  font-size: 14px;
  font-weight: bold;
}

.meta-pill--time {
  background: #e8f4ff;
  color: #2a5a8a;
}

.meta-pill--mastered {
  background: #dcf5d0;
  color: #2b7a4b;
}

.meta-pill--unmastered {
  background: #ffe1d6;
  color: #b34700;
}

/* ============ 弹层（详情 / 重新作答） ============ */

.detail-overlay,
.practice-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(40, 30, 50, 0.45);
  overflow-y: auto;
}

.detail-card,
.practice-card {
  width: 100%;
  max-width: 520px;
  padding: 24px 20px;
  border-radius: 24px;
  background: #fffdf5;
  border: 4px solid #ffd166;
  box-shadow: 0 8px 0 rgba(180, 130, 40, 0.35);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.practice-card {
  border-color: #a8c9ff;
  box-shadow: 0 8px 0 rgba(80, 120, 200, 0.35);
}

.detail-card__stem,
.practice-card__stem {
  margin: 0;
  font-size: 20px;
  font-weight: bold;
  color: #4a3b2a;
  line-height: 1.6;
  text-align: center;
  word-break: break-word;
}

.detail-card__meta {
  margin: 0;
  font-size: 15px;
  font-weight: bold;
  color: #8a6a7a;
}

.detail-card__missing {
  margin: 0;
  padding: 12px 16px;
  border-radius: 16px;
  background: #f0f0f0;
  color: #666666;
  font-size: 16px;
  font-weight: bold;
  text-align: center;
  line-height: 1.6;
}

.detail-card__answer,
.practice-card__answer {
  margin: 0;
  font-size: 18px;
  color: #2b7a4b;
  text-align: center;
  line-height: 1.6;
  word-break: break-word;
}

.detail-card__analysis,
.practice-card__analysis {
  margin: 0;
  font-size: 16px;
  color: #5a4a3a;
  text-align: center;
  line-height: 1.6;
}

.practice-card__encouragement {
  margin: 0;
  font-size: 16px;
  font-weight: bold;
  color: #b34700;
  text-align: center;
}

.detail-card__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 8px;
}

.practice-card__result {
  padding: 12px 18px;
  border-radius: 18px;
  background: #fff1d6;
  border: 2px solid #ffcf3f;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
}

.practice-card__result--correct {
  background: #dcf5d0;
  border-color: #8fdc7f;
  color: #2b7a4b;
  font-size: 22px;
  font-weight: bold;
  text-align: center;
  align-items: center;
}

/* ============ 大按钮（与练习页同风格） ============ */

.big-btn {
  min-width: 120px;
  min-height: 44px;
  padding: 10px 24px;
  border: none;
  border-radius: 999px;
  font-size: 18px;
  font-weight: bold;
  font-family: inherit;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.big-btn--primary {
  background: linear-gradient(180deg, #ffd94d 0%, #ffb03a 100%);
  color: #7a4a00;
  box-shadow: 0 4px 0 #d18a1a;
}

.big-btn--primary:active {
  transform: translateY(2px);
  box-shadow: 0 2px 0 #d18a1a;
}

.big-btn--rest {
  background: linear-gradient(180deg, #cfe3ff 0%, #a8c9ff 100%);
  color: #1d4f9c;
  box-shadow: 0 4px 0 #3b78d8;
}

.big-btn--rest:active {
  transform: translateY(2px);
  box-shadow: 0 2px 0 #3b78d8;
}

/* ============ 小屏适配 ============ */

@media (max-width: 420px) {
  .wrong-set-title {
    font-size: 24px;
  }

  .wrong-item__stem {
    font-size: 16px;
  }
}
</style>
