/**
 * Wrong_Set v1→v2 迁移模块（纯函数）
 *
 * 依据 .kiro/specs/multi-grade-mistake-book/design.md 的
 * 「Components and Interfaces → 迁移模块」与 Property 19 实现（Req 6.6）：
 *
 * - 形状检测：数据为 { items: [...] } 且任一元素缺少 wrongCount 字段
 *   （或 wrongCount 非有限数值）即视为旧版 v1 数据；全部元素具备合法
 *   v2 必需字段时视为 v2，原样返回（migrated=false）；
 * - v1 元素学科/年级推导顺序：
 *   a. kpId 推导：由元素 knowledgePointId 经 kpIdSubject/kpIdGrade 解析；
 *   b. 题库 byId 查找（bank 提供时）：questionRef 为题库题 id，
 *      取该题的 subject/grade；
 *   c. 生成器参数查找（gen: 引用）：questionRef 形如
 *      gen:{paramsId}:{operandsHash}，按 paramsId 在 generators 中查找，
 *      学科为 math、年级取其 grade；
 * - 合并：同一 questionRef 的多条 v1 记录合并为一条，
 *   wrongCount=合并条数、wrongAt=各条 wrongAt 最大值；
 * - 丢弃：无法推导学科或年级（或缺少合法 questionRef/knowledgePointId/
 *   wrongAt）的元素丢弃并记入迁移日志（内存缓冲，与 questionBank 的
 *   错误日志缓冲同一约定；保底路径，正常种子数据不会走到）；
 * - 结果满足 v2 校验：每条记录 questionRef/subject/grade(1-6 整数)/
 *   knowledgePointId/wrongAt/wrongCount 齐全且合法；v1 无生成题快照，
 *   迁移记录不携带 generated 字段；
 * - 纯函数：不修改任何入参（raw/bank/generators），返回全新对象
 *   （v2 原样返回时直接返回入参引用，本模块保证不对其做任何写操作）。
 */

import type { GeneratorParams, Subject } from '../types';
import type { QuestionIndex } from '../data/questionBank';
import { kpIdGrade, kpIdSubject } from './kpId';
import type { WrongSet, WrongSetItem } from './wrongSet';

// ============ 常量 ============

/** 合法学科取值（与 types.Subject 一致） */
const SUBJECTS: readonly Subject[] = ['chinese', 'math', 'english'];

/** 合法年级范围（与题库 Question.grade 取值域一致） */
const GRADE_MIN = 1;
const GRADE_MAX = 6;

/** 生成题引用前缀：gen:{paramsId}:{operandsHash} */
const GEN_REF_PREFIX = 'gen:';

// ============ 迁移日志（内存缓冲，约定同 questionBank 错误日志） ============

/** 迁移日志条目：时间戳 + 题目引用 + 丢弃原因 */
export interface MigrationLogEntry {
  at: number;
  /** 被丢弃元素的 questionRef（无法辨识时为占位描述） */
  questionRef: string;
  reason: string;
}

const migrationLogBuffer: MigrationLogEntry[] = [];

/** 记录一条迁移日志（时间戳可注入，默认 Date.now()） */
export function logMigration(entry: Omit<MigrationLogEntry, 'at'>, at: number = Date.now()): void {
  migrationLogBuffer.push({ ...entry, at });
}

/** 读取迁移日志缓冲（只读视图） */
export function getMigrationLog(): readonly MigrationLogEntry[] {
  return migrationLogBuffer;
}

/** 清空迁移日志缓冲（测试用） */
export function clearMigrationLog(): void {
  migrationLogBuffer.length = 0;
}

// ============ 形状检测 ============

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSubject(value: unknown): value is Subject {
  return typeof value === 'string' && (SUBJECTS as readonly string[]).includes(value);
}

/** 合法年级：1-6 的整数 */
function isGrade(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= GRADE_MIN && value <= GRADE_MAX;
}

/** 累计答错次数：≥1 的整数（首错为 1） */
function isWrongCount(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 1;
}

/** GeneratedSnapshot 形状（v2 元素可选字段存在时须结构合法） */
function isGeneratedSnapshotShape(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (typeof value.paramsId !== 'string' || typeof value.stem !== 'string') return false;
  if (!isFiniteNumber(value.answer)) return false;
  if (!isPlainObject(value.operands)) return false;
  return Object.values(value.operands).every(isFiniteNumber);
}

/** 单个元素是否具备合法 v2 必需字段（generated 可选但存在时须合法） */
function isWrongSetV2ItemShape(value: unknown): value is WrongSetItem {
  return (
    isPlainObject(value) &&
    typeof value.questionRef === 'string' &&
    isSubject(value.subject) &&
    isGrade(value.grade) &&
    typeof value.knowledgePointId === 'string' &&
    isFiniteNumber(value.wrongAt) &&
    isWrongCount(value.wrongCount) &&
    (value.generated === undefined || isGeneratedSnapshotShape(value.generated))
  );
}

/** v2 形状：{ items: [...] } 且全部元素具备合法 v2 必需字段（空 items 视为合法 v2） */
export function isWrongSetV2Shape(raw: unknown): raw is WrongSet {
  return isPlainObject(raw) && Array.isArray(raw.items) && raw.items.every(isWrongSetV2ItemShape);
}

/**
 * 旧版 v1 形状检测：{ items: [...] } 且任一元素缺少 wrongCount 字段
 * （元素非对象或 wrongCount 非有限数值均视为缺少）。
 */
export function isLegacyV1WrongSetShape(raw: unknown): boolean {
  return (
    isPlainObject(raw) &&
    Array.isArray(raw.items) &&
    raw.items.some((el) => !(isPlainObject(el) && isFiniteNumber(el.wrongCount)))
  );
}

// ============ 学科/年级推导 ============

interface DerivedOrigin {
  subject: Subject;
  grade: number;
}

/** a. kpId 推导：由 knowledgePointId 解析学科与年级（任一侧失败即整体失败） */
function deriveFromKpId(knowledgePointId: unknown): DerivedOrigin | null {
  if (typeof knowledgePointId !== 'string') return null;
  const subject = kpIdSubject(knowledgePointId);
  const grade = kpIdGrade(knowledgePointId);
  if (subject === null || grade === null) return null;
  return { subject, grade };
}

/** b. 题库 byId 查找：questionRef 为题库题 id 时取该题的 subject/grade */
function deriveFromBank(questionRef: string, bank: QuestionIndex | null): DerivedOrigin | null {
  if (bank === null) return null;
  const question = bank.byId.get(questionRef);
  if (question === undefined) return null;
  if (!isSubject(question.subject) || !isGrade(question.grade)) return null;
  return { subject: question.subject, grade: question.grade };
}

/** c. 生成器参数查找：gen:{paramsId}:{operandsHash} → paramsId 对应的生成器（math） */
function deriveFromGenerator(
  questionRef: string,
  generators: readonly GeneratorParams[]
): DerivedOrigin | null {
  if (!questionRef.startsWith(GEN_REF_PREFIX)) return null;
  const paramsId = questionRef.slice(GEN_REF_PREFIX.length).split(':')[0];
  if (paramsId.length === 0) return null;
  const params = generators.find((g) => g.id === paramsId);
  if (params === undefined || !isGrade(params.grade)) return null;
  return { subject: 'math', grade: params.grade };
}

/** 推导顺序：kpId 推导 → 题库 byId 查找 → 生成器参数查找 */
function deriveOrigin(
  questionRef: string,
  knowledgePointId: unknown,
  bank: QuestionIndex | null,
  generators: readonly GeneratorParams[]
): DerivedOrigin | null {
  return (
    deriveFromKpId(knowledgePointId) ??
    deriveFromBank(questionRef, bank) ??
    deriveFromGenerator(questionRef, generators)
  );
}

// ============ v1→v2 迁移 ============

/**
 * Wrong_Set v1→v2 迁移（Req 6.6，Property 19）：
 * - 已是 v2 形状：原样返回（migrated=false、dropped=0）；
 * - 可识别 v1 形状（任一元素缺 wrongCount）：按推导顺序补全学科/年级、
 *   按 questionRef 合并（wrongCount=合并条数、wrongAt=各条最大值），
 *   无法推导或缺必需字段的元素丢弃并记迁移日志；
 * - 既非 v2 亦非可识别 v1 形状：返回空集合（migrated=false），
 *   由调用方（Local_Store）走备份自愈路径。
 *
 * @param raw 待迁移的原始值（JSON 解析后的 wrongSet 存储值）
 * @param bank 题库索引（无题库上下文时为 null，跳过 byId 推导）
 * @param generators 口算生成器参数集合（用于 gen: 引用推导）
 */
export function migrateWrongSetV1(
  raw: unknown,
  bank: QuestionIndex | null,
  generators: readonly GeneratorParams[]
): { set: WrongSet; migrated: boolean; dropped: number } {
  // 已是 v2 形状：原样返回（本模块不对入参做任何写操作）
  if (isWrongSetV2Shape(raw)) {
    return { set: raw, migrated: false, dropped: 0 };
  }

  // 既非 v2 亦非可识别 v1 形状：不迁移，交由调用方走备份自愈
  if (!isLegacyV1WrongSetShape(raw)) {
    return { set: { items: [] }, migrated: false, dropped: 0 };
  }

  const rawItems: unknown[] = (raw as { items: unknown[] }).items;

  // 按 questionRef 分组（Map 保持首次出现顺序）；缺合法引用的元素单独计丢弃
  const groups = new Map<string, Record<string, unknown>[]>();
  let dropped = 0;
  for (const el of rawItems) {
    if (!isPlainObject(el) || typeof el.questionRef !== 'string') {
      dropped += 1;
      logMigration({ questionRef: '<unrecognizable>', reason: '元素缺少合法 questionRef，无法迁移' });
      continue;
    }
    const group = groups.get(el.questionRef);
    if (group === undefined) {
      groups.set(el.questionRef, [el]);
    } else {
      group.push(el);
    }
  }

  const items: WrongSetItem[] = [];
  for (const [questionRef, elements] of groups) {
    // 学科/年级推导：组内逐元素按推导顺序尝试，取首个成功结果
    let origin: DerivedOrigin | null = null;
    for (const el of elements) {
      origin = deriveOrigin(questionRef, el.knowledgePointId, bank, generators);
      if (origin !== null) break;
    }

    // knowledgePointId：取组内首个合法字符串
    const knowledgePointId = elements.find((el) => typeof el.knowledgePointId === 'string')
      ?.knowledgePointId as string | undefined;

    // wrongAt：各条有限数值的最大值
    let wrongAtMax = Number.NEGATIVE_INFINITY;
    for (const el of elements) {
      if (isFiniteNumber(el.wrongAt)) {
        wrongAtMax = Math.max(wrongAtMax, el.wrongAt);
      }
    }
    const hasWrongAt = wrongAtMax !== Number.NEGATIVE_INFINITY;

    if (origin === null || knowledgePointId === undefined || !hasWrongAt) {
      dropped += elements.length;
      const reason =
        origin === null
          ? '无法推导学科或年级，丢弃'
          : knowledgePointId === undefined
            ? '缺少合法 knowledgePointId，丢弃'
            : '缺少合法 wrongAt，丢弃';
      logMigration({ questionRef, reason });
      continue;
    }

    // 合并：wrongCount=合并条数、wrongAt=各条最大值；v1 无快照，不携带 generated
    items.push({
      questionRef,
      subject: origin.subject,
      grade: origin.grade,
      knowledgePointId,
      wrongAt: wrongAtMax,
      wrongCount: elements.length,
    });
  }

  return { set: { items }, migrated: true, dropped };
}
