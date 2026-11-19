/**
 * Local_Store childGrade 缺失数据属性测试（fast-check，≥100 次迭代）
 *
 * 覆盖设计属性 Property 10：任意不含 childGrade 键的存储（其余键任意），
 * 读取 childGrade 返回 null（未设置），且读取后不产生任何 backup:childGrade 备份键。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createLocalStore,
  createMemoryStorage,
  STORAGE_PREFIX,
  type EntityName,
  type StorageLike,
} from '@/data/localStore';

// ============ 生成器 ============

/** 账号标识（字母数字短横线下划线，非空；与 localStore.props.spec.ts 同约定） */
const arbAccountId = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
  { minLength: 1, maxLength: 16 },
);

/** 非负时间戳（备份键时间戳注入用） */
const arbTimestamp = fc.integer({ min: 0, max: 4_000_000_000_000 });

/** childGrade 之外的其余实体名 */
const OTHER_ENTITY_NAMES: readonly EntityName[] = [
  'mastery',
  'wrongSet',
  'wallet',
  'collection',
  'session:today',
  'oralBest',
  'settings',
  'lastGrade',
  'session:subjects',
];

/**
 * 任意"其余键"内容：其余实体键 + 任意原始字符串值（合法 JSON 与否不限，
 * 属性只要求这些键存在且不含 childGrade 键）。
 */
const arbOtherEntries = fc
  .array(fc.tuple(fc.constantFrom(...OTHER_ENTITY_NAMES), fc.string({ maxLength: 60 })), {
    maxLength: 8,
  })
  // 同实体重复出现时后者覆盖前者，归一化为唯一键映射
  .map((entries) => new Map(entries));

// ============ 记录型存储包装（观测读取动作的全部写副作用） ============

function trackWrites(base: StorageLike): { storage: StorageLike; writtenKeys: string[] } {
  const writtenKeys: string[] = [];
  return {
    storage: {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        writtenKeys.push(key);
        base.setItem(key, value);
      },
      removeItem: (key) => base.removeItem(key),
    },
    writtenKeys,
  };
}

// ============ 属性测试 ============

describe('localStore childGrade 缺失数据属性测试', () => {
  /**
   * **Feature: child-grade-setting, Property 10: 缺失数据按未设置启动且无备份**
   *
   * *For any* 不含 childGrade 键的存储（其余键任意）：读取 childGrade 返回 null
   * （未设置），且读取后存储中不产生任何 backup:childGrade 备份键。
   *
   * **Validates: Requirements 4.4**
   */
  it('Property 10: 缺失读取返回 null 且不产生任何 backup:childGrade 备份键', () => {
    fc.assert(
      fc.property(
        arbAccountId,
        arbOtherEntries,
        arbTimestamp,
        (accountId, otherEntries, ts) => {
          const base = createMemoryStorage();
          // 预置任意其余键（绝不包含 childGrade 键）
          for (const [entity, raw] of otherEntries) {
            base.setItem(`${STORAGE_PREFIX}:${accountId}:${entity}`, raw);
          }
          const { storage, writtenKeys } = trackWrites(base);
          const childGradeKey = `${STORAGE_PREFIX}:${accountId}:childGrade`;

          // 缺失读取：返回 null（按未设置启动，Req 4.4）
          const store = createLocalStore({ storage, accountId, now: () => ts });
          expect(store.read('childGrade')).toBeNull();
          // 同会话内重复读取仍为 null
          expect(store.read('childGrade')).toBeNull();

          // 新实例（模拟关闭浏览器后重开）读取仍按未设置返回 null
          const storeReopened = createLocalStore({ storage, accountId, now: () => ts });
          expect(storeReopened.read('childGrade')).toBeNull();

          // 读取后不产生任何 backup:childGrade 备份键，
          // 也不写 childGrade 实体键（缺失读取无任何写副作用）
          expect(writtenKeys.filter((key) => key.includes('childGrade'))).toEqual([]);
          expect(base.getItem(childGradeKey)).toBeNull();

          // 预置的其余键内容不被读取动作改变
          for (const [entity, raw] of otherEntries) {
            expect(base.getItem(`${STORAGE_PREFIX}:${accountId}:${entity}`)).toBe(raw);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
