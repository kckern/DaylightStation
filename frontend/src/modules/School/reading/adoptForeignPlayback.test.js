import { describe, it, expect, vi } from 'vitest';
import { resolveAdoptablePlayback } from './adoptForeignPlayback.js';

const track = (contentId, over = {}) => ({ contentId, mediaType: 'audio', title: contentId, ...over });
const capture = (over = {}) => ({
  state: 'playing',
  currentItem: { contentId: 'plex:674737' },
  position: 11.785,
  queue: { items: [track('plex:674737')], currentIndex: 0 },
  ...over,
});
const queueOf = (...items) => vi.fn(async () => ({ items }));

describe('resolveAdoptablePlayback', () => {
  it('proves the field case: the single-track book playing at 0:11.785', async () => {
    const fetchQueue = queueOf(track('plex:674737'), { contentId: 'marker', mediaType: 'trigger/side-effect' });
    const result = await resolveAdoptablePlayback({ capture: capture(), bookContentId: 'plex:674736', fetchQueue });
    expect(fetchQueue).toHaveBeenCalledWith('plex:674736');
    expect(result).toEqual({
      ok: true, positionSec: 11.785, trackContentId: 'plex:674737',
      play: [track('plex:674737')],
    });
  });

  it('adopts a multi-track book on track 2 — the queue starts at the playing track', async () => {
    const fetchQueue = queueOf(track('t1'), track('t2'), track('t3'));
    const result = await resolveAdoptablePlayback({
      capture: capture({ currentItem: { contentId: 't2' }, position: 40 }), bookContentId: 'book', fetchQueue,
    });
    expect(result.ok).toBe(true);
    expect(result.play.map((i) => i.contentId)).toEqual(['t2', 't3']);
    expect(result.positionSec).toBe(40);
  });

  it('a paused book is still the child s book — adoptable', async () => {
    const result = await resolveAdoptablePlayback({ capture: capture({ state: 'paused' }), bookContentId: 'b', fetchQueue: queueOf(track('plex:674737')) });
    expect(result.ok).toBe(true);
  });

  it.each(['idle', 'ended', 'error'])('declines not-playing when the player is %s', async (state) => {
    const result = await resolveAdoptablePlayback({ capture: capture({ state }), bookContentId: 'b', fetchQueue: queueOf(track('plex:674737')) });
    expect(result).toEqual({ ok: false, reason: 'not-playing' });
  });

  it('declines no-owner with no capture or no current item', async () => {
    expect(await resolveAdoptablePlayback({ capture: null, bookContentId: 'b', fetchQueue: queueOf() })).toEqual({ ok: false, reason: 'no-owner' });
    expect(await resolveAdoptablePlayback({ capture: capture({ currentItem: null }), bookContentId: 'b', fetchQueue: queueOf() })).toEqual({ ok: false, reason: 'no-owner' });
  });

  it('declines content-mismatch when a movie started since the book was tapped', async () => {
    const result = await resolveAdoptablePlayback({
      capture: capture({ currentItem: { contentId: 'plex:99999' }, state: 'playing' }),
      bookContentId: 'plex:674736', fetchQueue: queueOf(track('plex:674737')),
    });
    expect(result).toEqual({ ok: false, reason: 'content-mismatch' });
  });

  it('declines unverified (not a mismatch) when the book s queue cannot be read — no proof, no adoption', async () => {
    const fetchQueue = vi.fn(async () => { throw new Error('HTTP 502'); });
    expect(await resolveAdoptablePlayback({ capture: capture(), bookContentId: 'b', fetchQueue })).toEqual({ ok: false, reason: 'unverified' });
  });

  it('treats a non-finite position as 0 rather than failing the adoption', async () => {
    const result = await resolveAdoptablePlayback({ capture: capture({ position: NaN }), bookContentId: 'b', fetchQueue: queueOf(track('plex:674737')) });
    expect(result).toMatchObject({ ok: true, positionSec: 0 });
  });
});

// THE REAL CAPTURE SHAPE (review C1, 2026-09-30). The screen's session source
// returns `{ snapshot, identity, capabilities }`; state, current item and
// position live under `snapshot`. The fixtures above were flat, which is why
// every real adoption would have been declined `no-owner` while they passed.
import { createSessionSource } from '../../../screen-framework/publishers/SessionSource.js';

describe('resolveAdoptablePlayback — through the real session source', () => {
  it('proves the field case from a capture built by createSessionSource', async () => {
    const source = createSessionSource({
      ownerId: 'livingroom-tv',
      queueController: {
        capture: () => ({
          state: 'playing', currentItem: { contentId: 'plex:674737' }, position: 11.785,
          queue: { items: [{ contentId: 'plex:674737' }], currentIndex: 0 },
        }),
      },
    });
    const result = await resolveAdoptablePlayback({
      capture: source.capture(), bookContentId: 'plex:674736', fetchQueue: queueOf(track('plex:674737')),
    });
    expect(result).toMatchObject({ ok: true, positionSec: 11.785, trackContentId: 'plex:674737' });
  });

  it('declines no-owner from a real idle source (no player mounted)', async () => {
    const source = createSessionSource({ ownerId: 'livingroom-tv' });
    expect(await resolveAdoptablePlayback({ capture: source.capture(), bookContentId: 'b', fetchQueue: queueOf() }))
      .toEqual({ ok: false, reason: 'no-owner' });
  });
});
