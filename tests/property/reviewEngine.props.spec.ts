/**
 * 复习引擎（Review_Engine）间隔状态机属性测试
 *
 * 实现文件：src/engine/reviewEngine.ts（applyAnswer，纯函数，时间参数注入）
 * 间隔序列：1级=10分钟 → 2级=1天 → 3级=3天 → 4级=7天 → 5级=15天；5级答对即掌握。
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { applyAnswer } from '../../src/engine/reviewEngine';
import { INTERVALS_MS, IntervalLevel, MasteryRecord } from '../../src/types';

// ============ 通用生成器 ============

/** 时间戳生成器：留出最大间隔余量，避免 now + INTERVALS_MS[5] 溢出安全整数范围 */
const nowArb: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: Number.MAX_SAFE_INTEGER - INTERVALS_MS[5] - 1,
});

const levelArb: fc.Arbitrary<IntervalLevel> = fc.constantFrom(1, 2, 3, 4, 5);

/** 任意 MasteryRecord（含已掌握、任意级别、任意计数） */
const masteryRecordArb: fc.Arbitrary<MasteryRecord> = fc.record({
  knowledgePointId: fc.string(),
  level: levelArb,
  totalCorrect: fc.nat(1_000_000),
  totalWrong: fc.nat(1_000_000),
  nextReviewAt: fc.option(nowArb, { nil: null }),
  mastered: fc.boolean(),
  lastAnswerAt: nowArb,
});

/** 未掌握的 MasteryRecord */
const unmasteredRecordArb: fc.Arbitrary<MasteryRecord> = masteryRecordArb.map(
  (rec) => ({ ...rec, mastered: false })
);

/** 未掌握、级别 1-4 且 totalCorrect>0 的 MasteryRecord（Property 5 前置条件） */
const level1to4RecordArb: fc.Arbitrary<MasteryRecord> = fc.record({
  knowledgePointId: fc.string(),
  level: fc.constantFrom<IntervalLevel>(1, 2, 3, 4),
  totalCorrect: fc.integer({ min: 1, max: 1_000_000 }),
  totalWrong: fc.nat(1_000_000),
  nextReviewAt: fc.option(nowArb, { nil: null }),
  mastered: fc.constant(false),
  lastAnswerAt: nowArb,
});

/** 未掌握、级别 5（15 天）的 MasteryRecord（Property 7 前置条件） */
const level5RecordArb: fc.Arbitrary<MasteryRecord> = masteryRecordArb.map(
  (rec) => ({ ...rec, level: 5 as IntervalLevel, mastered: false })
);

const RUNS = { numRuns: 100 };

// ============ 属性测试 ============

describe('Review_Engine 间隔状态机（属性测试）', () => {
  /**
   * **Feature: kids-learning-adventure, Property 4: 首次答对建立一级间隔**
   *
   * *For any* 尚无 Mastery_Record 的知识点和任意时间 now，
   * applyAnswer(null, true, now) 应产出 level=1、totalCorrect=1、
   * nextReviewAt = now + 10 分钟、mastered=false 的记录。
   */
  it('Property 4: 首次答对建立一级间隔', () => {
    fc.assert(
      fc.property(nowArb, (now) => {
        const { record, requeue } = applyAnswer(null, true, now);

        expect(record.level).toBe(1);
        expect(record.totalCorrect).toBe(1);
        expect(record.totalWrong).toBe(0);
        expect(record.nextReviewAt).toBe(now + INTERVALS_MS[1]);
        expect(record.mastered).toBe(false);
        expect(record.lastAnswerAt).toBe(now);
        // knowledgePointId 由调用方补写，引擎返回空字符串（设计约定）
        expect(record.knowledgePointId).toBe('');
        expect(requeue).toBe(false);
      }),
      RUNS
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 5: 答对升级间隔序列**
   *
   * *For any* 未标记已掌握、当前级别为 1 至 4 级且 totalCorrect>0 的
   * Mastery_Record 和任意时间 now，答对后级别应递增一级，且
   * nextReviewAt = now + 新级别对应间隔（1 天/3 天/7 天/15 天）。
   */
  it('Property 5: 答对升级间隔序列', () => {
    fc.assert(
      fc.property(level1to4RecordArb, nowArb, (rec, now) => {
        const before = JSON.parse(JSON.stringify(rec)) as MasteryRecord;
        const { record, requeue } = applyAnswer(rec, true, now);

        const newLevel = (rec.level + 1) as IntervalLevel;
        expect(record.level).toBe(newLevel);
        expect(record.nextReviewAt).toBe(now + INTERVALS_MS[newLevel]);
        expect(record.mastered).toBe(false);
        expect(record.totalCorrect).toBe(rec.totalCorrect + 1);
        expect(record.totalWrong).toBe(rec.totalWrong);
        expect(record.knowledgePointId).toBe(rec.knowledgePointId);
        expect(record.lastAnswerAt).toBe(now);
        expect(requeue).toBe(false);

        // 纯函数：返回新对象且不修改入参
        expect(record).not.toBe(rec);
        expect(rec).toEqual(before);
      }),
      RUNS
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 6: 答错重置并当日重出**
   *
   * *For any* 未标记已掌握的 Mastery_Record（任意级别）和任意时间 now，
   * applyAnswer(rec, false, now) 应产出 level=1、nextReviewAt = now + 10 分钟、
   * mastered=false 的记录，且 requeue=true。
   */
  it('Property 6: 答错重置并当日重出', () => {
    fc.assert(
      fc.property(unmasteredRecordArb, nowArb, (rec, now) => {
        const before = JSON.parse(JSON.stringify(rec)) as MasteryRecord;
        const { record, requeue } = applyAnswer(rec, false, now);

        expect(record.level).toBe(1);
        expect(record.nextReviewAt).toBe(now + INTERVALS_MS[1]);
        expect(record.mastered).toBe(false);
        expect(record.totalWrong).toBe(rec.totalWrong + 1);
        expect(record.totalCorrect).toBe(rec.totalCorrect);
        expect(record.knowledgePointId).toBe(rec.knowledgePointId);
        expect(record.lastAnswerAt).toBe(now);
        expect(requeue).toBe(true);

        // 纯函数：返回新对象且不修改入参
        expect(record).not.toBe(rec);
        expect(rec).toEqual(before);
      }),
      RUNS
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 7: 五级答对即掌握且永不再入队**
   *
   * *For any* 当前级别为 5 级（15 天）的 Mastery_Record 和任意时间 now，
   * 答对后该记录 mastered=true 且 nextReviewAt=null。
   * （已掌握记录永不入队的一半由 buildTodayQueue 队列属性测试覆盖；
   * 这里仅断言 applyAnswer 一侧。）
   */
  it('Property 7: 五级答对即掌握且永不再入队（applyAnswer 侧）', () => {
    fc.assert(
      fc.property(level5RecordArb, nowArb, (rec, now) => {
        const { record, requeue } = applyAnswer(rec, true, now);

        expect(record.mastered).toBe(true);
        expect(record.nextReviewAt).toBeNull();
        expect(record.level).toBe(5);
        expect(record.totalCorrect).toBe(rec.totalCorrect + 1);
        expect(record.lastAnswerAt).toBe(now);
        // 已掌握记录不再重出当日队列
        expect(requeue).toBe(false);
      }),
      RUNS
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 10: 重试答对按答错记**
   *
   * *For any* Mastery_Record 与任意时间 now，重试后答对对掌握度的更新应与
   * applyAnswer(rec, false, now) 的结果完全一致（视为答错一次）。
   * 引擎层断言：会话层将重试答对以 correct=false 传入，
   * 故对任意记录（含 5 级记录），applyAnswer(rec, false, now)
   * 必须重置为 1 级、mastered=false、nextReviewAt = now + 10 分钟、requeue=true。
   */
  it('Property 10: 重试答对按答错记', () => {
    fc.assert(
      fc.property(masteryRecordArb, nowArb, (rec, now) => {
        const { record, requeue } = applyAnswer(rec, false, now);

        // 与答错路径语义完全一致：重置 1 级并当日重出
        expect(record.level).toBe(1);
        expect(record.mastered).toBe(false);
        expect(record.nextReviewAt).toBe(now + INTERVALS_MS[1]);
        expect(record.totalWrong).toBe(rec.totalWrong + 1);
        expect(record.totalCorrect).toBe(rec.totalCorrect);
        expect(record.knowledgePointId).toBe(rec.knowledgePointId);
        expect(record.lastAnswerAt).toBe(now);
        expect(requeue).toBe(true);
      }),
      RUNS
    );
  });
});
