/**
 * 会话定位、分组与持久化往返属性测试
 *
 * 实现 tasks.md 7.2，覆盖设计文档 Correctness Properties：
 * - Property 1: 下一未答题定位（Validates: Requirements 1.3, 1.5, 2.7）
 * - Property 2: 三题分组不变量（Validates: Requirements 2.1, 7.9）
 * - Property 3: 会话持久化往返（Validates: Requirements 2.4, 2.5, 2.8）
 *
 * 被测实现：src/engine/adventureEngine.ts（groupIntoGroups / nextUnanswered /
 * serializeSession / deserializeSession / isTodaySession / createTodaySession）。
 * Property 3 经由真实 Local_Store（src/data/localStore.ts）注入内存 StorageLike
 * 完成「序列化 → 写入 → 读出 → 恢复」全链路。
 * fast-check 每个属性最少 100 次迭代。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  deserializeSession,
  groupIntoGroups,
  isTodaySession,
  nextUnanswered,
  serializeSession,
} from '@/engine/adventureEngine';
import { createLocalStore, createMemoryStorage } from '@/data/localStore';
import type {
  AnswerResult,
  QueueItem,
  QuestionType,
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

/** 本地自然日字符串 'YYYY-MM-DD'（匹配会话校验的 DATE_RE） */
const dateStringArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 1970, max: 2100 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(
    ([y, m, d]) =>
      `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  );

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

/**
 * 任意合法 Today_Session：全部字段在各自取值域内随机，
 * results 为任意长度的作答结果列表（通过 isTodaySession 校验）。
 */
const todaySessionArb: fc.Arbitrary<TodaySession> = fc.record({
  date: dateStringArb,
  queue: fc.array(queueItemArb, { maxLength: 40 }),
  currentIndex: fc.nat(40),
  streak: fc.nat(1000),
  consecutiveWrong: fc.nat(1000),
  difficultyOffset: fc.constantFrom(0, -1) as fc.Arbitrary<0 | -1>,
  levelStartedAt: fc.integer({ min: 0, max: MAX_TS }),
  elapsedMs: fc.nat(3_600_000),
  status: fc.constantFrom('active', 'done') as fc.Arbitrary<'active' | 'done'>,
  results: fc.array(answerResultArb, { maxLength: 40 }),
});

/** 由已作答前缀构造会话：results 恰好对应 queue[0..currentIndex) 的作答记录 */
function buildSessionWithAnsweredPrefix(
  queue: QueueItem[],
  currentIndex: number,
  status: 'active' | 'done',
): TodaySession {
  const results: AnswerResult[] = queue.slice(0, currentIndex).map((item, i) => ({
    questionRef:
      item.kind === 'bank'
        ? (item.questionId as string)
        : (item.generatorParamsId as string),
    knowledgePointId: item.knowledgePointId,
    correct: i % 2 === 0,
    retried: i % 3 === 0,
    stars: i % 2 === 0 ? 5 : 0,
    answeredAt: i,
  }));
  return {
    date: '2026-01-01',
    queue,
    currentIndex,
    streak: 0,
    consecutiveWrong: 0,
    difficultyOffset: 0,
    levelStartedAt: 0,
    elapsedMs: 0,
    status,
    results,
  };
}

/**
 * 任意带已作答前缀的合法会话：任意队列长度 n≥0，currentIndex ∈ [0, n]
 * （覆盖"未开始 / 作答中途 / 恰好答完"），status 任意 active/done。
 */
const sessionWithPrefixArb: fc.Arbitrary<TodaySession> = fc
  .array(queueItemArb, { maxLength: 40 })
  .chain((queue) =>
    fc
      .tuple(
        fc.integer({ min: 0, max: queue.length }),
        fc.constantFrom('active', 'done') as fc.Arbitrary<'active' | 'done'>,
      )
      .map(([currentIndex, status]) =>
        buildSessionWithAnsweredPrefix(queue, currentIndex, status),
      ),
  );

const RUNS = { numRuns: 100 };

// ============ 属性测试 ============

describe('会话定位、分组与持久化往返属性测试', () => {
  /**
   * **Feature: kids-learning-adventure, Property 1: 下一未答题定位**
   *
   * *For any* 合法 Today_Session（任意队列长度、任意已作答前缀），
   * nextUnanswered(session) 应返回队列中第一个未作答的题目；当且仅当全部题目
   * 已完成（status='done'）时返回 null。
   *
   * **Validates: Requirements 1.3, 1.5, 2.7**
   */
  it('Property 1: 下一未答题定位（返回首个未作答题；全部完成当且仅当返回 null）', () => {
    fc.assert(
      fc.property(sessionWithPrefixArb, (session) => {
        const result = nextUnanswered(session);

        // 全部完成 ⟺ 会话标记 done，或已作答前缀覆盖整个队列（currentIndex 越界）
        const allDone =
          session.status === 'done' ||
          session.currentIndex >= session.queue.length;

        // 当且仅当全部完成时返回 null
        expect(result === null).toBe(allDone);

        if (!allDone) {
          // currentIndex 指向"下一道未作答位置"：返回的必须是该位置的题目（同引用）
          expect(result).toBe(session.queue[session.currentIndex]);
          // 前置一致性：已作答前缀长度即为 currentIndex
          expect(session.results.length).toBe(session.currentIndex);
        }
      }),
      RUNS,
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 2: 三题分组不变量**
   *
   * *For any* 题目队列（任意长度 n≥0），groupIntoGroups(queue, 3) 的结果应满足：
   * 除最后一组外每组恰为 3 题，最后一组为 1 至 3 题，且全部组拼接后与原始队列
   * 逐元素相等（不丢题、不重题、不改序）。
   *
   * **Validates: Requirements 2.1, 7.9**
   */
  it('Property 2: 三题分组不变量（满组 3 题、末组 1-3、拼接回原队列）', () => {
    fc.assert(
      fc.property(
        fc.array(queueItemArb, { maxLength: 60 }),
        (queue) => {
          const before = queue.slice();
          const groups = groupIntoGroups(queue, 3);

          // 组数 = ceil(n / 3)；空队列无组
          expect(groups.length).toBe(Math.ceil(queue.length / 3));
          if (queue.length === 0) {
            expect(groups).toEqual([]);
            return;
          }

          // 除最后一组外每组恰为 3 题；最后一组为 1 至 3 题
          groups.forEach((group, i) => {
            if (i < groups.length - 1) {
              expect(group.length).toBe(3);
            } else {
              expect(group.length).toBeGreaterThanOrEqual(1);
              expect(group.length).toBeLessThanOrEqual(3);
            }
          });

          // 全部组拼接后与原始队列逐元素相等（不丢题、不重题、不改序、同引用）
          const flattened = groups.flat();
          expect(flattened.length).toBe(queue.length);
          for (let i = 0; i < queue.length; i += 1) {
            expect(flattened[i]).toBe(queue[i]);
          }

          // 入参不被修改
          expect(queue).toEqual(before);

          // 缺省 size 即 3，与显式传 3 等价
          const defaulted = groupIntoGroups(queue);
          expect(defaulted.map((g) => g.slice())).toEqual(
            groups.map((g) => g.slice()),
          );
        },
      ),
      RUNS,
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 3: 会话持久化往返**
   *
   * *For any* 合法 Today_Session，将其序列化写入 Local_Store 后再读出恢复，
   * 得到的会话与原始会话在 queue、currentIndex、results、streak 上等价，
   * 且恢复后的 nextUnanswered 结果与写入前一致。
   *
   * **Validates: Requirements 2.4, 2.5, 2.8**
   */
  it('Property 3: 会话持久化往返（经 Local_Store 写入读出后等价且定位一致）', () => {
    fc.assert(
      fc.property(todaySessionArb, (session) => {
        const storage = createMemoryStorage();
        const store = createLocalStore({ storage });
        const nextBefore = nextUnanswered(session);

        // 路径一：serializeSession 序列化后写入真实存储，由 store.read 校验恢复
        storage.setItem(store.keyFor('session:today'), serializeSession(session));
        const restored = store.read('session:today');
        if (restored === null) {
          throw new Error('合法会话经序列化写入后读出不应为 null');
        }
        expect(isTodaySession(restored)).toBe(true);
        // queue / currentIndex / results / streak 等全字段等价
        expect(restored).toEqual(session);
        // 恢复后的 nextUnanswered 与写入前一致
        expect(nextUnanswered(restored)).toEqual(nextBefore);

        // 路径二：store.write 直接写入会话实体，读原始串经 deserializeSession 恢复
        store.write('session:today', session);
        const raw = storage.getItem(store.keyFor('session:today'));
        if (raw === null) {
          throw new Error('store.write 后存储中应存在会话串');
        }
        const restored2 = deserializeSession(raw);
        expect(restored2).toEqual(session);
        if (restored2 !== null) {
          expect(nextUnanswered(restored2)).toEqual(nextBefore);
        }

        // 纯序列化往返：deserializeSession(serializeSession(s)) 与 s 等价
        expect(deserializeSession(serializeSession(session))).toEqual(session);
      }),
      RUNS,
    );
  });
});
