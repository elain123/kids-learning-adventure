/**
 * 单词卡 4 选项构造器（Word_Card Options Builder）
 *
 * 依据 design.md "Property 19: 单词卡选项构造"（Validates: Requirements 8.4）实现：
 * 对任意单词卡练习题，产出恰 4 个选项——与所学单词匹配的正确选项恰 1 个，
 * 其余 3 个干扰项互不相同且均不等于正确项；支持图片（image）与拼写（spelling）两种模式。
 *
 * 构造规则：
 * - 随机源 rand 通过参数注入（与 Math.random 同契约，返回 [0,1)），纯函数、无 I/O；
 * - 正确项取值：
 *   · spelling 模式取本卡正确拼写（优先 answer.choice 指向的选项文本；
 *     图片型卡片的选项无文本时，从题干引号 “word” / "word" 中提取单词）；
 *   · image 模式取本卡图片（优先 media.image，否则取 answer.choice 指向的选项图片）；
 * - 干扰项优先取自题池中的其他单词卡（按 id 排除本题、按 type 过滤非单词卡），
 *   取值去重且不等于正确项；并按 plausible 程度分层选取：
 *   同 knowledgePointId 最优，其次同 unit，最后其余题；层内用 rand 洗牌保证随机；
 * - 小池兜底（4 选项不变量的保证范围）：
 *   · spelling 模式：题池干扰项不足 3 个时，对正确拼写程序化合成近似错拼
 *     （相邻字母交换 / 删字母 / 重复字母 / 换字母 / 元音替换，有限次随机尝试后，
 *     以"追加/前置 a-z 字母"作确定性兜底），因此只要能提取出非空正确拼写，
 *     恒产出恰 4 个选项（4 选项不变量在拼写模式下无条件成立）；
 *   · image 模式：图片无法程序化合成，干扰图只能来自题池——
 *     当题池可提供 ≥3 个互不相同且不等于正确图的图片时保证 4 选项
 *     （题库单词卡总数 ≥4 且各卡图片互异时自然满足）；否则抛出描述性 Error，
 *     由调用方换用 spelling 模式或换下一题（与题库校验"坏题跳过"的策略一致）；
 * - 组装：正确项 + 3 干扰项用 rand 做 Fisher-Yates 洗牌，按最终位置赋选项 id a/b/c/d，
 *   返回 correctOptionId 供判定管线（judge 的 choice 比对）使用。
 */

import type { Question, QuestionOption } from '../types';

/** 选项构造模式：image=图片 4 选 1，spelling=拼写 4 选 1 */
export type WordCardOptionMode = 'image' | 'spelling';

/** 构造结果：恰 4 个选项 + 正确选项 id */
export interface WordCardOptionsResult {
  /** 恰 4 个选项（1 正确 + 3 干扰），已洗牌；spelling 模式带 text，image 模式带 image */
  options: QuestionOption[];
  /** 正确选项的 id（a/b/c/d 之一） */
  correctOptionId: string;
  /** 本次构造使用的模式 */
  mode: WordCardOptionMode;
}

/** 选项总数（1 正确 + 3 干扰） */
export const WORD_CARD_OPTION_COUNT = 4;

/** 干扰项个数 */
const DISTRACTOR_COUNT = WORD_CARD_OPTION_COUNT - 1;

/** 选项 id（按洗牌后的最终位置依次赋值，与种子题库的选择题 id 风格一致） */
const OPTION_IDS: readonly string[] = ['a', 'b', 'c', 'd'];

/** 近似错拼随机变异的单次最大尝试次数（之后转入确定性兜底） */
const MAX_MUTATION_ATTEMPTS = 60;

/** 小写字母表（拼写变异与确定性兜底使用） */
const LOWERCASE_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** 元音字母（元音替换变异使用） */
const VOWELS = 'aeiou';

// ============ 单词卡内容提取 ============

/**
 * 提取单词卡的正确拼写。
 * - 拼写型卡片：answer.choice 指向的选项文本；
 * - 图片型卡片（选项只有图片）：从题干引号（“word”/"word"/「word」）中提取单词；
 * 无法提取时返回 null。
 */
export function extractWordCardSpelling(card: Question): string | null {
  const choiceIds = card.answer.choice;
  if (choiceIds !== undefined && card.options !== undefined) {
    for (const opt of card.options) {
      if (choiceIds.includes(opt.id) && typeof opt.text === 'string' && opt.text.trim().length > 0) {
        return opt.text;
      }
    }
  }
  const match = card.stem.match(/[“"「]([^”"」]+)[”"」]/);
  return match !== null ? match[1] : null;
}

/**
 * 提取单词卡的正确图片。
 * 优先 media.image（Req 8.2：每张单词记忆卡包含图片）；否则取 answer.choice 指向的选项图片。
 * 无法提取时返回 null。
 */
export function extractWordCardImage(card: Question): string | null {
  if (card.media !== undefined && typeof card.media.image === 'string' && card.media.image !== '') {
    return card.media.image;
  }
  const choiceIds = card.answer.choice;
  if (choiceIds !== undefined && card.options !== undefined) {
    for (const opt of card.options) {
      if (choiceIds.includes(opt.id) && typeof opt.image === 'string' && opt.image !== '') {
        return opt.image;
      }
    }
  }
  return null;
}

// ============ 主入口 ============

/**
 * 为一道单词卡练习题构造恰 4 个选项（1 正确 + 3 干扰）。
 *
 * @param question 当前单词卡题目（type 必须为 'word_card'）
 * @param pool 干扰项题池（通常为同学科/年级的其他单词卡；可含本题与非单词卡，会自动排除）
 * @param rand 随机源，与 Math.random 同契约，返回 [0,1)
 * @param mode 'image'（图片 4 选 1）或 'spelling'（拼写 4 选 1）
 * @returns 恰 4 个洗牌后的选项与正确选项 id
 * @throws 当 question 不是单词卡、无法提取正确项取值，
 *         或 image 模式下题池 distinct 图片不足 3 个时抛出描述性 Error
 */
export function buildWordCardOptions(
  question: Question,
  pool: readonly Question[],
  rand: () => number,
  mode: WordCardOptionMode,
): WordCardOptionsResult {
  if (question.type !== 'word_card') {
    throw new Error(
      `buildWordCardOptions: 题目 ${question.id} 不是单词卡题型（type=${question.type}）`,
    );
  }

  const extract = mode === 'spelling' ? extractWordCardSpelling : extractWordCardImage;
  const correctValue = extract(question);
  if (correctValue === null || correctValue.trim().length === 0) {
    throw new Error(
      `buildWordCardOptions: 单词卡 ${question.id} 无法提取${mode === 'spelling' ? '正确拼写' : '正确图片'}`,
    );
  }

  const poolValues = collectPoolDistractorValues(question, pool, correctValue, extract, rand);

  let distractors: string[];
  if (mode === 'spelling') {
    const fromPool = poolValues.slice(0, DISTRACTOR_COUNT);
    const used = new Set<string>([correctValue, ...fromPool]);
    const synthesized = synthesizeSpellingDistractors(
      correctValue,
      DISTRACTOR_COUNT - fromPool.length,
      used,
      rand,
    );
    distractors = [...fromPool, ...synthesized];
  } else {
    if (poolValues.length < DISTRACTOR_COUNT) {
      throw new Error(
        `buildWordCardOptions: 单词卡 ${question.id} 的题池图片干扰项不足 ` +
          `（需 ${DISTRACTOR_COUNT} 个互不相同且不等于正确图的图片，实得 ${poolValues.length} 个）`,
      );
    }
    distractors = poolValues.slice(0, DISTRACTOR_COUNT);
  }

  // 正确项 + 3 干扰项洗牌，按最终位置赋 id
  const shuffled = shuffle([correctValue, ...distractors], rand);
  const options: QuestionOption[] = shuffled.map((value, i) =>
    mode === 'spelling'
      ? { id: OPTION_IDS[i], text: value }
      : { id: OPTION_IDS[i], image: value },
  );
  const correctIndex = shuffled.indexOf(correctValue);
  return { options, correctOptionId: OPTION_IDS[correctIndex], mode };
}

// ============ 题池干扰项选取 ============

/** 干扰项候选：取值 + plausible 分层（0=同知识点，1=同单元，2=其余） */
interface DistractorCandidate {
  value: string;
  tier: 0 | 1 | 2;
}

/**
 * 从题池收集干扰项取值：
 * 排除本题（按 id）与非单词卡题目；取值去重且不等于正确项；
 * 整体洗牌后按分层稳定排序（层内随机、同知识点优先、其次同单元），返回有序取值列表。
 */
function collectPoolDistractorValues(
  question: Question,
  pool: readonly Question[],
  correctValue: string,
  extract: (card: Question) => string | null,
  rand: () => number,
): string[] {
  const seen = new Set<string>([correctValue]);
  const candidates: DistractorCandidate[] = [];
  for (const card of pool) {
    if (card.id === question.id || card.type !== 'word_card') {
      continue;
    }
    const value = extract(card);
    if (value === null || value.trim().length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    const tier: 0 | 1 | 2 =
      card.knowledgePointId === question.knowledgePointId ? 0 : card.unit === question.unit ? 1 : 2;
    candidates.push({ value, tier });
  }
  const shuffled = shuffle(candidates, rand);
  // ES2019+ Array.prototype.sort 稳定：层内保持洗牌后的随机顺序
  shuffled.sort((a, b) => a.tier - b.tier);
  return shuffled.map((c) => c.value);
}

// ============ 拼写干扰项合成（spelling 模式小池兜底） ============

/**
 * 对正确拼写合成 count 个近似错拼。
 * 先随机变异（有限次尝试），不足时以"追加/前置 a-z 字母"确定性兜底——
 * 只要正确拼写非空，恒能合成足额干扰项（拼写模式 4 选项不变量无条件成立）。
 * used 为禁用集合（正确拼写 + 已选干扰项），合成结果保证 ∉ used 且互不相同。
 */
function synthesizeSpellingDistractors(
  word: string,
  count: number,
  used: ReadonlySet<string>,
  rand: () => number,
): string[] {
  const out: string[] = [];
  for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS && out.length < count; attempt += 1) {
    const candidate = mutateSpelling(word, rand);
    if (candidate !== null && !used.has(candidate) && !out.includes(candidate)) {
      out.push(candidate);
    }
  }
  // 确定性兜底：word+letter 与 letter+word 各 26 个，互不相同且 ≠ word，
  // 对任意非空 word 均可补足剩余名额
  for (let i = 0; i < LOWERCASE_LETTERS.length && out.length < count; i += 1) {
    const letter = LOWERCASE_LETTERS[i];
    for (const candidate of [word + letter, letter + word]) {
      if (out.length >= count) {
        break;
      }
      if (!used.has(candidate) && !out.includes(candidate)) {
        out.push(candidate);
      }
    }
  }
  return out;
}

/**
 * 对单词做一次随机近似错拼变异。无法产生不同结果时返回 null（由调用方重试）。
 * 变异类型：相邻字母交换 / 删字母 / 重复字母 / 换字母 / 元音替换。
 */
function mutateSpelling(word: string, rand: () => number): string | null {
  if (word.length === 0) {
    return null;
  }
  const kind = randomIndex(5, rand);
  switch (kind) {
    case 0: {
      // 相邻字母交换（交换结果与原词相同则视为无效变异）
      if (word.length < 2) {
        return null;
      }
      const i = randomIndex(word.length - 1, rand);
      const swapped = word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
      return swapped === word ? null : swapped;
    }
    case 1: {
      // 删去一个字母
      if (word.length < 2) {
        return null;
      }
      const i = randomIndex(word.length, rand);
      return word.slice(0, i) + word.slice(i + 1);
    }
    case 2: {
      // 重复一个字母
      const i = randomIndex(word.length, rand);
      return word.slice(0, i) + word[i] + word[i] + word.slice(i + 1);
    }
    case 3: {
      // 替换一个字母为另一个不同的小写字母
      const letters = alphabeticPositions(word);
      if (letters.length === 0) {
        return null;
      }
      const pos = letters[randomIndex(letters.length, rand)];
      const replacement = randomOtherLetter(word[pos].toLowerCase(), rand);
      return word.slice(0, pos) + replacement + word.slice(pos + 1);
    }
    default: {
      // 元音替换（无元音则无效变异）
      const positions: number[] = [];
      for (let i = 0; i < word.length; i += 1) {
        if (VOWELS.includes(word[i].toLowerCase())) {
          positions.push(i);
        }
      }
      if (positions.length === 0) {
        return null;
      }
      const pos = positions[randomIndex(positions.length, rand)];
      let vowel = VOWELS[randomIndex(VOWELS.length, rand)];
      if (vowel === word[pos].toLowerCase()) {
        vowel = VOWELS[(VOWELS.indexOf(vowel) + 1) % VOWELS.length];
      }
      return word.slice(0, pos) + vowel + word.slice(pos + 1);
    }
  }
}

/** 单词中小写字母的下标列表（换字母变异只作用于字母字符） */
function alphabeticPositions(word: string): number[] {
  const positions: number[] = [];
  for (let i = 0; i < word.length; i += 1) {
    if (/[a-z]/i.test(word[i])) {
      positions.push(i);
    }
  }
  return positions;
}

/** 随机取一个与 given 不同的小写字母 */
function randomOtherLetter(given: string, rand: () => number): string {
  let letter = LOWERCASE_LETTERS[randomIndex(LOWERCASE_LETTERS.length, rand)];
  if (letter === given) {
    const next = (LOWERCASE_LETTERS.indexOf(letter) + 1 + randomIndex(LOWERCASE_LETTERS.length - 1, rand)) % LOWERCASE_LETTERS.length;
    letter = LOWERCASE_LETTERS[next];
  }
  return letter;
}

// ============ 通用随机工具 ============

/** Fisher-Yates 洗牌（返回新数组，不改入参） */
function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1, rand);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** 在 [0, span) 内取整数下标；对越界的 rand 返回值做防御性截断 */
function randomIndex(span: number, rand: () => number): number {
  return Math.min(Math.floor(rand() * span), span - 1);
}
