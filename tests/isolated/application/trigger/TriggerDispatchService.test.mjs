import { describe, it, expect, vi, beforeEach, test } from 'vitest';
import { TriggerDispatchService } from '../../../../backend/src/3_applications/trigger/TriggerDispatchService.mjs';
import { TriggerActuationGateway } from '../../../../backend/src/1_adapters/trigger/TriggerActuationGateway.mjs';

const TEST_RUNTIME = {
  createDispatchId: () => 'dispatch-test-id',
  scheduler: { after: () => () => {} },
};

const actuationFor = ({ deviceService = null, haGateway = null, screenBroadcast = null, commandResolver = null } = {}) =>
  new TriggerActuationGateway({ deviceService, homeGateway: haGateway, screenBroadcast, commandResolver });

// New registry shape produced by buildTriggerRegistry:
// { [modality]: { locations: { [location]: { target, action, auth_token, defaults } }, ...modality-specific } }
const baseRegistry = {
  nfc: {
    locations: {
      livingroom: {
        target: 'livingroom-tv',
        action: 'play-next',
        auth_token: null,
        defaults: {},
      },
    },
    tags: {
      '838e6806': { global: { plex: 620707 }, overrides: {} },
      '8d6d2a07': { global: { plex: 620708 }, overrides: {} },
    },
  },
  state: {
    locations: {
      livingroom: {
        target: 'livingroom-tv',
        auth_token: null,
        states: {
          off: { action: 'clear' },
        },
      },
    },
  },
};

const makeResolver = () => ({ resolve: (id) => /^plex:/.test(id) ? { source: 'plex' } : null });

describe('TriggerDispatchService.handleTrigger', () => {
  let wakeAndLoadService;
  let haGateway;
  let deviceService;
  let broadcast;
  let logger;

  beforeEach(() => {
    wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true, dispatchId: 'd1' }) };
    haGateway = { callService: vi.fn().mockResolvedValue({ ok: true }) };
    deviceService = {
      get: vi.fn().mockReturnValue({
        loadContent: vi.fn().mockResolvedValue({ ok: true }),
        clearContent: vi.fn().mockResolvedValue({ ok: true }),
      }),
    };
    broadcast = vi.fn();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  });

  function makeService(configOverrides = null) {
    const config = configOverrides !== null ? configOverrides : baseRegistry;
    return new TriggerDispatchService({
    ...TEST_RUNTIME,
      config,
      contentIdResolver: makeResolver(),
      wakeAndLoadService,
      actuationGateway: actuationFor({ haGateway, deviceService }),
      broadcast,
      logger,
    });
  }

  it('returns ok and dispatches a content load for a known nfc trigger', async () => {
    const service = makeService();
    const result = await service.handleTrigger('livingroom', 'nfc', '838e6806');
    expect(result.ok).toBe(true);
    expect(result.action).toBe('play-next');
    expect(result.target).toBe('livingroom-tv');
    expect(wakeAndLoadService.execute).toHaveBeenCalledWith(
      'livingroom-tv',
      expect.objectContaining({ 'play-next': 'plex:620707', op: 'play-next' }),
      expect.objectContaining({ dispatchId: expect.any(String) })
    );
  });

  it('returns 404-ish error for unknown location', async () => {
    const service = makeService();
    const result = await service.handleTrigger('attic', 'nfc', '838e6806');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/location/i);
    expect(result.code).toBe('LOCATION_NOT_FOUND');
  });

  it('returns 404-ish error for unknown trigger value (and logs the event)', async () => {
    const service = makeService();
    const result = await service.handleTrigger('livingroom', 'nfc', 'unknownuid');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TRIGGER_NOT_REGISTERED');
    expect(logger.info).toHaveBeenCalledWith('trigger.fired',
      expect.objectContaining({ registered: false, value: 'unknownuid' }));
  });

  it('lowercases the trigger value before lookup', async () => {
    const service = makeService();
    const result = await service.handleTrigger('livingroom', 'nfc', '838e6806');
    expect(result.ok).toBe(true);
  });

  it('returns UNKNOWN_ACTION for an unknown action handler', async () => {
    const registry = {
      nfc: {
        locations: {
          livingroom: {
            target: 'livingroom-tv',
            action: 'launch-rocket',
            auth_token: null,
            defaults: {},
          },
        },
        tags: {
          '838e6806': { global: { plex: 620707 }, overrides: {} },
        },
      },
    };
    const service = makeService(registry);
    const result = await service.handleTrigger('livingroom', 'nfc', '838e6806');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNKNOWN_ACTION');
  });

  it('rejects when location has auth_token and the request omits it', async () => {
    const registry = {
      nfc: {
        locations: {
          livingroom: {
            target: 'livingroom-tv',
            action: 'play-next',
            auth_token: 'secret',
            defaults: {},
          },
        },
        tags: {
          '838e6806': { global: { plex: 620707 }, overrides: {} },
        },
      },
    };
    const service = makeService(registry);
    const result = await service.handleTrigger('livingroom', 'nfc', '838e6806', {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AUTH_FAILED');
  });

  it('accepts when location auth_token matches', async () => {
    const registry = {
      nfc: {
        locations: {
          livingroom: {
            target: 'livingroom-tv',
            action: 'play-next',
            auth_token: 'secret',
            defaults: {},
          },
        },
        tags: {
          '838e6806': { global: { plex: 620707 }, overrides: {} },
        },
      },
    };
    const service = makeService(registry);
    const result = await service.handleTrigger('livingroom', 'nfc', '838e6806', { token: 'secret' });
    expect(result.ok).toBe(true);
  });

  it('does not dispatch when dryRun is true (validates only)', async () => {
    const service = makeService();
    const result = await service.handleTrigger('livingroom', 'nfc', '838e6806', { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(wakeAndLoadService.execute).not.toHaveBeenCalled();
  });

  it('broadcasts a trigger.fired event to topic trigger:<location>:<type>', async () => {
    const service = makeService();
    await service.handleTrigger('livingroom', 'nfc', '838e6806');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'trigger:livingroom:nfc',
      type: 'trigger.fired',
      location: 'livingroom',
      value: '838e6806',
    }));
  });

  it('returns DISPATCH_FAILED when the action handler throws a non-UnknownAction error', async () => {
    wakeAndLoadService.execute.mockRejectedValue(new Error('TV unreachable'));
    const service = makeService();
    const result = await service.handleTrigger('livingroom', 'nfc', '838e6806');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('DISPATCH_FAILED');
    expect(result.error).toMatch(/TV unreachable/);
  });

  it('returns UNKNOWN_MODALITY when modality has no slice in config', async () => {
    const service = makeService();
    const result = await service.handleTrigger('livingroom', 'voice', 'play_jazz');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNKNOWN_MODALITY');
  });

  it('dispatches a state trigger (clear action)', async () => {
    const service = makeService();
    const result = await service.handleTrigger('livingroom', 'state', 'off');
    expect(result.ok).toBe(true);
    expect(result.action).toBe('clear');
    expect(deviceService.get).toHaveBeenCalledWith('livingroom-tv');
    const device = deviceService.get.mock.results[0].value;
    expect(device.clearContent).toHaveBeenCalled();
  });
});

// ---- Debounce tests ----

const debounceRegistry = {
  nfc: {
    locations: {
      livingroom: {
        target: 'livingroom-tv',
        action: 'play-next',
        auth_token: null,
        defaults: {},
      },
    },
    tags: {
      '838e6806': { global: { plex: '620707' }, overrides: {} },
      '8d6d2a07': { global: { plex: '620708' }, overrides: {} },
    },
  },
};

const makeContentIdResolver = () => ({
  resolve: (id) => (/^plex:/.test(id) ? { source: 'plex' } : null),
});

const silentLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
};

describe('TriggerDispatchService — debounce', () => {
  test('first scan dispatches; second scan within window is debounced', async () => {
    const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    const service = new TriggerDispatchService({
    ...TEST_RUNTIME,
      config: debounceRegistry,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
    });

    const first = await service.handleTrigger('livingroom', 'nfc', '838e6806');
    expect(first.ok).toBe(true);
    expect(first.debounced).toBeUndefined();
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1);

    const second = await service.handleTrigger('livingroom', 'nfc', '838e6806');
    expect(second.ok).toBe(true);
    expect(second.debounced).toBe(true);
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1); // unchanged
  });

  test('different tag in same window is NOT debounced', async () => {
    const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    const service = new TriggerDispatchService({
    ...TEST_RUNTIME,
      config: debounceRegistry,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
    });

    await service.handleTrigger('livingroom', 'nfc', '838e6806');
    await service.handleTrigger('livingroom', 'nfc', '8d6d2a07');
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(2);
  });

  test('scan after window elapses is dispatched normally', async () => {
    const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    let now = 1_000_000;
    const service = new TriggerDispatchService({
    ...TEST_RUNTIME,
      config: debounceRegistry,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
      clock: () => now,
    });

    await service.handleTrigger('livingroom', 'nfc', '838e6806');
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1);

    now += 3500; // past window
    const result = await service.handleTrigger('livingroom', 'nfc', '838e6806');
    expect(result.debounced).toBeUndefined();
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(2);
  });

  test('dryRun bypasses debounce', async () => {
    const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    const service = new TriggerDispatchService({
    ...TEST_RUNTIME,
      config: debounceRegistry,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
    });

    await service.handleTrigger('livingroom', 'nfc', '838e6806');
    const dry = await service.handleTrigger('livingroom', 'nfc', '838e6806', { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.debounced).toBeUndefined();
  });

  test('failed dispatch clears debounce so user can retry immediately', async () => {
    const wakeAndLoadService = {
      execute: vi.fn()
        .mockRejectedValueOnce(new Error('wake-fail'))
        .mockResolvedValueOnce({ ok: true }),
    };
    const service = new TriggerDispatchService({
    ...TEST_RUNTIME,
      config: debounceRegistry,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
    });

    const first = await service.handleTrigger('livingroom', 'nfc', '838e6806');
    expect(first.ok).toBe(false);

    const second = await service.handleTrigger('livingroom', 'nfc', '838e6806');
    expect(second.ok).toBe(true);
    expect(second.debounced).toBeUndefined();
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(2);
  });
});

describe('TriggerDispatchService.handleTrigger — unknown NFC branch', () => {
  let wakeAndLoadService;
  let haGateway;
  let deviceService;
  let broadcast;
  let logger;
  let tagWriter;
  let now;

  beforeEach(() => {
    wakeAndLoadService = { execute: vi.fn() };
    haGateway = { callService: vi.fn().mockResolvedValue({ ok: true }) };
    deviceService = { get: vi.fn() };
    broadcast = vi.fn();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    tagWriter = {
      recordObserved: vi.fn().mockResolvedValue({ created: true }),
      setNfcNote: vi.fn(),
    };
    now = 1714137138000; // arbitrary fixed ms
  });

  function makeRegistry({ tags = {}, notify_unknown = 'mobile_app_kc_phone' } = {}) {
    return {
      nfc: {
        locations: {
          livingroom: {
            target: 'livingroom-tv',
            action: 'play-next',
            auth_token: null,
            notify_unknown,
            defaults: {},
          },
        },
        tags,  // already in parsed { global, overrides } shape
      },
      state: { locations: {} },
    };
  }

  function makeService(config) {
    return new TriggerDispatchService({
    ...TEST_RUNTIME,
      config,
      contentIdResolver: { resolve: () => null },
      wakeAndLoadService,
      actuationGateway: actuationFor({ haGateway, deviceService }),
      tagWriter,
      broadcast,
      logger,
      clock: () => now,
    });
  }

  it('state 0 — first scan: writes placeholder, notifies, returns 404', async () => {
    const service = makeService(makeRegistry());
    const result = await service.handleTrigger('livingroom', 'nfc', '04a1b2c3');

    expect(result.ok).toBe(false);
    expect(result.code).toBe('TRIGGER_NOT_REGISTERED');

    expect(tagWriter.recordObserved).toHaveBeenCalledWith(
      '04a1b2c3',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    );

    expect(haGateway.callService).toHaveBeenCalledWith(
      'notify',
      'mobile_app_kc_phone',
      expect.objectContaining({
        title: expect.stringMatching(/livingroom/i),
        message: expect.stringContaining('04a1b2c3'),
        data: expect.objectContaining({
          actions: [expect.objectContaining({
            action: 'NFC_REPLY|livingroom|04a1b2c3',
            behavior: 'textInput',
          })],
        }),
      }),
    );

    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'trigger:livingroom:nfc',
      type: 'trigger.fired',
      registered: false,
    }));
  });

  it('state 0 — no notify call when notify_unknown is unset', async () => {
    const service = makeService(makeRegistry({ notify_unknown: null }));
    await service.handleTrigger('livingroom', 'nfc', '04a1b2c3');
    expect(tagWriter.recordObserved).toHaveBeenCalled();
    expect(haGateway.callService).not.toHaveBeenCalled();
  });

  it('state 1 — re-scan with placeholder but no note: notifies, no new write', async () => {
    tagWriter.recordObserved.mockResolvedValue({ created: false });
    const registry = makeRegistry({
      tags: { '04a1b2c3': { global: { scanned_at: '2026-04-26 10:00:00' }, overrides: {} } },
    });
    const service = makeService(registry);
    await service.handleTrigger('livingroom', 'nfc', '04a1b2c3');

    // upsert is called but no-ops (returns { created: false })
    expect(tagWriter.recordObserved).toHaveBeenCalled();
    expect(haGateway.callService).toHaveBeenCalledTimes(1);
  });

  it('state 2 — has note already: silent (no notify, no write)', async () => {
    const registry = makeRegistry({
      tags: { '04a1b2c3': {
        global: { scanned_at: '2026-04-26 10:00:00', note: 'kids movie' },
        overrides: {},
      } },
    });
    const service = makeService(registry);
    await service.handleTrigger('livingroom', 'nfc', '04a1b2c3');

    expect(tagWriter.recordObserved).not.toHaveBeenCalled();
    expect(haGateway.callService).not.toHaveBeenCalled();
    // Broadcast still fires for observer dashboards:
    expect(broadcast).toHaveBeenCalled();
  });

  it('debounce extends to unknown branch: second scan within 3s does not re-notify', async () => {
    const service = makeService(makeRegistry());
    await service.handleTrigger('livingroom', 'nfc', '04a1b2c3');
    now += 1500; // 1.5 s later
    await service.handleTrigger('livingroom', 'nfc', '04a1b2c3');
    expect(haGateway.callService).toHaveBeenCalledTimes(1);
    expect(tagWriter.recordObserved).toHaveBeenCalledTimes(1);
  });

  it('debounce window expiry allows a second notify', async () => {
    tagWriter.recordObserved
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: false });
    const service = makeService(makeRegistry());
    await service.handleTrigger('livingroom', 'nfc', '04a1b2c3');
    now += 35000; // 35 s later, past 30 s default window
    await service.handleTrigger('livingroom', 'nfc', '04a1b2c3');
    expect(haGateway.callService).toHaveBeenCalledTimes(2);
  });

  it('notify failure does not change the GET response or skip broadcast', async () => {
    haGateway.callService.mockRejectedValue(new Error('HA down'));
    const service = makeService(makeRegistry());
    const result = await service.handleTrigger('livingroom', 'nfc', '04a1b2c3');
    expect(result.code).toBe('TRIGGER_NOT_REGISTERED');
    expect(broadcast).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('trigger.notify.failed', expect.any(Object));
  });

  it('non-NFC modality unknown branch does not call tagWriter', async () => {
    const config = {
      nfc: { locations: {}, tags: {} },
      state: {
        locations: {
          livingroom: {
            target: 'livingroom-tv',
            auth_token: null,
            states: {},  // empty: any state value will be unregistered
          },
        },
      },
    };
    const service = makeService(config);
    await service.handleTrigger('livingroom', 'state', 'on');
    expect(tagWriter.recordObserved).not.toHaveBeenCalled();
    expect(haGateway.callService).not.toHaveBeenCalled();
  });
});

describe('TriggerDispatchService.setNote', () => {
  let tagWriter;
  let broadcast;
  let logger;

  beforeEach(() => {
    tagWriter = { setNfcNote: vi.fn().mockResolvedValue({ created: false }) };
    broadcast = vi.fn();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  });

  function makeService({ auth_token = null } = {}) {
    return new TriggerDispatchService({
    ...TEST_RUNTIME,
      config: {
        nfc: {
          locations: {
            livingroom: { target: 'livingroom-tv', action: 'play-next', auth_token, notify_unknown: null, defaults: {} },
          },
          tags: {},
        },
        state: { locations: {} },
      },
      contentIdResolver: { resolve: () => null },
      wakeAndLoadService: { execute: vi.fn() },
      haGateway: { callService: vi.fn() },
      deviceService: { get: vi.fn() },
      tagWriter,
      broadcast,
      logger,
      clock: () => 1714137138000,
    });
  }

  it('writes the note via tagWriter and returns ok', async () => {
    const service = makeService();
    const result = await service.setNote('livingroom', 'nfc', '04a1b2c3', 'kids favorite');
    expect(result.ok).toBe(true);
    expect(tagWriter.setNfcNote).toHaveBeenCalledWith(
      '04a1b2c3',
      'kids favorite',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    );
  });

  it('lowercases the value before writing', async () => {
    const service = makeService();
    await service.setNote('livingroom', 'nfc', 'aabbcc', 'x');
    expect(tagWriter.setNfcNote).toHaveBeenCalledWith('aabbcc', 'x', expect.any(String));
  });

  it('broadcasts trigger.note_set on the location/modality topic', async () => {
    const service = makeService();
    await service.setNote('livingroom', 'nfc', '04a1b2c3', 'kids favorite');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'trigger:livingroom:nfc',
      type: 'trigger.note_set',
      location: 'livingroom',
      modality: 'nfc',
      value: '04a1b2c3',
      note: 'kids favorite',
    }));
  });

  it('returns 400 INVALID_NOTE when note is empty', async () => {
    const service = makeService();
    const result = await service.setNote('livingroom', 'nfc', '04', '');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_NOTE');
    expect(tagWriter.setNfcNote).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_NOTE when note exceeds 200 chars', async () => {
    const service = makeService();
    const result = await service.setNote('livingroom', 'nfc', '04', 'x'.repeat(201));
    expect(result.code).toBe('INVALID_NOTE');
  });

  it('returns 400 INVALID_NOTE when note is not a string', async () => {
    const service = makeService();
    const result = await service.setNote('livingroom', 'nfc', '04', 42);
    expect(result.code).toBe('INVALID_NOTE');
  });

  it('returns 400 UNSUPPORTED_MODALITY for non-nfc modalities', async () => {
    const service = makeService();
    const result = await service.setNote('livingroom', 'state', 'on', 'x');
    expect(result.code).toBe('UNSUPPORTED_MODALITY');
  });

  it('returns 404 LOCATION_NOT_FOUND for an unknown location', async () => {
    const service = makeService();
    const result = await service.setNote('attic', 'nfc', '04', 'x');
    expect(result.code).toBe('LOCATION_NOT_FOUND');
  });

  it('returns 401 AUTH_FAILED when token does not match location auth_token', async () => {
    const service = makeService({ auth_token: 'secret' });
    const result = await service.setNote('livingroom', 'nfc', '04', 'x', { token: 'wrong' });
    expect(result.code).toBe('AUTH_FAILED');
  });

  it('returns 200 when token matches', async () => {
    const service = makeService({ auth_token: 'secret' });
    const result = await service.setNote('livingroom', 'nfc', '04', 'x', { token: 'secret' });
    expect(result.ok).toBe(true);
  });

  it('returns 200 when location has no auth_token regardless of provided token', async () => {
    const service = makeService();
    const result = await service.setNote('livingroom', 'nfc', '04', 'x', { token: 'anything' });
    expect(result.ok).toBe(true);
  });

  it('returns 500 NOTE_WRITE_FAILED if tagWriter throws', async () => {
    tagWriter.setNfcNote.mockRejectedValue(new Error('disk full'));
    const service = makeService();
    const result = await service.setNote('livingroom', 'nfc', '04', 'x');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NOTE_WRITE_FAILED');
  });
});

// --- appended: unified-core wiring ---
import { TriggerEvent } from '#domains/trigger/TriggerEvent.mjs';

describe('TriggerDispatchService (unified core)', () => {
  function make(registry, wake) {
    const wakeAndLoadService = { execute: wake || (async () => ({ ok: true })) };
    return new TriggerDispatchService({
    ...TEST_RUNTIME,
      config: registry,
      contentIdResolver: { resolve: () => true },
      wakeAndLoadService,
      haGateway: { callService: async () => 'ok' },
      deviceService: { get: () => ({ loadContent: async () => 'ok', clearContent: async () => 'ok' }) },
      broadcast: () => {},
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      clock: () => 1000,
    });
  }
  const registry = { nfc: { locations: { livingroom: { target: 'livingroom-tv', action: 'queue' } }, tags: { 'aa': { global: { plex: '456598' }, overrides: {} } } }, state: { locations: {} } };

  it('dispatches an nfc content trigger via wakeAndLoad', async () => {
    const calls = [];
    const svc = make(registry, async (...a) => { calls.push(a); return { ok: true }; });
    const res = await svc.handleTrigger('livingroom', 'nfc', 'aa', {});
    expect(res.ok).toBe(true);
    expect(calls[0][0]).toBe('livingroom-tv');
    expect(calls[0][1]).toMatchObject({ queue: 'plex:456598' });
  });

  it('handleEvent(TriggerEvent) matches handleTrigger', async () => {
    const svc = make(registry);
    const viaEvent = await svc.handleEvent(TriggerEvent.create({ source: 'nfc', location: 'livingroom', value: 'aa' }), {});
    expect(viaEvent.ok).toBe(true);
    expect(viaEvent.action).toBe('queue');
  });
});

// --- appended: authorize + deps ---
describe('TriggerDispatchService authorize', () => {
  function make(registry, wake) {
    const wakeAndLoadService = { execute: wake || (async () => ({ ok: true })) };
    return new TriggerDispatchService({
    ...TEST_RUNTIME,
      config: registry,
      contentIdResolver: { resolve: () => true },
      wakeAndLoadService,
      haGateway: { callService: async () => 'ok' },
      deviceService: { get: () => ({ loadContent: async () => 'ok', clearContent: async () => 'ok' }) },
      broadcast: () => {},
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      clock: () => 1000,
    });
  }
  const registry = { nfc: { locations: { livingroom: { target: 'livingroom-tv', action: 'queue' } }, tags: { 'aa': { global: { plex: '456598' }, overrides: {} } } }, state: { locations: {} } };

  it('approves when the source has no strategies (nfc/state unchanged)', async () => {
    const calls = [];
    const svc = make(registry, async (...a) => { calls.push(a); return { ok: true }; });
    const res = await svc.handleTrigger('livingroom', 'nfc', 'aa', {});
    expect(res.ok).toBe(true);
    expect(res.action).toBe('queue');
    expect(calls.length).toBe(1);
  });

  it('accepts contentDispatcher/screenBroadcast/commandResolver deps without changing nfc behavior', async () => {
    const wakeAndLoadService = { execute: async () => ({ ok: true }) };
    const svc = new TriggerDispatchService({
    ...TEST_RUNTIME,
      config: registry,
      contentIdResolver: { resolve: () => true },
      wakeAndLoadService,
      haGateway: { callService: async () => 'ok' },
      deviceService: { get: () => ({ loadContent: async () => 'ok', clearContent: async () => 'ok' }) },
      contentDispatcher: { dispatch: async () => ({ ok: true }) },
      screenBroadcast: () => {},
      commandResolver: { resolve: () => null },
      broadcast: () => {},
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      clock: () => 1000,
    });
    const res = await svc.handleTrigger('livingroom', 'nfc', 'aa', {});
    expect(res.ok).toBe(true);
  });
});

// Regression: barcode resolves to a FROZEN Response (not a mutable intent).
// The dispatch core must normalize resolver output without mutating it — an
// earlier bug did `intent.dispatchId = ...` and threw "object is not extensible"
// on the frozen barcode Response, breaking every barcode scan end-to-end.
describe('TriggerDispatchService — barcode (frozen Response) through handleEvent', () => {
  const barcodeRegistry = {
    nfc: { locations: {}, tags: {} },
    state: { locations: {} },
    barcode: { locations: { ds2278: { target: 'living-room', default_action: 'queue', actions: ['queue', 'play', 'open'] } } },
  };
  function makeBarcode(extraDeps = {}) {
    const { screenBroadcast = null, commandResolver = null, ...otherDeps } = extraDeps;
    return new TriggerDispatchService({
    ...TEST_RUNTIME,
      config: barcodeRegistry,
      contentIdResolver: { resolve: () => true },
      wakeAndLoadService: { execute: async () => ({ ok: true }) },
      actuationGateway: actuationFor({
        haGateway: { callService: async () => 'ok' },
        deviceService: { get: () => ({ loadContent: async () => 'ok', clearContent: async () => 'ok' }) },
        screenBroadcast,
        commandResolver,
      }),
      broadcast: () => {},
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      clock: () => 1000,
      ...otherDeps,
    });
  }

  it('dispatches a barcode content scan via the optimistic content dispatcher (no throw)', async () => {
    const optimistic = vi.fn().mockResolvedValue(undefined);
    const svc = makeBarcode({ contentDispatcher: { optimistic } });
    const res = await svc.handleTrigger('ds2278', 'barcode', 'plex:595104', {});
    expect(res.ok).toBe(true);
    expect(optimistic).toHaveBeenCalledTimes(1);
    expect(optimistic.mock.calls[0][0]).toBe('living-room');
    expect(optimistic.mock.calls[0][1]).toMatchObject({ queue: 'plex:595104' });
  });

  it('dispatches a barcode command scan via screenBroadcast as a transport (no throw)', async () => {
    const screenBroadcast = vi.fn();
    const commandResolver = (cmd) => (cmd === 'pause' ? { playback: 'pause' } : null);
    const svc = makeBarcode({ screenBroadcast, commandResolver });
    const res = await svc.handleTrigger('ds2278', 'barcode', 'pause', {});
    expect(res.ok).toBe(true);
    expect(screenBroadcast).toHaveBeenCalledWith('living-room', { playback: 'pause' });
  });

  it('dryRun on a barcode content scan returns a Response without dispatching', async () => {
    const optimistic = vi.fn();
    const svc = makeBarcode({ contentDispatcher: { optimistic } });
    const res = await svc.handleTrigger('ds2278', 'barcode', 'plex:1', { dryRun: true });
    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(true);
    expect(res.response.kind).toBe('content');
    expect(optimistic).not.toHaveBeenCalled();
  });
});

// An action nothing can dispatch is, from the tap's point of view, exactly a
// tag nobody registered: nothing happens. Before this, it was WORSE than that —
// the UNKNOWN_ACTION return sits below the `if (!intent)` branch, so it skipped
// the placeholder write and the notify_unknown push. (Not the debounce: that
// key is set before resolution, so repeat taps were collapsing either way.)
// The arming event for that gap is a one-line YAML edit to a reader, which no
// test observes and no code comment reaches, so the degradation lives here.
describe('TriggerDispatchService — an unmappable action degrades to the unknown-tag path', () => {
  let haGateway; let tagWriter; let broadcast; let logger; let now;

  beforeEach(() => {
    haGateway = { callService: vi.fn().mockResolvedValue({ ok: true }) };
    tagWriter = { recordObserved: vi.fn().mockResolvedValue({ created: true }), setNfcNote: vi.fn() };
    broadcast = vi.fn();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    now = 1714137138000;
  });

  const registry = (modality = 'nfc') => ({
    [modality]: {
      locations: {
        livingroom: {
          target: 'livingroom-tv', action: 'launch-rocket', auth_token: null,
          notify_unknown: 'mobile_app_kc_phone', defaults: {},
        },
      },
      tags: { '04a1b2c3': { global: { plex: 620707 }, overrides: {} } },
    },
  });

  const makeService = (config) => new TriggerDispatchService({
    ...TEST_RUNTIME,
    config,
    contentIdResolver: makeResolver(),
    wakeAndLoadService: { execute: vi.fn() },
    actuationGateway: actuationFor({ haGateway, deviceService: { get: vi.fn() } }),
    tagWriter,
    broadcast,
    logger,
    clock: () => now,
  });

  it('writes the placeholder and pushes notify_unknown, as an unregistered tag would', async () => {
    const service = makeService(registry());
    const result = await service.handleTrigger('livingroom', 'nfc', '04a1b2c3');

    expect(result.code).toBe('UNKNOWN_ACTION');
    expect(tagWriter.recordObserved).toHaveBeenCalledWith('04a1b2c3', expect.any(String));
    expect(haGateway.callService).toHaveBeenCalledWith('notify', 'mobile_app_kc_phone', expect.any(Object));
  });

  it('one physical tap is one placeholder and one push, however many times HA fires it', async () => {
    const service = makeService(registry());
    await service.handleTrigger('livingroom', 'nfc', '04a1b2c3');
    const second = await service.handleTrigger('livingroom', 'nfc', '04a1b2c3');

    expect(second.debounced).toBe(true);
    expect(tagWriter.recordObserved).toHaveBeenCalledTimes(1);
    expect(haGateway.callService).toHaveBeenCalledTimes(1);
  });

  it('leaves a non-NFC modality alone — there is no tag registry to place it in', async () => {
    const service = makeService({
      state: {
        locations: {
          livingroom: { target: 'livingroom-tv', auth_token: null, states: { off: { action: 'launch-rocket' } } },
        },
      },
    });
    const result = await service.handleTrigger('livingroom', 'state', 'off');

    expect(result.code).toBe('UNKNOWN_ACTION');
    expect(tagWriter.recordObserved).not.toHaveBeenCalled();
  });
});

// The guard suppression is scoped to content, so it needs a test that content
// still gets it — otherwise scoping it reads as removing it.
describe('TriggerDispatchService — zombie-wake-guard suppression is content-only', () => {
  const guardedRegistry = (action, extra = {}) => ({
    nfc: {
      locations: { livingroom: { target: 'livingroom-tv', action, auth_token: null, notify_unknown: null, defaults: {} } },
      tags: { '838e6806': { global: { plex: 620707, ...extra }, overrides: {} } },
    },
  });

  function makeService(config, haGateway) {
    return new TriggerDispatchService({
    ...TEST_RUNTIME,
      config,
      contentIdResolver: makeResolver(),
      wakeAndLoadService: { execute: vi.fn().mockResolvedValue({ ok: true }) },
      actuationGateway: actuationFor({
        haGateway,
        deviceService: { get: vi.fn().mockReturnValue({ loadContent: vi.fn().mockResolvedValue({ ok: true }), clearContent: vi.fn().mockResolvedValue({ ok: true }) }) },
      }),
      tagWriter: { recordObserved: vi.fn().mockResolvedValue({ created: true }) },
      broadcast: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
  }

  it('disables the guard for a content play, which is what wakes the TV', async () => {
    const haGateway = { callService: vi.fn().mockResolvedValue({ ok: true }) };
    await makeService(guardedRegistry('play-next'), haGateway).handleTrigger('livingroom', 'nfc', '838e6806');
    expect(haGateway.callService).toHaveBeenCalledWith('automation', 'turn_off', {
      entity_id: 'automation.living_room_tv_zombie_wake_guard', stop_actions: true,
    });
  });

  it('leaves it alone for a clear, which wakes nothing', async () => {
    const haGateway = { callService: vi.fn().mockResolvedValue({ ok: true }) };
    await makeService(guardedRegistry('clear'), haGateway).handleTrigger('livingroom', 'nfc', '838e6806');
    expect(haGateway.callService).not.toHaveBeenCalled();
  });
});

/**
 * The interceptor seam is only real if the dispatcher actually CARRIES it.
 *
 * `#deps` is an explicit whitelist — "a dep that is not named here never
 * reaches responseHandlers" — so a seam built in `responseHandlers.content` and
 * an interceptor handed to `createTriggerApiRouter` can both be perfectly
 * correct while nothing whatsoever is connected between them. That is a failure
 * with no symptom in either unit: every claim test passes, every interceptor
 * test passes, and in the field the book just plays.
 */
describe('TriggerDispatchService — content interceptors reach the content handler', () => {
  const registry = {
    nfc: {
      locations: {
        livingroom: {
          target: 'livingroom-tv', action: 'play-next', end: 'tv-off',
          auth_token: null, defaults: {},
        },
      },
      tags: { '838e6806': { global: { plex: 620707 }, overrides: {} } },
    },
  };

  function service({ contentInterceptors, wakeAndLoadService }) {
    return new TriggerDispatchService({
    ...TEST_RUNTIME,
      config: registry,
      contentIdResolver: makeResolver(),
      wakeAndLoadService,
      haGateway: { callService: vi.fn().mockResolvedValue({ ok: true }) },
      deviceService: { get: vi.fn() },
      contentInterceptors,
      broadcast: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
  }

  it('a claimed book tap never reaches wake-and-load', async () => {
    const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    const result = await service({
      contentInterceptors: [{ claim: async () => ({ claimed: true, by: 'reading-session' }) }],
      wakeAndLoadService,
    }).handleTrigger('livingroom', 'nfc', '838e6806');

    expect(wakeAndLoadService.execute).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('an unclaimed book tap plays exactly as it does today', async () => {
    const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    await service({
      contentInterceptors: [{ claim: async () => null }],
      wakeAndLoadService,
    }).handleTrigger('livingroom', 'nfc', '838e6806');

    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1);
  });

  // D8, end to end through the dispatcher: the reader is configured
  // `end: tv-off`, and a suppressing interceptor must take it off the dispatch.
  it('a suppressing interceptor strips the reader s tv-off from the load options', async () => {
    const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    await service({
      contentInterceptors: [{ claim: async () => null, suppressEnd: () => true }],
      wakeAndLoadService,
    }).handleTrigger('livingroom', 'nfc', '838e6806');

    const [, , options] = wakeAndLoadService.execute.mock.calls[0];
    expect(options.endBehavior).toBeUndefined();
  });

  it('and without one, the reader s tv-off still rides along', async () => {
    const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    await service({ contentInterceptors: [], wakeAndLoadService })
      .handleTrigger('livingroom', 'nfc', '838e6806');

    const [, , options] = wakeAndLoadService.execute.mock.calls[0];
    expect(options).toMatchObject({ endBehavior: 'tv-off' });
  });
});

/**
 * D9 — the unknown-tag path gets an observer.
 *
 * A tag that resolves to nothing never becomes a content `Response`, so the
 * content-interceptor seam never sees it. This is the only place in the
 * pipeline that knows a tap happened at a reader and meant nothing — and until
 * now the only things it told were the observed registry and a phone in
 * another room. The screen in front of the child was told nothing.
 *
 * The hook ADDS. Neither the registry write nor the push may be traded for it.
 */
describe('TriggerDispatchService — the unknown-tag observer', () => {
  const registry = {
    nfc: {
      locations: {
        livingroom: {
          target: 'livingroom-tv', action: 'play-next',
          auth_token: null, notify_unknown: 'mobile_app_phone', defaults: {},
        },
      },
      tags: {
        // Named, but mapping to nothing — the "state 2" branch that returns
        // early from the registry write and still has a child at the reader.
        'aa11bb22': { global: { note: 'a book somebody named and never mapped' }, overrides: {} },
      },
    },
  };

  function service({ onUnknownTag, tagWriter, haGateway } = {}) {
    const homeGateway = haGateway ?? { callService: vi.fn().mockResolvedValue({ ok: true }) };
    return new TriggerDispatchService({
    ...TEST_RUNTIME,
      config: registry,
      contentIdResolver: makeResolver(),
      wakeAndLoadService: { execute: vi.fn() },
      actuationGateway: actuationFor({ haGateway: homeGateway, deviceService: { get: vi.fn() } }),
      tagWriter: tagWriter ?? { recordObserved: vi.fn().mockResolvedValue({ created: true }) },
      onUnknownTag,
      broadcast: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
  }

  it('names the reader and the tag for an unregistered tap', async () => {
    const seen = [];
    await service({ onUnknownTag: (info) => seen.push(info) })
      .handleTrigger('livingroom', 'nfc', '04deadbeef');
    expect(seen).toEqual([{ location: 'livingroom', uid: '04deadbeef', modality: 'nfc' }]);
  });

  it('and STILL writes the observed registry and sends the push', async () => {
    const tagWriter = { recordObserved: vi.fn().mockResolvedValue({ created: true }) };
    const haGateway = { callService: vi.fn().mockResolvedValue({ ok: true }) };
    await service({ onUnknownTag: () => {}, tagWriter, haGateway })
      .handleTrigger('livingroom', 'nfc', '04deadbeef');
    expect(tagWriter.recordObserved).toHaveBeenCalledTimes(1);
    expect(haGateway.callService).toHaveBeenCalledWith('notify', 'mobile_app_phone', expect.any(Object));
  });

  // A tag with a note but no mapping takes the early return out of the
  // registry write — and there is still a child at the reader who tapped it.
  it('fires for a NAMED tag that maps to nothing, which writes no registry entry', async () => {
    const seen = [];
    const tagWriter = { recordObserved: vi.fn().mockResolvedValue({ created: true }) };
    await service({ onUnknownTag: (info) => seen.push(info), tagWriter })
      .handleTrigger('livingroom', 'nfc', 'aa11bb22');
    expect(seen).toHaveLength(1);
    expect(tagWriter.recordObserved).not.toHaveBeenCalled();
  });

  it('an observer that THROWS cannot break the tap, or the registry write', async () => {
    const tagWriter = { recordObserved: vi.fn().mockResolvedValue({ created: true }) };
    const result = await service({
      onUnknownTag: () => { throw new Error('boom'); }, tagWriter,
    }).handleTrigger('livingroom', 'nfc', '04deadbeef');
    expect(result.code).toBe('TRIGGER_NOT_REGISTERED');
    expect(tagWriter.recordObserved).toHaveBeenCalledTimes(1);
  });

  it('no observer wired at all changes nothing', async () => {
    const tagWriter = { recordObserved: vi.fn().mockResolvedValue({ created: true }) };
    await service({ tagWriter }).handleTrigger('livingroom', 'nfc', '04deadbeef');
    expect(tagWriter.recordObserved).toHaveBeenCalledTimes(1);
  });
});
