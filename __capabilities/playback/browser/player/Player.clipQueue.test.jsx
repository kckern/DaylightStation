// Clip queues through the real Player: a saved query whose `/queue` items each
// play one window (`segment`) of a longer recording. The window's end must end
// the visit and advance the queue, and the durable progress logged on the way
// must be a fraction of the recording, not of the clip.
import React, { createRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Player from './Player.jsx';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import { useCommonMediaController } from './hooks/useCommonMediaController.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from './lib/recoveryLedger.js';

vi.mock('../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

const RECORDING = 5000;
const TIMELINE = {
  expectedEndSeconds: RECORDING, provenance: 'catalog', clipStartSeconds: null, clipEndSeconds: null,
  rendererStartSeconds: 0, contentStartSeconds: 0,
};

// The `/queue` item shapes, as the queue router projects them.
const plexClip = (n, start, end, { timeline = true } = {}) => ({
  id: `plex:1001#${n}`, contentId: `plex:1001#${n}`, title: `Carol ${n}`, source: 'plex',
  mediaUrl: '/api/v1/proxy/plex/stream/1001', mediaType: 'video', format: 'video',
  duration: RECORDING, resumable: false, resumePosition: null, shuffle: false, continuous: false,
  resume: false, active: true, subtitle: 'Winter Concert (2001)', segment: { start, end },
  surroundPart: 0, metadata: {},
  ...(timeline ? { contentTimeline: TIMELINE } : {}),
});
// A videoRules segment of an Immich video: no catalog timeline at all.
const immichSegment = (i, start, end) => ({
  id: `immich:abc#seg${i}`, contentId: `immich:abc#seg${i}`, title: 'Home video', source: 'immich',
  mediaUrl: '/api/v1/proxy/immich/assets/abc/video/playback', mediaType: 'video', format: 'video',
  duration: end - start, resumable: true, shuffle: false, continuous: false, resume: false, active: true,
  segment: { start, end, index: i, total: 2 }, metadata: {},
});

let ledger;
beforeEach(() => {
  vi.useFakeTimers();
  DaylightAPI.mockReset();
  ledger = createRecoveryLedger();
  _setSharedLedgerForTests(ledger);
  useCommonMediaController.__appliedStartByKey = Object.create(null);
  useCommonMediaController.__lastPosByKey = Object.create(null);
  useCommonMediaController.__lastSeekByKey = Object.create(null);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); _setSharedLedgerForTests(null); vi.useRealTimers(); vi.restoreAllMocks(); });

function prime(node, seconds) {
  Object.defineProperties(node, {
    currentTime: { configurable: true, writable: true, value: seconds },
    duration: { configurable: true, writable: true, value: RECORDING },
    readyState: { configurable: true, value: 4 },
    paused: { configurable: true, writable: true, value: false },
    ended: { configurable: true, writable: true, value: false },
    buffered: { configurable: true, value: { length: 1, start: () => 0, end: () => RECORDING } },
  });
  act(() => node.dispatchEvent(new Event('loadedmetadata')));
}
const tick = (node, seconds) => act(() => {
  node.currentTime = seconds;
  node.dispatchEvent(new Event('timeupdate'));
});

async function mountQueue(items, { via = 'queue' } = {}) {
  DaylightAPI.mockImplementation(async (path) => (String(path).includes('/queue/') ? { items } : {}));
  const completed = vi.fn();
  const ref = createRef();
  await act(async () => {
    const source = { contentId: 'query:winter-songs' };
    // `queue` is a menu's Queue action; `play` is a session item (a MediaApp
    // `?queue=query:<name>` deep link reaches the Player this way).
    render(<Player ref={ref} {...{ [via]: source }} onPlaybackCompleted={completed} clear={vi.fn()} />);
  });
  for (let i = 0; i < 5 && !ref.current.getMediaElement(); i += 1) {
    await act(async () => { vi.advanceTimersByTime(50); });
  }
  const node = ref.current.getMediaElement();
  expect(node).toBeTruthy();
  return { ref, node, completed };
}

const playLogs = () => DaylightAPI.mock.calls.filter(([path]) => path === 'api/v1/play/log').map(([, body]) => body);

describe('a clip queue through the Player', () => {
  it.each([
    ['a Plex clip with the recording\'s timeline', [plexClip(1, 4000, 4300), plexClip(2, 100, 300)]],
    ['a Plex clip without a timeline', [plexClip(1, 4000, 4300, { timeline: false }), plexClip(2, 100, 300, { timeline: false })]],
    ['a videoRules segment', [immichSegment(0, 4000, 4300), immichSegment(1, 100, 300)]],
  ])('ends %s at its window and advances', async (_label, items) => {
    const { ref, node, completed } = await mountQueue(items);
    expect(ref.current.getNowPlaying().item.contentId).toBe(items[0].contentId);
    prime(node, 4000);
    tick(node, 4150);
    expect(completed).not.toHaveBeenCalled();
    tick(node, 4300);
    expect(completed).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(ref.current.getNowPlaying().item.contentId).toBe(items[1].contentId);
    expect(ref.current.getNowPlaying().queuePosition).toBe(1);
  });

  it('plays the first clip\'s window when the query arrives as a session item', async () => {
    const items = [plexClip(1, 4000, 4300), plexClip(2, 100, 300)];
    const { ref, node, completed } = await mountQueue(items, { via: 'play' });
    expect(ref.current.getNowPlaying().item).toMatchObject({ contentId: 'plex:1001#1', segment: { start: 4000, end: 4300 } });
    prime(node, 4000);
    tick(node, 4300);
    expect(completed).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(ref.current.getNowPlaying().item.contentId).toBe('plex:1001#2');
  });

  it('logs progress as a fraction of the recording for a clip deep into it', async () => {
    const { node } = await mountQueue([plexClip(1, 4000, 4300), plexClip(2, 100, 300)]);
    prime(node, 4000);
    tick(node, 4100);
    const logs = playLogs();
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(Number(log.percent)).toBeGreaterThan(0);
      expect(Number(log.percent)).toBeLessThanOrEqual(100);
    }
    expect(logs.at(-1)).toMatchObject({ seconds: 4100, percent: '82.0' });
  });
});
