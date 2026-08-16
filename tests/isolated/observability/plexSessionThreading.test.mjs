// tests/isolated/observability/plexSessionThreading.test.mjs
//
// Tier 2, Task 2.1 — the end-to-end half.
//
// The frontend has minted a client session and put it on the wire as
// `?session=` for a long time. Nothing in the backend read it, so the identity
// died at the first hop: `play.mjs` ignored it, the returned `mediaUrl` did not
// carry it, `proxy.mjs` had nothing to pass on, and PlexAdapter minted a random
// identifier per request. These tests walk the value through every hop.
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from '#backend/src/4_api/v1/routers/play.mjs';
import { createProxyRouter } from '#backend/src/4_api/v1/routers/proxy.mjs';
import { PlayResponseService } from '#apps/content/services/PlayResponseService.mjs';
import { sanitizePlexSessionId } from '#adapters/content/media/plex/PlexAdapter.mjs';

const instanceA = '008c56a342:0#AbCdEfGhIj';
const instanceB = '008c56a342:0#KlMnOpQrSt';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {}, sampled: () => {} };

/** A Plex-shaped adapter: same mediaUrl scheme and the same identifier contract. */
function fakePlexAdapter() {
  return {
    source: 'plex',
    getItem: async (localId) => ({
      id: `plex:${localId}`,
      mediaUrl: `/api/v1/proxy/plex/stream/${localId}`,
      mediaType: 'video',
      title: 'A Lecture',
      duration: 3600,
      resumable: true,
      thumbnail: null,
      metadata: { type: 'movie' },
      isContainer: () => false,
    }),
    resolveClientIdentifier: (session) => sanitizePlexSessionId(session),
  };
}

function playApp(adapter = fakePlexAdapter()) {
  const app = express();
  app.use('/play', createPlayRouter({
    registry: { get: () => adapter },
    mediaProgressMemory: null,
    playResponseService: new PlayResponseService({ mediaProgressMemory: null }),
    contentIdResolver: { resolve: (compoundId) => ({ adapter, source: 'plex', localId: compoundId.split(':')[1] }) },
    logger: silentLogger,
  }));
  return app;
}

function proxyApp(getMediaUrl) {
  const plex = { getMediaUrl };
  const app = express();
  app.use('/proxy', createProxyRouter({
    registry: { get: (name) => (name === 'plex' ? plex : null) },
    logger: silentLogger,
  }));
  return app;
}

describe('play route → mediaUrl', () => {
  it('threads ?session= into the returned Plex stream url', async () => {
    const res = await request(playApp()).get(`/play/plex:694719?session=${encodeURIComponent(instanceA)}`);

    expect(res.status).toBe(200);
    // A query param and not a header: this url is fetched by the <video>/dash
    // element itself, which cannot be given custom headers.
    const url = new URL(res.body.mediaUrl, 'http://host');
    expect(url.searchParams.get('session')).toBe(instanceA);
  });

  it('reports the identifier Plex will log, so the frontend can log the same key', async () => {
    const res = await request(playApp()).get(`/play/plex:694719?session=${encodeURIComponent(instanceA)}`);

    expect(res.body.plexClientIdentifier).toBe(sanitizePlexSessionId(instanceA));
  });

  it('says WHICH absence it is when no session is sent', async () => {
    const res = await request(playApp()).get('/play/plex:694719');

    // Present-and-null: a Plex stream whose caller minted no session, so Plex
    // will see a fresh random client per request. Distinct from the field being
    // absent, which means the response is not a Plex stream at all.
    expect(res.body).toHaveProperty('plexClientIdentifier', null);
    expect(res.body.mediaUrl).not.toContain('session=');
  });

  it('leaves a non-Plex response without the field entirely', async () => {
    const local = fakePlexAdapter();
    local.getItem = async () => ({
      id: 'filesystem:song.mp3',
      mediaUrl: '/api/v1/proxy/media/stream/song.mp3',
      mediaType: 'audio',
      title: 'Song',
      duration: 120,
      resumable: false,
      metadata: {},
      isContainer: () => false,
    });

    const res = await request(playApp(local)).get(`/play/filesystem:song.mp3?session=${encodeURIComponent(instanceA)}`);

    expect(res.body).not.toHaveProperty('plexClientIdentifier');
    expect(res.body.mediaUrl).not.toContain('session=');
  });

  it('keeps the resume offset alongside the session', async () => {
    const adapter = fakePlexAdapter();
    const svc = new PlayResponseService({ mediaProgressMemory: null });
    const item = await adapter.getItem('694719');
    const response = svc.toPlayResponse(
      item,
      { contentId: 'plex:694719', playhead: 900, duration: 3600, percent: 25 },
      { adapter, session: instanceA }
    );

    const url = new URL(response.mediaUrl, 'http://host');
    expect(url.searchParams.get('offset')).toBe('900');
    expect(url.searchParams.get('session')).toBe(instanceA);
  });
});

describe('proxy route → PlexAdapter', () => {
  it('passes the session the media element carried through to getMediaUrl', async () => {
    const getMediaUrl = vi.fn(async () => ({ url: 'http://plex.test/video/:/transcode/universal/start.mpd' }));

    const res = await request(proxyApp(getMediaUrl))
      .get(`/proxy/plex/stream/694719?offset=900&session=${encodeURIComponent(instanceA)}`);

    expect(res.status).toBe(302);
    expect(getMediaUrl).toHaveBeenCalledWith('694719', { startOffset: 900, session: instanceA });
  });

  it('logs both identities, so the mint line joins in both directions', async () => {
    const sampled = [];
    const logger = { ...silentLogger, sampled: (event, data) => sampled.push({ event, data }) };
    const plex = { getMediaUrl: async () => ({ url: 'http://plex.test/x.mpd' }), resolveClientIdentifier: sanitizePlexSessionId };
    const app = express();
    app.use('/proxy', createProxyRouter({ registry: { get: () => plex }, logger }));

    await request(app).get(`/proxy/plex/stream/694719?session=${encodeURIComponent(instanceA)}`);

    const mint = sampled.find((s) => s.event === 'plex.stream.mint');
    // `session` joins to the frontend's mint line; `plexClientIdentifier` joins
    // to Plex's server log. They are related but not equal, so a line with only
    // one of them is joinable in only one direction.
    expect(mint.data.session).toBe(instanceA);
    expect(mint.data.plexClientIdentifier).toBe(sanitizePlexSessionId(instanceA));
  });

  it('passes null when the media element carried no session', async () => {
    const getMediaUrl = vi.fn(async () => ({ url: 'http://plex.test/x.mpd' }));

    await request(proxyApp(getMediaUrl)).get('/proxy/plex/stream/694719');

    expect(getMediaUrl).toHaveBeenCalledWith('694719', { startOffset: 0, session: null });
  });
});

describe('two player instances stay two clients all the way through', () => {
  // The `#<instanceId>` suffix is what makes threading this value safe at all.
  // Before it existed the session was content-derived, so two devices playing
  // the same title computed an IDENTICAL value — and threading it then would
  // have handed Plex one identifier for two independent streams.
  it('produces two distinct identifiers at every hop', async () => {
    const seen = [];
    const getMediaUrl = vi.fn(async (_key, opts) => {
      seen.push(opts.session);
      return { url: 'http://plex.test/x.mpd' };
    });

    const app = playApp();
    const responses = await Promise.all([instanceA, instanceB].map((s) =>
      request(app).get(`/play/plex:694719?session=${encodeURIComponent(s)}`)));

    // Hop 1: the play responses disagree.
    const [idA, idB] = responses.map((r) => r.body.plexClientIdentifier);
    expect(idA).not.toBe(idB);

    // Hop 2: the urls the media elements will fetch disagree.
    const urls = responses.map((r) => r.body.mediaUrl);
    expect(urls[0]).not.toBe(urls[1]);

    // Hop 3: what the adapter is asked for disagrees.
    const proxy = proxyApp(getMediaUrl);
    for (const mediaUrl of urls) {
      await request(proxy).get(mediaUrl.replace('/api/v1/proxy', '/proxy'));
    }
    expect(seen).toEqual([instanceA, instanceB]);
    expect(sanitizePlexSessionId(seen[0])).not.toBe(sanitizePlexSessionId(seen[1]));
  });
});
