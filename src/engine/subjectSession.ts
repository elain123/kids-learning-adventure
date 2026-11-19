/**
 * 学科年级组合会话键与分组合会话更新（纯函数模块）
 *
 * 依据 design.md "按学科+年级过滤" 与 "Property 6: 组合会话独立保存"
 *（Validates: Requirements 3.3）实现：
 *
 * - 学科流程的会话按 "学科:年级" 组合键独立存储（Local_Store 的
 *   session:subjects 实体，Record<SubjectGradeKey, TodaySession>），
 *   与首页"今日冒险"使用的 session:today 互不干扰；
 * - saveSubjectSession 为纯函数更新：写入 key 对应会话，其余组合键的
 *   会话值逐值保持不变（保存任一组合进度不得覆盖或修改其他组合）。
 *
 * 本模块只做键计算与映射更新；持久化（1 秒 schedule 落盘）由
 * Local_Store 适配层负责。
 */

import type { Subject, TodaySession } from '../types';

/**
 * 学科年级组合键："{subject}:{grade}"，如 "math:3"。
 */
export type SubjectGradeKey = `${Subject}:${number}`;

/**
 * 计算学科年级组合键（如 subjectGradeKey('math', 3) === "math:3"）。
 */
export function subjectGradeKey(subject: Subject, grade: number): SubjectGradeKey {
  return `${subject}:${grade}`;
}

/**
 * 分组合会话的纯函数更新：
 * 返回新映射，key 对应值为新会话，其余组合键的会话值逐值保持不变
 *（其他键的值保持同一引用，写入方与被写方之外的数据不受任何影响）。
 * 不修改入参映射。
 *
 * @param all 现有组合会话映射（session:subjects 实体值）
 * @param key 要写入的组合键（由 subjectGradeKey 生成）
 * @param session 要保存的会话
 */
export function saveSubjectSession(
  all: Record<string, TodaySession>,
  key: SubjectGradeKey,
  session: TodaySession
): Record<string, TodaySession> {
  return { ...all, [key]: session };
}
