/**
 * 种子数据契约测试（unit/contract tests，非属性测试）
 *
 * 验证 src/data/seed/ 下的种子数据满足设计文档「种子数据契约」：
 * - 语文/数学/英语三个题库 JSON 全部经 2.1 校验器（loadQuestionBank/validateQuestion）
 *   载入且 0 错误；
 * - 语文七类基础题型齐全（Req 6.2），按年级/册/单元组织（Req 6.1）；
 * - 数学覆盖三四年级全部 26 个单元知识点（Req 7.1）与六类题型（Req 7.2，
 *   口算速算经 generators-math.json 的 GeneratorParams 覆盖）；
 * - 英语单词卡每卡含图片/发音音频/可提取拼写（Req 8.2），按年级/册/Module 组织（Req 8.1）；
 * - 全部种子仅覆盖三、四年级（Req 13.8）；
 * - 题型枚举支持二期三类预留题型 reading/word_problem/read_aloud（Req 13.4）；
 * - phase=2 或二期题型题目载入但不入今日队列（Req 13.7）；
 * - collectibles.json 恰为 6 宠物 + 6 装饰共 12 件，id 与 COLLECTIBLE_ITEMS 常量一致。
 *
 * _Requirements: 6.1, 6.2, 7.1, 7.2, 8.1, 8.2, 13.4, 13.7, 13.8_
 */

import { describe, it, expect } from 'vitest';

import chineseJson from '../../src/data/seed/questions-chinese.json';
import mathJson from '../../src/data/seed/questions-math.json';
import englishJson from '../../src/data/seed/questions-english.json';
import generatorsJson from '../../src/data/seed/generators-math.json';
import collectiblesJson from '../../src/data/seed/collectibles.json';

import {
  loadQuestionBank,
  validateQuestion,
  buildQuestionIndex,
  isQueueEligible,
} from '../../src/data/questionBank';
import { buildTodayQueue } from '../../src/engine/reviewEngine';
import {
  COLLECTIBLE_ITEMS,
  PHASE2_QUESTION_TYPES,
  type Question,
  type SessionConfig,
} from '../../src/types';

// ============ 加载辅助 ============

/** 经 2.1 加载器载入种子题库 JSON；整体 fatal 时直接抛错（契约：不得 fatal） */
function loadSeed(raw: unknown, label: string): { questions: Question[]; errors: unknown[] } {
  const result = loadQuestionBank(JSON.stringify(raw));
  if ('fatal' in result) {
    throw new Error(`${label} 题库整体加载失败（fatal）：${result.fatal}`);
  }
  return result;
}

const chineseBank = loadSeed(chineseJson, 'questions-chinese');
const mathBank = loadSeed(mathJson, 'questions-math');
const englishBank = loadSeed(englishJson, 'questions-english');

const PHASE1_GRADES = [3, 4];

// ============ 种子载入校验（2.1 校验器全量通过） ============

describe('种子题库载入校验（全部经 2.1 校验合法）', () => {
  it('三个题库 JSON 载入均 0 错误，且题量符合种子规模', () => {
    expect(chineseBank.errors).toHaveLength(0);
    expect(mathBank.errors).toHaveLength(0);
    expect(englishBank.errors).toHaveLength(0);
    expect(chineseBank.questions).toHaveLength(56);
    expect(mathBank.questions).toHaveLength(78);
    expect(englishBank.questions).toHaveLength(101);
  });

  it('每道原始题目单独经 validateQuestion 校验均为合法题', () => {
    const allRaw = [
      ...chineseJson.questions,
      ...mathJson.questions,
      ...englishJson.questions,
    ];
    for (const raw of allRaw) {
      const r = validateQuestion(raw);
      expect(r.ok, `${(raw as { id?: string }).id ?? '<unknown>'} 校验失败`).toBe(true);
    }
    expect(allRaw).toHaveLength(56 + 78 + 101);
  });
});

// ============ 语文种子（Req 6.1, 6.2, 13.8） ============

describe('语文种子题库', () => {
  const CHINESE_TYPES = [
    'dictation',
    'pinyin',
    'similar_char',
    'polyphone',
    'word_match',
    'idiom_fill',
    'poem_chain',
  ];

  it('七类基础题型齐全（Req 6.2）', () => {
    const types = new Set(chineseBank.questions.map((q) => q.type));
    for (const t of CHINESE_TYPES) {
      expect(types.has(t as (typeof chineseBank.questions)[number]['type']), `缺少题型 ${t}`).toBe(
        true
      );
    }
    expect(types.size).toBe(CHINESE_TYPES.length);
  });

  it('按年级/册/单元组织（Req 6.1）：volume ∈ A/B 且 unit 非空', () => {
    for (const q of chineseBank.questions) {
      expect(['A', 'B']).toContain(q.volume);
      expect(q.unit.trim().length).toBeGreaterThan(0);
    }
  });

  it('仅覆盖三、四年级（Req 13.8）', () => {
    const grades = new Set(chineseBank.questions.map((q) => q.grade));
    for (const g of grades) {
      expect(PHASE1_GRADES).toContain(g);
    }
    for (const g of PHASE1_GRADES) {
      expect(grades.has(g), `缺少 ${g} 年级语文题`).toBe(true);
    }
  });
});

// ============ 数学种子（Req 7.1, 7.2, 13.8） ============

/**
 * 人教版三四年级 26 个单元与种子 knowledgePointId 的对应关系（Req 7.1）。
 * 种子 JSON 不存储单元中文名，契约以"单元 → 知识点集合"表达：
 * 每个单元至少有 1 道题、每个知识点至少有 1 道题，且种子不出现该表之外的知识点。
 */
const MATH_UNIT_COVERAGE: Record<3 | 4, Array<{ name: string; kps: string[] }>> = {
  3: [
    { name: '时分秒', kps: ['math.g3.time.hms'] },
    { name: '测量', kps: ['math.g3.measure'] },
    {
      name: '万以内加减法',
      kps: ['math.g3.add.within10000', 'math.g3.sub.within10000', 'math.g3.addsub.within10000'],
    },
    { name: '倍的认识', kps: ['math.g3.times'] },
    { name: '多位数乘一位数', kps: ['math.g3.mul.multi1'] },
    { name: '长方形和正方形的周长', kps: ['math.g3.perimeter.rect'] },
    { name: '分数的初步认识', kps: ['math.g3.fraction.intro'] },
    { name: '位置与方向', kps: ['math.g3.position.direction'] },
    { name: '除数是一位数的除法', kps: ['math.g3.div.1digit'] },
    { name: '两位数乘两位数', kps: ['math.g3.mul.2digit'] },
    { name: '面积', kps: ['math.g3.area'] },
    { name: '年月日', kps: ['math.g3.date.ymd'] },
    { name: '小数的初步认识', kps: ['math.g3.decimal.intro'] },
  ],
  4: [
    { name: '大数的认识', kps: ['math.g4.bignum'] },
    { name: '公顷和平方千米', kps: ['math.g4.area.land'] },
    { name: '角的度量', kps: ['math.g4.angle'] },
    { name: '三位数乘两位数', kps: ['math.g4.mul.3x2'] },
    { name: '平行四边形和梯形', kps: ['math.g4.quad'] },
    { name: '除数是两位数的除法', kps: ['math.g4.div.2digit'] },
    { name: '四则运算', kps: ['math.g4.arithmetic.order'] },
    { name: '运算定律', kps: ['math.g4.arithmetic.laws'] },
    { name: '小数的意义和性质', kps: ['math.g4.decimal.meaning'] },
    { name: '小数的加减法', kps: ['math.g4.decimal.add', 'math.g4.decimal.sub'] },
    { name: '三角形', kps: ['math.g4.triangle'] },
    { name: '平均数与条形统计图', kps: ['math.g4.average'] },
    { name: '数学广角鸡兔同笼', kps: ['math.g4.chickenrabbit'] },
  ],
};

describe('数学种子题库', () => {
  it.each([3, 4] as const)('%d 年级覆盖全部 13 个单元的知识点（Req 7.1）', (grade) => {
    const units = MATH_UNIT_COVERAGE[grade];
    expect(units).toHaveLength(13);

    const gradeQuestions = mathBank.questions.filter((q) => q.grade === grade);
    const usedKps = new Set(gradeQuestions.map((q) => q.knowledgePointId));
    const expectedKps = units.flatMap((u) => u.kps);

    // 每个单元至少有 1 道题
    for (const unit of units) {
      const covered = unit.kps.some((kp) => usedKps.has(kp));
      expect(covered, `${grade} 年级单元「${unit.name}」没有任何题目`).toBe(true);
    }
    // 每个知识点至少有 1 道题
    for (const kp of expectedKps) {
      expect(usedKps.has(kp), `知识点 ${kp} 没有任何题目`).toBe(true);
    }
    // 种子不出现该表之外的知识点（契约边界）
    expect([...usedKps].sort()).toEqual([...expectedKps].sort());

    // 13 个不同的（册|单元）组合
    const unitCombos = new Set(gradeQuestions.map((q) => `${q.volume}|${q.unit}`));
    expect(unitCombos.size).toBe(13);
  });

  it('六类题型齐全：题库覆盖填空/判断/选择/单位换算/几何计算，口算速算由生成器参数覆盖（Req 7.2）', () => {
    const bankTypes = new Set(mathBank.questions.map((q) => q.type));
    for (const t of ['blank', 'judge', 'choice', 'unit_conv', 'geometry']) {
      expect(bankTypes.has(t as (typeof mathBank.questions)[number]['type']), `题库缺少题型 ${t}`).toBe(
        true
      );
    }
    // 口算速算（oral）为程序化生成，由 generators-math.json 的 GeneratorParams 覆盖
    expect(generatorsJson.generators.length).toBeGreaterThan(0);
    const allTypes = new Set([...bankTypes, 'oral']);
    expect([...allTypes].sort()).toEqual(
      ['blank', 'choice', 'geometry', 'judge', 'oral', 'unit_conv'].sort()
    );
  });

  it('仅覆盖三、四年级（Req 13.8）', () => {
    const grades = new Set(mathBank.questions.map((q) => q.grade));
    for (const g of grades) {
      expect(PHASE1_GRADES).toContain(g);
    }
    for (const g of PHASE1_GRADES) {
      expect(grades.has(g), `缺少 ${g} 年级数学题`).toBe(true);
    }
  });
});

// ============ 英语种子（Req 8.1, 8.2, 13.8） ============

describe('英语种子题库', () => {
  it('全部为单词记忆卡题型，且每张卡含图片与发音音频（Req 8.2）', () => {
    for (const q of englishBank.questions) {
      expect(q.type).toBe('word_card');
      expect(typeof q.media?.image === 'string' && q.media.image.length > 0, `${q.id} 缺图片`).toBe(
        true
      );
      expect(typeof q.media?.audio === 'string' && q.media.audio.length > 0, `${q.id} 缺音频`).toBe(
        true
      );
    }
  });

  it('每张卡可提取拼写：至少一个拼写选项文本或题干含英文单词（Req 8.2）', () => {
    const hasLetters = (s: string): boolean => /[a-zA-Z]+/.test(s);
    for (const q of englishBank.questions) {
      const fromOptions = (q.options ?? []).some((o) => typeof o.text === 'string' && hasLetters(o.text));
      const fromStem = hasLetters(q.stem);
      expect(fromOptions || fromStem, `${q.id} 无法提取拼写`).toBe(true);
    }
  });

  it('按年级/册/Module 组织（Req 8.1）：volume ∈ A/B 且 unit 为 m{数字} 形式', () => {
    for (const q of englishBank.questions) {
      expect(['A', 'B']).toContain(q.volume);
      expect(q.unit, `${q.id} 的 unit 非 Module 形式`).toMatch(/^m\d+$/i);
    }
  });

  it('仅覆盖三、四年级（Req 13.8）', () => {
    const grades = new Set(englishBank.questions.map((q) => q.grade));
    for (const g of grades) {
      expect(PHASE1_GRADES).toContain(g);
    }
    for (const g of PHASE1_GRADES) {
      expect(grades.has(g), `缺少 ${g} 年级英语题`).toBe(true);
    }
  });
});

// ============ 题型枚举二期扩展（Req 13.4） ============

describe('题型枚举二期扩展', () => {
  it('PHASE2_QUESTION_TYPES 恰为 reading/word_problem/read_aloud 三类（Req 13.4）', () => {
    expect([...PHASE2_QUESTION_TYPES]).toEqual(['reading', 'word_problem', 'read_aloud']);
  });

  it('题型字段支持扩展表示二期题型：三类二期题均通过 2.1 校验（Req 13.4）', () => {
    for (const type of PHASE2_QUESTION_TYPES) {
      const raw = makeRawQuestion({ id: `phase2-${type}`, type, phase: 2 });
      const r = validateQuestion(raw);
      expect(r.ok, `二期题型 ${type} 未通过题型枚举校验`).toBe(true);
    }
  });
});

// ============ 二期题型不入今日队列（Req 13.7） ============

/** 构造一道可通过 2.1 校验的原始题目（用于契约测试的混合题库） */
function makeRawQuestion(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'test-q-1',
    subject: 'chinese',
    grade: 3,
    volume: 'A',
    unit: 'u1',
    type: 'dictation',
    knowledgePointId: 'test.kp.1',
    difficulty: 1,
    stem: '测试题干',
    answer: { choice: ['a'] },
    hint: '测试提示',
    analysis: '测试解析',
    phase: 1,
    ...overrides,
  };
}

const SESSION_CONFIG: SessionConfig = {
  groupSize: 3,
  levelTargetMs: 10 * 60 * 1000,
  maxNewPerSession: 50,
  maxReviewPerSession: 50,
};

describe('phase=2 题目不入今日队列', () => {
  // 混合题库：正常一期题 + 标注 phase=2 的二期题 + 误标 phase=1 的二期题型 + 标注 phase=2 的一期题型
  const mixedRaw = [
    makeRawQuestion({ id: 'q-normal', knowledgePointId: 'test.kp.normal' }),
    makeRawQuestion({
      id: 'q-reading',
      type: 'reading',
      phase: 2,
      knowledgePointId: 'test.kp.reading',
    }),
    makeRawQuestion({
      id: 'q-word-problem-mislabeled',
      subject: 'math',
      type: 'word_problem',
      phase: 1,
      knowledgePointId: 'test.kp.wordproblem',
    }),
    makeRawQuestion({
      id: 'q-dictation-phase2',
      type: 'dictation',
      phase: 2,
      knowledgePointId: 'test.kp.dictation2',
    }),
  ];
  const loaded = loadSeed({ questions: mixedRaw }, 'mixed');
  const index = buildQuestionIndex(loaded.questions);

  it('混合题库载入 0 错误（二期题型载入但不入队）', () => {
    expect(loaded.errors).toHaveLength(0);
    expect(loaded.questions).toHaveLength(4);
  });

  it('isQueueEligible：phase=2 或二期题型均不可入队，且双重判定互相独立（Req 13.7）', () => {
    const byId = index.byId;
    expect(isQueueEligible(byId.get('q-normal')!)).toBe(true);
    expect(isQueueEligible(byId.get('q-reading')!)).toBe(false);
    // 二期题型即使误标 phase=1 也不入队
    expect(isQueueEligible(byId.get('q-word-problem-mislabeled')!)).toBe(false);
    // 一期题型标注 phase=2 同样不入队
    expect(isQueueEligible(byId.get('q-dictation-phase2')!)).toBe(false);
  });

  it('索引划分：queueEligible 仅含一期题，deferred 含全部二期相关题（Req 13.7）', () => {
    expect(index.queueEligible.map((q) => q.id)).toEqual(['q-normal']);
    expect(index.deferred.map((q) => q.id).sort()).toEqual([
      'q-dictation-phase2',
      'q-reading',
      'q-word-problem-mislabeled',
    ]);
  });

  it('buildTodayQueue 输出绝不包含 phase=2 或二期题型题目（Req 13.7）', () => {
    const queue = buildTodayQueue({}, index, Date.now(), SESSION_CONFIG, []);
    expect(queue.map((item) => item.questionId)).toEqual(['q-normal']);
    for (const item of queue) {
      expect(PHASE2_QUESTION_TYPES.includes(item.type)).toBe(false);
      if (item.questionId) {
        const q = index.byId.get(item.questionId);
        expect(q?.phase).toBe(1);
      }
    }
  });
});

// ============ 收集品种子（12 件：6 宠物 + 6 装饰） ============

describe('收集品种子清单', () => {
  it('collectibles.json 恰为 12 件：6 宠物 + 6 装饰', () => {
    const items = collectiblesJson.items;
    expect(items).toHaveLength(12);
    expect(items.filter((i) => i.kind === 'pet')).toHaveLength(6);
    expect(items.filter((i) => i.kind === 'decoration')).toHaveLength(6);
  });

  it('种子 id 与 COLLECTIBLE_ITEMS 常量一一对应（id 与 kind 一致）', () => {
    const seedIds = collectiblesJson.items.map((i) => i.id).sort();
    const constIds = COLLECTIBLE_ITEMS.map((i) => i.id).sort();
    expect(constIds).toEqual(seedIds);

    const seedKindById = new Map(collectiblesJson.items.map((i) => [i.id, i.kind]));
    for (const item of COLLECTIBLE_ITEMS) {
      expect(seedKindById.get(item.id), `${item.id} 的 kind 不一致`).toBe(item.kind);
    }
    expect(COLLECTIBLE_ITEMS).toHaveLength(12);
  });
});

// ============ 口算生成器参数种子（Req 7.3 结构契约） ============

describe('口算生成器参数种子', () => {
  const OPERATIONS = ['add', 'sub', 'mul', 'div', 'mixed'];

  it('每条 GeneratorParams 结构合法：必需字段齐全、operands 范围 min≤max、operation/answerFormat 取值合法', () => {
    const generators = generatorsJson.generators;
    expect(generators.length).toBeGreaterThan(0);

    for (const g of generators) {
      expect(typeof g.id === 'string' && g.id.length > 0, 'id 缺失').toBe(true);
      expect(
        typeof g.knowledgePointId === 'string' && g.knowledgePointId.length > 0,
        `${g.id} knowledgePointId 缺失`
      ).toBe(true);
      expect(PHASE1_GRADES, `${g.id} grade 非三四年级`).toContain(g.grade);
      expect(Number.isInteger(g.difficulty) && g.difficulty >= 1 && g.difficulty <= 5).toBe(true);
      expect(typeof g.template === 'string' && g.template.length > 0, `${g.id} template 缺失`).toBe(
        true
      );
      expect(OPERATIONS, `${g.id} operation 非法`).toContain(g.operation);
      expect(g.answerFormat).toBe('number');

      const operandEntries = Object.entries(g.operands);
      expect(operandEntries.length, `${g.id} 缺少 operands`).toBeGreaterThan(0);
      for (const [key, range] of operandEntries) {
        expect(typeof range.min === 'number' && typeof range.max === 'number').toBe(true);
        expect(range.min, `${g.id} operands.${key} min>max`).toBeLessThanOrEqual(range.max);
        expect(typeof range.integer === 'boolean').toBe(true);
        // 题干模板必须引用该操作数占位符
        expect(g.template, `${g.id} template 未引用 {${key}}`).toContain(`{${key}}`);
      }
    }
  });

  it('生成器知识点 id 不重复且 grade 仅覆盖三四年级（Req 13.8）', () => {
    const kpIds = generatorsJson.generators.map((g) => g.knowledgePointId);
    expect(new Set(kpIds).size).toBe(kpIds.length);
    const grades = new Set(generatorsJson.generators.map((g) => g.grade));
    for (const g of grades) {
      expect(PHASE1_GRADES).toContain(g);
    }
  });
});
