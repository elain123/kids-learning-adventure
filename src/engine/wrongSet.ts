/**
 * Wrong_Set 记录模块（错题集 v2，纯函数）
 *
 * 依据 .kiro/specs/multi-grade-mistake-book/design.md 的
 * 「Components and Interfaces → Wrong_Set 记录模块」实现：
 * - 首错入账去重：同一 questionRef 在 Wrong_Set 中至多存在一条记录，
 *   重复首错只更新 wrongAt 与 wrongCount，不新增记录（Req 4.1-4.3）；
 * - 重试恒等：学生对已入账题目重试（非首个答案，无论对错）不修改
 *   Wrong_Set 的任何记录（Req 4.4、4.5）；
 * - 已掌握标记为派生状态：不冗余存储，由 mastery[knowledgePointId].mastered
 *   实时推导，永不出现标记与掌握度不一致（Req 4.6）；
 * - 分组查看：学科按 chinese → math → english 固定序，空分组不出现，
 *   组内按 wrongAt 由近到远降序，全部错题恰好出现一次（Req 5.2）；
 * - 重练定盘：答对仅写回掌握度（复用 Review_Engine 既有 applyAnswer），
 *   答错重置掌握度并更新该题 wrongAt 与 wrongCount（Req 5.8、5.9）。
 *
 * 设计约束：
 * - 纯函数实现：不做任何 I/O，不读取系统时钟，时间通过参数注入；
 * - 不修改入参，返回全新的对象。
 */

import type { MasteryRecord, Subject } from '../types';
import { applyAnswer } from './reviewEngine';

// ============ Wrong_Set v2 数据类型 ============

/**
 * 口算生成题快照：仅 kind=generated 的错题入账时携带。
 * 生成题的 questionRef 是哈希签名、不可逆，快照用于按原题展示与重练。
 */
export interface GeneratedSnapshot {
  paramsId: string;
  stem: string;
  operands: Record<string, number>;
  answer: number;
}

/** Wrong_Set v2 元素（同一 questionRef 至多一条记录） */
export interface WrongSetItem {
  /** 题库题 id 或生成器签名 gen:{paramsId}:{operandsHash} */
  questionRef: string;
  subject: Subject;
  /** 整数 1-6 */
  grade: number;
  knowledgePointId: string;
  /** 最近一次答错时间戳 */
  wrongAt: number;
  /** 累计答错次数（首错为 1） */
  wrongCount: number;
  /** 口算生成题快照（题库题无此字段） */
  generated?: GeneratedSnapshot;
}

/** Wrong_Set（错题集 v2） */
export interface WrongSet {
  items: WrongSetItem[];
}

/** 首错入账入参（由练习壳层从当前题快照构造） */
export interface FirstWrongEntry {
  questionRef: string;
  subject: Subject;
  grade: number;
  knowledgePointId: string;
  generated?: GeneratedSnapshot;
}

// ============ 错题入账（Req 4.1-4.5） ============

/**
 * 首次作答答错入账（Req 4.1-4.3，Properties 7、8）：
 * - questionRef 不存在：追加新记录，wrongAt=now、wrongCount=1，
 *   集合长度增加 1，其余记录不变；
 * - questionRef 已存在：更新该记录 wrongAt=now、wrongCount 在原值基础上加 1，
 *   其余字段不变，不新增记录（集合长度不变）；
 * - 操作前后集合中同一 questionRef 均至多存在一条记录；
 * - 纯函数：不修改入参，返回全新的 WrongSet。
 *
 * @param set 当前 Wrong_Set
 * @param entry 首错入账入参（当前题快照）
 * @param now 本次答错时间戳（毫秒），由调用方注入
 */
export function recordFirstWrong(
  set: WrongSet,
  entry: FirstWrongEntry,
  now: number
): WrongSet {
  const index = set.items.findIndex((it) => it.questionRef === entry.questionRef);

  // 新错题：追加 wrongAt=now、wrongCount=1 的新记录（Req 4.1、4.2）
  if (index === -1) {
    const item: WrongSetItem = {
      questionRef: entry.questionRef,
      subject: entry.subject,
      grade: entry.grade,
      knowledgePointId: entry.knowledgePointId,
      wrongAt: now,
      wrongCount: 1,
      ...(entry.generated !== undefined ? { generated: entry.generated } : {}),
    };
    return { items: [...set.items, item] };
  }

  // 重复首错：原地更新 wrongAt 与 wrongCount+1，不新增记录（Req 4.3）
  return {
    items: set.items.map((it, i) =>
      i === index ? { ...it, wrongAt: now, wrongCount: it.wrongCount + 1 } : it
    ),
  };
}

/**
 * 重试（非首个答案）对 Wrong_Set 的影响（Req 4.4、4.5，Property 9）：
 * 无论重试答对或答错，恒返回原集合——不修改任何记录的 wrongAt 与
 * wrongCount，答对也不移除该题。
 *
 * @param set 当前 Wrong_Set
 * @param questionRef 重试题目的引用（不参与计算，仅为接口语义完整）
 * @param correct 重试是否答对（不参与计算：两种结果均为恒等）
 */
export function applyRetryToWrongSet(
  set: WrongSet,
  questionRef: string,
  correct: boolean
): WrongSet {
  void questionRef;
  void correct;
  return set;
}

// ============ 派生状态与查看（Req 4.6、5.1、5.2、5.3） ============

/**
 * 已掌握错题标记（派生，Req 4.6，Property 10）：
 * 恒等于对应知识点的 Mastery_Record 是否已掌握（无记录视为未掌握）。
 * 该标记不冗余存储，知识点被 Review_Engine 标记掌握时错题自动呈现已掌握。
 */
export function isMasteredWrong(
  item: WrongSetItem,
  mastery: Record<string, MasteryRecord>
): boolean {
  return mastery[item.knowledgePointId]?.mastered ?? false;
}

/**
 * 未掌握错题数量（小岛入口徽标，Req 5.1，Property 10）：
 * 集合中未掌握错题的条数，无错题时为 0；求值过程不修改 Wrong_Set。
 */
export function unmasteredCount(
  set: WrongSet,
  mastery: Record<string, MasteryRecord>
): number {
  let count = 0;
  for (const item of set.items) {
    if (!isMasteredWrong(item, mastery)) {
      count += 1;
    }
  }
  return count;
}

/** 错题列表项（题干经 resolveStem 解析；mastered 为派生标记） */
export interface WrongSetViewItem {
  item: WrongSetItem;
  stem: string;
  mastered: boolean;
}

/** 学科分组（列表按固定学科序 chinese → math → english 排列；空学科分组不出现） */
export interface WrongSetGroup {
  subject: Subject;
  /** 组内按 wrongAt 由近到远（降序） */
  items: WrongSetViewItem[];
}

/** 学科分组固定顺序：语文 → 数学 → 英语（Req 5.2） */
const GROUP_SUBJECT_ORDER: readonly Subject[] = ['chinese', 'math', 'english'];

/**
 * 构建 Wrong_Set_View 分组列表（Req 5.2，Property 11）：
 * - 出现的学科分组按 语文→数学→英语 固定顺序排列，空分组不出现；
 * - 每个分组内错题按 wrongAt 由近到远（降序）排列；
 * - 全部输出条目与输入集合的错题一一对应（不丢、不重、每条恰好出现一次）；
 * - 纯函数：不修改入参（组内排序作用于过滤产生的新数组）。
 *
 * @param set 当前 Wrong_Set
 * @param mastery 全部知识点掌握度记录（用于派生 mastered 标记）
 * @param resolveStem 题干解析器（题库题取 stem、生成题取快照等，由调用方注入）
 */
export function buildWrongSetGroups(
  set: WrongSet,
  mastery: Record<string, MasteryRecord>,
  resolveStem: (item: WrongSetItem) => string
): WrongSetGroup[] {
  const groups: WrongSetGroup[] = [];
  for (const subject of GROUP_SUBJECT_ORDER) {
    const items = set.items
      .filter((it) => it.subject === subject)
      .sort((a, b) => b.wrongAt - a.wrongAt)
      .map((item) => ({
        item,
        stem: resolveStem(item),
        mastered: isMasteredWrong(item, mastery),
      }));
    if (items.length > 0) {
      groups.push({ subject, items });
    }
  }
  return groups;
}

/**
 * 最近一次答错时间显示格式（Req 5.3，Property 12）：
 * 设备本地时区 'YYYY-MM-DD HH:mm'——年 4 位，月、日、时、分各 2 位，
 * 各分量等于 ts 在本地时区的对应年月日时分。
 */
export function formatWrongAt(ts: number): string {
  const d = new Date(ts);
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

// ============ 错题重练定盘（Req 5.8、5.9） ============

/**
 * 掌握度写回：复用 Review_Engine 既有间隔状态机 applyAnswer 计算新记录，
 * 并补写知识点 id（rec=null 时引擎返回空 knowledgePointId，
 * 与练习壳层 persistMastery 同一约定）；其余知识点的记录不变。
 */
function writeBackMastery(
  mastery: Record<string, MasteryRecord>,
  knowledgePointId: string,
  correct: boolean,
  now: number
): Record<string, MasteryRecord> {
  const { record } = applyAnswer(mastery[knowledgePointId] ?? null, correct, now);
  const finalRecord: MasteryRecord = { ...record, knowledgePointId };
  return { ...mastery, [knowledgePointId]: finalRecord };
}

/**
 * 重练答对（Req 5.8，Property 14）：
 * 掌握度按既有间隔状态机 applyAnswer(rec, true, now) 更新
 * （间隔级别按 10 分钟→1 天→3 天→7 天→15 天序列递进，5 级答对即掌握）；
 * Wrong_Set 不被修改（该题保留，知识点升级/掌握由派生标记自动呈现）；
 * 其他知识点的记录不变。
 *
 * @param item 重练答对的错题
 * @param mastery 全部知识点掌握度记录
 * @param now 本次作答时间戳（毫秒），由调用方注入
 */
export function applyReAnswerCorrect(
  item: WrongSetItem,
  mastery: Record<string, MasteryRecord>,
  now: number
): { mastery: Record<string, MasteryRecord> } {
  return { mastery: writeBackMastery(mastery, item.knowledgePointId, true, now) };
}

/**
 * 重练答错（Req 5.9 与 4.3，Property 15）：
 * - 该题保持未掌握：掌握度按 applyAnswer(rec, false, now) 重置为
 *   1 级且 mastered=false；
 * - 该题 wrongAt=now、wrongCount 在原值基础上加 1，集合长度不变、
 *   不新增记录（复用 recordFirstWrong 的重复首错分支语义）；
 * - 其他错题记录与其他知识点的记录不变；
 * - 纯函数：不修改入参，返回全新的 WrongSet 与掌握度映射。
 *
 * @param set 包含该错题的 Wrong_Set
 * @param item 重练答错的错题
 * @param mastery 全部知识点掌握度记录
 * @param now 本次作答时间戳（毫秒），由调用方注入
 */
export function applyReAnswerWrong(
  set: WrongSet,
  item: WrongSetItem,
  mastery: Record<string, MasteryRecord>,
  now: number
): { set: WrongSet; mastery: Record<string, MasteryRecord> } {
  return {
    set: recordFirstWrong(set, item, now),
    mastery: writeBackMastery(mastery, item.knowledgePointId, false, now),
  };
}
