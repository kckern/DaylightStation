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
      upsertNfcPlaceholder: vi.fn().mockResolvedValue({ created: true }),
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
      config,
      contentIdResolver: { resolve: () => null },
      wakeAndLoadService,
      haGateway,
      deviceService,
      tagWriter,
      broadcast,
      logger,
      clock: () => now,
    });
  }

  it('state 0 — first scan: writes placeholder, notifies, returns 404', async () => {
    const service = makeService(makeRegistry());
    const result = await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');

    expect(result.ok).toBe(false);
    expect(result.code).toBe('TRIGGER_NOT_REGISTERED');

    expect(tagWriter.upsertNfcPlaceholder).toHaveBeenCalledWith(
      '04_a1_b2_c3',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    );

    expect(haGateway.callService).toHaveBeenCalledWith(
      'notify',
      'mobile_app_kc_phone',
      expect.objectContaining({
        title: expect.stringMatching(/livingroom/i),
        message: expect.stringContaining('04_a1_b2_c3'),
        data: expect.objectContaining({
          actions: [expect.objectContaining({
            action: 'NFC_REPLY|livingroom|04_a1_b2_c3',
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
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');
    expect(tagWriter.upsertNfcPlaceholder).toHaveBeenCalled();
    expect(haGateway.callService).not.toHaveBeenCalled();
  });

  it('state 1 — re-scan with placeholder but no note: notifies, no new write', async () => {
    tagWriter.upsertNfcPlaceholder.mockResolvedValue({ created: false });
    const registry = makeRegistry({
      tags: { '04_a1_b2_c3': { global: { scanned_at: '2026-04-26 10:00:00' }, overrides: {} } },
    });
    const service = makeService(registry);
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');

    // upsert is called but no-ops (returns { created: false })
    expect(tagWriter.upsertNfcPlaceholder).toHaveBeenCalled();
    expect(haGateway.callService).toHaveBeenCalledTimes(1);
  });

  it('state 2 — has note already: silent (no notify, no write)', async () => {
    const registry = makeRegistry({
      tags: { '04_a1_b2_c3': {
        global: { scanned_at: '2026-04-26 10:00:00', note: 'kids movie' },
        overrides: {},
      } },
    });
    const service = makeService(registry);
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');

    expect(tagWriter.upsertNfcPlaceholder).not.toHaveBeenCalled();
    expect(haGateway.callService).not.toHaveBeenCalled();
    // Broadcast still fires for observer dashboards:
    expect(broadcast).toHaveBeenCalled();
  });

  it('debounce extends to unknown branch: second scan within 3s does not re-notify', async () => {
    const service = makeService(makeRegistry());
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');
    now += 1500; // 1.5 s later
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');
    expect(haGateway.callService).toHaveBeenCalledTimes(1);
    expect(tagWriter.upsertNfcPlaceholder).toHaveBeenCalledTimes(1);
  });

  it('debounce window expiry allows a second notify', async () => {
    tagWriter.upsertNfcPlaceholder
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: false });
    const service = makeService(makeRegistry());
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');
    now += 35000; // 35 s later, past 30 s default window
    await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');
    expect(haGateway.callService).toHaveBeenCalledTimes(2);
  });

  it('notify failure does not change the GET response or skip broadcast', async () => {
    haGateway.callService.mockRejectedValue(new Error('HA down'));
    const service = makeService(makeRegistry());
    const result = await service.handleTrigger('livingroom', 'nfc', '04_a1_b2_c3');
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
    expect(tagWriter.upsertNfcPlaceholder).not.toHaveBeenCalled();
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
    const result = await service.setNote('livingroom', 'nfc', '04_a1_b2_c3', 'kids favorite');
    expect(result.ok).toBe(true);
    expect(tagWriter.setNfcNote).toHaveBeenCalledWith(
      '04_a1_b2_c3',
      'kids favorite',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    );
  });

  it('lowercases the value before writing', async () => {
    const service = makeService();
    await service.setNote('livingroom', 'nfc', 'AA_BB_CC', 'x');
    expect(tagWriter.setNfcNote).toHaveBeenCalledWith('aa_bb_cc', 'x', expect.any(String));
  });

  it('broadcasts trigger.note_set on the location/modality topic', async () => {
    const service = makeService();
    await service.setNote('livingroom', 'nfc', '04_a1_b2_c3', 'kids favorite');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'trigger:livingroom:nfc',
      type: 'trigger.note_set',
      location: 'livingroom',
      modality: 'nfc',
      value: '04_a1_b2_c3',
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
