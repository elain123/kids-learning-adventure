/**
 * Oral_Best（口算历史最佳纪录）与关卡完成星星结算
 *
 * 口算速算关结算时维护「历史最佳纪录」：按生成器参数 id 记录该口算知识点的
 * 历史最佳答对题数，并判定本关是否刷新纪录；另提供关卡完成 +10 星星结算。
 *
 * 设计约束（design.md「Data Models → 口算最佳纪录」）：
 * - 纯函数实现：不做任何 I/O，不读取系统时钟，时间通过参数注入；
 * - 不修改入参，records 更新时返回新对象（未更新时原样返回引用）；
 * - 纪录结构与 Local_Store 的 oralBest 实体一致：
 *   Record<generatorParamsId, { best, achievedAt }>（见 src/data/localStore.ts OralBestEntry）。
 *
 * 注意：宝箱开启等 Treasure_Box 奖励由任务 8.1 在 src/engine/rewards.ts 实现，
 * 本文件不重复承担。
 */

import type { OralBestEntry } from '../data/localStore';
import type { StarWallet } from '../types';

/** 关卡完成发放的星星数（Requirement 5.2） */
export const LEVEL_COMPLETION_STARS = 10;

/** updateOralBest 的返回结果 */
export interface UpdateOralBestResult {
  /**
   * 更新后的纪录表（新对象，入参不被修改）；
   * 未刷新纪录时原样返回入参引用。
   */
  records: Record<string, OralBestEntry>;
  /**
   * 是否刷新历史最佳纪录：
   * 无历史纪录（首次完成本口算关）或本关答对题数严格超过历史最佳时为 true
   * （Requirements 7.7, 7.8）。
   */
  isNewRecord: boolean;
  /** 历史最佳答对题数；无历史纪录时为 null */
  previousBest: number | null;
}

/**
 * 口算关结算：以本关答对题数更新历史最佳纪录。
 *
 * 语义（Requirements 7.6, 7.7, 7.8；Property 18）：
 * - 该口算知识点（generatorParamsId）无历史纪录：将本关答对题数记为历史最佳，
 *   isNewRecord=true，previousBest=null（Req 7.8，首次完成即纪录）；
 * - 本关答对题数严格超过历史最佳：更新纪录为本关答对题数，isNewRecord=true（Req 7.7，
 *   结算时展示新纪录提示）；
 * - 其余（持平或更低）：保留历史纪录不变，isNewRecord=false，
 *   结算仍展示本关答对与历史最佳的对比（Req 7.6）。
 *
 * @param records 现有口算最佳纪录表（generatorParamsId → 条目）
 * @param genParamsId 本关口算生成器参数 id
 * @param score 本关答对题数（仅已作答且答对的题目，见 sessionClock.settleOralLevel）
 * @param now 结算时间戳（毫秒），由调用方注入，记入 achievedAt
 */
export function updateOralBest(
  records: Record<string, OralBestEntry>,
  genParamsId: string,
  score: number,
  now: number,
): UpdateOralBestResult {
  // 仅以自有属性判定历史纪录：避免 "valueOf"/"toString" 等原型链上的键被误判为既有纪录
  const prev = Object.prototype.hasOwnProperty.call(records, genParamsId)
    ? records[genParamsId]
    : undefined;

  // 首次完成本口算关：无历史纪录，记本关答对数为最佳（Requirement 7.8）
  if (prev === undefined) {
    return {
      records: {
        ...records,
        [genParamsId]: { best: score, achievedAt: now },
      },
      isNewRecord: true,
      previousBest: null,
    };
  }

  // 严格超过历史最佳：更新纪录并标记新纪录（Requirement 7.7）
  if (score > prev.best) {
    return {
      records: {
        ...records,
        [genParamsId]: { best: score, achievedAt: now },
      },
      isNewRecord: true,
      previousBest: prev.best,
    };
  }

  // 持平或更低：保留历史纪录（Requirement 7.6）
  return {
    records,
    isNewRecord: false,
    previousBest: prev.best,
  };
}

/**
 * 关卡完成星星结算：向星星钱包发放 10 颗关卡完成星星。
 *
 * 语义（Requirement 5.2）：balance 与 totalEarned 各增加 10；
 * 不修改入参，返回新钱包对象。
 *
 * @param wallet 当前星星钱包
 */
export function awardLevelCompletion(wallet: StarWallet): StarWallet {
  return {
    balance: wallet.balance + LEVEL_COMPLETION_STARS,
    totalEarned: wallet.totalEarned + LEVEL_COMPLETION_STARS,
  };
}
