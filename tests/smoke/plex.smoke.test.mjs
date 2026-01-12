import { describe, it, expect, beforeAll } from '@jest/globals';

describe('Plex connectivity', () => {
  let plexUrl;
  let plexToken;

  beforeAll(async () => {
    // Dynamic import to handle ESM config loading
    const { configService } = await import('../../backend/_legacy/lib/config/ConfigService.mjs');

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
