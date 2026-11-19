/**
 * Review_Engine（复习引擎）
 *
 * 基于艾宾浩斯间隔重复的 5 级间隔状态机：
 * 10 分钟 → 1 天 → 3 天 → 7 天 → 15 天，15 天级答对即掌握。
 *
 * 设计约束（design.md「Components and Interfaces → 复习引擎」）：
 * - 纯函数实现：不做任何 I/O，不读取系统时钟，时间通过参数注入；
 * - 不修改入参，返回全新的 MasteryRecord。
 */

import { INTERVALS_MS, MasteryRecord } from '../types';

/** applyAnswer 的返回结果 */
export interface ApplyAnswerResult {
  /** 更新后的掌握度记录（新对象，入参不被修改） */
  record: MasteryRecord;
  /** 答错时为 true：该知识点需追加到当日练习队列中重出（Requirement 3.4） */
  requeue: boolean;
}

/**
 * 间隔状态机：将一次作答结果应用到知识点的掌握度记录上。
 *
 * 语义（Requirements 3.1-3.4, 3.7, 4.3；Properties 4-7, 10）：
 * - rec=null 且答对：建立 1 级间隔（10 分钟），totalCorrect=1；
 * - rec=null 且答错：建立 1 级间隔（10 分钟），totalWrong=1，requeue=true；
 * - 未掌握且级别 1-4 答对：级别递增一级，nextReviewAt = now + 新级别间隔；
 * - 未掌握且级别 5 答对：标记 mastered=true，清除 nextReviewAt（永不再入队）；
 * - 任意答错（含重试后答对按答错记的情形）：重置为 1 级（10 分钟），
 *   mastered=false，requeue=true（当日重出）。
 *
 * 注意：rec=null 时返回记录的 knowledgePointId 为空字符串，
 * 由调用方（冒险引擎）补写实际知识点 id。
 *
 * @param rec 当前掌握度记录；该知识点尚无记录时传 null
 * @param correct 本次作答是否按答对计（重试后答对按答错记，应传 false）
 * @param now 本次答题时间戳（毫秒），由调用方注入
 */
export function applyAnswer(
  rec: MasteryRecord | null,
  correct: boolean,
  now: number
): ApplyAnswerResult {
  // 首次作答：尚无 Mastery_Record，建立 1 级间隔（Requirement 3.2）
  if (rec === null) {
    const record: MasteryRecord = {
      knowledgePointId: '',
      level: 1,
      totalCorrect: correct ? 1 : 0,
      totalWrong: correct ? 0 : 1,
      nextReviewAt: now + INTERVALS_MS[1],
      mastered: false,
      lastAnswerAt: now,
    };
    return { record, requeue: !correct };
  }

  // 答错：重置为 1 级（10 分钟）并当日重出（Requirement 3.4 / 4.3）
  if (!correct) {
    return {
      record: {
        ...rec,
        level: 1,
        totalWrong: rec.totalWrong + 1,
        nextReviewAt: now + INTERVALS_MS[1],
        mastered: false,
        lastAnswerAt: now,
      },
      requeue: true,
    };
  }

  // 防御分支：已掌握记录不再入队，理论上不会被作答；
  // 若仍答对，仅累计次数，保持 mastered 与 nextReviewAt=null 不变。
  if (rec.mastered) {
    return {
      record: {
        ...rec,
        totalCorrect: rec.totalCorrect + 1,
        lastAnswerAt: now,
      },
      requeue: false,
    };
  }

  // 5 级（15 天）答对：标记掌握并清除下次复习时间（Requirement 3.7）
  if (rec.level === 5) {
    return {
      record: {
        ...rec,
        totalCorrect: rec.totalCorrect + 1,
        nextReviewAt: null,
        mastered: true,
        lastAnswerAt: now,
      },
      requeue: false,
    };
  }

  // 1-4 级答对：按序列递增一级（Requirement 3.3）
  const newLevel = (rec.level + 1) as MasteryRecord['level'];
  return {
    record: {
      ...rec,
      level: newLevel,
      totalCorrect: rec.totalCorrect + 1,
      nextReviewAt: now + INTERVALS_MS[newLevel],
      mastered: false,
      lastAnswerAt: now,
    },
    requeue: false,
  };
}
// ============ 今日队列生成（buildTodayQueue） ============

import {
  GeneratorParams,
  QueueItem,
  SessionConfig,
  TodaySession,
} from '../types';
import { isQueueEligible, type QuestionIndex } from '../data/questionBank';
import { kpIdGrade } from './kpId';

/**
 * 年级上限谓词（childGrade 过滤的统一判定）：
 * - childGrade 为 null/undefined（未设置）：不过滤，恒为 true；
 * - childGrade 已设置：grade 必须可判定（非 null）且 ≤ childGrade；
 *   grade 为 null（kpId 年级段无法解析）时 fail-closed 排除。
 */
function gradeWithinLimit(
  grade: number | null,
  childGrade: number | null | undefined
): boolean {
  if (childGrade === null || childGrade === undefined) {
    return true;
  }
  if (grade === null) {
    return false;
  }
  return grade <= childGrade;
}

/**
 * 由注入的时间戳计算本地自然日字符串 'YYYY-MM-DD'。
 * 使用本地时区的日期分量（getFullYear/getMonth/getDate），而非 UTC，
 * 保证"本地自然日"语义与 TodaySession.date 一致（Requirement 3.8）。
 */
export function localDateString(now: number): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 今日队列是否应（重新）生成。
 * 当已存在 date 等于 now 本地自然日的 Today_Session 时沿用该会话、不重新生成；
 * 仅当不存在当日会话时才生成新队列（Requirements 3.8, 3.9, 1.4；Property 9）。
 *
 * @param existingSession 已持久化的今日会话；无会话时传 null
 * @param now 当前时间戳（毫秒），由调用方注入
 */
export function shouldGenerateTodayQueue(
  existingSession: TodaySession | null,
  now: number
): boolean {
  if (existingSession === null) {
    return true;
  }
  return existingSession.date !== localDateString(now);
}

/**
 * 为一个知识点挑选一个今日队列项。
 * 优先取题库中该知识点第一道可入队题目（kind='bank'）；
 * 题库无可用题时，若为口算知识点（存在生成器参数），取生成器参数项（kind='generated'）。
 * 两者皆无则返回 null（该知识点今日无题可出，跳过）。
 */
function pickItemForKnowledgePoint(
  knowledgePointId: string,
  bank: QuestionIndex,
  generators: readonly GeneratorParams[],
  source: QueueItem['source'],
  childGrade: number | null = null
): QueueItem | null {
  const questions = bank.byKnowledgePoint.get(knowledgePointId);
  if (questions) {
    // 内部取题同样施加年级谓词：防止契约破坏数据
    // （q.grade 与 kpId 年级段不一致）经复习段混入
    const eligible = questions.find(
      (q) => isQueueEligible(q) && gradeWithinLimit(q.grade, childGrade)
    );
    if (eligible) {
      return {
        kind: 'bank',
        questionId: eligible.id,
        knowledgePointId,
        subject: eligible.subject,
        type: eligible.type,
        difficulty: eligible.difficulty,
        source,
      };
    }
  }
  const gen = generators.find(
    (g) => g.knowledgePointId === knowledgePointId && gradeWithinLimit(g.grade, childGrade)
  );
  if (gen) {
    return {
      kind: 'generated',
      generatorParamsId: gen.id,
      knowledgePointId,
      subject: 'math',
      type: 'oral',
      difficulty: gen.difficulty,
      source,
    };
  }
  return null;
}

/**
 * 生成今日队列：到点复习题在前（按 nextReviewAt 升序），新知识点题在后。
 *
 * 语义（Requirements 3.5, 3.6, 1.4, 1.6, 13.7；Properties 7, 8, 24）：
 * - 复习段：未掌握且 nextReviewAt ≤ now 的知识点，按 nextReviewAt 从最早到最晚升序，
 *   数量不超过 config.maxReviewPerSession；已掌握（mastered / nextReviewAt=null）与
 *   未到点（nextReviewAt > now，含时钟回拨造成的未来时间）的知识点不纳入；
 * - 新知识点段：尚无 Mastery_Record 的知识点，数量不超过 config.maxNewPerSession；
 * - 任意复习题都排在任意新知识点题之前；到点复习集合为空时队列全部由新知识点题组成；
 * - phase=2 或二期题型（reading/word_problem/read_aloud）题目永不入队
 *   （经 bank.queueEligible 判定，Requirement 13.7）；
 * - 纯函数：不修改入参，时间通过参数注入。
 *
 * 注意：本函数只负责生成队列本身；"当日是否已生成"的判定由
 * shouldGenerateTodayQueue 承担，调用方（冒险引擎）应先调用后者。
 *
 * 过滤（可选 childGrade 参数，默认 null = 未设置不过滤）：
 * 过滤施加于候选枚举点（Requirement 2.1 的三个年级来源）：
 * - 复习段：到点记录追加条件 gradeWithinLimit(kpIdGrade(rec.knowledgePointId), childGrade)，
 *   年级超限或不可解析的到点知识点不进入复习段（Requirement 2.3），其记录本身不被修改
 *   （Requirement 2.4）；
 * - 新知识点段（题库）：枚举 bank.queueEligible 时要求 gradeWithinLimit(q.grade, childGrade)；
 * - 新知识点段（生成器）：枚举 generators 时要求 gradeWithinLimit(g.grade, childGrade)；
 * - pickItemForKnowledgePoint 内部取题/取生成器时同样施加谓词，防止契约破坏数据
 *   （q.grade 与 kpId 年级段不一致）经复习段混入。
 * 其余语义不变：复习段按 nextReviewAt 升序在前、新知识点段在后，
 * 各段数量上限不变（Requirement 2.7）；childGrade=null 时输出与
 * 既有五参调用完全一致（Requirement 3.1）。
 *
 * @param records 全部知识点掌握度记录（knowledgePointId → MasteryRecord）
 * @param bank 题库索引（由 buildQuestionIndex 构建）
 * @param now 当前时间戳（毫秒），由调用方注入
 * @param config 会话配置（maxNewPerSession / maxReviewPerSession 上限）
 * @param generators 口算生成器参数列表（可选；QuestionIndex 不索引 GeneratorParams，
 *                   故由调用方传入，用于为口算知识点产出 kind='generated' 队列项）
 * @param childGrade 孩子年级上限（可选，默认 null = 未设置不过滤）；
 *                   设置后仅纳入年级 ≤ childGrade 的队列项
 */
export function buildTodayQueue(
  records: Record<string, MasteryRecord>,
  bank: QuestionIndex,
  now: number,
  config: SessionConfig,
  generators: readonly GeneratorParams[] = [],
  childGrade: number | null = null
): QueueItem[] {
  const queue: QueueItem[] = [];

  // ---- 复习段：到点（nextReviewAt ≤ now）且未掌握的知识点，按 nextReviewAt 升序 ----
  // childGrade 已设置时追加年级谓词：kpId 年级段不可解析（null）fail-closed 排除
  const dueRecords = Object.values(records)
    .filter(
      (rec) =>
        !rec.mastered &&
        rec.nextReviewAt !== null &&
        rec.nextReviewAt <= now &&
        gradeWithinLimit(kpIdGrade(rec.knowledgePointId), childGrade)
    )
    .sort((a, b) => (a.nextReviewAt as number) - (b.nextReviewAt as number));

  const reviewCap = Math.max(0, config.maxReviewPerSession);
  let reviewCount = 0;
  for (const rec of dueRecords) {
    if (reviewCount >= reviewCap) {
      break;
    }
    const item = pickItemForKnowledgePoint(rec.knowledgePointId, bank, generators, 'review', childGrade);
    if (item) {
      queue.push(item);
      reviewCount += 1;
    }
  }

  // ---- 新知识点段：无 Mastery_Record 的知识点（题库可入队题 + 口算生成器覆盖） ----
  const seen = new Set<string>();
  const newKpIds: string[] = [];
  for (const q of bank.queueEligible) {
    if (
      !(q.knowledgePointId in records) &&
      !seen.has(q.knowledgePointId) &&
      gradeWithinLimit(q.grade, childGrade)
    ) {
      seen.add(q.knowledgePointId);
      newKpIds.push(q.knowledgePointId);
    }
  }
  for (const g of generators) {
    if (
      !(g.knowledgePointId in records) &&
      !seen.has(g.knowledgePointId) &&
      gradeWithinLimit(g.grade, childGrade)
    ) {
      seen.add(g.knowledgePointId);
      newKpIds.push(g.knowledgePointId);
    }
  }

  const newCap = Math.max(0, config.maxNewPerSession);
  let newCount = 0;
  for (const kpId of newKpIds) {
    if (newCount >= newCap) {
      break;
    }
    const item = pickItemForKnowledgePoint(kpId, bank, generators, 'new', childGrade);
    if (item) {
      queue.push(item);
      newCount += 1;
    }
  }

  return queue;
}
