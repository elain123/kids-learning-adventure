/**
 * 音频失败降级、音效开关行为与答题反馈时序单元测试
 *
 * 覆盖：
 * - 读音重听/重播不限次（Req 6.6, 8.6）
 * - 读音加载/播放失败抛出可捕获 AudioPlaybackError，UI 可提示且作答不受影响（Req 8.7）
 * - 音效不可用（AudioContext 缺失/抛错）时静默降级（Req 12.3, 12.4 的降级路径）
 * - 答错提示音效 ≤1 秒、纯合成无人声、与答对音效不同（Req 12.4）
 * - 音效开关默认开、关闭即停播且后续全场景静音、重开恢复（Req 12.5, 12.6）
 * - 开关状态经 Local_Store settings 持久化，重启后恢复（Req 12.7）
 * - 反馈时序与形状：≤3 秒庆祝（Req 12.3）、首错仅 Hint（Req 4.1）、
 *   再错答案 + ≤100 字解析 + 鼓励 + 下一题入口（Req 4.2）
 * - 鼓励文案库不含批评/否定表述（Req 4.2）
 *
 * _Requirements: 4.1, 4.2, 6.3, 6.6, 8.3, 8.6, 8.7, 12.3, 12.4, 12.5, 12.6, 12.7_
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  AudioPlaybackError,
  createAudioService,
  type AudioContextLike,
  type AudioElementLike,
  type AudioEnvironment,
  type AudioService,
  type EffectName,
  type GainNodeLike,
  type OscillatorNodeLike,
} from '@/services/audioService';
import { CELEBRATION_DURATION_MS, createFeedbackService } from '@/services/feedback';
import {
  ENCOURAGEMENT_BANNED_WORDS,
  ENCOURAGEMENTS,
  pickEncouragement,
} from '@/data/encouragement';
import { createLocalStore, createMemoryStorage } from '@/data/localStore';

// ============ 可注入音频环境 mock ============

/** 记录调度信息的假振荡器 */
interface RecordedOsc {
  type: string;
  freq: number | null;
  startAt: number | null;
  stopAt: number | null;
}

interface RecordingContext extends AudioContextLike {
  oscillators: RecordedOsc[];
}

/** 记录型 AudioContext：捕获每个振荡器的波形、频率与调度起止时间 */
function createRecordingContext(): RecordingContext {
  const oscillators: RecordedOsc[] = [];
  return {
    currentTime: 0,
    destination: {},
    state: 'running',
    oscillators,
    createOscillator(): OscillatorNodeLike {
      const rec: RecordedOsc = { type: '', freq: null, startAt: null, stopAt: null };
      oscillators.push(rec);
      return {
        get type(): string {
          return rec.type;
        },
        set type(value: string) {
          rec.type = value;
        },
        frequency: {
          value: 0,
          setValueAtTime(value: number) {
            rec.freq = value;
          },
        },
        connect: () => undefined,
        start: (when = 0) => {
          rec.startAt = when;
        },
        stop: (when = 0) => {
          rec.stopAt = when;
        },
        onended: null,
      };
    },
    createGain(): GainNodeLike {
      return {
        gain: {
          value: 1,
          setValueAtTime: () => undefined,
          linearRampToValueAtTime: () => undefined,
        },
        connect: () => undefined,
        disconnect: () => undefined,
      };
    },
    resume: () => Promise.resolve(),
  };
}

/** 音效实际时长（秒）：stop 调度含 10ms 防截断缓冲，计算时扣除 */
function toneSpanSeconds(oscs: RecordedOsc[]): number {
  const start = Math.min(...oscs.map((o) => o.startAt ?? 0));
  const end = Math.max(...oscs.map((o) => (o.stopAt ?? 0) - 0.01));
  return end - start;
}

/** 音效配方签名：波形 + 频率 + 起始时间，用于比较两种音效是否不同 */
function recipeSignature(oscs: RecordedOsc[]): string {
  return oscs.map((o) => `${o.type}:${o.freq}@${o.startAt}`).join('|');
}

/** 记录型 Audio 元素：记录 play/pause 调用次数，play 可配置为失败 */
interface FakeAudioElement extends AudioElementLike {
  playCalls: number;
  pauseCalls: number;
}

function createFakeElement(options: { rejectPlay?: boolean } = {}): FakeAudioElement {
  const el: FakeAudioElement = {
    src: '',
    currentTime: 0,
    playCalls: 0,
    pauseCalls: 0,
    play() {
      el.playCalls += 1;
      return options.rejectPlay
        ? Promise.reject(new Error('NotAllowedError: play() 被拒绝'))
        : Promise.resolve();
    },
    pause() {
      el.pauseCalls += 1;
    },
  };
  return el;
}

/** 元素工厂 mock：逐个产出记录型元素，可用 rejectNext 让下一次 play 失败 */
function createElementFactory() {
  const elements: FakeAudioElement[] = [];
  let rejectNext = false;
  const createAudioElement = (src: string): FakeAudioElement => {
    const el = createFakeElement({ rejectPlay: rejectNext });
    rejectNext = false;
    el.src = src;
    elements.push(el);
    return el;
  };
  return {
    elements,
    createAudioElement,
    failNextPlay: () => {
      rejectNext = true;
    },
  };
}

/** Feedback_Service 用的 Audio_Service 全 mock */
function createMockAudio(): AudioService & {
  playEffect: Mock<[EffectName], Promise<void>>;
  stopAll: Mock<[], void>;
} {
  return {
    playEffect: vi.fn((_name: EffectName) => Promise.resolve()),
    playPronunciation: vi.fn(() => Promise.resolve()),
    speakText: vi.fn(() => Promise.resolve()),
    stopAll: vi.fn(),
    isEffectAvailable: vi.fn(() => true),
  };
}

// ============ 读音播放：重听/重播不限次（Req 6.6, 8.6） ============

describe('读音重听/重播不限次（Req 6.6, 8.6）', () => {
  it('连续多次调用 playPronunciation 每次都重新播放，且重播前先停旧读音', async () => {
    const factory = createElementFactory();
    const env: AudioEnvironment = {
      createAudioContext: () => null,
      createAudioElement: factory.createAudioElement,
      createSpeechSynthesis: () => null,
      createUtterance: (text) => ({ text, lang: '', rate: 1, pitch: 1, onend: null, onerror: null }),
    };
    const service = createAudioService(env);
    const url = 'audio/eng-g3-m1-apple.mp3';
    const REPLAYS = 5;

    for (let i = 0; i < REPLAYS; i++) {
      await service.playPronunciation(url);
    }

    // 每次重播都创建新元素并播放一次（不限次数）
    expect(factory.elements).toHaveLength(REPLAYS);
    for (const el of factory.elements) {
      expect(el.src).toBe(url);
      expect(el.playCalls).toBe(1);
    }
    // 每次重播前停掉上一个读音，同一时刻只有一个在播
    for (const el of factory.elements.slice(0, -1)) {
      expect(el.pauseCalls).toBe(1);
    }
  });

  it('stopAll 停止当前正在播放的读音', async () => {
    const factory = createElementFactory();
    const service = createAudioService({
      createAudioContext: () => null,
      createAudioElement: factory.createAudioElement,
    });
    await service.playPronunciation('audio/zi-qing.mp3');
    service.stopAll();
    expect(factory.elements[0].pauseCalls).toBe(1);
  });
});

// ============ 音频失败降级（Req 8.7） ============

describe('读音失败降级（Req 8.7）', () => {
  it('element.play() 拒绝时抛出可捕获的 AudioPlaybackError，携带失败 URL', async () => {
    const factory = createElementFactory();
    const service = createAudioService({
      createAudioContext: () => null,
      createAudioElement: factory.createAudioElement,
    });
    const url = 'audio/missing-word.mp3';
    factory.failNextPlay();

    const error = await service.playPronunciation(url).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AudioPlaybackError);
    const playbackError = error as AudioPlaybackError;
    expect(playbackError.url).toBe(url);
    expect(playbackError.message).toContain('音频播放失败');
  });

  it('createAudioElement 抛错（音频加载失败）同样抛出 AudioPlaybackError', async () => {
    const service = createAudioService({
      createAudioContext: () => null,
      createAudioElement: () => {
        throw new Error('网络资源加载失败');
      },
    });
    const url = 'audio/broken.mp3';

    const error = await service.playPronunciation(url).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AudioPlaybackError);
    expect((error as AudioPlaybackError).url).toBe(url);
  });

  it('UI 可捕获错误展示"音频播放失败"提示，且失败后服务仍可用（作答不受影响）', async () => {
    const factory = createElementFactory();
    const service = createAudioService({
      createAudioContext: () => createRecordingContext(),
      createAudioElement: factory.createAudioElement,
    });

    // 模拟 WordCard 的降级路径：catch 后展示提示，图片与拼写仍可看、可作答
    factory.failNextPlay();
    let uiHint: string | null = null;
    try {
      await service.playPronunciation('audio/word-1.mp3');
    } catch (error) {
      if (error instanceof AudioPlaybackError) uiHint = '音频播放失败';
    }
    expect(uiHint).toBe('音频播放失败');

    // 失败后读音服务仍可正常重播（不阻塞后续交互）
    await expect(service.playPronunciation('audio/word-2.mp3')).resolves.toBeUndefined();
    expect(factory.elements).toHaveLength(2);

    // 音效播放同样不受读音失败影响
    await expect(service.playEffect('correct')).resolves.toBeUndefined();
  });
});

// ============ 音效静默降级（Req 12.3, 12.4 降级路径） ============

describe('音效不可用静默降级（Req 12.3, 12.4 降级路径）', () => {
  it('createAudioContext 返回 null：playEffect 全部 resolve，isEffectAvailable 为 false', async () => {
    const service = createAudioService({ createAudioContext: () => null });
    expect(service.isEffectAvailable()).toBe(false);
    await expect(service.playEffect('correct')).resolves.toBeUndefined();
    await expect(service.playEffect('wrong')).resolves.toBeUndefined();
    await expect(service.playEffect('star')).resolves.toBeUndefined();
    await expect(service.playEffect('treasure')).resolves.toBeUndefined();
  });

  it('createAudioContext 构造抛错：同样静默降级不阻塞交互', async () => {
    const service = createAudioService({
      createAudioContext: () => {
        throw new Error('AudioContext 被禁用');
      },
    });
    expect(service.isEffectAvailable()).toBe(false);
    await expect(service.playEffect('correct')).resolves.toBeUndefined();
  });

  it('播放中途节点创建失败：静默吞掉不抛错', async () => {
    const ctx = createRecordingContext();
    ctx.createOscillator = () => {
      throw new Error('节点创建失败');
    };
    const service = createAudioService({ createAudioContext: () => ctx });
    await expect(service.playEffect('correct')).resolves.toBeUndefined();
  });

  it('AudioContext 可用时 isEffectAvailable 为 true 且按配方调度振荡器', async () => {
    const ctx = createRecordingContext();
    const service = createAudioService({ createAudioContext: () => ctx });
    expect(service.isEffectAvailable()).toBe(true);
    await service.playEffect('star');
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });
});

// ============ 答错提示音效配方（Req 12.4） ============

describe('答错提示音效配方（Req 12.4）', () => {
  it('≤1 秒、纯合成波形（无人声）、与答对音效配方不同', async () => {
    const ctx = createRecordingContext();
    const service = createAudioService({ createAudioContext: () => ctx });

    await service.playEffect('wrong');
    const wrongOscs = ctx.oscillators.slice();
    await service.playEffect('correct');
    const correctOscs = ctx.oscillators.slice(wrongOscs.length);

    expect(wrongOscs.length).toBeGreaterThan(0);
    expect(correctOscs.length).toBeGreaterThan(0);

    // 提示音效总时长不超过 1 秒
    expect(toneSpanSeconds(wrongOscs)).toBeLessThanOrEqual(1);

    // 全部为 Web Audio 合成波形（正弦/方波/三角波），不含人声语音
    for (const osc of wrongOscs) {
      expect(['sine', 'square', 'triangle']).toContain(osc.type);
    }

    // 与答对音效配方不同（波形/频率/时序组合不一致）
    expect(recipeSignature(wrongOscs)).not.toBe(recipeSignature(correctOscs));
  });
});

// ============ 音效开关行为（Req 12.5, 12.6） ============

describe('音效开关行为（Req 12.5, 12.6）', () => {
  it('默认开启；关闭即停播当前音效，后续答题与奖励场景零播放但事件照常返回；重开恢复', () => {
    const audio = createMockAudio();
    const feedback = createFeedbackService({ audio });

    // Req 12.5：默认开启
    expect(feedback.isSoundOn()).toBe(true);
    feedback.onCorrect();
    expect(audio.playEffect).toHaveBeenCalledWith('correct');

    // Req 12.6：切为关闭立即停止当前音效
    feedback.setSoundOn(false);
    expect(audio.stopAll).toHaveBeenCalledTimes(1);
    expect(feedback.isSoundOn()).toBe(false);

    // 后续答题与奖励场景均不再播放任何音效（事件仍照常返回，仅抑制声音）
    const callsBefore = audio.playEffect.mock.calls.length;
    const celebration = feedback.onCorrect();
    const hint = feedback.onFirstWrong({ hint: '注意“清”是三点水' });
    const reveal = feedback.onSecondWrong({ answer: { choice: ['B'] }, analysis: '解析' });
    const stars = feedback.onStars(10);
    const treasure = feedback.onTreasure();
    expect(audio.playEffect.mock.calls).toHaveLength(callsBefore);
    expect(celebration.kind).toBe('celebration');
    expect(hint.kind).toBe('hint');
    expect(reveal.kind).toBe('answer-reveal');
    expect(stars).toEqual({ kind: 'stars', count: 10 });
    expect(treasure.kind).toBe('treasure');

    // 重新开启后恢复播放
    feedback.setSoundOn(true);
    feedback.onCorrect();
    expect(audio.playEffect).toHaveBeenCalledWith('correct');
  });
});

// ============ 开关状态持久化（Req 12.7） ============

describe('音效开关持久化（Req 12.7）', () => {
  it('关闭后重建服务（模拟重启应用）恢复为关闭；再开恢复为开启', () => {
    const storage = createMemoryStorage();
    const audio = createMockAudio();

    const store1 = createLocalStore({ storage });
    const feedback1 = createFeedbackService({ audio, store: store1 });
    feedback1.setSoundOn(false);

    // 变化已调度写入（1 秒内落盘，Req 10.2），flush 模拟落盘完成
    expect(store1.hasPending()).toBe(true);
    store1.flush();
    expect(JSON.parse(storage.getItem('kla:v1:default:settings') as string)).toEqual({
      soundOn: false,
    });

    // 重启应用：同一 storage 上新建 Local_Store 与 Feedback_Service
    const store2 = createLocalStore({ storage });
    const feedback2 = createFeedbackService({ audio, store: store2 });
    expect(feedback2.isSoundOn()).toBe(false);

    // 再切回开启并重启，恢复为开启
    feedback2.setSoundOn(true);
    store2.flush();
    const feedback3 = createFeedbackService({ audio, store: createLocalStore({ storage }) });
    expect(feedback3.isSoundOn()).toBe(true);
  });

  it('无任何历史设置时默认开启（Req 12.5）', () => {
    const storage = createMemoryStorage();
    const feedback = createFeedbackService({
      audio: createMockAudio(),
      store: createLocalStore({ storage }),
    });
    expect(feedback.isSoundOn()).toBe(true);
  });
});

// ============ 答题反馈时序与形状（Req 12.3, 4.1, 4.2） ============

describe('答题反馈时序与形状（Req 12.3, 4.1, 4.2）', () => {
  it('答对：返回 ≤3 秒庆祝动画事件并播放正确音效（Req 12.3）', () => {
    const audio = createMockAudio();
    const feedback = createFeedbackService({ audio });
    const event = feedback.onCorrect();
    expect(event.kind).toBe('celebration');
    expect(event.durationMs).toBe(CELEBRATION_DURATION_MS);
    expect(event.durationMs).toBeLessThanOrEqual(3000);
    expect(event.durationMs).toBeGreaterThan(0);
    expect(audio.playEffect).toHaveBeenCalledWith('correct');
  });

  it('首错：仅返回该题 Hint 与 1 次重试机会，不携带正确答案（Req 4.1）', () => {
    const audio = createMockAudio();
    const feedback = createFeedbackService({ audio });
    const event = feedback.onFirstWrong({ hint: '想一想“清”字的偏旁' });
    expect(event).toEqual({ kind: 'hint', hint: '想一想“清”字的偏旁', retryLeft: 1 });
    expect(event).not.toHaveProperty('answer');
    expect(audio.playEffect).toHaveBeenCalledWith('wrong');
  });

  it('再错：返回答案 + ≤100 字解析（超长截断）+ 库中鼓励文案 + 下一题入口（Req 4.2）', () => {
    const audio = createMockAudio();
    const longAnalysis = '这是一段解析。'.repeat(30); // 210 字，超过 100 字上限
    const feedback = createFeedbackService({ audio, rand: () => 0 });
    const answer = { choice: ['B'] };

    const event = feedback.onSecondWrong({ answer, analysis: longAnalysis });

    expect(event.kind).toBe('answer-reveal');
    expect(event.answer).toEqual(answer);
    // 解析截断到 100 字（按字符码点）
    expect([...event.analysis]).toHaveLength(100);
    expect(event.analysis).toBe([...longAnalysis].slice(0, 100).join(''));
    // 鼓励文案来自文案库；rand=0 时应取第一条
    expect(event.encouragement).toBe(ENCOURAGEMENTS[0]);
    expect(ENCOURAGEMENTS).toContain(event.encouragement);
    // 提供进入下一题的操作入口
    expect(event.nextAction).toBe('next-question');
    expect(audio.playEffect).toHaveBeenCalledWith('wrong');
  });

  it('再错：本就 ≤100 字的解析不被截断（Req 4.2）', () => {
    const feedback = createFeedbackService({ audio: createMockAudio() });
    const analysis = '“清”表示水清，所以是三点水。';
    const event = feedback.onSecondWrong({ answer: { choice: ['A'] }, analysis });
    expect(event.analysis).toBe(analysis);
  });

  it('星星与宝箱反馈播放对应音效并返回事件', () => {
    const audio = createMockAudio();
    const feedback = createFeedbackService({ audio });
    expect(feedback.onStars(10)).toEqual({ kind: 'stars', count: 10 });
    expect(audio.playEffect).toHaveBeenCalledWith('star');
    expect(feedback.onTreasure()).toEqual({ kind: 'treasure' });
    expect(audio.playEffect).toHaveBeenCalledWith('treasure');
  });
});

// ============ 鼓励文案库（Req 4.2） ============

describe('鼓励文案库（Req 4.2）', () => {
  it('每条文案均不含批评或否定表述', () => {
    expect(ENCOURAGEMENTS.length).toBeGreaterThan(0);
    for (const phrase of ENCOURAGEMENTS) {
      for (const banned of ENCOURAGEMENT_BANNED_WORDS) {
        expect(phrase.includes(banned)).toBe(false);
      }
    }
  });

  it('pickEncouragement 边界随机值返回库中文案', () => {
    expect(pickEncouragement(() => 0)).toBe(ENCOURAGEMENTS[0]);
    expect(pickEncouragement(() => 0.999999)).toBe(ENCOURAGEMENTS[ENCOURAGEMENTS.length - 1]);
    expect(ENCOURAGEMENTS).toContain(pickEncouragement(() => 0.5));
  });
});
