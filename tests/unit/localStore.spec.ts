/**
 * Local_Store 本地存储适配器单元测试
 *
 * 覆盖：命名空间键格式、初始态恢复、损坏备份自愈（会话内不覆盖）、
 * 1 秒内调度写入、写失败抛出/上报、多账号隔离。
 *
 * _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 12.7, 13.5_
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createLocalStore,
  createMemoryStorage,
  initialEntityState,
  LocalStoreWriteError,
  WRITE_DELAY_MS,
  type EntityName,
  type StorageLike,
  type WrongSet,
} from '@/data/localStore';
import type { IslandCollection, MasteryRecord, StarWallet, TodaySession } from '@/types';

// ============ 合法样例数据 ============

const mastery: Record<string, MasteryRecord> = {
  'cn.g3.zi.001': {
    knowledgePointId: 'cn.g3.zi.001',
    level: 3,
    totalCorrect: 5,
    totalWrong: 2,
    nextReviewAt: 1720000000000,
    mastered: false,
    lastAnswerAt: 1719990000000,
  },
};

const wrongSet: WrongSet = {
  items: [
    {
      questionRef: 'cn-g3-u1-dict-0001',
      knowledgePointId: 'cn.g3.zi.001',
      wrongAt: 1719990000000,
      retriedCorrect: false,
    },
  ],
};

const wallet: StarWallet = { balance: 45, totalEarned: 120 };

const collection: IslandCollection = { items: ['pet-fox'] };

const session: TodaySession = {
  date: '2026-05-13',
  queue: [
    {
      kind: 'bank',
      questionId: 'cn-g3-u1-dict-0001',
      knowledgePointId: 'cn.g3.zi.001',
      subject: 'chinese',
      type: 'dictation',
      difficulty: 2,
      source: 'new',
    },
  ],
  currentIndex: 0,
  streak: 2,
  consecutiveWrong: 0,
  difficultyOffset: 0,
  levelStartedAt: 1719990000000,
  elapsedMs: 60000,
  status: 'active',
  results: [
    {
      questionRef: 'cn-g3-u1-dict-0001',
      knowledgePointId: 'cn.g3.zi.001',
      correct: true,
      retried: false,
      stars: 5,
      answeredAt: 1719990060000,
    },
  ],
};

const oralBest = { 'gen-math-g3-add-3digit': { best: 12, achievedAt: 1719990000000 } };

const settings = { soundOn: false };

const ALL_ENTITIES: EntityName[] = [
  'mastery',
  'wrongSet',
  'wallet',
  'collection',
  'session:today',
  'oralBest',
  'settings',
];

// ============ 手动定时器（注入调度写入） ============

function createManualTimer() {
  let callback: (() => void) | null = null;
  let armedDelay = -1;
  return {
    setTimeoutFn: (cb: () => void, ms: number) => {
      callback = cb;
      armedDelay = ms;
      return {};
    },
    clearTimeoutFn: () => {
      callback = null;
    },
    fire: () => {
      const cb = callback;
      callback = null;
      cb?.();
    },
    get armedDelay() {
      return armedDelay;
    },
    get armed() {
      return callback !== null;
    },
  };
}

describe('localStore 命名空间键格式（Req 13.5）', () => {
  it('默认账号键为 kla:v1:default:{entity}，备份键含 backup 段与时间戳', () => {
    const store = createLocalStore({ storage: createMemoryStorage() });
    expect(store.keyFor('mastery')).toBe('kla:v1:default:mastery');
    expect(store.keyFor('session:today')).toBe('kla:v1:default:session:today');
    expect(store.backupKeyFor('wallet', 123)).toBe('kla:v1:default:backup:wallet:123');
  });

  it('自定义 accountId 反映到键中', () => {
    const store = createLocalStore({ storage: createMemoryStorage(), accountId: 'alice' });
    expect(store.keyFor('wallet')).toBe('kla:v1:alice:wallet');
  });
});

describe('localStore 读取初始态（Req 10.1, 10.4, 12.7）', () => {
  it('全部实体在无任何数据时返回初始状态', () => {
    const store = createLocalStore({ storage: createMemoryStorage() });
    expect(store.read('mastery')).toEqual({});
    expect(store.read('wrongSet')).toEqual({ items: [] });
    expect(store.read('wallet')).toEqual({ balance: 0, totalEarned: 0 });
    expect(store.read('collection')).toEqual({ items: [] });
    expect(store.read('session:today')).toBeNull();
    expect(store.read('oralBest')).toEqual({});
    expect(store.read('settings')).toEqual({ soundOn: true });
  });

  it('initialEntityState 每次返回新对象（不共享引用）', () => {
    for (const entity of ALL_ENTITIES) {
      if (entity === 'session:today') {
        expect(initialEntityState(entity)).toBeNull();
        continue;
      }
      expect(initialEntityState(entity)).not.toBe(initialEntityState(entity));
    }
  });
});

describe('localStore 写入/读取往返（Req 10.1, 10.3, 12.7）', () => {
  it('各实体立即写入后读回等价值', () => {
    const store = createLocalStore({ storage: createMemoryStorage() });
    store.write('mastery', mastery);
    store.write('wrongSet', wrongSet);
    store.write('wallet', wallet);
    store.write('collection', collection);
    store.write('session:today', session);
    store.write('oralBest', oralBest);
    store.write('settings', settings);

    expect(store.read('mastery')).toEqual(mastery);
    expect(store.read('wrongSet')).toEqual(wrongSet);
    expect(store.read('wallet')).toEqual(wallet);
    expect(store.read('collection')).toEqual(collection);
    expect(store.read('session:today')).toEqual(session);
    expect(store.read('oralBest')).toEqual(oralBest);
    expect(store.read('settings')).toEqual(settings);
  });

  it('session:today 写入 null 后读回 null', () => {
    const store = createLocalStore({ storage: createMemoryStorage() });
    store.write('session:today', session);
    store.write('session:today', null);
    expect(store.read('session:today')).toBeNull();
  });
});

describe('localStore 多账号隔离（Req 13.5）', () => {
  it('账号 A 写入不影响账号 B 的读取', () => {
    const storage = createMemoryStorage();
    const storeA = createLocalStore({ storage, accountId: 'alice' });
    const storeB = createLocalStore({ storage, accountId: 'bob' });

    storeA.write('wallet', wallet);
    storeA.write('settings', { soundOn: false });

    expect(storeA.read('wallet')).toEqual(wallet);
    expect(storeB.read('wallet')).toEqual({ balance: 0, totalEarned: 0 });
    expect(storeB.read('settings')).toEqual({ soundOn: true });
  });
});

describe('localStore 损坏自愈与备份保留（Req 10.4）', () => {
  it('无法解析的 JSON：返回初始态，原始值复制到备份键', () => {
    const storage = createMemoryStorage();
    const store = createLocalStore({ storage, now: () => 777 });
    storage.setItem('kla:v1:default:wallet', '{"balance":10');

    expect(store.read('wallet')).toEqual({ balance: 0, totalEarned: 0 });
    expect(storage.getItem('kla:v1:default:backup:wallet:777')).toBe('{"balance":10');
  });

  it('缺少必需字段：返回初始态并备份', () => {
    const storage = createMemoryStorage();
    const store = createLocalStore({ storage, now: () => 888 });
    storage.setItem('kla:v1:default:wallet', '{"balance":10}');

    expect(store.read('wallet')).toEqual({ balance: 0, totalEarned: 0 });
    expect(storage.getItem('kla:v1:default:backup:wallet:888')).toBe('{"balance":10}');
  });

  it('字段类型非法的 mastery 记录：返回空对象并备份', () => {
    const storage = createMemoryStorage();
    const store = createLocalStore({ storage, now: () => 999 });
    const corrupted = JSON.stringify({ 'kp.1': { knowledgePointId: 'kp.1', level: 9 } });
    storage.setItem('kla:v1:default:mastery', corrupted);

    expect(store.read('mastery')).toEqual({});
    expect(storage.getItem('kla:v1:default:backup:mastery:999')).toBe(corrupted);
  });

  it('同一会话内再次损坏不覆盖首次备份', () => {
    const storage = createMemoryStorage();
    const store = createLocalStore({ storage, now: () => 111 });
    storage.setItem('kla:v1:default:collection', 'not-json');
    expect(store.read('collection')).toEqual({ items: [] });

    // 同会话第二次损坏（不同原值、时间戳也变化也不应覆盖）
    storage.setItem('kla:v1:default:collection', '{"items":"oops"}');
    expect(store.read('collection')).toEqual({ items: [] });

    expect(storage.getItem('kla:v1:default:backup:collection:111')).toBe('not-json');
  });

  it('损坏自愈后写入新值，读取恢复正常', () => {
    const storage = createMemoryStorage();
    const store = createLocalStore({ storage });
    storage.setItem('kla:v1:default:settings', '{bad');
    expect(store.read('settings')).toEqual({ soundOn: true });

    store.write('settings', { soundOn: false });
    expect(store.read('settings')).toEqual({ soundOn: false });
  });
});

describe('localStore 1 秒内调度写入（Req 10.2）', () => {
  it('schedule 后延迟小于 1 秒，定时触发落盘', () => {
    const timer = createManualTimer();
    const storage = createMemoryStorage();
    const store = createLocalStore({
      storage,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
    });

    store.schedule('wallet', wallet);
    expect(timer.armed).toBe(true);
    expect(timer.armedDelay).toBeLessThan(1000);
    expect(timer.armedDelay).toBe(WRITE_DELAY_MS);
    expect(storage.getItem('kla:v1:default:wallet')).toBeNull();
    expect(store.hasPending()).toBe(true);

    timer.fire();
    expect(JSON.parse(storage.getItem('kla:v1:default:wallet') as string)).toEqual(wallet);
    expect(store.hasPending()).toBe(false);
  });

  it('突发连续 schedule：窗口内仅更新待写值，落盘为最新值', () => {
    const timer = createManualTimer();
    const storage = createMemoryStorage();
    const store = createLocalStore({
      storage,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
    });

    store.schedule('wallet', { balance: 1, totalEarned: 1 });
    const firstDelay = timer.armedDelay;
    store.schedule('wallet', { balance: 2, totalEarned: 2 });
    store.schedule('mastery', mastery);
    // 计时器不因后续变化而重置（保证首个变化 1 秒内落盘）
    expect(timer.armedDelay).toBe(firstDelay);

    timer.fire();
    expect(store.read('wallet')).toEqual({ balance: 2, totalEarned: 2 });
    expect(store.read('mastery')).toEqual(mastery);
  });

  it('flush 立即落盘并取消定时器', () => {
    const timer = createManualTimer();
    const storage = createMemoryStorage();
    const store = createLocalStore({
      storage,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
    });

    store.schedule('collection', collection);
    store.flush();
    expect(store.read('collection')).toEqual(collection);
    expect(timer.armed).toBe(false);

    // 定时器已取消，fire 不应产生任何写入
    timer.fire();
    expect(store.hasPending()).toBe(false);
  });

  it('立即 write 成功后丢弃同实体较旧的调度待写值（避免旧值覆盖新值）', () => {
    const timer = createManualTimer();
    const storage = createMemoryStorage();
    const store = createLocalStore({
      storage,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
    });

    store.schedule('wallet', { balance: 1, totalEarned: 1 });
    store.write('wallet', { balance: 99, totalEarned: 99 });
    timer.fire();
    expect(store.read('wallet')).toEqual({ balance: 99, totalEarned: 99 });
  });
});

describe('localStore 写失败上报（Req 10.6）', () => {
  function createThrowingStorage(): StorageLike {
    return {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
  }

  it('立即 write 失败抛出 LocalStoreWriteError，含 UI 提示文案', () => {
    const store = createLocalStore({ storage: createThrowingStorage() });
    try {
      store.write('wallet', wallet);
      expect.unreachable('write 应当抛出');
    } catch (error) {
      expect(error).toBeInstanceOf(LocalStoreWriteError);
      const writeError = error as LocalStoreWriteError;
      expect(writeError.entity).toBe('wallet');
      expect(writeError.key).toBe('kla:v1:default:wallet');
      expect(writeError.message).toContain('本次进度可能无法保存');
    }
  });

  it('flush 失败抛出 LocalStoreWriteError', () => {
    const store = createLocalStore({ storage: createThrowingStorage() });
    store.schedule('wallet', wallet);
    expect(() => store.flush()).toThrow(LocalStoreWriteError);
  });

  it('调度写定时触发失败经 onWriteError 上报，不在定时器内抛出', () => {
    const timer = createManualTimer();
    const onWriteError = vi.fn();
    const store = createLocalStore({
      storage: createThrowingStorage(),
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
      onWriteError,
    });

    store.schedule('wallet', wallet);
    expect(() => timer.fire()).not.toThrow();
    expect(onWriteError).toHaveBeenCalledTimes(1);
    const error = onWriteError.mock.calls[0][0] as LocalStoreWriteError;
    expect(error).toBeInstanceOf(LocalStoreWriteError);
    expect(error.message).toContain('本次进度可能无法保存');
  });
});
