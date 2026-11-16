/**
 * kids-learning-adventure 核心类型与常量
 *
 * 依据 .kiro/specs/kids-learning-adventure/design.md 的
 * "Components and Interfaces" 与 "Data Models" 章节定义。
 * 所有下游任务（引擎层、数据层、UI 层）统一从本文件导入类型。
 */

// ============ 基础枚举 ============

/** 学科标识 */
export type Subject = 'chinese' | 'math' | 'english';

/** 册别：A=上册 B=下册 */
export type Volume = 'A' | 'B';

/** 难度等级：整数 1-5 */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

/**
 * 题型枚举。
 * 一期题型 phase=1 入今日队列；二期预留题型 phase=2 载入但不入队。
 *
 * | 学科    | 一期题型                                                          | 二期预留      |
 * | chinese | dictation/pinyin/similar_char/polyphone/word_match/idiom_fill/poem_chain | reading       |
 * | math    | oral/blank/judge/choice/unit_conv/geometry                          | word_problem  |
 * | english | word_card                                                         | read_aloud    |
 */
export type QuestionType =
  // 语文（一期）
  | 'dictation'    // 生字听写
  | 'pinyin'       // 拼音选择
  | 'similar_char' // 形近字辨析
  | 'polyphone'    // 多音字辨析
  | 'word_match'   // 词语搭配
  | 'idiom_fill'   // 成语填空
  | 'poem_chain'   // 古诗文接龙
  // 语文（二期预留）
  | 'reading'      // 阅读理解
  // 数学（一期）
  | 'oral'         // 口算速算（由生成器产出）
  | 'blank'        // 填空
  | 'judge'        // 判断
  | 'choice'       // 选择
  | 'unit_conv'    // 单位换算
  | 'geometry'     // 几何计算
  // 数学（二期预留）
  | 'word_problem' // 多步骤应用题
  // 英语（一期）
  | 'word_card'    // 单词记忆卡
  // 英语（二期预留）
  | 'read_aloud';  // 跟读评分

/** 二期预留题型集合（phase=2，载入但不入今日队列） */
export const PHASE2_QUESTION_TYPES: readonly QuestionType[] = [
  'reading',
  'word_problem',
  'read_aloud',
];

// ============ 复习引擎：间隔级别与掌握度 ============

/** 间隔级别 1-5（10 分钟 / 1 天 / 3 天 / 7 天 / 15 天） */
export type IntervalLevel = 1 | 2 | 3 | 4 | 5;

/** 各级别对应的复习间隔（毫秒） */
export const INTERVALS_MS: Record<IntervalLevel, number> = {
  1: 10 * 60 * 1000,        // 10 分钟
  2: 1 * 24 * 3600 * 1000,  // 1 天
  3: 3 * 24 * 3600 * 1000,  // 3 天
  4: 7 * 24 * 3600 * 1000,  // 7 天
  5: 15 * 24 * 3600 * 1000, // 15 天
};

/** 知识点掌握度记录（Mastery_Record） */
export interface MasteryRecord {
  knowledgePointId: string;
  level: IntervalLevel;
  totalCorrect: number;
  totalWrong: number;
  /** 下次复习时间戳；已掌握为 null */
  nextReviewAt: number | null;
  mastered: boolean;
  lastAnswerAt: number;
}

// ============ 题库：Question 与 GeneratorParams ============

/** 题目媒体资源 */
export interface QuestionMedia {
  audio?: string;
  image?: string;
}

/** 题目选项 */
export interface QuestionOption {
  id: string;
  text?: string;
  image?: string;
}

/**
 * 标准答案，按题型取其中一种形态：
 * - choice：点选型（拼音选择/多音字/判断以外的选择/单词卡 4 选 1 等），正确选项 id 列表
 * - order：排序/接龙型（古诗文接龙等），有序 id 列表
 * - pairs：配对/拖拽型（词语搭配/成语填空/形近字辨析/单位换算等），左槽 id → 右槽 id
 * - number：数值型（口算速算/填空/几何计算）
 * - bool：判断型
 */
export interface QuestionAnswer {
  choice?: string[];
  order?: string[];
  pairs?: Record<string, string>;
  number?: number;
  bool?: boolean;
}

/** 题库题目（题库 JSON Schema 的 Question） */
export interface Question {
  id: string;
  subject: Subject;
  /** 整数 1-6，一期种子仅覆盖 3-4 年级 */
  grade: number;
  volume: Volume;
  /** 单元/Module 标识 */
  unit: string;
  type: QuestionType;
  knowledgePointId: string;
  difficulty: Difficulty;
  stem: string;
  media?: QuestionMedia;
  options?: QuestionOption[];
  answer: QuestionAnswer;
  hint: string;
  /** 不超过 100 字的解析 */
  analysis: string;
  /** 1=一期可用；2=二期题型（载入但跳过，不入今日队列） */
  phase: 1 | 2;
}

/** 口算生成器操作数的取值范围 */
export interface OperandRange {
  min: number;
  max: number;
  integer: boolean;
}

/** 口算生成器约束 */
export interface GeneratorConstraints {
  /** 减法不许负数 */
  resultMin?: number;
  resultMax?: number;
  /** 除法是否要求整除 */
  divisible?: boolean;
  /** 结果小数位上限 */
  decimalPlaces?: number;
}

export type OralOperation = 'add' | 'sub' | 'mul' | 'div' | 'mixed';

/** 数学口算生成器参数（按知识点配置，题库 JSON 的 GeneratorParams） */
export interface GeneratorParams {
  id: string;
  knowledgePointId: string;
  grade: number;
  difficulty: Difficulty;
  /** 题干模板，如 "{a} + {b} = ?" */
  template: string;
  operands: Record<string, OperandRange>;
  operation: OralOperation;
  constraints?: GeneratorConstraints;
  answerFormat: 'number';
}

/** 口算生成器产出物（与题库题走同一判定与复习管线） */
export interface GeneratedQuestion {
  /** 生成器签名：gen:{paramsId}:{operandsHash} */
  signature: string;
  generatorParamsId: string;
  knowledgePointId: string;
  subject: 'math';
  type: 'oral';
  difficulty: Difficulty;
  /** 已代入数值的题干文本 */
  stem: string;
  operands: Record<string, number>;
  answer: number;
}

// ============ 冒险引擎：会话与队列 ============

/** 今日队列项 */
export interface QueueItem {
  kind: 'bank' | 'generated';
  /** kind=bank 时的题库题 id */
  questionId?: string;
  /** kind=generated（口算）时的生成器参数 id */
  generatorParamsId?: string;
  knowledgePointId: string;
  subject: Subject;
  type: QuestionType;
  difficulty: Difficulty;
  source: 'review' | 'new' | 'retry';
}

/** 单题作答结果（TodaySession.results 元素） */
export interface AnswerResult {
  /** 题库题 id 或生成器签名（gen:{paramsId}:{operandsHash}） */
  questionRef: string;
  knowledgePointId: string;
  /** 首次作答是否答对 */
  correct: boolean;
  /** 是否经历了重试 */
  retried: boolean;
  /** 本题发放星星数（首次答对 5 或 10，其余 0） */
  stars: number;
  answeredAt: number;
}

/** 会话配置 */
export interface SessionConfig {
  groupSize: 3;
  /** 关卡目标时长：10 分钟（10 * 60 * 1000 毫秒） */
  levelTargetMs: number;
  maxNewPerSession: number;
  maxReviewPerSession: number;
}

/** 今日会话（Today_Session） */
export interface TodaySession {
  /** 本地自然日 'YYYY-MM-DD' */
  date: string;
  /** 题目或生成器参数项 */
  queue: QueueItem[];
  /** 下一道未作答位置 */
  currentIndex: number;
  streak: number;
  consecutiveWrong: number;
  /** 连错 3 题后为 -1 */
  difficultyOffset: 0 | -1;
  levelStartedAt: number;
  elapsedMs: number;
  status: 'active' | 'done';
  results: AnswerResult[];
}

// ============ 星星、宝箱与收集 ============

/** 星星钱包（Star_Wallet） */
export interface StarWallet {
  balance: number;
  totalEarned: number;
}

/** 可收集物（6 宠物 + 6 装饰），kind 取值与种子数据 collectibles.json 一致 */
export interface CollectibleItem {
  id: string;
  name: string;
  kind: 'pet' | 'decoration';
}

/** 小岛收藏（Island_Collection），items 内任意物品至多出现一次 */
export interface IslandCollection {
  items: string[];
}

/** 开启一次宝箱消耗的星星数 */
export const TREASURE_BOX_COST = 30;

/** 宝箱产出重复物品时返还的星星数 */
export const DUPLICATE_REFUND_STARS = 5;

/** 12 件可收集物全集常量：6 宠物 + 6 装饰（id/名称/kind 与 src/data/seed/collectibles.json 一致） */
export const COLLECTIBLE_ITEMS: readonly CollectibleItem[] = [
  // 宠物（6）
  { id: 'pet-fox', name: '小狐狸', kind: 'pet' },
  { id: 'pet-panda', name: '大熊猫', kind: 'pet' },
  { id: 'pet-penguin', name: '小企鹅', kind: 'pet' },
  { id: 'pet-rabbit', name: '小白兔', kind: 'pet' },
  { id: 'pet-tiger', name: '小老虎', kind: 'pet' },
  { id: 'pet-dragon', name: '小龙', kind: 'pet' },
  // 装饰（6）
  { id: 'deco-lighthouse', name: '灯塔', kind: 'decoration' },
  { id: 'deco-treehouse', name: '树屋', kind: 'decoration' },
  { id: 'deco-fountain', name: '喷泉', kind: 'decoration' },
  { id: 'deco-rainbow-bridge', name: '彩虹桥', kind: 'decoration' },
  { id: 'deco-flower-garden', name: '花园', kind: 'decoration' },
  { id: 'deco-castle', name: '城堡', kind: 'decoration' },
] as const;

/** 可收集物总数（小岛页"已收集 N/12"计数） */
export const COLLECTIBLE_TOTAL = COLLECTIBLE_ITEMS.length;
