/**
 * 年级选择配置（Grade_Selector 纯函数模块）
 *
 * 依据 design.md "Property 1: 年级选项配置"（Validates: Requirements 1.1, 1.2）与
 * "Property 2: Last_Grade 标记唯一性"（Validates: Requirements 1.5, 1.6）实现：
 *
 * - 语文/数学按人教版提供一年级至六年级共 6 个选项，按升序展示；
 * - 英语按外研版（三年级起点）提供三年级至六年级共 4 个选项，不展示一、二年级；
 * - Last_Grade 记录学生在每个学科最近一次所选年级，再次进入学科入口页时
 *   该学科 Last_Grade 对应选项显示可见区分标记，且每个学科至多标记一个年级；
 * - 从未选择过年级的学科（空 Last_Grade）不显示任何标记。
 *
 * 纯函数、无 I/O：Last_Grade 的读取与持久化由调用方（Local_Store 适配层）负责，
 * 本模块只负责"可选年级有哪些"与"应标记哪个年级"两项计算。
 * markedGrade 对任意 Last_Grade 形态（缺失学科、越界年级、非整数值等）均安全：
 * 返回值要么为 null（不显示标记），要么恰好为该学科可选年级列表中的一个年级。
 */

import type { Subject } from '../types';

/**
 * 各学科可选年级（升序）：
 * 语文/数学为人教版一年级至六年级；英语为外研版（三年级起点）三年级至六年级。
 */
export const SUBJECT_GRADES: Record<Subject, readonly number[]> = {
  chinese: [1, 2, 3, 4, 5, 6],
  math: [1, 2, 3, 4, 5, 6],
  english: [3, 4, 5, 6],
} as const;

/**
 * Last_Grade 实体：仅记录学生选择过年级的学科；
 * 键为学科标识，值为最近一次选择的年级；初始态为 {}。
 */
export type LastGrade = Partial<Record<Subject, number>>;

/**
 * 学科可选年级列表（升序，与 SUBJECT_GRADES 一致）。
 * 语文/数学返回 [1,2,3,4,5,6]，英语返回 [3,4,5,6]（不含一、二年级）。
 */
export function gradeOptionsFor(subject: Subject): readonly number[] {
  return SUBJECT_GRADES[subject];
}

/**
 * 计算某学科应标记的年级：
 * - Last_Grade 中该学科有记录，且该记录属于本学科可选年级时返回该年级；
 * - 否则返回 null（不显示任何标记），覆盖空 Last_Grade 与越界/非法年级形态。
 *
 * 任意 Last_Grade 形态下，返回值要么为 null，要么恰为该学科可选年级之一，
 * 保证一个学科至多标记一个年级选项（标记唯一性）。
 */
export function markedGrade(lastGrade: LastGrade, subject: Subject): number | null {
  const recorded: unknown = lastGrade[subject];
  if (typeof recorded !== 'number') {
    return null;
  }
  return (SUBJECT_GRADES[subject] as readonly number[]).includes(recorded) ? recorded : null;
}
