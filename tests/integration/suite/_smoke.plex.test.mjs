import { describe, it, expect, beforeAll } from '@jest/globals';

describe('Plex connectivity', () => {
  let plexUrl;
  let plexToken;

  beforeAll(async () => {
    // Dynamic import to handle ESM config loading
    // Use new config infrastructure from src/0_infrastructure/config
    const { createConfigService } = await import('#backend/src/0_infrastructure/config/index.mjs');
    
    // Create a config service instance with the data path
    const dataDir = process.env.DAYLIGHT_DATA_PATH || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation';
    let configService;
    try {
      configService = createConfigService(dataDir);
    } catch (e) {
      // Config may not be available in test environment
      console.warn('SKIP: Could not load config:', e.message);
      return;
    }

    // Get Plex config from household auth or environment
    const plexAuth = configService.getHouseholdAuth('plex');
    plexUrl = plexAuth?.url || process.env.PLEX_URL;
    plexToken = plexAuth?.token || process.env.PLEX_TOKEN;
  });

  it('has Plex URL configured (or skips)', () => {
    if (!plexUrl) {
      console.warn('SKIP: Plex URL not configured');
      return;
    }
    expect(plexUrl).not.toBe('');
  });

  it('has Plex token configured (or skips)', () => {
    if (!plexToken) {
      console.warn('SKIP: Plex token not configured');
      return;
    }
    expect(plexToken).not.toBe('');
  });

  it('can reach Plex server identity endpoint', async () => {
    if (!plexUrl || !plexToken) {
      console.warn('SKIP: Plex not fully configured');
      return;
    }

    const response = await fetch(`${plexUrl}/identity`, {
      headers: { 'X-Plex-Token': plexToken }
    });

    expect(response.ok).toBe(true);
  });
});
