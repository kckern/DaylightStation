// backend/src/3_applications/content/services/PlayResponseService.surround.test.mjs

import { describe, it, expect, vi } from 'vitest';
import { PlayResponseService } from './PlayResponseService.mjs';

const ITEM = {
  id: 'plex:663134',
  title: 'Beethoven: 3. Sinfonie',
  mediaUrl: '/api/v1/proxy/plex/stream/663134',
  mediaType: 'video',
  duration: 3223,
  resumable: true,
  thumbnail: '/thumb.jpg',
  metadata: { grandparentTitle: 'Classical' }
};

const PAYLOAD = {
  id: 'concert-hall',
  definition: { regions: { right: { module: 'composer-card' } } },
  piece: { title: 'Symphony No. 3' },
  pieceSegments: [{ n: 1, name: 'Allegro con brio', start: 0 }],
  cues: [],
  facts: [],
  composer: { name: 'Ludwig van Beethoven' },
  assetBase: 'surround/classical'
};

// The live container case: season plex:696233, second étude episode plex:696235.
const EPISODE = {
  id: 'plex:696235',
  title: 'Études, Op. 25',
  mediaUrl: '/api/v1/proxy/plex/stream/696235',
  mediaType: 'video',
  duration: 2016,
  resumable: true,
  metadata: {}
};

const SEASON_PAYLOAD = {
  ...PAYLOAD,
  piece: { title: 'Études' },
  timeline: {
    totalSounding: 3738,
    parts: [
      { contentId: 'plex:696234', index: 0, sounding: 1800 },
      { contentId: 'plex:696235', index: 1, sounding: 1550 },
      { contentId: 'plex:696236', index: 2, sounding: 388 }
    ]
  }
};

const EPISODE_PAYLOAD = { ...PAYLOAD, piece: { title: 'Études, Op. 25' } };

const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() });
// The composed logger is a child logger; keep the same spies so assertions see the calls.
const makeChildLogger = () => {
  const l = makeLogger();
  l.child.mockReturnValue(l);
  return l;
};

const makeService = (surroundStore, logger) => new PlayResponseService({
  mediaProgressMemory: null,
  surroundStore,
  logger
});

describe('PlayResponseService surround attachment', () => {
  it('attaches the payload verbatim when the store hits', () => {
    const logger = makeChildLogger();
    const store = { lookup: vi.fn().mockReturnValue(PAYLOAD) };
    const response = makeService(store, logger).toPlayResponse(ITEM);

    expect(store.lookup).toHaveBeenCalledWith('plex:663134', 'Beethoven: 3. Sinfonie');
    expect(response.surround).toEqual(PAYLOAD);
    const attached = logger.debug.mock.calls.find((c) => c[0] === 'surround.attach');
    expect(attached).toBeDefined();
    expect(attached[1]).toMatchObject({ contentId: 'plex:663134', surroundId: 'concert-hall', path: 'play' });
  });

  it('omits the key entirely when no store is composed', () => {
    const response = new PlayResponseService({ mediaProgressMemory: null }).toPlayResponse(ITEM);
    expect('surround' in response).toBe(false);
  });

  it('returns a response identical to the no-store response when the store misses', () => {
    const bare = new PlayResponseService({ mediaProgressMemory: null }).toPlayResponse(ITEM);
    const store = { lookup: vi.fn().mockReturnValue(null) };
    const missed = makeService(store, makeChildLogger()).toPlayResponse(ITEM);

    expect(store.lookup).toHaveBeenCalled();
    expect(missed).toEqual(bare);
    expect('surround' in missed).toBe(false);
  });

  it('attaches the container payload to a child item, with its part index', () => {
    const logger = makeChildLogger();
    const store = {
      // The episode HAS its own sidecar; the container's claim must still win,
      // which is why lookupByPart is asked first rather than as a fallback.
      lookup: vi.fn().mockReturnValue(EPISODE_PAYLOAD),
      lookupByPart: vi.fn((id) => (id === 'plex:696235' ? { payload: SEASON_PAYLOAD, part: 1 } : null))
    };
    const response = makeService(store, logger)
      .toPlayResponse(EPISODE, null, { containerId: 'plex:696233' });

    expect(response.surround).toEqual(SEASON_PAYLOAD);
    expect(response.surroundPart).toBe(1);
    expect(store.lookup).not.toHaveBeenCalled();
    const attached = logger.debug.mock.calls.find((c) => c[0] === 'surround.attach');
    expect(attached[1]).toMatchObject({ containerId: 'plex:696233', part: 1, path: 'play' });
  });

  it('gives the same episode its own standalone frame when played directly', () => {
    const store = {
      lookup: vi.fn().mockReturnValue(EPISODE_PAYLOAD),
      lookupByPart: vi.fn().mockReturnValue({ payload: SEASON_PAYLOAD, part: 1 })
    };
    const response = makeService(store, makeChildLogger()).toPlayResponse(EPISODE);

    expect(response.surround).toEqual(EPISODE_PAYLOAD);
    expect('surroundPart' in response).toBe(false);
    expect(store.lookupByPart).not.toHaveBeenCalled();
  });

  it('does not attach a container payload to an unrelated item', () => {
    const store = { lookup: () => null, lookupByPart: () => null };
    const response = makeService(store, makeChildLogger())
      .toPlayResponse({ id: 'plex:other', title: 'x', metadata: {} }, null, { containerId: 'plex:696233' });

    expect(response.surround).toBeUndefined();
    expect('surroundPart' in response).toBe(false);
  });

  it('falls back to the item\'s own sidecar when the container does not claim it', () => {
    const store = {
      lookup: vi.fn().mockReturnValue(EPISODE_PAYLOAD),
      lookupByPart: vi.fn().mockReturnValue(null)
    };
    const response = makeService(store, makeChildLogger())
      .toPlayResponse(EPISODE, null, { containerId: 'plex:696233' });

    expect(response.surround).toEqual(EPISODE_PAYLOAD);
    expect('surroundPart' in response).toBe(false);
  });

  it('still returns a playable response when the store violates its never-throw contract', () => {
    const logger = makeChildLogger();
    const store = { lookup: vi.fn(() => { throw new Error('index corrupt'); }) };
    const response = makeService(store, logger).toPlayResponse(ITEM);

    expect(response.id).toBe('plex:663134');
    expect('surround' in response).toBe(false);
    const warned = logger.warn.mock.calls.find((c) => c[0] === 'surround.attach.failed');
    expect(warned).toBeDefined();
    expect(warned[1]).toMatchObject({ contentId: 'plex:663134', error: 'index corrupt' });
  });
});
