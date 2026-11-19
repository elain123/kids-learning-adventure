/**
 * 设置变更的生效时机属性测试（fast-check，≥100 次迭代）
 *
 * 实现 tasks.md 4.2，对应 .kiro/specs/child-grade-setting/design.md Property 6。
 *
 * 被测实现：src/stores/appState.ts 的 App_State 接线——
 * setChildGrade 立即写入与 startAdventure 仅在"当日会话需要新生成"分支
 * 读取 store.read('childGrade') 传入 buildTodayQueue。
 *
 * 测试构造（design.md「Correctness Properties」约定）：
 * - 内存存储（createMemoryStorage）+ 注入时钟（options.now 指向可变 currentTime）
 *   + 真实种子题库（createAppState 默认加载全部年级种子文件）；
 * - 会话形态由 startAdventure 在 childGrade=g1 下真实生成后改造
 *   （进行中：推进 currentIndex 并补齐前 k 题作答记录；已完成：答满并置
 *   status='done'），保证持久化会话经 Local_Store 校验读回；
 * - 任意 g1、g2 ∈ 1-6、任意当日会话形态（无会话/当日进行中/当日已完成/
 *   昨日会话）与任意时钟。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createAppState, type AppState } from '@/stores/appState';
import { createMemoryStorage } from '@/data/localStore';
import { localDateString } from '@/engine/reviewEngine';
import { nextUnanswered } from '@/engine/adventureEngine';
import { kpIdGrade } from '@/engine/kpId';
import type { AudioService } from '@/services/audioService';
import type { AnswerResult, QueueItem } from '@/types';

// ============ 基础生成器 ============

const MAX_TS = 1_000_000_000_000; // 任意时间戳上限（留出时钟推进余量）

/** 任意时钟（任意自然日内的任意时刻） */
const nowArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_TS });

/** 任意孩子年级（1-6 整数） */
const gradeArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 6 });

/** 任意当日会话形态：无会话 / 当日进行中 / 当日已完成 / 昨日会话 */
const shapeArb = fc.constantFrom('none', 'active', 'done', 'yesterday');

/** 组合场景：g1（变更前年级）、g2（变更后年级）、会话形态、时钟、进行中进度基数 */
const scenarioArb = fc.record({
  g1: gradeArb,
  g2: gradeArb,
  shape: shapeArb,
  now: nowArb,
  progress: fc.nat(1_000),
});

const RUNS = { numRuns: 100 };

// ============ 测试辅助 ============

/** 静音 Audio_Service（注入 App_State，避免 jsdom 媒体告警干扰） */
const silentAudio: AudioService = {
  playEffect: () => Promise.resolve(),
  playPronunciation: () => Promise.resolve(),
  speakText: () => Promise.resolve(),
  stopAll: () => undefined,
  isEffectAvailable: () => false,
};

/** 本地当日零点（setHours 经本地时区分量，与 localDateString 同口径） */
function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 本地下一自然日零点（Date 算术处理跨月/跨年/夏令时） */
function nextNaturalDayStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** 为队列项构造结构合法的作答结果（isAnswerResult 口径，保证会话读回校验通过） */
function answerResultFor(item: QueueItem, answeredAt: number): AnswerResult {
  return {
    questionRef:
      item.kind === 'bank'
        ? (item.questionId as string)
        : `gen:${item.generatorParamsId as string}:0`,
    knowledgePointId: item.knowledgePointId,
    correct: true,
    retried: false,
    stars: 5,
    answeredAt,
  };
}

/**
 * 断言队列每项年级均 ≤ childGrade：题目数值 grade（kind='bank'）、
 * 生成器年级参数（kind='generated'）与 kpId 年级段（可解析且 ≤ childGrade），
 * 与 Requirement 2.1/2.2 的三个年级来源一一对应。
 */
function expectQueueWithinGrade(
  state: AppState,
  queue: readonly QueueItem[],
  childGrade: number,
): void {
  const generatorById = new Map(state.generators.map((g) => [g.id, g]));
  for (const item of queue) {
    if (item.kind === 'bank') {
      const q = state.bank?.byId.get(item.questionId as string);
      expect(q, `队列项题目 ${item.questionId} 必须存在于题库`).toBeDefined();
      if (q) {
        expect(
          q.grade,
          `bank 队列项题目 ${q.id} 年级 ${q.grade} 必须 ≤ g2=${childGrade}`,
        ).toBeLessThanOrEqual(childGrade);
      }
    } else {
      const gen = generatorById.get(item.generatorParamsId as string);
      expect(gen, `队列项生成器 ${item.generatorParamsId} 必须存在`).toBeDefined();
      if (gen) {
        expect(
          gen.grade,
          `generated 队列项生成器 ${gen.id} 年级 ${gen.grade} 必须 ≤ g2=${childGrade}`,
        ).toBeLessThanOrEqual(childGrade);
      }
    }
    const g = kpIdGrade(item.knowledgePointId);
    expect(g, `队列项知识点 ${item.knowledgePointId} 的年级段必须可解析`).not.toBeNull();
    expect(
      g as number,
      `队列项知识点 ${item.knowledgePointId} 年级段 ${g} 必须 ≤ g2=${childGrade}`,
    ).toBeLessThanOrEqual(childGrade);
  }
}

// ============ 属性测试 ============

describe('childGrade 设置变更的生效时机属性测试', () => {
  /**
   * **Feature: child-grade-setting, Property 6: 设置变更的生效时机（App_State 接线）**
   *
   * *For any* 年级 g1、g2（1-6）、任意当日会话形态（无会话 / 当日进行中 /
   * 当日已完成 / 昨日会话）与任意时钟：以内存存储与注入时钟创建 App_State
   * 并持久化上述会话后调用 setChildGrade(g2)——
   * (a) 当日会话已存在（进行中或已完成）时，当日再次 startAdventure 不改变
   *     已存储会话：进行中则续练且队列深等于变更前、下一道未完成题不变，
   *     已完成则返回 done 且不重新生成；
   * (b) 当日会话不存在（无会话或仅昨日会话）时，其后 startAdventure 生成的
   *     队列中每个队列项年级均 ≤ g2；
   * (c) 时钟推进到下一自然日后 startAdventure 生成的队列中每个队列项年级
   *     均 ≤ g2。
   *
   * **Validates: Requirements 2.9, 3.2, 3.3, 3.4, 3.5**
   */
  it('Property 6: 当日已生成会话不受设置变更影响，下次生成起按新年级过滤', () => {
    fc.assert(
      fc.property(scenarioArb, ({ g1, g2, shape, now, progress }) => {
        let currentTime = now;
        const state = createAppState({
          storage: createMemoryStorage(),
          audio: silentAudio,
          now: () => currentTime,
        });
        expect(state.bank, '真实种子题库必须加载成功').not.toBeNull();

        // 家长此前已设置 g1（既有会话在 g1 下生成，覆盖"修改"而非仅"首次设置"）
        state.setChildGrade(g1);

        // ---- 构造当日会话形态（会话经 startAdventure 真实生成并持久化） ----
        if (shape === 'yesterday') {
          // 昨日生成会话，随后时钟回到今日（今日无会话）
          currentTime = startOfDay(now) - 1;
          const seeded = state.startAdventure();
          expect(seeded.kind, '昨日会话在真实种子题库下必须能生成').toBe('ready');
          currentTime = now;
        } else if (shape === 'active' || shape === 'done') {
          const seeded = state.startAdventure();
          expect(seeded.kind, '当日会话在真实种子题库下必须能生成').toBe('ready');
          if (seeded.kind !== 'ready') return;
          const base = seeded.session;
          if (shape === 'active') {
            // 当日进行中：已答前 k 题（0 ≤ k < queue.length），下一道未完成题存在
            const k = progress % base.queue.length;
            state.saveSession({
              ...base,
              currentIndex: k,
              results: base.queue.slice(0, k).map((item) => answerResultFor(item, now)),
            });
          } else {
            // 当日已完成：全部作答且 status='done'
            state.saveSession({
              ...base,
              currentIndex: base.queue.length,
              status: 'done',
              results: base.queue.map((item) => answerResultFor(item, now)),
            });
          }
        }
        // shape === 'none'：无会话，不做任何构造

        // ---- 变更前快照（自 Local_Store 读回，与后续比较同一口径） ----
        const preSession = state.store.read('session:today');
        const preNext = preSession === null ? null : nextUnanswered(preSession);

        // ---- 家长修改孩子年级 g1 → g2 ----
        state.setChildGrade(g2);
        expect(state.store.read('childGrade')).toBe(g2);

        const today = localDateString(now);

        if (shape === 'active') {
          // (a1) 当日进行中：再次 startAdventure 续练原队列，
          //      队列深等于变更前且下一道未完成题不变（Req 3.3）
          const after = state.startAdventure();
          expect(after.kind, '当日进行中会话应续练而非重新生成').toBe('ready');
          if (after.kind === 'ready') {
            expect(after.resumed).toBe(true);
            expect(after.session.queue).toEqual(preSession?.queue);
            expect(nextUnanswered(after.session)).toEqual(preNext);
          }
          // 已存储会话不变：年级超限项仍保留在队列中可作答
          expect(state.store.read('session:today')).toEqual(preSession);
        } else if (shape === 'done') {
          // (a2) 当日已完成：返回 done（完成庆祝），当日不重新生成（Req 3.4）
          const after = state.startAdventure();
          expect(after.kind, '当日已完成会话应返回 done 而非重新生成').toBe('done');
          expect(state.store.read('session:today')).toEqual(preSession);
        } else {
          // (b) 当日会话不存在（无会话/仅昨日会话）：其后 startAdventure
          //     即按 g2 过滤生成，队列每项年级 ≤ g2（Req 2.9、3.2）
          const after = state.startAdventure();
          expect(after.kind, '真实种子题库按 g2 过滤后必有可出题').toBe('ready');
          if (after.kind === 'ready') {
            expect(after.resumed).toBe(false);
            expect(after.session.date).toBe(today);
            expectQueueWithinGrade(state, after.session.queue, g2);
          }
        }

        // (c) 时钟推进到下一自然日：新年级自下一次生成起生效，
        //     生成的队列每项年级 ≤ g2（Req 2.9、3.5；全部形态）
        currentTime = nextNaturalDayStart(now);
        const nextDay = state.startAdventure();
        expect(nextDay.kind, '次日真实种子题库按 g2 过滤后必有可出题').toBe('ready');
        if (nextDay.kind === 'ready') {
          expect(nextDay.resumed).toBe(false);
          expect(nextDay.session.date).toBe(localDateString(currentTime));
          expectQueueWithinGrade(state, nextDay.session.queue, g2);
        }
      }),
      RUNS,
    );
  });
});
