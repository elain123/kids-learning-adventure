<!--
  家长设置页（Parent_Settings，/parent-settings）—— child-grade-setting 任务 6.1

  依据 .kiro/specs/child-grade-setting/design.md「页面设计 → ParentSettingsPage」
  与「家长确认交互细节」实现，内部两步状态机 step: 'gate' | 'picker'，初始为 gate：

  - gate 步骤（家长确认，Req 1.2、1.3）：挂载时经 1.1 的 createParentGateChallenge
    （随机源可注入，默认 Math.random）生成两位数加法挑战，展示"请家长回答：a + b = ?"、
    数字输入框与确认/取消按钮；该步骤不渲染任何年级选项（Req 1.2）。确认经
    checkParentGateAnswer 判定：通过才进入 picker；答错显示"回答不正确，请再试一次"
    并自动更换新题、停留门禁（Req 1.3）。取消直接 router.push('/')；gate 步骤全程
    不读写 childGrade（Req 1.3）。
  - picker 步骤（孩子年级设置，Req 1.4-1.9、3.5）：6 个年级按钮按一年级至六年级
    固定升序，每个触控区域 ≥44×44px（Req 1.4）；Child_Grade 未设置时全部不选中、
    显示"还未设置孩子年级"提示且保存按钮禁用（Req 1.5、1.8）；已设置时当前年级
    按钮带差异化标记（颜色 + ✓ 图标，Req 1.9），可重新选择并保存覆盖原值（Req 1.7）。
    保存调用 4.1 的 setChildGrade（立即落盘）并展示"当前设置：X 年级"与
    "自明天起的今日冒险生效"说明（Req 1.6、3.5）。
  - 存储写失败经 appState.writeError 提示，不阻断（Req 4.7，与错题集页同一口径）。

  Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 3.5
-->
<template>
  <div class="parent-settings-page">
    <!-- 顶栏：返回首页 + 标题（触控区域 ≥44×44px，Req 12.2 口径） -->
    <header class="ps-topbar">
      <button type="button" class="ps-back" data-testid="back-home" @click="goHome">
        ← 返回首页
      </button>
      <h1 class="ps-title">👨‍👩‍👧 家长设置</h1>
    </header>

    <!-- 存储写失败提示（Req 4.7）：界面可见，不阻断 -->
    <div v-if="writeError" class="ps-write-error" data-testid="write-error-banner" role="alert">
      💾 {{ writeError }}
    </div>

    <!-- gate 步骤：家长确认（Req 1.2、1.3）；本步骤不渲染任何年级选项 -->
    <section v-if="step === 'gate'" class="ps-card" data-testid="parent-gate" aria-label="家长确认">
      <div class="ps-card__emoji" aria-hidden="true">🔐</div>
      <h2 class="ps-card__title">家长确认</h2>
      <p class="ps-card__text">为防止小朋友误改设置，请家长先回答下面这道题：</p>
      <p class="ps-challenge" data-testid="gate-challenge">
        请家长回答：{{ challenge.a }} + {{ challenge.b }} = ?
      </p>
      <input
        v-model="gateInput"
        class="ps-input"
        data-testid="gate-input"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        autocomplete="off"
        placeholder="请输入答案"
        aria-label="家长确认答案"
        @keyup.enter="onGateConfirm"
      />
      <p v-if="gateError" class="ps-gate-error" data-testid="gate-error" role="alert">
        回答不正确，请再试一次
      </p>
      <div class="ps-actions">
        <button
          type="button"
          class="ps-btn ps-btn--primary"
          data-testid="gate-confirm"
          @click="onGateConfirm"
        >
          确认
        </button>
        <button
          type="button"
          class="ps-btn ps-btn--rest"
          data-testid="gate-cancel"
          @click="onGateCancel"
        >
          取消
        </button>
      </div>
    </section>

    <!-- picker 步骤：孩子年级设置（Req 1.4-1.9、3.5） -->
    <section v-else class="ps-card" data-testid="grade-picker" aria-label="孩子年级设置">
      <div class="ps-card__emoji" aria-hidden="true">🎒</div>
      <h2 class="ps-card__title">孩子年级设置</h2>

      <!-- 未设置提示（Req 1.5、1.8） -->
      <p v-if="childGrade === null" class="ps-hint" data-testid="unset-hint" role="status">
        还未设置孩子年级，请选择孩子所在年级
      </p>
      <!-- 当前已设置的 Child_Grade 展示（Req 1.6） -->
      <p v-else class="ps-current" data-testid="current-setting" role="status">
        当前设置：{{ gradeLabel(childGrade) }}
      </p>

      <!-- 6 个年级按钮：一年级至六年级固定升序，触控区域 ≥44×44px（Req 1.4） -->
      <div class="ps-grade-grid">
        <button
          v-for="g in GRADES"
          :key="g"
          type="button"
          class="ps-grade-btn"
          :class="{
            'ps-grade-btn--selected': g === selected,
            'ps-grade-btn--current': g === childGrade,
          }"
          :data-grade="g"
          :aria-pressed="g === selected"
          data-testid="grade-option"
          @click="onSelectGrade(g)"
        >
          <span class="ps-grade-btn__label">{{ gradeLabel(g) }}</span>
          <!-- 当前 Child_Grade 差异化标记：颜色 + ✓ 图标（Req 1.9） -->
          <span
            v-if="g === childGrade"
            class="ps-grade-btn__mark"
            data-testid="current-grade-mark"
            aria-label="当前设置"
            >✓</span
          >
        </button>
      </div>

      <!-- 未选择年级时保存不可用（Req 1.5）；选择后可保存覆盖原值（Req 1.7） -->
      <button
        type="button"
        class="ps-btn ps-btn--primary ps-save"
        data-testid="save-grade"
        :disabled="!canSave"
        @click="onSave"
      >
        保存
      </button>

      <!-- 生效时机说明（Req 1.6、3.5）：保存后展示 -->
      <p v-if="savedNotice" class="ps-effect" data-testid="save-effect-note" role="status">
        已保存！新年级自明天起的今日冒险生效
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useAppState } from '../stores/appState';
import {
  createParentGateChallenge,
  checkParentGateAnswer,
  type ParentGateChallenge,
} from '../engine/parentGate';

/** 随机源注入（挑战生成定盘可测），默认 Math.random（与错题集页同一约定） */
const props = withDefaults(defineProps<{ rand?: () => number }>(), { rand: undefined });

const appState = useAppState();
const router = useRouter();

/** 孩子年级（响应式共享引用；gate 步骤不使用，picker 步骤只读展示） */
const childGrade = appState.childGrade;
/** 存储写失败提示（Req 4.7，App_State 唯一状态源） */
const writeError = appState.writeError;

// ============ 两步状态机：gate → picker ============

type Step = 'gate' | 'picker';
const step = ref<Step>('gate');

// ============ gate 步骤（家长确认，Req 1.2、1.3） ============

/** 当前挑战：挂载时生成一次，每次答错后更换新题 */
const challenge = ref<ParentGateChallenge>(createParentGateChallenge(props.rand));
const gateInput = ref('');
const gateError = ref(false);

/** 确认：通过进入 picker；答错提示并换新题、停留门禁，childGrade 不变（Req 1.3） */
function onGateConfirm(): void {
  if (checkParentGateAnswer(challenge.value, gateInput.value)) {
    // 进入年级选择：已设置时预选当前年级（可重新选择覆盖保存，Req 1.7）
    selected.value = childGrade.value;
    step.value = 'picker';
    return;
  }
  gateError.value = true;
  gateInput.value = '';
  challenge.value = createParentGateChallenge(props.rand);
}

/** 取消：直接返回首页，全程不读写 childGrade（Req 1.3） */
function onGateCancel(): void {
  void router.push('/');
}

// ============ picker 步骤（孩子年级设置，Req 1.4-1.9、3.5） ============

/** 6 个年级选项：一年级至六年级固定升序（Req 1.4） */
const GRADES = [1, 2, 3, 4, 5, 6] as const;

const GRADE_LABELS = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'] as const;

function gradeLabel(grade: number): string {
  return GRADE_LABELS[grade - 1] ?? `${grade}年级`;
}

/** 本次访问已选择的年级（未选择为 null；进入 picker 时预选当前设置） */
const selected = ref<number | null>(null);
/** 保存成功后的生效说明（Req 1.6、3.5） */
const savedNotice = ref(false);

/** 保存可用条件：已选择任一年级（未设置且未选择时禁用，Req 1.5） */
const canSave = computed<boolean>(() => selected.value !== null);

function onSelectGrade(grade: number): void {
  selected.value = grade;
}

/** 保存：setChildGrade 同步更新响应式引用并立即落盘（Req 1.6、1.7、4.1、4.2） */
function onSave(): void {
  if (selected.value === null) return;
  appState.setChildGrade(selected.value);
  savedNotice.value = true;
}

function goHome(): void {
  void router.push('/');
}
</script>

<style scoped>
/* ============ 页面整体（卡通圆角，与错题集页/学科页一致） ============ */

.parent-settings-page {
  min-height: 100vh;
  min-height: 100dvh;
  box-sizing: border-box;
  padding: 16px 16px 40px;
  background: linear-gradient(180deg, #cfe8ff 0%, #e6f3ff 45%, #fff3d6 100%);
  font-family: 'Comic Sans MS', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* ============ 顶栏 ============ */

.ps-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  width: 100%;
  max-width: 520px;
  margin: 0 auto 16px;
}

/* 返回首页：触控区域 ≥44×44px */
.ps-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: 8px 16px;
  border: none;
  border-radius: 999px;
  background: #ffffff;
  color: #2b5d8a;
  font-size: 16px;
  font-weight: 800;
  font-family: inherit;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.12);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.ps-back:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12);
}

.ps-title {
  flex: 1 1 auto;
  margin: 0;
  font-size: 26px;
  color: #2b5d8a;
  text-align: center;
  text-shadow: 0 2px 0 rgba(255, 255, 255, 0.7);
}

/* ============ 写失败提示（Req 4.7） ============ */

.ps-write-error {
  width: 100%;
  max-width: 520px;
  box-sizing: border-box;
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

/* ============ 卡片（门禁 / 年级设置共用） ============ */

.ps-card {
  width: 100%;
  max-width: 480px;
  box-sizing: border-box;
  padding: 24px 22px;
  border: 4px solid #ffd166;
  border-radius: 28px;
  background: rgba(255, 253, 245, 0.97);
  box-shadow: 0 8px 0 rgba(180, 130, 40, 0.28);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.ps-card__emoji {
  font-size: 48px;
  line-height: 1;
}

.ps-card__title {
  margin: 0;
  font-size: 24px;
  font-weight: 900;
  color: #4a3b2a;
}

.ps-card__text {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #8a7358;
  text-align: center;
  line-height: 1.6;
}

/* ============ gate 步骤 ============ */

.ps-challenge {
  margin: 4px 0 0;
  font-size: 26px;
  font-weight: 900;
  color: #2b5d8a;
  text-align: center;
}

.ps-input {
  width: 100%;
  max-width: 240px;
  min-height: 52px;
  box-sizing: border-box;
  padding: 8px 16px;
  border: 3px solid #a8c9ff;
  border-radius: 16px;
  background: #ffffff;
  color: #2b3a4a;
  font-size: 24px;
  font-weight: 800;
  font-family: inherit;
  text-align: center;
}

.ps-input:focus {
  outline: none;
  border-color: #5b9bd5;
  box-shadow: 0 0 0 3px rgba(91, 155, 213, 0.25);
}

.ps-gate-error {
  margin: 0;
  padding: 8px 16px;
  border-radius: 999px;
  background: #ffe1d6;
  color: #b34700;
  font-size: 15px;
  font-weight: 800;
}

.ps-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 4px;
}

/* ============ 按钮（触控区域 ≥44×44px） ============ */

.ps-btn {
  min-width: 140px;
  min-height: 48px;
  padding: 10px 28px;
  border: none;
  border-radius: 999px;
  font-size: 18px;
  font-weight: 900;
  font-family: inherit;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.ps-btn--primary {
  background: linear-gradient(180deg, #ffb703, #fb8500);
  color: #ffffff;
  box-shadow: 0 4px 0 rgba(180, 100, 0, 0.45);
}

.ps-btn--primary:active:not(:disabled) {
  transform: translateY(3px);
  box-shadow: 0 1px 0 rgba(180, 100, 0, 0.45);
}

.ps-btn--primary:disabled {
  cursor: default;
  opacity: 0.5;
}

.ps-btn--rest {
  background: #f0f0f0;
  color: #5a4a42;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.12);
}

.ps-btn--rest:active {
  transform: translateY(3px);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12);
}

/* ============ picker 步骤 ============ */

.ps-hint {
  margin: 0;
  padding: 8px 16px;
  border-radius: 999px;
  background: #fff1d6;
  border: 2px solid #ffcf3f;
  color: #8a5a00;
  font-size: 16px;
  font-weight: 800;
  text-align: center;
}

.ps-current {
  margin: 0;
  padding: 8px 16px;
  border-radius: 999px;
  background: #dcf5d0;
  color: #2b7a4b;
  font-size: 17px;
  font-weight: 900;
  text-align: center;
}

/* 年级网格：6 个按钮固定升序（Req 1.4） */
.ps-grade-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  width: 100%;
}

/*
 * 年级按钮（触控区域 ≥44×44px，Req 1.4）：
 * 未设置时全部按钮共享同一样式、均不选中（Req 1.5）。
 */
.ps-grade-btn {
  position: relative;
  min-width: 44px;
  min-height: 64px;
  padding: 8px 4px;
  border: 3px solid transparent;
  border-radius: 20px;
  background: linear-gradient(180deg, #fff8ec, #ffeccb);
  color: #5a4a42;
  font-size: 20px;
  font-weight: 900;
  font-family: inherit;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.ps-grade-btn:active {
  transform: translateY(3px);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12);
}

/* 本次选择态：高亮描边（与未选中按钮可见区分） */
.ps-grade-btn--selected {
  border-color: #5b9bd5;
  box-shadow: 0 4px 0 rgba(70, 120, 180, 0.45);
}

/*
 * 当前 Child_Grade 标记按钮：差异化配色 + ✓ 图标，与其余年级选项可见区分
 * （Req 1.9）；至多一个按钮携带该修饰。
 */
.ps-grade-btn--current {
  background: linear-gradient(180deg, #95d5b2, #52b788);
  color: #1b4332;
  box-shadow: 0 4px 0 rgba(40, 110, 70, 0.45);
}

.ps-grade-btn--current.ps-grade-btn--selected {
  border-color: #2b7a4b;
}

.ps-grade-btn__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  min-height: 22px;
  padding: 0 4px;
  border-radius: 999px;
  background: #ffffff;
  color: #2b7a4b;
  font-size: 14px;
  font-weight: 900;
  line-height: 1;
}

.ps-save {
  margin-top: 4px;
}

.ps-effect {
  margin: 0;
  padding: 8px 16px;
  border-radius: 999px;
  background: #e8f4ff;
  color: #2a5a8a;
  font-size: 15px;
  font-weight: 800;
  text-align: center;
}

/* 窄屏适配：字号收缩，避免横向滚动 */
@media (max-width: 480px) {
  .ps-title {
    font-size: 22px;
  }

  .ps-challenge {
    font-size: 22px;
  }
}
</style>
