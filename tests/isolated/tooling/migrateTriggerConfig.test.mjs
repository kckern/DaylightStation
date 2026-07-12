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

  it('emits a barcode source per barcode-scanner device', () => {
    const { sources } = migrateTriggerConfig({
      ...old,
      barcodeConfig: { default_action: 'queue', actions: ['queue', 'play', 'open'] },
      scannerDevices: { ds2278: { type: 'barcode-scanner', target_screen: 'living-room' } },
    });
    expect(sources.ds2278).toEqual({
      modality: 'barcode',
      location: 'ds2278',
      target: 'living-room',
      default_action: 'queue',
      actions: ['queue', 'play', 'open'],
    });
  });

  it('ignores non-barcode-scanner devices and applies action defaults when barcodeConfig is absent', () => {
    const { sources } = migrateTriggerConfig({
      scannerDevices: {
        ds2278: { type: 'barcode-scanner', target_screen: 'office' },
        'office-tv': { type: 'linux-pc', target_screen: 'office' },
      },
    });
    expect(sources.ds2278).toEqual({
      modality: 'barcode',
      location: 'ds2278',
      target: 'office',
      default_action: 'queue',
      actions: ['queue', 'play', 'open'],
    });
    expect(sources['office-tv']).toBeUndefined();
  });
});
