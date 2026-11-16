/**
 * Audio_Service Web Audio 音效与读音播放服务
 *
 * 依据 .kiro/specs/kids-learning-adventure/design.md 的
 * "模块职责 → Audio_Service" 与 "Error Handling" 章节实现。
 *
 * 契约（_Requirements: 6.3, 6.6, 8.3, 8.6, 8.7, 12.3, 12.4_）：
 * - Web Audio 合成音效：答对 / 答错（≤1 秒、不含人声、与答对音效不同）/
 *   星星 / 宝箱（Req 12.3, 12.4）。
 * - 生字与单词读音播放：通过 URL 播放，重听/重播不限次（重复调用
 *   playPronunciation 即为重播）（Req 6.3, 6.6, 8.3, 8.6）。
 * - TTS 朗读（speakText）：通过 Web Speech API（speechSynthesis）直接朗读
 *   给定文本，无需任何音频文件；语言按文本自动判定（含汉字→zh-CN，否则
 *   en-US），也可显式指定。重复调用即重播（先取消上一段），不限次数。
 * - 读音加载/播放或 TTS 朗读失败：抛出可捕获的 AudioPlaybackError，供调用方
 *   显示"音频播放失败"提示；不得阻塞作答（Req 8.7）。
 * - 音效不可用（Web Audio 缺失或被禁用，如 AudioContext undefined）：
 *   静默降级——不抛错、不阻塞任何交互（设计 Error Handling 表）。
 * - 环境依赖可注入：AudioContext 构造与 Audio 元素工厂均通过
 *   AudioEnvironment 注入，单元测试可 mock；模块为纯 TS，不依赖 Vue。
 */

// ============ 可注入环境抽象 ============

/** Web Audio 振荡器节点的最小接口子集（便于测试 mock） */
export interface OscillatorNodeLike {
  type: string;
  frequency: {
    value: number;
    setValueAtTime(value: number, time: number): void;
  };
  connect(destination: unknown): void;
  start(when?: number): void;
  stop(when?: number): void;
  onended: (() => void) | null;
}

/** Web Audio 增益节点的最小接口子集 */
export interface GainNodeLike {
  gain: {
    value: number;
    setValueAtTime(value: number, time: number): void;
    linearRampToValueAtTime(value: number, time: number): void;
  };
  connect(destination: unknown): void;
  disconnect(): void;
}

/** AudioContext 的最小接口子集 */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state: string;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
  resume(): Promise<void>;
}

/** HTMLAudioElement 的最小接口子集 */
export interface AudioElementLike {
  src: string;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
}

/** SpeechSynthesisUtterance 的最小接口子集（TTS，便于测试 mock） */
export interface SpeechUtteranceLike {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  onend: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** SpeechSynthesis 的最小接口子集（TTS） */
export interface SpeechSynthesisLike {
  speak(utterance: SpeechUtteranceLike): void;
  cancel(): void;
}

/**
 * 音频环境依赖（全部可注入）。
 * createAudioContext 返回 null 表示 Web Audio 不可用 → 音效静默降级。
 * createSpeechSynthesis 返回 null 表示 TTS 不可用 → speakText 抛 AudioPlaybackError。
 */
export interface AudioEnvironment {
  createAudioContext(): AudioContextLike | null;
  createAudioElement(src: string): AudioElementLike;
  createSpeechSynthesis(): SpeechSynthesisLike | null;
  createUtterance(text: string): SpeechUtteranceLike;
}

// ============ 错误类型 ============

/**
 * 读音播放失败错误（Req 8.7）。
 * 调用方 catch 后显示"音频播放失败"提示，作答流程不受影响。
 */
export class AudioPlaybackError extends Error {
  /** 播放失败的媒体 URL */
  readonly url: string;
  /** 原始错误（如有） */
  readonly cause: unknown;

  constructor(url: string, cause?: unknown) {
    super(`音频播放失败: ${url}`);
    this.name = 'AudioPlaybackError';
    this.url = url;
    this.cause = cause;
  }
}

// ============ 音效定义（Web Audio 合成，无音频文件依赖） ============

/** 音效名称 */
export type EffectName = 'correct' | 'wrong' | 'star' | 'treasure';

/** 单个合成音步：频率(Hz)、相对起始(秒)、时长(秒)、波形、音量 */
interface ToneStep {
  freq: number;
  start: number;
  duration: number;
  type: 'sine' | 'square' | 'triangle';
  volume: number;
}

/**
 * 音效配方：
 * - correct：C5→E5→G5 上行琶音，明亮欢快，总时长约 0.54 秒。
 * - wrong：A3→E3 下行低音乐句，方波钝音，总时长 0.6 秒（≤1 秒），
 *   纯合成器音色不含人声，与答对音效在音高走向与波形上均不同（Req 12.4）。
 * - star：C6→G6 清脆双音，总时长约 0.35 秒。
 * - treasure：E5→G5→B5→E6 四音上滑 + 长音收尾，总时长约 0.9 秒。
 */
const EFFECT_RECIPES: Record<EffectName, readonly ToneStep[]> = {
  correct: [
    { freq: 523.25, start: 0, duration: 0.15, type: 'sine', volume: 0.25 },
    { freq: 659.25, start: 0.12, duration: 0.15, type: 'sine', volume: 0.25 },
    { freq: 783.99, start: 0.24, duration: 0.3, type: 'sine', volume: 0.25 },
  ],
  wrong: [
    { freq: 220.0, start: 0, duration: 0.25, type: 'square', volume: 0.1 },
    { freq: 164.81, start: 0.2, duration: 0.4, type: 'square', volume: 0.1 },
  ],
  star: [
    { freq: 1046.5, start: 0, duration: 0.12, type: 'sine', volume: 0.2 },
    { freq: 1567.98, start: 0.1, duration: 0.25, type: 'triangle', volume: 0.2 },
  ],
  treasure: [
    { freq: 659.25, start: 0, duration: 0.12, type: 'sine', volume: 0.2 },
    { freq: 783.99, start: 0.1, duration: 0.12, type: 'sine', volume: 0.2 },
    { freq: 987.77, start: 0.2, duration: 0.12, type: 'sine', volume: 0.2 },
    { freq: 1318.51, start: 0.3, duration: 0.12, type: 'sine', volume: 0.2 },
    { freq: 1567.98, start: 0.42, duration: 0.45, type: 'triangle', volume: 0.2 },
  ],
};

/** 音效最长时长（秒），用于增益节点回收 */
const EFFECT_MAX_DURATION_S = 1;

/** TTS 朗读超时（毫秒）：超时未收到 onend/onerror 视为语音引擎不可用 */
const SPEECH_TIMEOUT_MS = 8000;

// ============ 默认环境（浏览器） ============

/** 默认 AudioContext 构造；不可用（含被禁用、构造抛错）时返回 null → 静默降级 */
function defaultCreateAudioContext(): AudioContextLike | null {
  const g = globalThis as {
    AudioContext?: new () => unknown;
    webkitAudioContext?: new () => unknown;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (typeof Ctor !== 'function') return null;
  try {
    return new Ctor() as AudioContextLike;
  } catch {
    return null;
  }
}

/** 默认 Audio 元素工厂 */
function defaultCreateAudioElement(src: string): AudioElementLike {
  return new Audio(src) as AudioElementLike;
}

/** 默认 SpeechSynthesis 获取；不可用（含老浏览器）时返回 null → speakText 抛错降级 */
function defaultCreateSpeechSynthesis(): SpeechSynthesisLike | null {
  const g = globalThis as { speechSynthesis?: SpeechSynthesisLike };
  return g.speechSynthesis ?? null;
}

/** 默认 utterance 工厂 */
function defaultCreateUtterance(text: string): SpeechUtteranceLike {
  return new SpeechSynthesisUtterance(text) as unknown as SpeechUtteranceLike;
}

const DEFAULT_ENV: AudioEnvironment = {
  createAudioContext: defaultCreateAudioContext,
  createAudioElement: defaultCreateAudioElement,
  createSpeechSynthesis: defaultCreateSpeechSynthesis,
  createUtterance: defaultCreateUtterance,
};

/** 按文本自动判定 TTS 朗读语言：含汉字 → zh-CN，否则 en-US */
export function detectSpeechLang(text: string): 'zh-CN' | 'en-US' {
  return /[一-鿿]/.test(text) ? 'zh-CN' : 'en-US';
}

// ============ Audio_Service ============

/** Audio_Service 对外接口 */
export interface AudioService {
  /**
   * 播放合成音效。音效不可用或播放失败时静默降级：
   * 不抛错、不阻塞交互（返回的 Promise 始终 resolve）。
   */
  playEffect(name: EffectName): Promise<void>;
  /**
   * 播放生字/单词读音。重复调用即重播，不限次数。
   * 加载或播放失败时 reject AudioPlaybackError，供调用方提示且不阻塞作答。
   */
  playPronunciation(url: string): Promise<void>;
  /**
   * TTS 朗读给定文本（Web Speech API，无需音频文件）。重复调用即重播，
   * 不限次数（先取消上一段）。lang 缺省按文本自动判定（汉字→zh-CN，
   * 否则 en-US）。TTS 不可用或朗读失败时 reject AudioPlaybackError，
   * 供调用方提示且不阻塞作答（Req 8.7）。
   */
  speakText(text: string, lang?: string): Promise<void>;
  /** 停止当前全部音效与读音 */
  stopAll(): void;
  /** 当前环境是否可播放合成音效（AudioContext 可用） */
  isEffectAvailable(): boolean;
}

/**
 * 创建 Audio_Service 实例。
 * env 可整体或部分注入；缺省项回退到浏览器默认环境。
 */
export function createAudioService(env: Partial<AudioEnvironment> = {}): AudioService {
  const environment: AudioEnvironment = { ...DEFAULT_ENV, ...env };

  /** AudioContext 惰性创建；null 表示已判定不可用（本次会话静默降级） */
  let audioCtx: AudioContextLike | null | undefined;
  /** 当前活动振荡器（音效），用于 stopAll */
  const activeOscillators = new Set<OscillatorNodeLike>();
  /** 当前读音元素（同一时刻只保留一个，重播前先停旧） */
  let currentPronunciation: AudioElementLike | null = null;
  /** 当前 TTS utterance（同一时刻只保留一段，重播前先取消旧的） */
  let currentUtterance: SpeechUtteranceLike | null = null;

  function getAudioContext(): AudioContextLike | null {
    if (audioCtx === undefined) {
      try {
        audioCtx = environment.createAudioContext();
      } catch {
        audioCtx = null; // 构造抛错同样视为不可用，静默降级
      }
    }
    return audioCtx;
  }

  function stopPronunciation(): void {
    if (currentPronunciation !== null) {
      try {
        currentPronunciation.pause();
      } catch {
        // 停止失败无害，忽略
      }
      currentPronunciation = null;
    }
  }

  async function playEffect(name: EffectName): Promise<void> {
    // 静默降级：任何一步失败都吞掉，绝不 reject（设计 Error Handling 表）
    try {
      const ctx = getAudioContext();
      if (ctx === null) return;

      // 浏览器自动播放策略下 context 可能处于 suspended，尝试恢复
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => undefined);
      }

      const recipe = EFFECT_RECIPES[name];
      const baseTime = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);

      for (const step of recipe) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = step.type;
        osc.frequency.setValueAtTime(step.freq, baseTime + step.start);
        // 简单包络：淡入 5ms，末尾线性淡出到 0，避免爆音
        const t0 = baseTime + step.start;
        const t1 = t0 + step.duration;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(step.volume, t0 + 0.005);
        gain.gain.linearRampToValueAtTime(0, t1);
        osc.connect(gain);
        gain.connect(master);
        activeOscillators.add(osc);
        osc.onended = () => {
          activeOscillators.delete(osc);
        };
        osc.start(t0);
        osc.stop(t1 + 0.01);
      }

      // 音效最长 1 秒后断开主增益，释放资源
      setTimeout(() => {
        try {
          master.disconnect();
        } catch {
          // 忽略
        }
      }, EFFECT_MAX_DURATION_S * 1000 + 50);
    } catch {
      // 音效播放失败：静默降级，不阻塞任何交互
    }
  }

  async function playPronunciation(url: string): Promise<void> {
    stopPronunciation();
    let element: AudioElementLike;
    try {
      element = environment.createAudioElement(url);
    } catch (cause) {
      throw new AudioPlaybackError(url, cause);
    }
    currentPronunciation = element;
    try {
      await element.play();
    } catch (cause) {
      if (currentPronunciation === element) currentPronunciation = null;
      throw new AudioPlaybackError(url, cause);
    }
  }

  /** 停止当前 TTS 朗读（清回调后 cancel，避免取消事件触发 reject） */
  function stopSpeaking(): void {
    if (currentUtterance === null) return;
    const utterance = currentUtterance;
    currentUtterance = null;
    utterance.onend = null;
    utterance.onerror = null;
    try {
      environment.createSpeechSynthesis()?.cancel();
    } catch {
      // 取消失败无害，忽略
    }
  }

  async function speakText(text: string, lang?: string): Promise<void> {
    stopSpeaking();
    let synthesis: SpeechSynthesisLike | null;
    try {
      synthesis = environment.createSpeechSynthesis();
    } catch (cause) {
      throw new AudioPlaybackError(text, cause);
    }
    if (synthesis === null) {
      // TTS 不可用（老浏览器/jsdom）：按失败降级，由调用方提示且不阻塞作答
      throw new AudioPlaybackError(text);
    }
    let utterance: SpeechUtteranceLike;
    try {
      utterance = environment.createUtterance(text);
    } catch (cause) {
      throw new AudioPlaybackError(text, cause);
    }
    utterance.text = text;
    utterance.lang = lang ?? detectSpeechLang(text);
    utterance.rate = 0.9; // 语速稍慢，适合儿童听辨
    utterance.pitch = 1;
    currentUtterance = utterance;
    await new Promise<void>((resolve, reject) => {
      // 部分浏览器语音引擎不可用时会把 utterance 静默挂起（onend/onerror 均
      // 不触发），超时兜底：reject 让调用方显示提示，并 cancel 清理卡住的队列
      const timer = setTimeout(() => {
        utterance.onend = null;
        utterance.onerror = null;
        if (currentUtterance === utterance) currentUtterance = null;
        try {
          synthesis.cancel();
        } catch {
          // 忽略
        }
        reject(new AudioPlaybackError(text, new Error('TTS 朗读超时：浏览器语音引擎不可用或被拦截')));
      }, SPEECH_TIMEOUT_MS);
      utterance.onend = () => {
        clearTimeout(timer);
        if (currentUtterance === utterance) currentUtterance = null;
        resolve();
      };
      utterance.onerror = (event: unknown) => {
        clearTimeout(timer);
        if (currentUtterance === utterance) currentUtterance = null;
        reject(new AudioPlaybackError(text, event));
      };
      try {
        synthesis.speak(utterance);
      } catch (cause) {
        clearTimeout(timer);
        utterance.onend = null;
        utterance.onerror = null;
        if (currentUtterance === utterance) currentUtterance = null;
        reject(new AudioPlaybackError(text, cause));
      }
    });
  }

  function stopAll(): void {
    stopPronunciation();
    stopSpeaking();
    for (const osc of activeOscillators) {
      try {
        osc.onended = null;
        osc.stop();
      } catch {
        // 已停止的节点再次 stop 会抛错，忽略
      }
    }
    activeOscillators.clear();
  }

  function isEffectAvailable(): boolean {
    return getAudioContext() !== null;
  }

  return { playEffect, playPronunciation, speakText, stopAll, isEffectAvailable };
}

/** 应用内共享的默认实例（AudioContext 惰性创建，模块加载无副作用） */
export const audioService: AudioService = createAudioService();
