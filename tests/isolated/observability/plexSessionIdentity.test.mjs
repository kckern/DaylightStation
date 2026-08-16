// tests/isolated/observability/plexSessionIdentity.test.mjs
//
// Tier 2, Task 2.1 — the adapter half.
//
// On 2026-08-16 the piano kiosk opened 495 Plex transcode sessions in four
// minutes for one lecture, and diagnosing it meant reading Plex's own server
// log inside its container: PlexAdapter minted a fresh random identifier per
// request, so Plex recorded 495 distinct CLIENTS rather than one client
// retrying. These tests pin the identifier down at the adapter boundary.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PlexAdapter, sanitizePlexSessionId } from '#adapters/content/media/plex/PlexAdapter.mjs';

const ADAPTER_SOURCE = fileURLToPath(
  new URL('../../../backend/src/1_adapters/content/media/plex/PlexAdapter.mjs', import.meta.url)
);

function adapter(httpClient = { get: async () => ({}) }) {
  return new PlexAdapter({ host: 'http://plex.test', token: 't' }, { httpClient });
}

// A realistic value in the CURRENT frontend shape: `${singlePlayerKey}#${playerInstanceId}`.
const instanceA = '008c56a342:0#AbCdEfGhIj';
const instanceB = '008c56a342:0#KlMnOpQrSt';

describe('sanitizePlexSessionId', () => {
  it('leaves an already-safe value byte-for-byte alone', () => {
    expect(sanitizePlexSessionId('008c56a342:0')).toBe('008c56a342:0');
  });

  it('removes the # that would truncate a hand-built Plex url', () => {
    const out = sanitizePlexSessionId(instanceA);
    expect(out).not.toContain('#');
    expect(out).toMatch(/^[A-Za-z0-9._~:-]+$/);
  });

  it('keeps two different sessions different after sanitising', () => {
    expect(sanitizePlexSessionId(instanceA)).not.toBe(sanitizePlexSessionId(instanceB));
  });

  it('keeps values distinct when replacement alone would collide', () => {
    // '#' and '-' both map to '-', so without the digest suffix these two
    // distinct sessions would arrive at Plex as one identity.
    expect(sanitizePlexSessionId('a#b')).not.toBe(sanitizePlexSessionId('a-b'));
  });

  it('keeps values distinct when truncation alone would collide', () => {
    const long = 'x'.repeat(200);
    expect(sanitizePlexSessionId(`${long}one`)).not.toBe(sanitizePlexSessionId(`${long}two`));
  });

  it('caps length so nothing upstream truncates for us', () => {
    expect(sanitizePlexSessionId('y'.repeat(500)).length).toBeLessThanOrEqual(96);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
    ['a non-string', 12345],
  ])('returns null for %s — "no usable session was supplied"', (_label, value) => {
    expect(sanitizePlexSessionId(value)).toBeNull();
  });
});

describe('PlexAdapter session identifiers', () => {
  it('is defined exactly once on the class', () => {
    // It was defined TWICE (~:901 and ~:1374). A duplicate method definition is
    // legal JavaScript — the later replaces the earlier — so one copy had never
    // executed while reading the file suggested it did, on the exact function
    // this incident turns on.
    const src = readFileSync(ADAPTER_SOURCE, 'utf-8');
    const definitions = src.match(/^\s{2}_generateSessionIds\s*\(/gm) || [];
    expect(definitions).toHaveLength(1);
  });

  it('presents the caller session to Plex instead of a fresh random one', () => {
    const ids = adapter()._generateSessionIds(instanceA);
    expect(ids.clientIdentifier).toBe(sanitizePlexSessionId(instanceA));
    expect(ids.clientIdentifier).not.toMatch(/^api-/);
    // The per-request identifier still moves — Plex wants a new one per segment
    // request — but it is now anchored to the stable client identifier.
    expect(ids.sessionIdentifier.startsWith(ids.clientIdentifier)).toBe(true);
  });

  it('gives two player instances two client identifiers', () => {
    const a = adapter()._generateSessionIds(instanceA);
    const b = adapter()._generateSessionIds(instanceB);
    expect(a.clientIdentifier).not.toBe(b.clientIdentifier);
  });

  it('falls back to a random identifier when no session is supplied', () => {
    // This is the branch that ran 495 times. Keeping it is correct — an
    // unidentified caller must not collide with another — but it must be
    // reachable ONLY when the caller genuinely sent nothing.
    const ids = adapter()._generateSessionIds(null);
    expect(ids.clientIdentifier).toMatch(/^api-/);
  });

  it('gives the audio stream its own identifier, derivable from the session', () => {
    const a = adapter();
    expect(a._generateSessionIds(instanceA, 'audio').clientIdentifier)
      .toBe(`${a.resolveClientIdentifier(instanceA)}-audio`);
  });

  it('resolveClientIdentifier answers without opening a stream', () => {
    const a = adapter();
    expect(a.resolveClientIdentifier(instanceA)).toBe(sanitizePlexSessionId(instanceA));
    expect(a.resolveClientIdentifier(null)).toBeNull();
  });
});

describe('PlexAdapter.getMediaUrl carries the session to Plex', () => {
  function movieMetadata() {
    return {
      MediaContainer: {
        Metadata: [{
          type: 'movie',
          ratingKey: '694719',
          title: 'A Lecture',
          Media: [{ videoCodec: 'hevc', audioCodec: 'eac3', container: 'mkv', Part: [{ key: '/library/parts/1/file.mkv' }] }],
        }],
      },
    };
  }

  function adapterWithDecisionFailure() {
    // Decision endpoint failing takes the _buildTranscodeUrl path, which is the
    // hand-built query string the sanitiser exists to protect.
    const httpClient = { get: vi.fn(async () => { throw new Error('decision unavailable'); }) };
    const a = adapter(httpClient);
    a.client.getMetadata = vi.fn(async () => movieMetadata());
    a.logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
    return a;
  }

  it('puts the caller session in X-Plex-Client-Identifier', async () => {
    const a = adapterWithDecisionFailure();
    const { url } = await a.getMediaUrl('694719', { startOffset: 0, session: instanceA });
    const expected = sanitizePlexSessionId(instanceA);
    expect(url).toContain(`X-Plex-Client-Identifier=${expected}`);
  });

  it('produces a url no fragment can truncate', async () => {
    const a = adapterWithDecisionFailure();
    const { url } = await a.getMediaUrl('694719', { startOffset: 0, session: instanceA });
    // A raw '#' would end the url there and drop every later parameter,
    // including the codec profile that keeps Chromium's demuxer from stalling.
    expect(url).not.toContain('#');
    expect(url).toContain('X-Plex-Client-Profile-Extra=');
  });

  it('gives two player instances two Plex identities for the same item', async () => {
    const urlFor = async (session) =>
      (await adapterWithDecisionFailure().getMediaUrl('694719', { startOffset: 0, session })).url;

    const [a, b] = await Promise.all([urlFor(instanceA), urlFor(instanceB)]);
    const idOf = (u) => new URL(`http://x${u.slice(u.indexOf('/video'))}`)
      .searchParams.get('X-Plex-Client-Identifier');

    expect(idOf(a)).not.toBe(idOf(b));
  });
});
