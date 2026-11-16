/**
 * 单词卡 4 选项构造器（Word_Card Options Builder）属性测试
 *
 * 实现文件：src/engine/wordCardOptions.ts（buildWordCardOptions，纯函数，随机源注入）
 * 种子数据：src/data/seed/questions-english.json（101 张真实单词卡，作为固定题池用例纳入属性运行）
 *
 * 实现契约（与实现文件头注释一致，本属性按此契约设计）：
 *  - 产出恰 4 个选项：与所学单词匹配的正确选项恰 1 个，其余 3 个干扰项互不相同
 *    且均不等于正确项；选项经洗牌后按位置赋 id a/b/c/d，返回 correctOptionId；
 *  - spelling 模式：题池干扰项不足 3 个时程序化合成近似错拼兜底，
 *    只要能提取出非空正确拼写，4 选项不变量无条件成立；
 *  - image 模式：图片无法程序化合成，题池须提供 ≥3 个互不相同且不等于正确图的
 *    干扰图（排除本题、非单词卡与重复取值后），否则抛出描述性 Error——
 *    本属性对该边界同时验证"抛错分支"与"成功分支"。
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  buildWordCardOptions,
  extractWordCardImage,
  extractWordCardSpelling,
  WORD_CARD_OPTION_COUNT,
  type WordCardOptionMode,
  type WordCardOptionsResult,
} from '../../src/engine/wordCardOptions';
import type { Difficulty, Question } from '../../src/types';
import seedJson from '../../src/data/seed/questions-english.json';

// ============ 确定性随机源生成器 ============

/** mulberry32 确定性 PRNG：与 Math.random 同契约，返回 [0,1) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由 fast-check 整数种子驱动的确定性随机源 */
const prngRandArb: fc.Arbitrary<() => number> = fc
  .integer({ min: 0, max: 0xffffffff })
  .map((seed) => mulberry32(seed));

/** 构造模式：图片 4 选 1 / 拼写 4 选 1 */
const modeArb: fc.Arbitrary<WordCardOptionMode> = fc.constantFrom('image', 'spelling');

// ============ 种子题池（101 张真实单词卡，固定用例） ============

const seedCards = (seedJson as { questions: unknown[] }).questions as Question[];

/** 随机目标单词卡（取自种子题库） */
const seedCardArb: fc.Arbitrary<Question> = fc.constantFrom(...seedCards);

/** 随机题池：种子单词卡的任意子集（含空集、含/不含本题） */
const seedSubsetArb: fc.Arbitrary<Question[]> = fc.subarray(seedCards);

// ============ 合成单词卡生成器（碰撞倾向，覆盖去重与小池兜底） ============

/** 小字母表随机单词：易撞词，专门练习题池取值去重与拼写合成兜底 */
const wordArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom('a', 'b', 'c', 'd', 'e'), { minLength: 1, maxLength: 8 })
  .map((cs) => cs.join(''));

/** 小图片集合：易耗尽，专门练习 image 模式的"干扰项不足即抛错"契约 */
const imageArb: fc.Arbitrary<string> = fc.constantFrom(
  'img/syn/s1.png',
  'img/syn/s2.png',
  'img/syn/s3.png',
  'img/syn/s4.png',
  'img/syn/s5.png',
  'img/syn/s6.png',
);

/**
 * 合成单词卡（id 由调用方保证唯一）：
 * - withTextOptions=true：选项带文本、answer.choice 指向正确文本（spelling 走选项提取路径）；
 * - withTextOptions=false：选项只有图片、题干含引号单词（spelling 走题干引号提取路径）。
 * 两种形态均可提取正确拼写与正确图片。
 */
function makeSyntheticCard(
  id: string,
  word: string,
  image: string,
  withTextOptions: boolean,
  unit: string,
  knowledgePointId: string,
): Question {
  return {
    id,
    subject: 'english',
    grade: 3,
    volume: 'A',
    unit,
    type: 'word_card',
    knowledgePointId,
    difficulty: 2 as Difficulty,
    stem: withTextOptions
      ? '看图片、听发音，选出正确的单词拼写'
      : `听发音，选出与单词 “${word}” 相匹配的图片`,
    media: { audio: `audio/syn/${word}.mp3`, image },
    options: withTextOptions
      ? [
          { id: 'a', text: word },
          { id: 'b', text: `${word}x` },
          { id: 'c', text: `x${word}` },
          { id: 'd', image },
        ]
      : [
          { id: 'a', image },
          { id: 'b', image: `${image}#b` },
          { id: 'c', image: `${image}#c` },
          { id: 'd', image: `${image}#d` },
        ],
    answer: { choice: ['a'] },
    hint: '提示',
    analysis: '解析',
    phase: 1,
  };
}

/** 非单词卡干扰题（练习题池按 type 过滤） */
function makeDecoy(id: string, image: string): Question {
  return {
    id,
    subject: 'english',
    grade: 3,
    volume: 'A',
    unit: 'm9',
    type: 'choice',
    knowledgePointId: 'en.g3.decoy',
    difficulty: 1 as Difficulty,
    stem: '非单词卡干扰题',
    media: { image },
    options: [{ id: 'a', text: 'x' }],
    answer: { choice: ['a'] },
    hint: '提示',
    analysis: '解析',
    phase: 1,
  };
}

interface SyntheticCase {
  target: Question;
  pool: Question[];
}

/**
 * 合成用例：随机目标单词卡 + 随机题池（可为空、可含本题、可含非单词卡干扰题）。
 * 题池元素按数组下标赋唯一 id（word_card 与 decoy 混合）。
 */
const syntheticCaseArb: fc.Arbitrary<SyntheticCase> = fc
  .tuple(
    wordArb,
    imageArb,
    fc.boolean(),
    fc.constantFrom('m1', 'm2'),
    fc.constantFrom('en.g3.alpha', 'en.g3.beta'),
    fc.array(
      fc.tuple(
        fc.constantFrom('card', 'decoy'),
        wordArb,
        imageArb,
        fc.boolean(),
        fc.constantFrom('m1', 'm2'),
        fc.constantFrom('en.g3.alpha', 'en.g3.beta'),
      ),
      { minLength: 0, maxLength: 12 },
    ),
  )
  .map(([word, image, withText, unit, kp, poolRaw]) => {
    const target = makeSyntheticCard('syn-target', word, image, withText, unit, kp);
    const pool = poolRaw.map(([kind, w, img, wt, u, k], i) =>
      kind === 'card'
        ? makeSyntheticCard(`syn-pool-${i}`, w, img, wt, u, k)
        : makeDecoy(`syn-pool-${i}`, img),
    );
    // 一半用例把本题放入题池（练习题池按 id 排除本题的路径）
    return { target, pool: withText ? pool : [target, ...pool] };
  });

// ============ 契约辅助 ============

const OPTION_IDS = ['a', 'b', 'c', 'd'];

/** 按模式提取正确项取值（与实现共用的提取器，充当 oracle） */
function correctValueOf(question: Question, mode: WordCardOptionMode): string {
  const value = mode === 'spelling' ? extractWordCardSpelling(question) : extractWordCardImage(question);
  expect(value, `${question.id} 应可提取${mode === 'spelling' ? '正确拼写' : '正确图片'}`).not.toBeNull();
  return value as string;
}

/**
 * 镜像实现契约：题池中可用的 image 干扰项个数——
 * 排除本题（按 id）与非单词卡，取值去重且不等于正确图。
 */
function countAvailableImageDistractors(question: Question, pool: readonly Question[]): number {
  const correctImage = extractWordCardImage(question);
  const seen = new Set<string>([correctImage as string]);
  for (const card of pool) {
    if (card.id === question.id || card.type !== 'word_card') {
      continue;
    }
    const value = extractWordCardImage(card);
    if (value !== null && value.trim().length > 0) {
      seen.add(value);
    }
  }
  return seen.size - 1;
}

/** 选项取值（spelling 取 text，image 取 image） */
function optionValues(result: WordCardOptionsResult, mode: WordCardOptionMode): (string | undefined)[] {
  return result.options.map((o) => (mode === 'spelling' ? o.text : o.image));
}

/**
 * 断言 Property 19 的 4 选项不变量：
 * 选项恰 4 个；与所学单词匹配的正确选项恰 1 个（位于 correctOptionId、
 * 取值等于本卡正确拼写/图片）；其余 3 个干扰项互不相同且均不等于正确项。
 */
function assertOptionInvariant(
  question: Question,
  result: WordCardOptionsResult,
  mode: WordCardOptionMode,
): void {
  const correctValue = correctValueOf(question, mode);

  // ---- 恰 4 个选项，id 按洗牌后位置依次为 a/b/c/d，模式回显 ----
  expect(result.options).toHaveLength(WORD_CARD_OPTION_COUNT);
  expect(result.options.map((o) => o.id)).toEqual(OPTION_IDS);
  expect(result.mode).toBe(mode);
  expect(OPTION_IDS).toContain(result.correctOptionId);

  const values = optionValues(result, mode);

  // ---- 正确选项恰 1 个：位于 correctOptionId，且取值等于本卡正确拼写/图片 ----
  const correctCount = values.filter((v) => v === correctValue).length;
  expect(correctCount, `正确项取值 "${correctValue}" 应恰出现 1 次，实得 ${JSON.stringify(values)}`).toBe(1);
  const correctOption = result.options.find((o) => o.id === result.correctOptionId);
  expect(correctOption).toBeDefined();
  expect(mode === 'spelling' ? correctOption?.text : correctOption?.image).toBe(correctValue);

  // ---- 其余 3 个干扰项：互不相同且均不等于正确项 ----
  const distractors = values.filter((v) => v !== correctValue);
  expect(distractors).toHaveLength(WORD_CARD_OPTION_COUNT - 1);
  expect(new Set(distractors).size, `干扰项应互不相同，实得 ${JSON.stringify(distractors)}`).toBe(
    WORD_CARD_OPTION_COUNT - 1,
  );
  for (const d of distractors) {
    expect(d).not.toBe(correctValue);
  }
}

/** 按契约分派：image 模式题池干扰图不足 3 个时应抛出描述性 Error，否则构造成功并断言不变量 */
function runContract(
  question: Question,
  pool: readonly Question[],
  rand: () => number,
  mode: WordCardOptionMode,
): 'success' | 'threw' {
  if (mode === 'image' && countAvailableImageDistractors(question, pool) < WORD_CARD_OPTION_COUNT - 1) {
    expect(() => buildWordCardOptions(question, pool, rand, mode)).toThrowError(/干扰项不足/);
    return 'threw';
  }
  const result = buildWordCardOptions(question, pool, rand, mode);
  assertOptionInvariant(question, result, mode);
  return 'success';
}

// ============ 属性测试 ============

describe('单词卡 4 选项构造器（属性测试）', () => {
  /**
   * **Feature: kids-learning-adventure, Property 19: 单词卡选项构造**
   * **Validates: Requirements 8.4**
   *
   * 种子题库 × 随机题池：对任意种子单词卡（任意目标卡 × 题库的任意子集题池）、
   * 任意构造模式（image/spelling）与任意 PRNG 随机源：
   * - spelling 模式恒产出恰 4 个选项（小池由近似错拼合成兜底）；
   * - image 模式在题池 distinct 干扰图 ≥3 时产出恰 4 个选项，不足 3 时按契约抛错；
   * 成功产出时正确选项恰 1 个，其余 3 个干扰项互不相同且均不等于正确项。
   */
  it('Property 19: 种子单词卡 × 随机子集题池 × 双模式——4 选项不变量与 image 抛错契约', () => {
    expect(seedCards).toHaveLength(101);
    let successCount = 0;
    let threwCount = 0;
    fc.assert(
      fc.property(seedCardArb, seedSubsetArb, modeArb, prngRandArb, (card, pool, mode, rand) => {
        if (runContract(card, pool, rand, mode) === 'threw') {
          threwCount++;
        } else {
          successCount++;
        }
      }),
      { numRuns: 300 },
    );
    // 健全性：两个契约分支都被真实行使（小子集触发 image 抛错，大子集构造成功）
    expect(successCount).toBeGreaterThan(0);
    expect(threwCount).toBeGreaterThan(0);
  });

  /**
   * **Feature: kids-learning-adventure, Property 19: 单词卡选项构造**
   * **Validates: Requirements 8.4**
   *
   * 合成题池（碰撞倾向）：对任意合成单词卡（小字母表单词 × 小图片集，易撞词/撞图）、
   * 任意题池（可为空、可含本题、可混入非单词卡干扰题）、双模式与任意 PRNG 随机源，
   * 同样的 4 选项不变量与 image 抛错契约成立——覆盖取值去重、按 id 排除本题、
   * 按 type 过滤非单词卡，以及空池/小池下 spelling 合成兜底路径。
   */
  it('Property 19: 合成碰撞题池 × 双模式——去重、排除本题、过滤非单词卡与小池兜底', () => {
    let successCount = 0;
    let threwCount = 0;
    fc.assert(
      fc.property(syntheticCaseArb, modeArb, prngRandArb, ({ target, pool }, mode, rand) => {
        if (runContract(target, pool, rand, mode) === 'threw') {
          threwCount++;
        } else {
          successCount++;
        }
      }),
      { numRuns: 300 },
    );
    // 健全性：6 值图片集下 image 抛错分支必然被行使，spelling 成功分支同理
    expect(successCount).toBeGreaterThan(0);
    expect(threwCount).toBeGreaterThan(0);
  });

  /**
   * **Feature: kids-learning-adventure, Property 19: 单词卡选项构造**
   * **Validates: Requirements 8.4**
   *
   * 固定题池用例：完整种子题库（101 卡，图片与拼写全互异）作为题池，
   * 遍历全部 101 张种子卡 × 双模式 × 多组确定性随机源——
   * 真实生产题池下 4 选项不变量对每张卡、每种模式恒成立。
   */
  it('Property 19: 完整种子题池 × 全部 101 张卡 × 双模式（固定题池扫描）', () => {
    for (const card of seedCards) {
      for (const mode of ['image', 'spelling'] as const) {
        for (let s = 0; s < 3; s += 1) {
          const rand = mulberry32(0x9e3779b9 ^ (s * 0x85ebca6b) ^ card.id.length);
          const result = buildWordCardOptions(card, seedCards, rand, mode);
          assertOptionInvariant(card, result, mode);
        }
      }
    }
  });

  /**
   * **Feature: kids-learning-adventure, Property 19: 单词卡选项构造**
   * **Validates: Requirements 8.4**
   *
   * 边界固定用例：
   * - spelling 模式在空题池下仍产出恰 4 个选项（全部由近似错拼合成兜底）；
   * - image 模式在空题池下按契约抛出"干扰项不足"的描述性 Error；
   * - spelling 模式在仅含本题的单元素题池下同样产出恰 4 个选项（本题按 id 被排除）。
   */
  it('Property 19: 边界——空题池与单元素题池下的拼写兜底与图片抛错', () => {
    const card = seedCards[0];
    const rand = mulberry32(42);

    // 空题池：spelling 兜底成功，image 按契约抛错
    const emptyPoolResult = buildWordCardOptions(card, [], rand, 'spelling');
    assertOptionInvariant(card, emptyPoolResult, 'spelling');
    expect(() => buildWordCardOptions(card, [], rand, 'image')).toThrowError(/干扰项不足/);

    // 仅含本题：本题按 id 排除，spelling 兜底成功
    const selfOnlyResult = buildWordCardOptions(card, [card], rand, 'spelling');
    assertOptionInvariant(card, selfOnlyResult, 'spelling');
  });
});
