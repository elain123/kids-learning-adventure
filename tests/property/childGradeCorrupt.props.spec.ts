/**
 * Child_Grade 损坏数据自愈属性测试（fast-check，≥100 次迭代）
 *
 * 与 tests/property/localStore.props.spec.ts 的通用实体损坏自愈属性互补：
 * 本文件专测 childGrade 实体（child-grade-setting 任务 2.1 登记），覆盖任意
 * 无法解析为合法 Child_Grade 的存储值下的自愈、备份保留与后续写入恢复。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createLocalStore,
  createMemoryStorage,
  type Settings,
} from '@/data/localStore';
import type { StarWallet } from '@/types';

// ============ 测试侧校验预言（镜像 localStore isChildGrade） ============

/** 合法 Child_Grade：null（未设置）或 1-6 整数 */
function isChildGradeLike(value: unknown): boolean {
  return (
    value === null ||
    (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 6)
  );
}

// ============ 生成器：损坏存储值 ============

/** 无法解析的原始字符串（JSON.parse 必抛错） */
const arbUnparseableRaw = fc.string({ minLength: 0, maxLength: 60 }).filter((raw) => {
  try {
    JSON.parse(raw);
    return false;
  } catch {
    return true;
  }
});

/**
 * JSON 合法但值非 null/1-6 整数的原始字符串：
 * 前置常量覆盖任务点名的典型形态（7、2.5、"3"、{}、[]、true），
 * 一般生成分支覆盖任意非法 JSON 值（越界整数、非整数、字符串、对象、数组、布尔等）。
 */
const arbInvalidChildGradeRaw = fc.oneof(
  fc.constantFrom('7', '2.5', '"3"', '{}', '[]', 'true'),
  fc
    .jsonValue({ maxDepth: 3 })
    .filter((value) => !isChildGradeLike(value))
    .map((value) => JSON.stringify(value)),
);

/** 损坏 childGrade 存储值：无法解析或值非法二者之一 */
const arbCorruptRaw = fc.oneof(arbUnparseableRaw, arbInvalidChildGradeRaw);

// ============ 生成器：合法值与其他实体 ============

/** 合法 Child_Grade（写入恢复用）：null 或 1-6 整数 */
const arbChildGrade: fc.Arbitrary<number | null> = fc.option(fc.integer({ min: 1, max: 6 }), {
  nil: null,
});

/** 备份键时间戳（JSON 可精确表示的整数范围） */
const arbTimestamp = fc.integer({ min: 0, max: 4_000_000_000_000 });

/** 其他实体代表：Star_Wallet 与 Settings 的合法值 */
const arbWallet: fc.Arbitrary<StarWallet> = fc.record({
  balance: fc.integer({ min: 0, max: 1_000_000 }),
  totalEarned: fc.integer({ min: 0, max: 1_000_000 }),
});

const arbSettings: fc.Arbitrary<Settings> = fc.record({ soundOn: fc.boolean() });

/** 用例：两个损坏原始值 + 备份时间戳 + 其他实体合法值 + 恢复写入的新合法值 */
const arbCase = fc.record({
  raw1: arbCorruptRaw,
  raw2: arbCorruptRaw,
  ts: arbTimestamp,
  wallet: arbWallet,
  settings: arbSettings,
  newGrade: arbChildGrade,
});

// ============ 属性测试 ============

describe('childGrade 损坏数据自愈属性测试', () => {
  /**
   * **Feature: child-grade-setting, Property 11: 损坏数据自愈、备份保留且此后可正常写入**
   *
   * *For any* 无法解析为合法 Child_Grade 的存储值（非法 JSON 串，或 JSON 合法但值非
   * null/1-6 整数）：读取返回 null（按未设置启动）；原始损坏值被复制到独立备份键且
   * 同一会话内再次读取不覆盖；其他实体键值不受影响；此后写入新合法 Child_Grade 仍
   * 正常持久化并可读回。
   *
   * **Validates: Requirements 4.5**
   */
  it('Property 11: 损坏读取返回 null，原值入备份且会话内不覆盖，其他实体不受影响，此后写入恢复', () => {
    fc.assert(
      fc.property(arbCase, ({ raw1, raw2, ts, wallet, settings, newGrade }) => {
        const storage = createMemoryStorage();
        const store = createLocalStore({ storage, now: () => ts });
        const childKey = store.keyFor('childGrade');
        const backupKey = store.backupKeyFor('childGrade', ts);

        // 预置其他实体合法值，作为"不受影响"的对照
        store.write('wallet', wallet);
        store.write('settings', settings);
        const walletKey = store.keyFor('wallet');
        const settingsKey = store.keyFor('settings');
        const walletRawBefore = storage.getItem(walletKey);
        const settingsRawBefore = storage.getItem(settingsKey);

        // 备份键独立于实体键
        expect(backupKey).not.toBe(childKey);
        expect(backupKey).toContain(':backup:');

        // 损坏读取：返回 null（按未设置启动，Req 4.5）
        storage.setItem(childKey, raw1);
        expect(store.read('childGrade')).toBeNull();

        // 原始损坏值被复制到独立备份键
        expect(storage.getItem(backupKey)).toBe(raw1);

        // 其他实体键值不受影响：原始串与读回值均不变
        expect(storage.getItem(walletKey)).toBe(walletRawBefore);
        expect(storage.getItem(settingsKey)).toBe(settingsRawBefore);
        expect(store.read('wallet')).toEqual(wallet);
        expect(store.read('settings')).toEqual(settings);

        // 同一会话内再次损坏读取：仍返回 null，且不覆盖首次备份
        storage.setItem(childKey, raw2);
        expect(store.read('childGrade')).toBeNull();
        expect(storage.getItem(backupKey)).toBe(raw1);

        // 此后写入新合法值：正常持久化并可读回（含模拟浏览器重开的新实例）
        store.write('childGrade', newGrade);
        expect(storage.getItem(childKey)).toBe(JSON.stringify(newGrade));
        expect(store.read('childGrade')).toEqual(newGrade);
        const reopened = createLocalStore({ storage });
        expect(reopened.read('childGrade')).toEqual(newGrade);

        // 首次备份在写入恢复后依旧保留
        expect(storage.getItem(backupKey)).toBe(raw1);
      }),
      { numRuns: 100 },
    );
  });
});
