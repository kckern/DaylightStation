import {
  HOUSEHOLD_APP_CONFIGS,
  appConfigRelPath,
  legacyAppConfigRelPath,
  allAppNames,
} from './householdConfig.mjs';

describe('householdConfig registry', () => {
  it('maps an app to its grouped path under the household folder', () => {
    expect(appConfigRelPath('scales')).toBe('hardware/scales');
    expect(appConfigRelPath('vehicles')).toBe('automotive/vehicles');
    expect(appConfigRelPath('concierge')).toBe('agents/concierge');
  });

  it('returns null for an app it does not know', () => {
    expect(appConfigRelPath('nope')).toBeNull();
  });

  it('gives the legacy flat path for any app name', () => {
    expect(legacyAppConfigRelPath('scales')).toBe('config/scales');
    expect(legacyAppConfigRelPath('nope')).toBe('config/nope');
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
