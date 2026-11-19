/**
 * 单元测试：英语排除与既有调用方回归（child-grade-setting 任务 3.7）
 *
 * 以真实种子题库与生成器调用 buildTodayQueue：
 * - Child_Grade=1 与 2 时输出队列不含任何 subject='english' 队列项（Req 2.5：
 *   外研版教材三年级起点，英语无一、二年级内容，通用年级过滤天然排除，
 *   无需学科特判）；
 * - 种子契约：全部英语题目与生成器 grade ≥ 3，与 multi-grade 契约
 *   SUBJECT_GRADES.english = [3,4,5,6] 同口径（Req 2.5）；
 * - 既有五参调用回归：第六参 childGrade=null 的输出与既有五参调用深相等（Req 3.1）。
 *
 * _Requirements: 2.5, 3.1_
 */

import { describe, it, expect } from 'vitest';

import chineseJson from '../../src/data/seed/questions-chinese.json';
import mathJson from '../../src/data/seed/questions-math.json';
import englishJson from '../../src/data/seed/questions-english.json';
import chineseG1Json from '../../src/data/seed/questions-chinese-g1.json';
import chineseG2Json from '../../src/data/seed/questions-chinese-g2.json';
import chineseG5Json from '../../src/data/seed/questions-chinese-g5.json';
import chineseG6Json from '../../src/data/seed/questions-chinese-g6.json';
import mathG1Json from '../../src/data/seed/questions-math-g1.json';
import mathG2Json from '../../src/data/seed/questions-math-g2.json';
import mathG5Json from '../../src/data/seed/questions-math-g5.json';
import mathG6Json from '../../src/data/seed/questions-math-g6.json';
import englishG5Json from '../../src/data/seed/questions-english-g5.json';
import englishG6Json from '../../src/data/seed/questions-english-g6.json';
import generatorsJson from '../../src/data/seed/generators-math.json';
import generatorsG1Json from '../../src/data/seed/generators-math-g1.json';
import generatorsG2Json from '../../src/data/seed/generators-math-g2.json';
import generatorsG5Json from '../../src/data/seed/generators-math-g5.json';
import generatorsG6Json from '../../src/data/seed/generators-math-g6.json';

import { loadQuestionBank, buildQuestionIndex } from '../../src/data/questionBank';
import { buildTodayQueue } from '../../src/engine/reviewEngine';
import { SUBJECT_GRADES } from '../../src/engine/gradeSelector';
import { kpIdSubject } from '../../src/engine/kpId';
import type {
  GeneratorParams,
  MasteryRecord,
  Question,
  QueueItem,
  SessionConfig,
} from '../../src/types';

// ============ 真实种子加载（与 src/stores/appState.ts loadSeedBank 同源同序） ============

function loadSeed(raw: unknown, label: string): Question[] {
  const result = loadQuestionBank(JSON.stringify(raw));
  if ('fatal' in result) {
    throw new Error(`${label} 题库整体加载失败（fatal）：${result.fatal}`);
  }
  return result.questions;
}

const allQuestions: Question[] = [
  ...loadSeed(chineseJson, 'questions-chinese'),
  ...loadSeed(mathJson, 'questions-math'),
  ...loadSeed(englishJson, 'questions-english'),
  ...loadSeed(chineseG1Json, 'questions-chinese-g1'),
  ...loadSeed(chineseG2Json, 'questions-chinese-g2'),
  ...loadSeed(chineseG5Json, 'questions-chinese-g5'),
  ...loadSeed(chineseG6Json, 'questions-chinese-g6'),
  ...loadSeed(mathG1Json, 'questions-math-g1'),
  ...loadSeed(mathG2Json, 'questions-math-g2'),
  ...loadSeed(mathG5Json, 'questions-math-g5'),
  ...loadSeed(mathG6Json, 'questions-math-g6'),
  ...loadSeed(englishG5Json, 'questions-english-g5'),
  ...loadSeed(englishG6Json, 'questions-english-g6'),
];

const bank = buildQuestionIndex(allQuestions);

const generators: GeneratorParams[] = [
  generatorsJson,
  generatorsG1Json,
  generatorsG2Json,
  generatorsG5Json,
  generatorsG6Json,
].flatMap((raw) => (raw as { generators: GeneratorParams[] }).generators);

/** 会话配置（与 appState.SESSION_CONFIG 口径一致：复习/新知识点各上限 50） */
const SESSION_CONFIG: SessionConfig = {
  groupSize: 3,
  levelTargetMs: 10 * 60 * 1000,
  maxNewPerSession: 50,
  maxReviewPerSession: 50,
};

const NOW = Date.now();

// ============ 断言辅助 ============

/** 解析队列项的年级：题库项查 byId，生成器项查生成器参数 */
function itemGrade(item: QueueItem): number {
  if (item.kind === 'bank') {
    const q = bank.byId.get(item.questionId as string);
    if (!q) throw new Error(`队列项题目 ${item.questionId} 不在题库中`);
    return q.grade;
  }
  const gen = generators.find((g) => g.id === item.generatorParamsId);
  if (!gen) throw new Error(`队列项生成器 ${item.generatorParamsId} 不在生成器集合中`);
  return gen.grade;
}

/** 取一个真实英语知识点 id（种子中英语题必存在，grade ≥ 3） */
function someEnglishKpId(): string {
  const q = allQuestions.find((q) => q.subject === 'english');
  if (!q) throw new Error('种子题库缺少英语题');
  return q.knowledgePointId;
}

/** 构造到点未掌握的掌握度记录 */
function dueRecord(knowledgePointId: string): MasteryRecord {
  return {
    knowledgePointId,
    level: 1,
    totalCorrect: 1,
    totalWrong: 0,
    nextReviewAt: NOW - 1000,
    mastered: false,
    lastAnswerAt: NOW - 2000,
  };
}

// ============ 英语种子契约：grade ≥ 3（Req 2.5，与 multi-grade 契约同口径） ============

describe('英语种子契约（Req 2.5）', () => {
  it('multi-grade 契约：英语可选年级为 [3,4,5,6]，不含一、二年级', () => {
    expect([...SUBJECT_GRADES.english]).toEqual([3, 4, 5, 6]);
    expect(Math.min(...SUBJECT_GRADES.english)).toBe(3);
  });

  it('全部英语题目 grade ≥ 3（种子无一、二年级英语题）', () => {
    const englishQuestions = allQuestions.filter((q) => q.subject === 'english');
    expect(englishQuestions.length).toBeGreaterThan(0);
    for (const q of englishQuestions) {
      expect(q.grade, `英语题 ${q.id} 年级 ${q.grade} 应 ≥ 3`).toBeGreaterThanOrEqual(3);
    }
  });

  it('全部英语生成器 grade ≥ 3（种子生成器均为数学口算，无英语生成器）', () => {
    expect(generators.length).toBeGreaterThan(0);
    for (const g of generators) {
      if (kpIdSubject(g.knowledgePointId) === 'english') {
        expect(g.grade, `英语生成器 ${g.id} 年级 ${g.grade} 应 ≥ 3`).toBeGreaterThanOrEqual(3);
      } else {
        expect(kpIdSubject(g.knowledgePointId)).toBe('math');
      }
    }
  });
});

// ============ Child_Grade=1/2 时队列不含英语队列项（Req 2.5） ============

describe('Child_Grade=1/2 的今日队列英语排除（Req 2.5）', () => {
  it.each([1, 2])('childGrade=%i 时队列非空、无任何 subject=english 项且各项年级 ≤ %i', (childGrade) => {
    // 复习段也构造到点英语记录：过滤须同时覆盖复习段与新知识点段
    const records: Record<string, MasteryRecord> = {
      [someEnglishKpId()]: dueRecord(someEnglishKpId()),
    };
    const queue = buildTodayQueue(records, bank, NOW, SESSION_CONFIG, generators, childGrade);

    // 非平凡性前置：g1/g2 语文数学内容使队列非空
    expect(queue.length).toBeGreaterThan(0);
    for (const item of queue) {
      expect(item.subject, `队列项 ${item.knowledgePointId} 不应为英语`).not.toBe('english');
      expect(itemGrade(item), `队列项 ${item.knowledgePointId} 年级应 ≤ ${childGrade}`).toBeLessThanOrEqual(childGrade);
    }
  });

  it('未过滤（未设置）时同一到点英语记录会进入队列（对照：排除来自 childGrade 过滤）', () => {
    const records: Record<string, MasteryRecord> = {
      [someEnglishKpId()]: dueRecord(someEnglishKpId()),
    };
    const unfiltered = buildTodayQueue(records, bank, NOW, SESSION_CONFIG, generators);
    const englishItems = unfiltered.filter((item) => item.subject === 'english');
    expect(englishItems.length).toBeGreaterThan(0);
    // 复习段在前：到点英语记录应为首个队列项
    expect(unfiltered[0].subject).toBe('english');
    expect(unfiltered[0].source).toBe('review');

    const filtered1 = buildTodayQueue(records, bank, NOW, SESSION_CONFIG, generators, 1);
    const filtered2 = buildTodayQueue(records, bank, NOW, SESSION_CONFIG, generators, 2);
    expect(filtered1.some((item) => item.subject === 'english')).toBe(false);
    expect(filtered2.some((item) => item.subject === 'english')).toBe(false);
  });
});

// ============ 既有五参调用回归（Req 3.1） ============

describe('既有五参调用回归（Req 3.1）', () => {
  it('第六参 childGrade=null 与既有五参调用输出深相等（空记录）', () => {
    const legacy = buildTodayQueue({}, bank, NOW, SESSION_CONFIG, generators);
    const withNull = buildTodayQueue({}, bank, NOW, SESSION_CONFIG, generators, null);
    expect(withNull).toEqual(legacy);
    expect(legacy.length).toBeGreaterThan(0);
  });

  it('第六参 childGrade=null 与既有五参调用输出深相等（含到点复习记录）', () => {
    const records: Record<string, MasteryRecord> = {
      [someEnglishKpId()]: dueRecord(someEnglishKpId()),
    };
    const legacy = buildTodayQueue(records, bank, NOW, SESSION_CONFIG, generators);
    const withNull = buildTodayQueue(records, bank, NOW, SESSION_CONFIG, generators, null);
    expect(withNull).toEqual(legacy);
  });
});
