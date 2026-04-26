import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TriggerDispatchService } from '../../../../backend/src/3_applications/trigger/TriggerDispatchService.mjs';

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
    deviceService = { get: vi.fn().mockReturnValue({ loadContent: vi.fn().mockResolvedValue({ ok: true }) }) };
    broadcast = vi.fn();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  });

  function makeService(configOverrides = null) {
    // Production now keys entries by modality first then value, i.e.
    // entries[modality][value]. See TriggerDispatchService.handleTrigger
    // (backend/src/3_applications/trigger/TriggerDispatchService.mjs:43).
    const config = configOverrides || {
      livingroom: {
        target: 'livingroom-tv',
        action: 'queue',
        auth_token: null,
        entries: { nfc: { '83_8e_68_06': { plex: 620707 } } },
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
        entries: { nfc: { '83_8e_68_06': { action: 'launch-rocket' } } },
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
        entries: { nfc: { '83_8e_68_06': { plex: 620707 } } },
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
        entries: { nfc: { '83_8e_68_06': { plex: 620707 } } },
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
