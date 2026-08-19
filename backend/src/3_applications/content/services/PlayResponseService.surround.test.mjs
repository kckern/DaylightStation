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
  movements: [{ n: 1, name: 'Allegro con brio', start: 0 }],
  cues: [],
  facts: [],
  composer: { name: 'Ludwig van Beethoven' },
  assetBase: 'surround/classical'
};

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
