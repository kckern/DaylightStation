import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TriggerDispatchService } from '#apps/trigger/TriggerDispatchService.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('TriggerDispatchService (modality-aware lookup)', () => {
  let logger, broadcast, deps, service;

  const config = {
    livingroom: {
      target: 'livingroom-tv',
      action: 'play',
      auth_token: null,
      entries: {
        nfc: { '83_8e_68_06': { plex: 620707 } },
        state: { off: { action: 'clear' } },
      },
    },
  };

  beforeEach(() => {
    logger = makeLogger();
    broadcast = vi.fn();
    deps = {
      wakeAndLoadService: { execute: vi.fn() },
      haGateway: { callService: vi.fn() },
      deviceService: { get: vi.fn() },
    };
    service = new TriggerDispatchService({
      config,
      contentIdResolver: null,
      ...deps,
      broadcast,
      logger,
    });
  });

  it('resolves an nfc trigger via entries.nfc', async () => {
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06', { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.action).toBe('play');
    expect(result.target).toBe('livingroom-tv');
  });

  it('resolves a state trigger via entries.state', async () => {
    const result = await service.handleTrigger('livingroom', 'state', 'off', { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.action).toBe('clear');
    expect(result.target).toBe('livingroom-tv');
  });

  it('returns TRIGGER_NOT_REGISTERED for unknown modality', async () => {
    const result = await service.handleTrigger('livingroom', 'voice', 'hello', {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TRIGGER_NOT_REGISTERED');
  });

  it('returns TRIGGER_NOT_REGISTERED for unknown value within a known modality', async () => {
    const result = await service.handleTrigger('livingroom', 'state', 'frozen', {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TRIGGER_NOT_REGISTERED');
  });

  it('returns LOCATION_NOT_FOUND for unknown location', async () => {
    const result = await service.handleTrigger('attic', 'nfc', 'whatever', {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe('LOCATION_NOT_FOUND');
  });
});
