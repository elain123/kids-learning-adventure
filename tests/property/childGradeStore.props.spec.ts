/**
 * Child_Grade 持久化读写往返属性测试（fast-check，≥100 次迭代）
 *
 * 对应 .kiro/specs/child-grade-setting/design.md Property 8。
 * 与 tests/property/localStore.props.spec.ts 的通用实体往返属性互补：
 * 本文件专注 childGrade 实体的"写入→读出相等"与"关闭重开后恢复一致"。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createLocalStore,
  createMemoryStorage,
  type EntityTypeMap,
} from '@/data/localStore';

// ============ 生成器 ============

/** 合法 Child_Grade 值：null（未设置）或 1-6 整数 */
const arbChildGrade: fc.Arbitrary<EntityTypeMap['childGrade']> = fc.option(
  fc.integer({ min: 1, max: 6 }),
  { nil: null },
);

/** 孩子年级写入序列（长度 ≥ 1，末值即"最后一次成功写入"） */
const arbChildGradeSeq = fc.array(arbChildGrade, { minLength: 1, maxLength: 8 });

// ============ 属性测试 ============

describe('childGrade 持久化属性测试', () => {
  /**
   * **Feature: child-grade-setting, Property 8: 孩子年级持久化读写往返**
   *
   * *For any* 合法 Child_Grade 值（null 或 1-6 整数）：写入 Local_Store 后再读出，
   * 得到与写入值相等的值；以同一底层存储创建新的适配器实例（模拟关闭浏览器后
   * 重开）后读出，仍与最后一次成功写入的值一致。
   *
   * **Validates: Requirements 4.1, 4.3**
   */
  it('Property 8: 写入后读出相等；新适配器实例读出与最后一次成功写入一致', () => {
    fc.assert(
      fc.property(arbChildGradeSeq, (grades) => {
        const storage = createMemoryStorage();
        const store = createLocalStore({ storage });

        // 每次写入完成后，从 Local_Store 读出值与写入值相等（Req 4.1）
        for (const grade of grades) {
          store.write('childGrade', grade);
          expect(store.read('childGrade')).toEqual(grade);
        }

        // 以同一底层存储创建新适配器实例（模拟关闭浏览器后重开）：
        // 恢复值与最后一次成功写入一致（Req 4.3）
        const reopened = createLocalStore({ storage });
        expect(reopened.read('childGrade')).toEqual(grades[grades.length - 1]);
      }),
      { numRuns: 100 },
    );
  });
});
