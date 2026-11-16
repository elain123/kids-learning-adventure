/**
 * 作答流程属性测试：计数转移、星星规则与难度调节
 *
 * 实现 tasks.md 7.4，覆盖设计文档 Correctness Properties：
 * - Property 11: 首次作答计数转移（Validates: Requirements 4.1, 4.4, 4.5, 4.8）
 * - Property 12: 星星发放规则（Validates: Requirements 4.6, 5.1）
 * - Property 13: 连错降难度且不低于下限（Validates: Requirements 4.7, 4.8）
 *
 * 被测实现：src/engine/adventureEngine.ts（applyFirstAnswer / awardAnswer /
 * shouldLowerDifficulty / clampDifficulty / nextUnanswered）。
 *
 * Property 12 的 Star_Wallet 部分：Star_Wallet 入账职责在练习壳层（引擎只产出
 * 本题应发星星数 stars，见 adventureEngine 模块文档），本测试采用双重断言——
 * 既断言 applyFirstAnswer 返回的 stars 字段与 awardAnswer 一致，又模拟壳层
 * 入账（balance += stars）验证余额恰好增加该数量。
 *
 * fast-check 每个属性最少 100 次迭代。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ANSWER_STARS_BASE,
  ANSWER_STARS_DOUBLED,
  CONSECUTIVE_WRONG_THRESHOLD,
  applyFirstAnswer,
  awardAnswer,
  clampDifficulty,
  nextUnanswered,
  shouldLowerDifficulty,
} from '@/engine/adventureEngine';
import type {
  AnswerResult,
  Difficulty,
  QueueItem,
  QuestionType,
  StarWallet,
  Subject,
  TodaySession,
} from '@/types';

// ============ 基础生成器 ============

const MAX_TS = 1_000_000_000_000; // 任意时间戳上限

/** 非空白短字符串 */
const nonEmptyString = (maxLength = 16): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength }).filter((s) => s.trim().length > 0);

const SUBJECTS: readonly Subject[] = ['chinese', 'math', 'english'];

const ALL_QUESTION_TYPES: readonly QuestionType[] = [
  'dictation',
  'pinyin',
  'similar_char',
  'polyphone',
  'word_match',
  'idiom_fill',
  'poem_chain',
  'reading',
  'oral',
  'blank',
  'judge',
  'choice',
  'unit_conv',
  'geometry',
  'word_problem',
  'word_card',
  'read_aloud',
];

/** 任意合法 QueueItem：kind=bank 带 questionId，kind=generated 带 generatorParamsId */
const queueItemArb: fc.Arbitrary<QueueItem> = fc
  .record({
    kind: fc.constantFrom('bank', 'generated'),
    id: nonEmptyString(12),
    knowledgePointId: nonEmptyString(10),
    subject: fc.constantFrom(...SUBJECTS) as fc.Arbitrary<Subject>,
    type: fc.constantFrom(...ALL_QUESTION_TYPES),
    difficulty: fc.integer({ min: 1, max: 5 }) as fc.Arbitrary<QueueItem['difficulty']>,
    source: fc.constantFrom('review', 'new', 'retry') as fc.Arbitrary<QueueItem['source']>,
  })
  .map((r): QueueItem => {
    const base = {
      knowledgePointId: r.knowledgePointId,
      subject: r.subject,
      type: r.type,
      difficulty: r.difficulty,
      source: r.source,
    };
    return r.kind === 'bank'
      ? { kind: 'bank', questionId: `q:${r.id}`, ...base }
      : { kind: 'generated', generatorParamsId: `gen:${r.id}`, ...base };
  });

/** 任意合法 AnswerResult */
const answerResultArb: fc.Arbitrary<AnswerResult> = fc.record({
  questionRef: nonEmptyString(12),
  knowledgePointId: nonEmptyString(10),
  correct: fc.boolean(),
  retried: fc.boolean(),
  stars: fc.constantFrom(0, 5, 10),
  answeredAt: fc.integer({ min: 0, max: MAX_TS }),
});

/** 任意合法难度等级（1-5） */
const difficultyArb = fc.integer({ min: 1, max: 5 }) as fc.Arbitrary<Difficulty>;

/** 任意作答时间戳 */
const nowArb = fc.integer({ min: 0, max: MAX_TS });

/**
 * 可作答会话生成器：队列非空、currentIndex 指向一道未作答题、status='active'
 * （applyFirstAnswer 真正定盘，而非走"已完成/无题"防御分支）。
 * streak / consecutiveWrong 的取值域由调用方指定（默认任意非负整数），
 * difficultyOffset 任意（0 或 -1），results 为与已作答前缀等长的任意结果列表。
 */
function answerableSessionArb(options?: {
  streak?: fc.Arbitrary<number>;
  consecutiveWrong?: fc.Arbitrary<number>;
}): fc.Arbitrary<TodaySession> {
  return fc
    .array(queueItemArb, { minLength: 1, maxLength: 40 })
    .chain((queue) =>
      fc
        .tuple(
          fc.integer({ min: 0, max: queue.length - 1 }),
          options?.streak ?? fc.nat(1000),
          options?.consecutiveWrong ?? fc.nat(1000),
          fc.constantFrom(0, -1) as fc.Arbitrary<0 | -1>,
          nowArb,
          fc.nat(3_600_000),
        )
        .chain(
          ([
            currentIndex,
            streak,
            consecutiveWrong,
            difficultyOffset,
            levelStartedAt,
            elapsedMs,
          ]) =>
            fc
              .array(answerResultArb, {
                minLength: currentIndex,
                maxLength: currentIndex,
              })
              .map(
                (results): TodaySession => ({
                  date: '2026-01-01',
                  queue,
                  currentIndex,
                  streak,
                  consecutiveWrong,
                  difficultyOffset,
                  levelStartedAt,
                  elapsedMs,
                  status: 'active',
                  results,
                }),
              ),
        ),
    );
}

/** 纯数据会话的深拷贝快照（入参非修改性检查用） */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const RUNS = { numRuns: 100 };

// ============ 属性测试 ============

describe('作答流程属性测试：计数转移、星星规则与难度调节', () => {
  /**
   * **Feature: kids-learning-adventure, Property 11: 首次作答计数转移**
   *
   * *For any* 会话状态（任意 streak、任意 consecutiveWrong）：首次作答答对后
   * streak 加 1 且 consecutiveWrong 归 0；首次作答答错后 streak 归 0 且
   * consecutiveWrong 加 1；且首错后 retryLeft=1、当前题保持不变。
   *
   * **Validates: Requirements 4.1, 4.4, 4.5, 4.8**
   */
  it('Property 11: 首次作答计数转移（答对 streak+1/连错归 0；答错 streak 归 0/连错+1、retryLeft=1、题目不变）', () => {
    fc.assert(
      fc.property(answerableSessionArb(), nowArb, (session, now) => {
        const before = clone(session);

        // —— 分支一：首次作答答对 ——
        const correctOutcome = applyFirstAnswer(session, true, now);
        const streakAfter = session.streak + 1;
        // streak 加 1、consecutiveWrong 归 0
        expect(correctOutcome.session.streak).toBe(streakAfter);
        expect(correctOutcome.session.consecutiveWrong).toBe(0);
        // 记录首答结果并推进到下一题
        expect(correctOutcome.session.currentIndex).toBe(session.currentIndex + 1);
        expect(correctOutcome.session.results).toHaveLength(
          session.results.length + 1,
        );
        const recorded =
          correctOutcome.session.results[correctOutcome.session.results.length - 1];
        expect(recorded.correct).toBe(true);
        expect(recorded.retried).toBe(false);
        expect(recorded.answeredAt).toBe(now);
        expect(recorded.stars).toBe(correctOutcome.stars);
        // 首对事件
        expect(correctOutcome.events).toHaveLength(1);
        const correctEvent = correctOutcome.events[0];
        expect(correctEvent.type).toBe('first-correct');
        if (correctEvent.type === 'first-correct') {
          expect(correctEvent.streak).toBe(streakAfter);
          expect(correctEvent.stars).toBe(correctOutcome.stars);
        }

        // —— 分支二：首次作答答错 ——
        const wrongOutcome = applyFirstAnswer(session, false, now);
        const consecutiveWrongAfter = session.consecutiveWrong + 1;
        // streak 归 0、consecutiveWrong 加 1
        expect(wrongOutcome.session.streak).toBe(0);
        expect(wrongOutcome.session.consecutiveWrong).toBe(consecutiveWrongAfter);
        expect(wrongOutcome.stars).toBe(0);
        // 当前题保持不变：currentIndex 不前进、queue 与 results 均不变，
        // 下一未答题仍为同一道题（保留供重试，Req 4.1）
        expect(wrongOutcome.session.currentIndex).toBe(session.currentIndex);
        expect(wrongOutcome.session.queue).toBe(session.queue);
        expect(wrongOutcome.session.results).toEqual(session.results);
        expect(nextUnanswered(wrongOutcome.session)).toBe(
          session.queue[session.currentIndex],
        );
        // 首错事件：retryLeft 恒为 1
        expect(wrongOutcome.events).toHaveLength(1);
        const wrongEvent = wrongOutcome.events[0];
        expect(wrongEvent.type).toBe('first-wrong');
        if (wrongEvent.type === 'first-wrong') {
          expect(wrongEvent.retryLeft).toBe(1);
          expect(wrongEvent.consecutiveWrong).toBe(consecutiveWrongAfter);
        }

        // 入参不被修改（两次定盘调用基于同一入参，均应保持其原样）
        expect(session).toEqual(before);
      }),
      RUNS,
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 12: 星星发放规则**
   *
   * *For any* 首次作答答对后的 streak 值 s（s≥1），该题发放星星数应为：
   * s 是 3 的倍数时 10 颗，否则 5 颗，且 Star_Wallet 余额恰好增加该数量。
   *
   * 钱包部分断言方式：Star_Wallet 入账由练习壳层负责（引擎只产出本题应发
   * 星星数），此处先断言 applyFirstAnswer 返回的 stars 字段与 awardAnswer
   * 一致，再模拟壳层入账（balance += stars）验证余额恰好增加该数量。
   *
   * **Validates: Requirements 4.6, 5.1**
   */
  it('Property 12: 星星发放规则（s 为 3 的倍数 10 颗否则 5 颗，钱包余额恰增该数量）', () => {
    fc.assert(
      fc.property(
        answerableSessionArb(),
        nowArb,
        fc.integer({ min: 1, max: 10_000 }), // 任意 streak 值 s≥1，直接断言 awardAnswer
        fc.nat(10_000), // Star_Wallet 起始余额
        (session, now, streakDirect, initialBalance) => {
          // 常量与规格取值一致
          expect(ANSWER_STARS_BASE).toBe(5);
          expect(ANSWER_STARS_DOUBLED).toBe(10);

          // awardAnswer 直接断言：s 是 3 的倍数时 10 颗，否则 5 颗
          expect(awardAnswer(streakDirect)).toBe(
            streakDirect % 3 === 0 ? 10 : 5,
          );

          // 经 applyFirstAnswer 的首对定盘：s = 答对后的 streak（≥1）
          const s = session.streak + 1;
          const expectedStars = s % 3 === 0 ? 10 : 5;
          const outcome = applyFirstAnswer(session, true, now);
          expect(outcome.session.streak).toBe(s);
          expect(outcome.stars).toBe(expectedStars);
          expect(outcome.stars).toBe(awardAnswer(s));
          const event = outcome.events[0];
          expect(event.type).toBe('first-correct');
          if (event.type === 'first-correct') {
            expect(event.stars).toBe(expectedStars);
            // streak 达 3 的倍数时展示星星加倍反馈
            expect(event.doubled).toBe(expectedStars === 10);
          }

          // 模拟壳层 Star_Wallet 入账：余额恰好增加本题应发星星数
          const wallet: StarWallet = {
            balance: initialBalance,
            totalEarned: initialBalance,
          };
          wallet.balance += outcome.stars;
          expect(wallet.balance).toBe(initialBalance + expectedStars);
        },
      ),
      RUNS,
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 13: 连错降难度且不低于下限**
   *
   * *For any* 会话与学科（该学科题库最低难度为 minD）：当连续首次答错计数
   * 达到 3 时，后续出题难度下调 1 级且结果不低于 minD；首次答对后该计数
   * 归零，不再触发下调。
   *
   * **Validates: Requirements 4.7, 4.8**
   */
  it('Property 13: 连错降难度且不低于下限（连错 3 题下调 1 级且不低于 minD；首对归零不再下调）', () => {
    fc.assert(
      fc.property(
        // consecutiveWrong 取小范围整数，保证覆盖"未达 3 / 恰好达 3 / 超过 3"三类情形
        answerableSessionArb({
          consecutiveWrong: fc.integer({ min: 0, max: 6 }),
        }),
        nowArb,
        difficultyArb, // 题目原始难度（1-5）
        difficultyArb, // 该学科题库最低难度 minD（1-5）
        (session, now, difficulty, minD) => {
          const before = clone(session);

          // 阈值常量与规格一致：连续 3 道题首次作答答错触发下调
          expect(CONSECUTIVE_WRONG_THRESHOLD).toBe(3);

          // —— 首错定盘：连续首次答错计数达到 3 ⟺ difficultyOffset 置为 -1 ——
          const wrongOutcome = applyFirstAnswer(session, false, now);
          const consecutiveWrongAfter = session.consecutiveWrong + 1;
          expect(wrongOutcome.session.consecutiveWrong).toBe(consecutiveWrongAfter);
          expect(wrongOutcome.session.difficultyOffset).toBe(
            consecutiveWrongAfter >= 3 ? -1 : 0,
          );
          // difficultyLowered 跳变沿：仅达阈值且此前未处于下调状态时为 true
          const wrongEvent = wrongOutcome.events[0];
          expect(wrongEvent.type).toBe('first-wrong');
          if (wrongEvent.type === 'first-wrong') {
            expect(wrongEvent.difficultyLowered).toBe(
              consecutiveWrongAfter >= 3 && session.difficultyOffset === 0,
            );
          }

          // —— 出题夹取：难度下调 1 级且不低于该学科题库最低难度 minD ——
          const offset = wrongOutcome.session.difficultyOffset;
          const lowered = clampDifficulty(difficulty, offset, minD);
          expect(lowered).toBe(Math.min(Math.max(difficulty + offset, minD), 5));
          expect(lowered).toBeGreaterThanOrEqual(minD);
          expect(lowered).toBeLessThanOrEqual(5);
          // 显式下调 1 级：offset=-1 时结果恰为 max(difficulty - 1, minD)
          expect(clampDifficulty(difficulty, -1, minD)).toBe(
            Math.max(difficulty - 1, minD),
          );
          // offset=0 时难度不下调（在上下限内保持原难度）
          expect(clampDifficulty(difficulty, 0, minD)).toBe(
            Math.min(Math.max(difficulty, minD), 5),
          );

          // —— 首对归零：consecutiveWrong 与 difficultyOffset 均归 0，不再触发下调 ——
          const correctOutcome = applyFirstAnswer(session, true, now);
          expect(correctOutcome.session.consecutiveWrong).toBe(0);
          expect(correctOutcome.session.difficultyOffset).toBe(0);
          expect(
            shouldLowerDifficulty(correctOutcome.session.consecutiveWrong),
          ).toBe(false);

          // 入参不被修改
          expect(session).toEqual(before);
        },
      ),
      RUNS,
    );
  });
});
