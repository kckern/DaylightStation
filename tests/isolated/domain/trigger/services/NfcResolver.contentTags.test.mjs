import { describe, it, expect } from 'vitest';
import { NfcResolver } from "../../../../../__capabilities/device-dispatch/server/domain/services/NfcResolver.mjs";

const contentIdResolver = { resolve: (compound) => (/^(plex|files):/.test(compound) ? compound : null) };
const tag = (global, overrides = {}) => ({ global, overrides });
const contentTags = (tags, resolver = contentIdResolver) => NfcResolver.contentTags({ registry: { locations: {}, tags }, contentIdResolver: resolver });

describe('NfcResolver.contentTags', () => {
  it('resolves shorthand through the content-id resolver, with the note', () => {
    expect(contentTags({
      '04aa': tag({ note: 'Jungle book', plex: 620681 }),
      '0bbb': tag({ files: 'stories/owl.mp3', scanned_at: '2026-01-01' }),
    })).toEqual([
      { uid: '04aa', contentId: 'plex:620681', note: 'Jungle book' },
      { uid: '0bbb', contentId: 'files:stories/owl.mp3', note: null },
    ]);
  });

  it('takes an explicit content id as written', () => {
    expect(contentTags({ c: tag({ content: 'plex:5', note: 'Five' }) }))
      .toEqual([{ uid: 'c', contentId: 'plex:5', note: 'Five' }]);
  });

  it('keeps play and play-next tags, drops queues, learner cards, scenes and unresolvable keys', () => {
    expect(contentTags({
      p: tag({ action: 'play', plex: 1 }),
      n: tag({ action: 'play-next', plex: 2 }),
      q: tag({ action: 'queue', plex: 456598, shuffle: 1 }),
      card: tag({ note: 'learner card', school_learner: 'test-learner' }),
      scene: tag({ note: 'Lights', scene: 'scene.evening' }),
      odd: tag({ mystery: 7 }),
    }).map((t) => t.contentId)).toEqual(['plex:1', 'plex:2']);
  });

  it('skips an ambiguous tag instead of throwing', () => {
    expect(contentTags({ two: tag({ plex: 1, files: 'x' }), ok: tag({ plex: 3 }) }).map((t) => t.uid)).toEqual(['ok']);
  });

  it('answers [] for an empty or missing registry', () => {
    expect(NfcResolver.contentTags({ registry: null, contentIdResolver })).toEqual([]);
    expect(contentTags({})).toEqual([]);
  });
});
