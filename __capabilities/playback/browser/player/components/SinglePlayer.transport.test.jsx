import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SinglePlayer } from './SinglePlayer.jsx';
import { fetchMediaInfo } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ fetchMediaInfo: vi.fn() }));
vi.mock('../renderers/VideoPlayer.jsx', () => ({
  VideoPlayer: ({ media }) => (
    <output data-testid="video-transport">{media.mediaType}|{media.segment ? `${media.segment.start}-${media.segment.end}` : 'whole'}</output>
  ),
}));
vi.mock('../renderers/ImageFrame.jsx', () => ({
  ImageFrame: ({ media }) => (
    <output data-testid="image-frame">{media.mediaUrl || 'no-url'}|{media.slideshow?.focusPerson || 'no-slideshow'}</output>
  ),
}));

describe('SinglePlayer transport descriptor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the authoritative HLS descriptor instead of a stale opaque stream queue format', async () => {
    fetchMediaInfo.mockResolvedValue({
      id: 'plex:55854', contentId: 'plex:55854', title: 'Arrival',
      mediaUrl: '/api/v1/proxy/plex/stream/55854', mediaType: 'hls_video', format: 'hls_video',
    });

    render(<SinglePlayer
      contentId="plex:55854"
      mediaUrl="/api/v1/proxy/plex/stream/55854"
      mediaType="dash_video"
      format="dash_video"
      clear={vi.fn()}
      advance={vi.fn()}
    />);

    expect(await screen.findByTestId('video-transport')).toHaveTextContent('hls_video');
    expect(fetchMediaInfo).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:55854' }));
  });

  it('asks the server not to resume when the request fixes its own start', async () => {
    fetchMediaInfo.mockResolvedValue({
      id: 'plex:50896', contentId: 'plex:50896', mediaUrl: '/api/v1/proxy/plex/stream/50896', mediaType: 'dash_video', format: 'dash_video',
    });
    const { unmount } = render(<SinglePlayer contentId="plex:50896" seconds={0} clear={vi.fn()} advance={vi.fn()} />);
    await screen.findByTestId('video-transport');
    expect(fetchMediaInfo).toHaveBeenLastCalledWith(expect.objectContaining({ resume: false }));
    unmount();
    render(<SinglePlayer contentId="plex:50897" clear={vi.fn()} advance={vi.fn()} />);
    await screen.findByTestId('video-transport');
    expect(fetchMediaInfo).toHaveBeenLastCalledWith(expect.objectContaining({ resume: undefined }));
  });

  it('keeps identity-less direct embeds on the direct-media bypass', async () => {
    render(<SinglePlayer
      mediaUrl="https://media.example.test/embed/opaque"
      mediaType="hls_video"
      format="unregistered_embed"
      clear={vi.fn()}
      advance={vi.fn()}
    />);

    expect(await screen.findByText(/unregistered_embed/)).toBeInTheDocument();
    expect(fetchMediaInfo).not.toHaveBeenCalled();
  });

  // Queue-built Immich items (saved queries) carry playback shape that only the
  // queue knows: a photo's preview URL + slideshow config, a clip's segment.
  // `/play` returns none of it — a photo comes back with no mediaUrl and renders
  // as an empty frame (2026-10-07 birthday montage went dark after the intro).
  it('keeps a queue photo on its own mediaUrl and slideshow config', async () => {
    render(<SinglePlayer
      contentId="immich:82bc356a"
      mediaUrl="/api/v1/proxy/immich/assets/82bc356a/thumbnail?size=preview"
      mediaType="image"
      format="image"
      slideshow={{ duration: 5, focusPerson: 'test-person' }}
      clear={vi.fn()}
      advance={vi.fn()}
    />);

    expect(await screen.findByTestId('image-frame'))
      .toHaveTextContent('/api/v1/proxy/immich/assets/82bc356a/thumbnail?size=preview|test-person');
    expect(fetchMediaInfo).not.toHaveBeenCalled();
  });

  it('keeps a queue video segment instead of resolving the whole clip', async () => {
    render(<SinglePlayer
      contentId="immich:bfd3eccb#seg0"
      mediaUrl="/api/v1/proxy/immich/assets/bfd3eccb/video/playback"
      mediaType="video"
      format="video"
      segment={{ start: 0, end: 15, index: 0, total: 3 }}
      clear={vi.fn()}
      advance={vi.fn()}
    />);

    expect(await screen.findByTestId('video-transport')).toHaveTextContent('video|0-15');
    expect(fetchMediaInfo).not.toHaveBeenCalled();
  });
});


it('keeps excluded audio metadata on its existing native timeline', async () => {
  fetchMediaInfo.mockResolvedValue({ id: 'files:audio', contentId: 'files:audio', title: 'Audio',
    mediaUrl: '/audio.mp3', mediaType: 'audio', format: 'audio', duration: 300 });
  const onResolvedMeta = vi.fn();
  render(<SinglePlayer contentId="files:audio" onResolvedMeta={onResolvedMeta} clear={() => {}} advance={() => {}} />);
  await waitFor(() => expect(onResolvedMeta).toHaveBeenCalled());
  expect(onResolvedMeta.mock.calls.at(-1)[0]).not.toHaveProperty('contentTimeline');
});

it('retains the caller clip window when an owner restart refetch returns the full item', async () => {
  fetchMediaInfo.mockResolvedValue({ id: 'files:clip', contentId: 'files:clip', title: 'Clip',
    mediaUrl: '/clip.mp4', mediaType: 'video', format: 'video', duration: 100 });
  render(<SinglePlayer contentId="files:clip" mediaUrl="/clip.mp4" format="video" mediaType="video"
    segment={{ start: 10, end: 20 }} remountDiagnostics={{ remountClass: 'owner-operation',
      rendererOperation: { operationId: 'restart-clip', expectedContentId: 'files:clip', targetSeconds: 10, autoplay: true } }}
    clear={() => {}} advance={() => {}} />);
  expect(await screen.findByTestId('video-transport')).toHaveTextContent('video|10-20');
});
