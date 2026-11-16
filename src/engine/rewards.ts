/**
 * 星星钱包与宝箱（Star_Wallet & Treasure_Box）
 *
 * 依据 design.md "Property 14: 宝箱开启守恒"（Validates: Requirements 5.3, 5.4, 5.6, 5.7）
 * 与 "Property 15: 星星不足不可开箱"（Validates: Requirements 5.5）实现：
 *
 * - 开启一次宝箱固定消耗 TREASURE_BOX_COST（30）颗星星；
 * - 余额 ≥30：扣减 30，用注入的随机源 roll()（与 Math.random 同契约，返回 [0,1)）
 *   从 12 件 COLLECTIBLE_ITEMS（6 宠物 + 6 装饰）中均匀产出恰 1 件：
 *   · 产出物品不在收藏中 → 加入 Island_Collection，outcome='new'，余额为 b-30；
 *   · 产出物品已在收藏中 → 折算 DUPLICATE_REFUND_STARS（5）颗星星返还，
 *     余额为 b-30+5，收藏保持不变、不重复添加，outcome='duplicate'；
 * - 余额 <30：outcome='insufficient'，钱包与收藏均原样返回（不做任何变更）；
 * - 纯函数、无 I/O：不修改入参，变更时返回新对象；收藏 items 内任意物品至多出现一次。
 *
 * totalEarned 口径（设计文档允许的选择，特此记录）：重复物品折算返还的 5 颗星星
 * 计入 totalEarned（视为"获得"的星星）；开箱扣减的 30 颗不影响 totalEarned
 * （视为"消耗"，totalEarned 只累计获得、不回减）。
 */

import {
  COLLECTIBLE_ITEMS,
  DUPLICATE_REFUND_STARS,
  TREASURE_BOX_COST,
} from '../types';
import type { CollectibleItem, IslandCollection, StarWallet } from '../types';

/** 宝箱开启结果 */
export type TreasureBoxOutcome = 'new' | 'duplicate' | 'insufficient';

/** openTreasureBox 返回值 */
export interface TreasureBoxResult {
  wallet: StarWallet;
  collection: IslandCollection;
  outcome: TreasureBoxOutcome;
  /** 本次产出的物品；余额不足（insufficient）时无产出，为 undefined */
  item?: CollectibleItem;
}

/**
 * 开启一次宝箱。
 *
 * @param wallet 当前星星钱包
 * @param collection 当前小岛收藏（items 内物品唯一）
 * @param roll 随机源，与 Math.random 同契约，返回 [0,1)；注入以便测试确定产出
 * @returns 新的钱包与收藏、开启结果及产出物品；余额不足时入参原样返回
 */
export function openTreasureBox(
  wallet: StarWallet,
  collection: IslandCollection,
  roll: () => number,
): TreasureBoxResult {
  if (wallet.balance < TREASURE_BOX_COST) {
    return { wallet, collection, outcome: 'insufficient' };
  }

  // 从 12 件可收集物中均匀产出恰 1 件；对越界的 roll 返回值做防御性截断
  const index = Math.min(Math.floor(roll() * COLLECTIBLE_ITEMS.length), COLLECTIBLE_ITEMS.length - 1);
  const item = COLLECTIBLE_ITEMS[index];

  if (collection.items.includes(item.id)) {
    // 重复物品：折算 5 颗星星返还，不重复入收藏；返还计入 totalEarned
    return {
      wallet: {
        balance: wallet.balance - TREASURE_BOX_COST + DUPLICATE_REFUND_STARS,
        totalEarned: wallet.totalEarned + DUPLICATE_REFUND_STARS,
      },
      collection,
      outcome: 'duplicate',
      item,
    };
  }

  // 新物品：加入收藏（items 保持唯一），余额为 b-30，totalEarned 不变
  return {
    wallet: {
      balance: wallet.balance - TREASURE_BOX_COST,
      totalEarned: wallet.totalEarned,
    },
    collection: { items: [...collection.items, item.id] },
    outcome: 'new',
    item,
  };
}
