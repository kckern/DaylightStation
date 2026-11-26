import React, { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { resetApiResourceCache } from '../../../../../frontend/src/lib/hooks/useApiResource.js';

const apiMock = vi.fn(() => Promise.resolve({ items: [] }));
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...args) => apiMock(...args) }));
const log = vi.hoisted(() => ({ started: vi.fn(), stopped: vi.fn() }));
vi.mock("../logging/mediaLog.js", async (importOriginal) => {
  const real = await importOriginal();
  const facade = { ...real.default, previewStarted: log.started, previewStopped: log.stopped };
  return { ...real, default: facade, mediaLog: facade };
});

const dispatchLeafVerb = vi.fn();
const run = vi.fn();
let contentState;
vi.mock("./useContentInfo.js", () => ({ useContentInfo: () => contentState }));
vi.mock("../search/useContentDispatch.js", () => ({ useContentDispatch: () => ({ dispatchLeafVerb }) }));
vi.mock("../household/useItemVerbs.jsx", () => ({ useItemVerbs: () => ({ run, overlays: null, nameFor: (id) => id }) }));
vi.mock("../cast/CastButton.jsx", () => ({ CastButton: () => null }));
const pop = vi.fn();
vi.mock("../shell/NavProvider.jsx", () => ({ useNav: () => ({ pop, backDestination: 'Search' }) }));

import { InfoPreview, previewSource } from "./InfoPreview.jsx";
import { DetailView } from "./DetailView.jsx";
import { habitsStore } from "../habits/mediaHabits.js";
import { resetPreparedStarts } from "../cast/usePrepareStart.js";

const FILM = {
  id: 'plex:55854', contentId: 'plex:55854', title: 'Arrival', type: 'movie', mediaType: 'video',
  mediaUrl: '/api/v1/proxy/plex/library/parts/9/1/file.mp4', thumbnail: 'arrival.jpg',
};

let calls;
beforeEach(() => {
  vi.clearAllMocks();
  resetApiResourceCache();
  resetPreparedStarts();
  habitsStore().recordScreen('video', []);
  calls = [];
  apiMock.mockReset();
  apiMock.mockImplementation((...args) => { calls.push(args); return Promise.resolve({ items: [] }); });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play() { return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  contentState = { info: { ...FILM }, loading: false, error: null };
});
afterEach(() => { vi.restoreAllMocks(); });

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);
const writes = () => calls.filter(([, , method]) => method && method !== 'GET');

describe('previewSource (what may play inside the art)', () => {
  it('uses a native progressive file the info already named', () => {
    expect(previewSource(FILM)).toBe(FILM.mediaUrl);
  });
  it('never a stream that would mint a transcode, and never audio', () => {
    expect(previewSource({ ...FILM, mediaType: 'dash_video', mediaUrl: '/api/v1/proxy/plex/stream/55854' })).toBeNull();
    expect(previewSource({ ...FILM, mediaType: 'video', mediaUrl: '/api/v1/proxy/plex/stream/55854' })).toBeNull();
    expect(previewSource({ ...FILM, mediaType: 'hls_video', mediaUrl: '/x/index.m3u8' })).toBeNull();
    expect(previewSource({ ...FILM, type: 'track', mediaType: 'audio', mediaUrl: '/a.mp3' })).toBeNull();
    expect(previewSource({ ...FILM, mediaUrl: undefined })).toBeNull();
  });
});

describe('InfoPreview', () => {
  it('offers nothing for audio, and nothing plays until Preview is pressed', () => {
    const { rerender } = wrap(<InfoPreview item={{ ...FILM, type: 'track', mediaType: 'audio', mediaUrl: '/a.mp3' }} />);
    expect(screen.queryByTestId('detail-preview')).toBeNull();
    rerender(<MantineProvider><InfoPreview item={FILM} /></MantineProvider>);
    expect(screen.getByTestId('detail-preview')).toHaveTextContent('Preview');
    expect(document.querySelector('video')).toBeNull();
    fireEvent.focus(screen.getByTestId('detail-preview'));
    fireEvent.mouseEnter(screen.getByTestId('detail-preview'));
    expect(document.querySelector('video')).toBeNull();
  });

  it('plays muted on this device inside the art, records and sends nothing', async () => {
    const onStart = vi.fn();
    wrap(<InfoPreview item={FILM} onStart={onStart} />);
    await act(async () => { fireEvent.click(screen.getByTestId('detail-preview')); });
    const video = document.querySelector('.detail-poster-box video');
    expect(video).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(video.getAttribute('src')).toBe(FILM.mediaUrl);
    expect(screen.getByTestId('detail-preview-label')).toHaveTextContent('Preview');
    expect(onStart).toHaveBeenCalled();
    expect(log.started).toHaveBeenCalledWith({ contentId: 'plex:55854', seconds: 0 });
    expect(calls).toEqual([]);
  });

  it('does not look like PLAY: no filled/amber variant, no play glyph', () => {
    wrap(<InfoPreview item={FILM} />);
    const btn = screen.getByTestId('detail-preview');
    expect(btn.getAttribute('data-variant')).not.toBe('filled');
    expect(btn.className).not.toMatch(/amber|accent|play/i);
    expect(btn.querySelector('.tabler-icon-player-play, .tabler-icon-player-play-filled')).toBeNull();
  });

  it('stop releases the file (src removed + load) and logs the seconds watched', async () => {
    const ref = createRef();
    const onStop = vi.fn();
    wrap(<InfoPreview ref={ref} item={FILM} onStop={onStop} />);
    await act(async () => { fireEvent.click(screen.getByTestId('detail-preview')); });
    const video = document.querySelector('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 12.6 });
    act(() => { ref.current.stop(); });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    expect(video.hasAttribute('src')).toBe(false);
    expect(document.querySelector('video')).toBeNull();
    expect(log.stopped).toHaveBeenCalledWith({ contentId: 'plex:55854', seconds: 13 });
    expect(onStop).toHaveBeenCalled();
  });

  it('unmounting stops it', async () => {
    const { unmount } = wrap(<InfoPreview item={FILM} />);
    await act(async () => { fireEvent.click(screen.getByTestId('detail-preview')); });
    unmount();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    expect(log.stopped).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:55854' }));
  });
});

describe('DetailView with a preview (Review Focus 4)', () => {
  it('PLAY stops the preview before the dispatch begins; nothing from the preview reaches history', async () => {
    const order = [];
    log.stopped.mockImplementation(() => order.push('preview-stopped'));
    run.mockImplementation(() => { order.push('dispatch'); return 'local'; });
    wrap(<DetailView contentId="plex:55854" />);
    await act(async () => { fireEvent.click(screen.getByTestId('detail-preview')); });
    expect(document.querySelector('.detail-poster-box video')).not.toBeNull();
    fireEvent.click(screen.getByTestId('detail-play-now'));
    expect(order).toEqual(['preview-stopped', 'dispatch']);
    expect(document.querySelector('video')).toBeNull();
    expect(writes()).toEqual([]);
    expect(calls.some(([url]) => /play\/log|progress/.test(String(url)))).toBe(false);
  });

  it('Back stops it', async () => {
    const { unmount } = wrap(<DetailView contentId="plex:55854" />);
    await act(async () => { fireEvent.click(screen.getByTestId('detail-preview')); });
    fireEvent.click(screen.getByTestId('detail-back'));
    expect(pop).toHaveBeenCalled();
    unmount();
    expect(log.stopped).toHaveBeenCalled();
  });

  it('offers no preview for an item without a safe file', () => {
    contentState = { info: { ...FILM, mediaType: 'dash_video', mediaUrl: '/api/v1/proxy/plex/stream/55854' }, loading: false, error: null };
    wrap(<DetailView contentId="plex:55854" />);
    expect(screen.queryByTestId('detail-preview')).toBeNull();
    expect(screen.getByTestId('detail-play-now')).toBeInTheDocument();
  });
});
