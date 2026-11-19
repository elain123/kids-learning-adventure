/**
 * 孩子年级"1 秒内写入且最后写入生效"属性测试（fast-check，≥100 次迭代）
 *
 * 对应 .kiro/specs/child-grade-setting/design.md Property 9。
 * 与 tests/property/childGradeStore.props.spec.ts 的 Local_Store 实体往返属性互补：
 * 本文件专注 App_State 接线层 setChildGrade 的立即写入语义——
 * 家长 1 秒内连续多次设置/修改年级时，最终落盘值为最后一次变化后的年级。
 *
 * 依据任务 4.1 的实现：setChildGrade 采用立即写入（store.write）而非调度写入
 * （store.schedule），故"调用返回后即可从 Local_Store 读出"平凡成立，
 * 本属性在任意变化序列上锁定该契约（Req 4.2、1.7）。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createAppState } from '@/stores/appState';
import { createMemoryStorage } from '@/data/localStore';
import type { AudioService } from '@/services/audioService';

// ============ 挂载辅助 ============

/** 静音 Audio_Service（注入 App_State，避免 jsdom 媒体告警干扰） */
const silentAudio: AudioService = {
  playEffect: () => Promise.resolve(),
  playPronunciation: () => Promise.resolve(),
  speakText: () => Promise.resolve(),
  stopAll: () => undefined,
  isEffectAvailable: () => false,
};

// ============ 生成器 ============

/**
 * 孩子年级变化序列（长度 ≥ 1 的 1-6 整数序列，模拟 1 秒内连续多次设置）。
 * 末值即"最后一次变化后的 Child_Grade"；单元素序列覆盖"仅设置一次"边界。
 */
const arbGradeChangeSeq = fc.array(fc.integer({ min: 1, max: 6 }), {
  minLength: 1,
  maxLength: 8,
});

// ============ 属性测试 ============

describe('App_State setChildGrade 最后写入生效属性测试', () => {
  /**
   * **Feature: child-grade-setting, Property 9: 1 秒内写入且最后写入生效**
   *
   * *For any* 孩子年级变化序列（长度 ≥ 1 的 1-6 整数序列，模拟 1 秒内连续多次
   * 设置）：依次调用 setChildGrade 后，Local_Store 中读出的 childGrade 恒等于
   * 序列最后一个值；且单次变化在调用返回后即可从 Local_Store 读出
   * （立即写入，满足 1 秒时限）。
   *
   * **Validates: Requirements 4.2, 1.7**
   */
  it('Property 9: 每次调用返回后即可读出该值；序列末次调用后读出恒等于最后值', () => {
    fc.assert(
      fc.property(arbGradeChangeSeq, (grades) => {
        // 每次迭代以独立内存存储创建 App_State（真实种子题库 + 静音音频），
        // 保证变化序列之间互不污染
        const state = createAppState({
          storage: createMemoryStorage(),
          audio: silentAudio,
        });

        for (const grade of grades) {
          state.setChildGrade(grade);
          // 单次变化在调用返回后即可从 Local_Store 读出：
          // 立即写入（store.write）满足"变化后 1 秒内写入"时限（Req 4.2）
          expect(state.store.read('childGrade')).toBe(grade);
        }

        // 1 秒内多次变化时，最终写入 Local_Store 的值为最后一次变化后的
        // Child_Grade（Req 4.2）；覆盖保存使设置更新为新值（Req 1.7）
        expect(state.store.read('childGrade')).toBe(grades[grades.length - 1]);
      }),
      { numRuns: 100 },
    );
  });
});
