import { describe, it, expect, vi, beforeEach, test } from 'vitest';
import { TriggerDispatchService } from '../../../../backend/src/3_applications/trigger/TriggerDispatchService.mjs';

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
      '83_8e_68_06': { global: { plex: 620707 }, overrides: {} },
      '8d_6d_2a_07': { global: { plex: 620708 }, overrides: {} },
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
      config,
      contentIdResolver: makeResolver(),
      wakeAndLoadService,
      haGateway,
      deviceService,
      broadcast,
      logger,
    });
  }

  it('returns ok and dispatches a content load for a known nfc trigger', async () => {
    const service = makeService();
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
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
    const result = await service.handleTrigger('attic', 'nfc', '83_8e_68_06');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/location/i);
    expect(result.code).toBe('LOCATION_NOT_FOUND');
  });

  it('returns 404-ish error for unknown trigger value (and logs the event)', async () => {
    const service = makeService();
    const result = await service.handleTrigger('livingroom', 'nfc', 'unknown_uid');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TRIGGER_NOT_REGISTERED');
    expect(logger.info).toHaveBeenCalledWith('trigger.fired',
      expect.objectContaining({ registered: false, value: 'unknown_uid' }));
  });

  it('lowercases the trigger value before lookup', async () => {
    const service = makeService();
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8E_68_06');
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
          '83_8e_68_06': { global: { plex: 620707 }, overrides: {} },
        },
      },
    };
    const service = makeService(registry);
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
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
          '83_8e_68_06': { global: { plex: 620707 }, overrides: {} },
        },
      },
    };
    const service = makeService(registry);
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06', {});
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
          '83_8e_68_06': { global: { plex: 620707 }, overrides: {} },
        },
      },
    };
    const service = makeService(registry);
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06', { token: 'secret' });
    expect(result.ok).toBe(true);
  });

  it('does not dispatch when dryRun is true (validates only)', async () => {
    const service = makeService();
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06', { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(wakeAndLoadService.execute).not.toHaveBeenCalled();
  });

  it('broadcasts a trigger.fired event to topic trigger:<location>:<type>', async () => {
    const service = makeService();
    await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'trigger:livingroom:nfc',
      type: 'trigger.fired',
      location: 'livingroom',
      value: '83_8e_68_06',
    }));
  });

  it('returns DISPATCH_FAILED when the action handler throws a non-UnknownAction error', async () => {
    wakeAndLoadService.execute.mockRejectedValue(new Error('TV unreachable'));
    const service = makeService();
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
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
      '83_8e_68_06': { global: { plex: '620707' }, overrides: {} },
      '8d_6d_2a_07': { global: { plex: '620708' }, overrides: {} },
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
      config: debounceRegistry,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
    });

    const first = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(first.ok).toBe(true);
    expect(first.debounced).toBeUndefined();
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1);

    const second = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(second.ok).toBe(true);
    expect(second.debounced).toBe(true);
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1); // unchanged
  });

  test('different tag in same window is NOT debounced', async () => {
    const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    const service = new TriggerDispatchService({
      config: debounceRegistry,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
    });

    await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    await service.handleTrigger('livingroom', 'nfc', '8d_6d_2a_07');
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(2);
  });

  test('scan after window elapses is dispatched normally', async () => {
    const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    let now = 1_000_000;
    const service = new TriggerDispatchService({
      config: debounceRegistry,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
      clock: () => now,
    });

    await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1);

    now += 3500; // past window
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(result.debounced).toBeUndefined();
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(2);
  });

  test('dryRun bypasses debounce', async () => {
    const wakeAndLoadService = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    const service = new TriggerDispatchService({
      config: debounceRegistry,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
    });

    await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    const dry = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06', { dryRun: true });
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
      config: debounceRegistry,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
    });

    const first = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(first.ok).toBe(false);

    const second = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(second.ok).toBe(true);
    expect(second.debounced).toBeUndefined();
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(2);
  });
});
