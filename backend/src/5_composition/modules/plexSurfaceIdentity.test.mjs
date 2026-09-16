/**
 * Plex surface identity resolution.
 *
 * Written because the first version of this logic lived as an inline closure in
 * app.mjs — untestable — and was wrong in a way nothing caught: it returned
 * null for every non-fleet caller, so a fitness video played in a browser
 * logged progress every 10s and never appeared in Plex. The rule is that ANY
 * Player playback of Plex content registers.
 *
 * The other half is the constraint that cannot be relaxed: identifiers must be
 * stable and bounded. A fresh one per request creates a permanent Plex device
 * row each time, which is what wedged the server earlier the same day.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createPlexSurfaceIdentityResolver,
  WEB_CLIENT_IDENTIFIER,
  WEB_DEVICE_NAME,
} from './plexSurfaceIdentity.mjs';

const DEVICES = {
  'livingroom-tv': {
    name: 'Living Room TV',
    plex: {
      client_identifier: '9f2c1e80-3b77-4f2e-9a41-6d2b8c5e1a03',
      product: 'DaylightStation',
      version: '1.0',
      platform: 'Linux',
      device: 'Living Room TV',
    },
  },
  'office-tv': { name: 'Office Screen' },                    // no plex block
  'broken-tv': { name: 'Broken', plex: { product: 'X' } },   // no identifier
  // A declared-but-unusable identifier: PlexClientIdentity rejects a blank one.
  'blank-tv': { name: 'Blank', plex: { client_identifier: '   ' } },
};

function build() {
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const resolve = createPlexSurfaceIdentityResolver({
    configService: { getHouseholdDevices: () => ({ devices: DEVICES }) },
    householdId: 'default',
    logger,
  });
  return { resolve, logger };
}

describe('declared fleet surfaces', () => {
  it('resolves to the surface’s own identity and human name', () => {
    const id = build().resolve('fleet:livingroom-tv');
    expect(id.clientIdentifier).toBe('9f2c1e80-3b77-4f2e-9a41-6d2b8c5e1a03');
    expect(id.device).toBe('Living Room TV');
    expect(id.displayName).toBe('Living Room TV');
  });
});

describe('every other caller still registers', () => {
  it('gives a browser a STABLE identity derived from its persisted token', () => {
    const { resolve } = build();
    const a = resolve('browser:f635bcb19c0d485f');
    const b = resolve('browser:f635bcb19c0d485f');
    expect(a.clientIdentifier).toBe(`${WEB_CLIENT_IDENTIFIER}-f635bcb19c0d485f`);
    expect(a.clientIdentifier).toBe(b.clientIdentifier); // stable, not per-request
    expect(a.device).toBe(WEB_DEVICE_NAME);
  });

  it('keeps two browsers apart so their sessions do not collide', () => {
    const { resolve } = build();
    expect(resolve('browser:aaa').clientIdentifier)
      .not.toBe(resolve('browser:bbb').clientIdentifier);
  });

  it('falls back to one shared identity for a User-Agent caller', () => {
    const id = build().resolve('Mozilla/5.0 (X11; Linux x86_64) Firefox/155.0');
    expect(id.clientIdentifier).toBe(WEB_CLIENT_IDENTIFIER);
  });

  it('never returns null — a play is a play', () => {
    const { resolve } = build();
    for (const input of [null, undefined, '', '   ', 'anything']) {
      expect(resolve(input)).not.toBeNull();
    }
  });

  it('reports a fleet screen that has no plex block rather than dropping it', () => {
    const { resolve, logger } = build();
    expect(resolve('fleet:office-tv').clientIdentifier).toBe(WEB_CLIENT_IDENTIFIER);
    expect(resolve('fleet:broken-tv').clientIdentifier).toBe(WEB_CLIENT_IDENTIFIER);
    // Neither is malformed — they simply declare nothing. Nothing to warn about.
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns AND still reports when a declared plex block is malformed', () => {
    const { resolve, logger } = build();
    expect(resolve('fleet:blank-tv').clientIdentifier).toBe(WEB_CLIENT_IDENTIFIER);
    expect(logger.warn).toHaveBeenCalledWith(
      'plex.session.identity_invalid',
      expect.objectContaining({ surfaceId: 'blank-tv' }),
    );
  });
});

describe('identifiers stay bounded', () => {
  it('NEVER derives an identifier from an ephemeral id', () => {
    // `lib/deviceIdentity.js` mints `ephemeral:<token>` fresh on every page load
    // when localStorage is unavailable. Deriving from it would create a
    // permanent Plex device row per page load — the 81,009-row outage, rebuilt.
    const { resolve } = build();
    const first = resolve('ephemeral:9a8b7c6d5e4f3021');
    const second = resolve('ephemeral:0123456789abcdef');
    expect(first.clientIdentifier).toBe(WEB_CLIENT_IDENTIFIER);
    expect(second.clientIdentifier).toBe(WEB_CLIENT_IDENTIFIER);
    // Two different ephemeral tokens must collapse to ONE Plex device.
    expect(first.clientIdentifier).toBe(second.clientIdentifier);
  });

  it('sanitises and caps a derived token', () => {
    const id = build().resolve(`browser:${'x'.repeat(200)}/../nasty chars`);
    expect(id.clientIdentifier.length).toBeLessThanOrEqual(WEB_CLIENT_IDENTIFIER.length + 1 + 64);
    expect(id.clientIdentifier).toMatch(/^daylight-web-[A-Za-z0-9_-]+$/);
  });
});
