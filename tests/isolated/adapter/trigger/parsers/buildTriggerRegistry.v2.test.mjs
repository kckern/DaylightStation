import { describe, it, expect } from 'vitest';
import { buildTriggerRegistry } from '#adapters/trigger/parsers/buildTriggerRegistry.mjs';

describe('buildTriggerRegistry v2', () => {
  it('assembles nfc/state/tags/responses/endpoints from new blobs', () => {
    const reg = buildTriggerRegistry({
      sources: {
        livingroom: { modality: 'nfc', target: 'livingroom-tv', action: 'play-next' },
        'lr-state': { modality: 'state', location: 'livingroom', target: 'livingroom-tv', states: { off: { action: 'clear' } } },
      },
      bindingsNfc: { '1a_95_71_06': { plex: 456598, action: 'queue', livingroom: { action: 'play' } } },
      responses: { 'r1': { kind: 'content' } },
      endpoints: { 'e1': { method: 'POST', url: 'http://x' } },
    });
    expect(reg.nfc.locations.livingroom.target).toBe('livingroom-tv');
    expect(reg.state.locations.livingroom.states.off).toEqual({ action: 'clear' });
    expect(reg.nfc.tags['1a_95_71_06'].global).toMatchObject({ plex: 456598, action: 'queue' });
    expect(reg.nfc.tags['1a_95_71_06'].overrides.livingroom).toEqual({ action: 'play' });
    expect(reg.responses.r1).toEqual({ kind: 'content' });
    expect(reg.endpoints.e1).toMatchObject({ method: 'POST' });
  });

  it('tolerates all blobs absent', () => {
    const reg = buildTriggerRegistry({});
    expect(reg).toEqual({ nfc: { locations: {}, tags: {} }, state: { locations: {} }, responses: {}, endpoints: {} });
  });
});
