/**
 * 星星钱包与宝箱（Star_Wallet & Treasure_Box）属性测试
 *
 * 实现文件：src/engine/rewards.ts（openTreasureBox，纯函数，随机源 roll 注入）
 * 常量：src/types/index.ts（COLLECTIBLE_ITEMS 12 件、TREASURE_BOX_COST=30、DUPLICATE_REFUND_STARS=5）
 *
 * 实现契约（与实现文件头注释及设计文档 Property 14/15 一致）：
 *  - 余额 b ≥ 30：扣减 30，用注入随机源 roll()（与 Math.random 同契约，返回 [0,1)）
 *    从 12 件 COLLECTIBLE_ITEMS 中均匀产出恰 1 件：
 *    · 产出物品不在收藏中 → 加入收藏，outcome='new'，余额恰为 b-30，totalEarned 不变；
 *    · 产出物品已在收藏中 → 折算 5 星返还，outcome='duplicate'，余额恰为 b-30+5，
 *      收藏保持不变、不重复添加，totalEarned 计入返还的 5 星；
 *  - 余额 b < 30：outcome='insufficient'，钱包与收藏均原样返回（roll 不被消费）；
 *  - 纯函数：不修改入参；收藏 items 内任意物品至多出现一次。
 *
 * 随机源策略：
 *  - 任意 roll 值：fc.double 裁剪到 [0,1)，另显式混入边界值 0 与 near-1（1-ε）；
 *  - 定向 roll 值：给定目标物品下标 i，取 v=(i+f)/12（f∈[0,1)），
 *    保证 floor(v*12)=i，从而刻意构造"产出物品在收藏中/不在收藏中"两种情形。
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { openTreasureBox } from '../../src/engine/rewards';
import {
  COLLECTIBLE_ITEMS,
  DUPLICATE_REFUND_STARS,
  TREASURE_BOX_COST,
} from '../../src/types';
import type { IslandCollection, StarWallet } from '../../src/types';

// ============ 基础生成器 ============

const ALL_IDS: readonly string[] = COLLECTIBLE_ITEMS.map((i) => i.id);

/** 余额 ≥30 的钱包：显式混入边界 30（恰够开一次箱）与 31 */
const sufficientBalanceArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(TREASURE_BOX_COST),
  fc.constant(TREASURE_BOX_COST + 1),
  fc.integer({ min: TREASURE_BOX_COST, max: 100_000 }),
);

/** 余额 <30 的钱包：显式混入边界 29（差 1 星）与 0 */
const insufficientBalanceArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(TREASURE_BOX_COST - 1),
  fc.constant(0),
  fc.integer({ min: 0, max: TREASURE_BOX_COST - 1 }),
);

const totalEarnedArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 1_000_000 });

const sufficientWalletArb: fc.Arbitrary<StarWallet> = fc.record({
  balance: sufficientBalanceArb,
  totalEarned: totalEarnedArb,
});

const insufficientWalletArb: fc.Arbitrary<StarWallet> = fc.record({
  balance: insufficientBalanceArb,
  totalEarned: totalEarnedArb,
});

/** 任意收藏：12 件物品 id 的任意子集（subarray 保证唯一、保持全集顺序） */
const collectionArb: fc.Arbitrary<IslandCollection> = fc
  .subarray([...ALL_IDS])
  .map((items) => ({ items }));

/** 把 fc.double 的产出裁剪进 [0,1) 契约区间 */
function clampToUnitInterval(v: number): number {
  if (Number.isNaN(v)) {
    return 0;
  }
  if (v >= 1) {
    return 1 - Number.EPSILON;
  }
  if (v < 0 || Object.is(v, -0)) {
    return 0;
  }
  return v;
}

/** 任意 roll 值：fc.double 裁剪到 [0,1)，显式混入边界 0 与 near-1 */
const rollValueArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.constant(1 - Number.EPSILON),
  fc.double({ min: 0, max: 1, noNaN: true }).map(clampToUnitInterval),
);

/** 记录调用次数的随机源（余额不足时应一次都不被调用） */
function countingRoll(v: number): { roll: () => number; calls: () => number } {
  let n = 0;
  return {
    roll: () => {
      n++;
      return v;
    },
    calls: () => n,
  };
}

/** 定向 roll 值：产出下标为 index 的物品（v=(index+f)/12，f∈[0,1)）；
 *  过滤兜底：f 接近 1 时 (index+f)/12 可能因浮点舍入恰好等于 (index+1)/12
 *  （如 index=2、f=1-ε 时 v 舍入为 0.25，floor(0.25*12)=3），
 *  故显式过滤以保证生成器契约 floor(v*12)=index 成立。 */
const directedRollArb = (index: number): fc.Arbitrary<number> =>
  fc
    .oneof(fc.constant(0), fc.constant(1 - Number.EPSILON), fc.double({ min: 0, max: 1, noNaN: true }))
    .map((f) => (index + clampToUnitInterval(f)) / COLLECTIBLE_ITEMS.length)
    .filter((v) => Math.floor(v * COLLECTIBLE_ITEMS.length) === index);

/** 定向"重复"场景：收藏保证包含下标为 index 的物品（插入位置随机），其余为余下 id 的任意子集 */
const duplicateScenarioArb = (index: number): fc.Arbitrary<IslandCollection> => {
  const target = ALL_IDS[index];
  const others = ALL_IDS.filter((id) => id !== target);
  return fc.subarray(others).chain((subset) =>
    fc.integer({ min: 0, max: subset.length }).map((pos) => {
      const items = [...subset.slice(0, pos), target, ...subset.slice(pos)];
      return { items };
    }),
  );
};

/** 定向"新物品"场景：收藏为余下 id 的任意子集，保证不包含下标为 index 的物品 */
const newItemScenarioArb = (index: number): fc.Arbitrary<IslandCollection> => {
  const others = ALL_IDS.filter((_, i) => i !== index);
  return fc.subarray(others).map((items) => ({ items }));
};

const itemIndexArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: COLLECTIBLE_ITEMS.length - 1 });

// ============ 通用断言 ============

/** 深冻结输入对象：实现若试图修改入参，在严格模式下会立即抛 TypeError */
function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      deepFreeze(value);
    }
    Object.freeze(obj);
  }
  return obj;
}

/** 收藏唯一性不变量：任意物品至多出现一次 */
function expectUniqueItems(collection: IslandCollection): void {
  expect(new Set(collection.items).size, '收藏中任意物品应至多出现一次').toBe(collection.items.length);
  for (const id of collection.items) {
    expect(ALL_IDS, `收藏物品 ${id} 应属于 12 件可收集物全集`).toContain(id);
  }
}

// ============ 属性测试 ============

describe('Treasure_Box 宝箱（属性测试）', () => {
  /**
   * **Feature: kids-learning-adventure, Property 14: 宝箱开启守恒**
   * **Validates: Requirements 5.3, 5.4, 5.6, 5.7**
   *
   * 任意余额 b≥30 的钱包 × 任意收藏 × 任意随机源（含边界 0 与 near-1）：
   * 开启后余额恰为 b-30（新物品）或 b-30+5（重复物品），产出恰 1 件且与
   * floor(roll*12) 下标的物品一致；新物品加入收藏且余额不再变化，
   * 重复物品收藏不变；收藏始终唯一；入参不被修改。
   */
  it('Property 14: 任意钱包/收藏/随机源——余额守恒、产出恰 1 件、收藏唯一、入参不可变', () => {
    let newCount = 0;
    let dupCount = 0;
    fc.assert(
      fc.property(sufficientWalletArb, collectionArb, rollValueArb, (wallet, collection, v) => {
        const walletSnapshot = structuredClone(wallet);
        const collectionSnapshot = structuredClone(collection);
        deepFreeze(wallet);
        deepFreeze(collection);

        const { roll, calls } = countingRoll(v);
        const result = openTreasureBox(wallet, collection, roll);

        // 随机源恰被消费一次，产出恰 1 件且下标与 roll 值一致
        expect(calls()).toBe(1);
        expect(result.item).toBeDefined();
        const expectedIndex = Math.min(
          Math.floor(v * COLLECTIBLE_ITEMS.length),
          COLLECTIBLE_ITEMS.length - 1,
        );
        const expectedItem = COLLECTIBLE_ITEMS[expectedIndex];
        expect(result.item).toEqual(expectedItem);

        if (collectionSnapshot.items.includes(expectedItem.id)) {
          // 重复物品：收藏保持不变、不重复添加，余额为 b-30+5，返还计入 totalEarned
          dupCount++;
          expect(result.outcome).toBe('duplicate');
          expect(result.wallet.balance).toBe(walletSnapshot.balance - TREASURE_BOX_COST + DUPLICATE_REFUND_STARS);
          expect(result.wallet.totalEarned).toBe(walletSnapshot.totalEarned + DUPLICATE_REFUND_STARS);
          expect(result.collection.items).toEqual(collectionSnapshot.items);
        } else {
          // 新物品：加入收藏且余额不再变化（恰为 b-30），totalEarned 不变
          newCount++;
          expect(result.outcome).toBe('new');
          expect(result.wallet.balance).toBe(walletSnapshot.balance - TREASURE_BOX_COST);
          expect(result.wallet.totalEarned).toBe(walletSnapshot.totalEarned);
          expect(result.collection.items).toEqual([...collectionSnapshot.items, expectedItem.id]);
          expect(result.collection.items).toContain(expectedItem.id);
        }

        // 收藏唯一性不变量与入参不可变
        expectUniqueItems(result.collection);
        expect(wallet).toEqual(walletSnapshot);
        expect(collection).toEqual(collectionSnapshot);
      }),
      { numRuns: 300 },
    );
    // 健全性：随机混合下两种产出都应被大量行使
    expect(newCount).toBeGreaterThan(0);
    expect(dupCount).toBeGreaterThan(0);
  });

  /**
   * **Feature: kids-learning-adventure, Property 14: 宝箱开启守恒**
   * **Validates: Requirements 5.3, 5.4, 5.6, 5.7**
   *
   * 定向"新物品"情形：收藏刻意不包含将被产出的物品——
   * outcome='new'、该物品被加入收藏、余额恰为 b-30 且不再变化、收藏保持唯一。
   */
  it('Property 14: 定向新物品——加入收藏、余额恰为 b-30、收藏唯一', () => {
    fc.assert(
      fc.property(
        sufficientWalletArb,
        itemIndexArb.chain((index) =>
          fc.record({
            index: fc.constant(index),
            collection: newItemScenarioArb(index),
            v: directedRollArb(index),
          }),
        ),
        (wallet, { index, collection, v }) => {
          const walletSnapshot = structuredClone(wallet);
          const collectionSnapshot = structuredClone(collection);
          deepFreeze(wallet);
          deepFreeze(collection);

          const result = openTreasureBox(wallet, collection, () => v);
          const expectedItem = COLLECTIBLE_ITEMS[index];

          expect(result.outcome).toBe('new');
          expect(result.item).toEqual(expectedItem);
          expect(result.wallet.balance).toBe(walletSnapshot.balance - TREASURE_BOX_COST);
          expect(result.wallet.totalEarned).toBe(walletSnapshot.totalEarned);
          // 该物品被加入收藏且余额不再变化：收藏恰为原收藏 + 该物品
          expect(result.collection.items).toEqual([...collectionSnapshot.items, expectedItem.id]);
          expectUniqueItems(result.collection);
          expect(wallet).toEqual(walletSnapshot);
          expect(collection).toEqual(collectionSnapshot);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 14: 宝箱开启守恒**
   * **Validates: Requirements 5.3, 5.4, 5.6, 5.7**
   *
   * 定向"重复物品"情形：收藏刻意包含将被产出的物品——
   * outcome='duplicate'、收藏不变（不重复添加）、余额恰为 b-30+5。
   */
  it('Property 14: 定向重复物品——收藏不变、余额恰为 b-30+5', () => {
    fc.assert(
      fc.property(
        sufficientWalletArb,
        itemIndexArb.chain((index) =>
          fc.record({
            index: fc.constant(index),
            collection: duplicateScenarioArb(index),
            v: directedRollArb(index),
          }),
        ),
        (wallet, { index, collection, v }) => {
          const walletSnapshot = structuredClone(wallet);
          const collectionSnapshot = structuredClone(collection);
          deepFreeze(wallet);
          deepFreeze(collection);

          const result = openTreasureBox(wallet, collection, () => v);
          const expectedItem = COLLECTIBLE_ITEMS[index];

          expect(result.outcome).toBe('duplicate');
          expect(result.item).toEqual(expectedItem);
          expect(result.wallet.balance).toBe(walletSnapshot.balance - TREASURE_BOX_COST + DUPLICATE_REFUND_STARS);
          expect(result.wallet.totalEarned).toBe(walletSnapshot.totalEarned + DUPLICATE_REFUND_STARS);
          // 收藏不变、不重复添加：该物品在原收藏中出现次数与结果收藏一致（均为 1 次）
          expect(result.collection.items).toEqual(collectionSnapshot.items);
          expect(
            result.collection.items.filter((id) => id === expectedItem.id),
            '重复物品不得在收藏中重复出现',
          ).toHaveLength(1);
          expectUniqueItems(result.collection);
          expect(wallet).toEqual(walletSnapshot);
          expect(collection).toEqual(collectionSnapshot);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Feature: kids-learning-adventure, Property 15: 星星不足不可开箱**
   * **Validates: Requirements 5.5**
   *
   * 任意余额 b<30 的钱包 × 任意收藏 × 任意随机源：
   * outcome='insufficient'、无产出物品、余额与收藏均保持不变，
   * 且随机源一次都不被消费（无任何开箱动作发生）。
   */
  it('Property 15: 余额不足——insufficient、钱包与收藏原样不变、随机源不被消费', () => {
    fc.assert(
      fc.property(insufficientWalletArb, collectionArb, rollValueArb, (wallet, collection, v) => {
        const walletSnapshot = structuredClone(wallet);
        const collectionSnapshot = structuredClone(collection);
        deepFreeze(wallet);
        deepFreeze(collection);

        const { roll, calls } = countingRoll(v);
        const result = openTreasureBox(wallet, collection, roll);

        expect(result.outcome).toBe('insufficient');
        expect(result.item).toBeUndefined();
        expect(calls(), '余额不足时随机源不应被消费').toBe(0);
        // 余额与收藏均保持不变（值相等，且实现直接原样返回入参引用）
        expect(result.wallet).toEqual(walletSnapshot);
        expect(result.collection).toEqual(collectionSnapshot);
        expect(result.wallet.balance).toBe(walletSnapshot.balance);
        expect(result.wallet.totalEarned).toBe(walletSnapshot.totalEarned);
        expect(result.collection.items).toEqual(collectionSnapshot.items);
        // 入参不可变
        expect(wallet).toEqual(walletSnapshot);
        expect(collection).toEqual(collectionSnapshot);
      }),
      { numRuns: 200 },
    );
  });
});
