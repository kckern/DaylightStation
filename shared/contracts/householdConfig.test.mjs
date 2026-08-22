import * as registry from './householdConfig.mjs';

const { HOUSEHOLD_APP_CONFIGS, appConfigRelPath, allAppNames } = registry;

describe('householdConfig registry', () => {
  it('maps an app to its grouped path under the household folder', () => {
    expect(appConfigRelPath('scales')).toBe('hardware/scales');
    expect(appConfigRelPath('vehicles')).toBe('automotive/vehicles');
    expect(appConfigRelPath('concierge')).toBe('agents/concierge');
  });

  it('returns null for an app it does not know', () => {
    expect(appConfigRelPath('nope')).toBeNull();
  });

  // INVERTED in Phase E. This used to assert legacyAppConfigRelPath('scales')
  // === 'config/scales'. The flat path is gone, and the export with it — an
  // unregistered app must now resolve to NOTHING rather than degrading to a
  // flat file, because degrading is what silently recreated household/config/
  // on the write side. Asserting the export's absence keeps a well-meaning
  // "restore the fallback" from sneaking back in unnoticed.
  it('exposes NO legacy flat-path helper — the registry is the only lookup', () => {
    expect(registry.legacyAppConfigRelPath).toBeUndefined();
    expect(appConfigRelPath('nope')).toBeNull();
  });

  // No registry VALUE may point back into the retired flat directory.
  it('registers no path under the retired config/ directory', () => {
    const flat = Object.entries(HOUSEHOLD_APP_CONFIGS)
      .filter(([, rel]) => rel.startsWith('config/'));
    expect(flat).toEqual([]);
  });

  it('keeps the media domain/surface split honest', () => {
    // `media` is the DOMAIN (plex host, infinity board ids).
    // `media-app` is the SURFACE (browse menu, searchScopes).
    expect(appConfigRelPath('media')).toBe('media/config');
    expect(appConfigRelPath('media-app')).toBe('media/app');
  });

  it('names school explicitly rather than by convention', () => {
    expect(appConfigRelPath('school')).toBe('school/school');
  });

  it('has no duplicate destination paths', () => {
    const paths = Object.values(HOUSEHOLD_APP_CONFIGS);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('lists every registered app', () => {
    expect(allAppNames()).toContain('playback-hub');
    expect(allAppNames().length).toBe(Object.keys(HOUSEHOLD_APP_CONFIGS).length);
  });
});
