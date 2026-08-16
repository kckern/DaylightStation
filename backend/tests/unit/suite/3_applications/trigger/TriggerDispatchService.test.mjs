import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TriggerDispatchService } from '#apps/trigger/TriggerDispatchService.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('TriggerDispatchService (modality-aware lookup)', () => {
  let logger, broadcast, deps, service;

  // The MODALITY-FIRST registry the service actually receives, as built by
  // YamlTriggerConfigRepository.loadRegistry() and mirrored by the fallback in
  // 5_composition/modules/triggerApi.mjs:
  //   { nfc: { locations, tags }, state: { locations }, responses, endpoints }
  //
  // This file previously described a location-first shape with a nested
  // `entries: { nfc, state }`, which the code stopped reading when lookup
  // became modality-aware. Every case fell out at the modality gate, so all
  // five assertions were testing the same one line.
  //
  // Tag keys are CANONICAL uids — separators stripped, lowercased — because
  // that is what canonicalizeNfcUid() produces before the lookup.
  const config = {
    nfc: {
      locations: {
        livingroom: { target: 'livingroom-tv', action: 'play' },
      },
      tags: {
        '838e6806': { global: { content: 'plex/620707' } },
      },
    },
    state: {
      locations: {
        livingroom: {
          target: 'livingroom-tv',
          states: { off: { action: 'clear' } },
        },
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

  it('resolves an nfc trigger via the nfc slice', async () => {
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06', { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.action).toBe('play');
    expect(result.target).toBe('livingroom-tv');
  });

  it('resolves a state trigger via the state slice', async () => {
    const result = await service.handleTrigger('livingroom', 'state', 'off', { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.action).toBe('clear');
    expect(result.target).toBe('livingroom-tv');
  });

  // UNKNOWN_MODALITY, not TRIGGER_NOT_REGISTERED. The service checks the
  // modality slice before anything else precisely so an unrecognised modality
  // is distinguishable from a recognised one that had no matching entry —
  // see the comment above the check. The old expectation predated that split.
  it('returns UNKNOWN_MODALITY for an unknown modality', async () => {
    const result = await service.handleTrigger('livingroom', 'voice', 'hello', {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNKNOWN_MODALITY');
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
