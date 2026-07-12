import { describe, it, expect } from 'vitest';
import { migrateTriggerConfig } from '../../../scripts/migrate-trigger-config.mjs';

describe('migrateTriggerConfig', () => {
  const old = {
    nfcLocations: { livingroom: { target: 'livingroom-tv', action: 'play-next', notify_unknown: 'mobile_app_kc_phone' } },
    stateLocations: { livingroom: { target: 'livingroom-tv', states: { off: { action: 'clear' } } } },
    nfcTags: {
      '1a_95_71_06': { plex: 456598, action: 'queue' },                                  // curated, no timestamp
      '04_2f_71_72': { scanned_at: '2026-04-26 17:44:56', note: 'Pinocchio', plex: 620699 }, // curated + observed
      '04_87_33_00': { scanned_at: '2026-04-26 17:44:48' },                               // placeholder only
    },
  };

  it('builds sources with modality and de-collides state', () => {
    const { sources } = migrateTriggerConfig(old);
    expect(sources.livingroom).toMatchObject({ modality: 'nfc', target: 'livingroom-tv', action: 'play-next' });
    expect(sources['livingroom-state']).toMatchObject({ modality: 'state', location: 'livingroom', target: 'livingroom-tv' });
  });

  it('strips scanned_at from bindings and drops placeholder-only tags', () => {
    const { bindingsNfc } = migrateTriggerConfig(old);
    expect(bindingsNfc['1a_95_71_06']).toEqual({ plex: 456598, action: 'queue' });
    expect(bindingsNfc['04_2f_71_72']).toEqual({ note: 'Pinocchio', plex: 620699 });
    expect(bindingsNfc['04_87_33_00']).toBeUndefined();
  });

  it('moves scanned_at into observed as first/last-seen', () => {
    const { observed } = migrateTriggerConfig(old);
    expect(observed['04_2f_71_72']).toEqual({ first_seen: '2026-04-26 17:44:56', last_seen: '2026-04-26 17:44:56', count: 1 });
    expect(observed['04_87_33_00']).toEqual({ first_seen: '2026-04-26 17:44:48', last_seen: '2026-04-26 17:44:48', count: 1 });
    expect(observed['1a_95_71_06']).toBeUndefined();
  });
});
