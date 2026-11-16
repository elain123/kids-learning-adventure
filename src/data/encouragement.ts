/**
 * 鼓励文案库（无批评否定表述）
 *
 * 依据 .kiro/specs/kids-learning-adventure/requirements.md Requirement 4.2 实现：
 * 学生重试后仍答错时，系统展示"一条不含批评或否定表述的鼓励性反馈文案"。
 *
 * 本模块为纯数据 + 纯函数：不依赖 DOM/Vue，随机源通过参数注入，便于测试。
 */

/**
 * 鼓励文案中禁止出现的批评/否定表述（Req 4.2）。
 * 供单元测试（任务 11.3）断言：文案库中任何一条均不包含这些表述。
 * 注意："没关系"属于安抚用语而非对孩子的否定评价，故"没"不在禁止之列。
 */
export const ENCOURAGEMENT_BANNED_WORDS: readonly string[] = [
  '错',
  '不对',
  '不行',
  '不好',
  '失败',
  '笨',
  '粗心',
  '差劲',
  '批评',
  '退步',
];

/**
 * 鼓励文案库：全部面向小学生、积极向上，不含任何批评或否定表述（Req 4.2）。
 * 文案围绕"努力、进步、勇敢、坚持"，与游戏的冒险/星星/宝藏主题呼应。
 */
export const ENCOURAGEMENTS: readonly string[] = [
  '没关系，再试一次就会更棒！',
  '你已经很努力了，继续加油！',
  '每一次认真尝试，都是一次进步！',
  '小勇士，敢于挑战就是最棒的！',
  '想一想，你离宝藏又近了一步！',
  '认真思考的你，闪闪发光！',
  '这道题有点调皮，下一题继续冲！',
  '坚持练习的小探险家，最了不起！',
  '你的努力，星星都看在眼里啦！',
  '学到这里已经很棒，继续去发现下一颗星星吧！',
];

/**
 * 从文案库中选取一条鼓励文案（纯函数）。
 * rand 为注入的随机源，返回 [0, 1) 区间浮点数（默认 Math.random）；
 * 越界输入会被收敛到合法区间，保证返回值始终是库中某一条文案。
 */
export function pickEncouragement(rand: () => number = Math.random): string {
  const raw = rand();
  const clamped = Number.isFinite(raw)
    ? Math.min(Math.max(raw, 0), 1 - Number.EPSILON)
    : 0;
  const index = Math.floor(clamped * ENCOURAGEMENTS.length);
  return ENCOURAGEMENTS[index];
}
