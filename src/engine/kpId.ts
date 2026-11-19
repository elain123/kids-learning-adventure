/**
 * 知识点标识（kpId）学科与年级解析（纯函数模块）
 *
 * 依据 design.md "知识点标识方案（年级隔离契约）" 实现：
 * 知识点标识强制包含学科前缀与年级段：
 * - 语文：`cn.g{1-6}.{领域}.{序号}`，如 `cn.g3.zi.001`
 * - 数学：`math.g{1-6}.{主题}[.{子主题}]`，如 `math.g3.add.within10000`
 * - 英语：`en.g{3-6}.{类别}.{序号}`，如 `en.g5.word.001`
 *
 * - kpIdSubject：由第一段前缀推导学科（cn→chinese、math→math、en→english），
 *   无法识别的前缀返回 null；
 * - kpIdGrade：解析第二段 g{N}（如 cn.g3.zi.001 → 3），无法解析
 *   （缺少第二段、形态不符或 N 越出合法年级 1-6）返回 null。
 *
 * 解析结果唯一、确定性：同一标识恒得同一结果；不同年级段的标识是互不相等的字符串。
 * 本模块不依赖 DOM / localStorage / 时钟，供迁移模块（Wrong_Set v1→v2）
 * 与契约测试共用。
 */

import type { Subject } from '../types';

/** 学科前缀 → 学科标识 */
const KP_ID_SUBJECT_PREFIXES: Record<string, Subject> = {
  cn: 'chinese',
  math: 'math',
  en: 'english',
};

/** 合法年级范围（与题库 Question.grade 取值域一致） */
const KP_ID_GRADE_MIN = 1;
const KP_ID_GRADE_MAX = 6;

/** 年级段形态：g{N}，N 为一位或多位数字 */
const GRADE_SEGMENT_PATTERN = /^g(\d+)$/;

/**
 * 由知识点标识推导学科：
 * 第一段前缀 cn→chinese、math→math、en→english；
 * 无法识别的前缀（含空标识）返回 null。
 */
export function kpIdSubject(kpId: string): Subject | null {
  if (typeof kpId !== 'string' || kpId.length === 0) {
    return null;
  }
  const prefix = kpId.split('.')[0];
  return KP_ID_SUBJECT_PREFIXES[prefix] ?? null;
}

/**
 * 由知识点标识推导年级：
 * 解析第二段 g{N}（如 `cn.g3.zi.001` → 3），N 须为 1-6 的整数。
 * 无法解析（缺少第二段、第二段不符合 g{N} 形态、或 N 越出合法年级范围）返回 null。
 */
export function kpIdGrade(kpId: string): number | null {
  if (typeof kpId !== 'string') {
    return null;
  }
  const segment = kpId.split('.')[1];
  if (segment === undefined) {
    return null;
  }
  const match = GRADE_SEGMENT_PATTERN.exec(segment);
  if (match === null) {
    return null;
  }
  const grade = Number.parseInt(match[1], 10);
  if (!Number.isInteger(grade) || grade < KP_ID_GRADE_MIN || grade > KP_ID_GRADE_MAX) {
    return null;
  }
  return grade;
}
