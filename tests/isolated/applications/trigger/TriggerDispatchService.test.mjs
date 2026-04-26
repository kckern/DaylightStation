import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { TriggerDispatchService } from '../../../../backend/src/3_applications/trigger/TriggerDispatchService.mjs';

const makeResolver = () => ({ resolve: (id) => /^plex:/.test(id) ? { source: 'plex' } : null });

describe('TriggerDispatchService.handleTrigger', () => {
  let wakeAndLoadService;
  let haGateway;
  let deviceService;
  let broadcast;
  let logger;

  beforeEach(() => {
    wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true, dispatchId: 'd1' }) };
    haGateway = { callService: jest.fn().mockResolvedValue({ ok: true }) };
    deviceService = { get: jest.fn().mockReturnValue({ loadContent: jest.fn().mockResolvedValue({ ok: true }) }) };
    broadcast = jest.fn();
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  });

  function makeService(configOverrides = null) {
    const config = configOverrides || {
      livingroom: {
        target: 'livingroom-tv',
        action: 'queue',
        auth_token: null,
        entries: { '83_8e_68_06': { plex: 620707 } },
      },
    };
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

  it('returns ok and dispatches a content load for a known trigger', async () => {
    const service = makeService();
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(result.ok).toBe(true);
    expect(result.action).toBe('queue');
    expect(result.target).toBe('livingroom-tv');
    expect(wakeAndLoadService.execute).toHaveBeenCalledWith(
      'livingroom-tv',
      expect.objectContaining({ queue: 'plex:620707' }),
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

  it('returns 400-ish error for unknown action', async () => {
    const service = makeService({
      livingroom: {
        target: 'livingroom-tv',
        action: 'queue',
        auth_token: null,
        entries: { '83_8e_68_06': { action: 'launch-rocket' } },
      },
    });
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNKNOWN_ACTION');
  });

  it('rejects when location has auth_token and the request omits it', async () => {
    const service = makeService({
      livingroom: {
        target: 'livingroom-tv',
        action: 'queue',
        auth_token: 'secret',
        entries: { '83_8e_68_06': { plex: 620707 } },
      },
    });
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06', {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AUTH_FAILED');
  });

  it('accepts when location auth_token matches', async () => {
    const service = makeService({
      livingroom: {
        target: 'livingroom-tv',
        action: 'queue',
        auth_token: 'secret',
        entries: { '83_8e_68_06': { plex: 620707 } },
      },
    });
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
});

const baseConfig = {
  livingroom: {
    target: 'livingroom-tv',
    action: 'play-next',
    entries: {
      nfc: {
        '83_8e_68_06': { plex: '620707' },
      },
    },
  },
};

const makeContentIdResolver = () => ({
  resolve: (entry) => (entry?.plex ? `plex:${entry.plex}` : null),
});

const silentLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
};

describe('TriggerDispatchService — debounce', () => {
  test('first scan dispatches; second scan within window is debounced', async () => {
    const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    const service = new TriggerDispatchService({
      config: baseConfig,
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
    const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    const config = {
      livingroom: {
        target: 'livingroom-tv',
        action: 'play-next',
        entries: {
          nfc: {
            '83_8e_68_06': { plex: '620707' },
            '8d_6d_2a_07': { plex: '620707' },
          },
        },
      },
    };
    const service = new TriggerDispatchService({
      config,
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
    const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    let now = 1_000_000;
    const service = new TriggerDispatchService({
      config: baseConfig,
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
    const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    const service = new TriggerDispatchService({
      config: baseConfig,
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
    const wakeAndLoadService = { execute: jest.fn().mockRejectedValueOnce(new Error('wake-fail')).mockResolvedValueOnce({ ok: true }) };
    const service = new TriggerDispatchService({
      config: baseConfig,
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
