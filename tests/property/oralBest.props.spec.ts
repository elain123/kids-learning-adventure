/**
 * 口算历史最佳纪录（Oral_Best）属性测试
 *
 * 实现文件：src/engine/oralBest.ts（updateOralBest / awardLevelCompletion，纯函数、同步、无 I/O）
 * 设计契约（design.md "Property 18: 历史最佳纪录更新"，Validates: Requirements 7.6, 7.7, 7.8）：
 * 对任意本关答对数 score 与历史最佳 prevBest（可能不存在）：
 * - 结算后新纪录 = prevBest 不存在时的 score，否则 max(score, prevBest)；
 * - 当且仅当 prevBest 不存在或 score > prevBest 时 isNewRecord = true（产生"新纪录"提示）；
 * - previousBest 正确回显（无历史纪录为 null，否则为 prevBest）；
 * - 不修改入参 records；其他 genParamsId 的条目保持不变；
 * - 刷新纪录时 achievedAt 记入注入的 now。
 *
 * 测试策略：
 * 1) 任意 records 表（含/不含目标 genParamsId 条目）× 任意非负 score × 任意 now，
 *    断言上述完整契约；
 * 2) awardLevelCompletion：任意钱包 → balance/totalEarned 各 +10，入参不被修改。
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  LEVEL_COMPLETION_STARS,
  awardLevelCompletion,
  updateOralBest,
} from '../../src/engine/oralBest';
import type { OralBestEntry } from '../../src/data/localStore';

const NUM_RUNS = { numRuns: 100 };

// ============ fast-check arbitraries ============

/** 口算生成器参数 id */
const arbGenParamsId: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s !== '__proto__' && s !== 'constructor' && s !== 'prototype');

/** 非负整数答对数（覆盖 0 与较大值） */
const arbScore: fc.Arbitrary<number> = fc.integer({ min: 0, max: 1_000_000 });

/** 结算时间戳（毫秒，非负有限整数） */
const arbNow: fc.Arbitrary<number> = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });

/** 口算最佳纪录条目 */
const arbEntry: fc.Arbitrary<OralBestEntry> = fc.record({
  best: arbScore,
  achievedAt: arbNow,
});

/**
 * 任意 records 表 + 目标 genParamsId：
 * 返回 { records, targetId, prev }，其中 prev 为表中该 id 的既有条目（可能不存在）。
 * 通过布尔开关保证"有/无历史纪录"两类输入空间都被充分覆盖。
 */
const arbRecordsWithTarget: fc.Arbitrary<{
  records: Record<string, OralBestEntry>;
  targetId: string;
  prev: OralBestEntry | undefined;
}> = fc
  .tuple(
    arbGenParamsId,
    fc.boolean(),
    fc.option(arbEntry, { nil: undefined }),
    fc.dictionary(arbGenParamsId, arbEntry, { maxKeys: 8 }),
  )
  .map(([targetId, hasPrev, prevEntry, others]) => {
    // others 中不得包含 targetId，保证语义可控
    const records: Record<string, OralBestEntry> = { ...others };
    delete records[targetId];
    let prev: OralBestEntry | undefined;
    if (hasPrev) {
      prev = prevEntry ?? { best: 0, achievedAt: 0 };
      records[targetId] = prev;
    }
    return { records, targetId, prev };
  });

/** 星星钱包 */
const arbWallet = fc.record({
  balance: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER - LEVEL_COMPLETION_STARS }),
  totalEarned: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER - LEVEL_COMPLETION_STARS }),
});

describe('oralBest 属性测试', () => {
  it('**Feature: kids-learning-adventure, Property 18: 历史最佳纪录更新**', () => {
    // **Validates: Requirements 7.6, 7.7, 7.8**
    fc.assert(
      fc.property(arbRecordsWithTarget, arbScore, arbNow, ({ records, targetId, prev }, score, now) => {
        // 入参快照，用于验证不被修改
        const recordsBefore = JSON.parse(JSON.stringify(records)) as Record<string, OralBestEntry>;
        const prevEntryRef = prev;

        const result = updateOralBest(records, targetId, score, now);

        // 1) 结算后新纪录 = prevBest 不存在时的 score，否则 max(score, prevBest)
        const expectedBest = prev === undefined ? score : Math.max(score, prev.best);
        expect(result.records[targetId]).toBeDefined();
        expect(result.records[targetId].best).toBe(expectedBest);

        // 2) 当且仅当 prevBest 不存在或 score > prevBest 时 isNewRecord = true
        const expectNewRecord = prev === undefined || score > prev.best;
        expect(result.isNewRecord).toBe(expectNewRecord);

        // 3) previousBest 正确回显
        expect(result.previousBest).toBe(prev === undefined ? null : prev.best);

        // 4) 刷新纪录时 achievedAt 记入注入的 now；未刷新时保留原条目（引用不变）
        if (expectNewRecord) {
          expect(result.records[targetId].achievedAt).toBe(now);
        } else {
          expect(result.records[targetId]).toBe(prevEntryRef);
          expect(result.records).toBe(records);
        }

        // 5) 入参 records 不被修改
        expect(records).toEqual(recordsBefore);

        // 6) 其他 genParamsId 的条目保持不变（引用逐一相同）
        for (const key of Object.keys(recordsBefore)) {
          if (key !== targetId) {
            expect(result.records[key]).toBe(records[key]);
          }
        }
      }),
      NUM_RUNS,
    );
  });

  it('**Feature: kids-learning-adventure, Property 18: 历史最佳纪录更新** — awardLevelCompletion 发放 10 星星', () => {
    // **Validates: Requirements 7.6, 7.7, 7.8**
    fc.assert(
      fc.property(arbWallet, (wallet) => {
        const walletBefore = { ...wallet };
        const result = awardLevelCompletion(wallet);

        // balance 与 totalEarned 各增加 LEVEL_COMPLETION_STARS（10）
        expect(result.balance).toBe(wallet.balance + LEVEL_COMPLETION_STARS);
        expect(result.totalEarned).toBe(wallet.totalEarned + LEVEL_COMPLETION_STARS);
        expect(LEVEL_COMPLETION_STARS).toBe(10);

        // 不修改入参，返回新对象
        expect(wallet).toEqual(walletBefore);
        expect(result).not.toBe(wallet);
      }),
      NUM_RUNS,
    );
  });
});
