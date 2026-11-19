/**
 * Local_Store childGrade 账号隔离属性测试（fast-check，≥100 次迭代）
 *
 * 对应 .kiro/specs/child-grade-setting/design.md Property 12。
 * 与 tests/property/localStore.props.spec.ts 的通用多账号隔离属性互补：
 * 本文件专注 childGrade 实体在 kla:v1:{accountId}: 键命名空间下的账号隔离。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createLocalStore,
  createMemoryStorage,
  STORAGE_PREFIX,
  type EntityTypeMap,
} from '@/data/localStore';

// ============ 生成器 ============

/** 账号标识（字母数字短横线下划线，非空；与 localStore.props.spec.ts 同约定） */
const arbAccountId = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
  { minLength: 1, maxLength: 16 },
);

/** 两个不同账号标识 A≠B */
const arbTwoAccounts = fc
  .tuple(arbAccountId, arbAccountId)
  .filter(([a, b]) => a !== b);

/** 合法 Child_Grade 值：null（未设置）或 1-6 整数 */
const arbChildGrade: fc.Arbitrary<EntityTypeMap['childGrade']> = fc.option(
  fc.integer({ min: 1, max: 6 }),
  { nil: null },
);

/**
 * 账号 B 下已存值：undefined 表示 B 从未写入（存储中无 B 的 childGrade 键），
 * 否则为 B 预先写入的合法 Child_Grade 值（含 null）。
 */
const arbBStored = fc.option(arbChildGrade, { nil: undefined });

// ============ 属性测试 ============

describe('localStore childGrade 账号隔离属性测试', () => {
  /**
   * **Feature: child-grade-setting, Property 12: 孩子年级账号隔离**
   *
   * *For any* 两个不同账号标识 A≠B 与任意合法 Child_Grade 值：A 写入后读 A 相等，
   * 读 B 得 null（B 未写入时），且 A 的写入不改变 B 下已存任何值。
   *
   * **Validates: Requirements 4.6**
   */
  it('Property 12: A 写入后读 A 相等，读 B 得 null，且 B 下已存值不被改变', () => {
    fc.assert(
      fc.property(
        arbTwoAccounts,
        arbChildGrade,
        arbBStored,
        ([accA, accB], gradeA, bStored) => {
          const storage = createMemoryStorage();
          const storeA = createLocalStore({ storage, accountId: accA });
          const storeB = createLocalStore({ storage, accountId: accB });
          const keyA = `${STORAGE_PREFIX}:${accA}:childGrade`;
          const keyB = `${STORAGE_PREFIX}:${accB}:childGrade`;

          // B 预先写入任意合法值（undefined 表示 B 从未写入）
          if (bStored !== undefined) {
            storeB.write('childGrade', bStored);
          }
          const bRawBefore = storage.getItem(keyB);
          // B 未写入时期望读出 null，否则期望读出 B 的已存值
          const bExpected: EntityTypeMap['childGrade'] =
            bStored === undefined ? null : bStored;

          // A 写入后读 A 相等（Req 4.6：键命名空间 kla:v1:{accountId}:childGrade）
          storeA.write('childGrade', gradeA);
          expect(storeA.read('childGrade')).toEqual(gradeA);
          expect(storage.getItem(keyA)).toBe(JSON.stringify(gradeA));

          // 读 B：B 未写入时得 null；B 已写入时 A 的写入不改变 B 下已存值
          expect(storeB.read('childGrade')).toEqual(bExpected);
          expect(storage.getItem(keyB)).toBe(bRawBefore);

          // 新适配器实例（模拟关闭浏览器后重开）隔离仍成立
          const storeAReopened = createLocalStore({ storage, accountId: accA });
          const storeBReopened = createLocalStore({ storage, accountId: accB });
          expect(storeAReopened.read('childGrade')).toEqual(gradeA);
          expect(storeBReopened.read('childGrade')).toEqual(bExpected);
          expect(storage.getItem(keyB)).toBe(bRawBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});
