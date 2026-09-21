import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SinglePlayer } from './SinglePlayer.jsx';
import { fetchMediaInfo } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ fetchMediaInfo: vi.fn() }));
vi.mock('../renderers/VideoPlayer.jsx', () => ({
  VideoPlayer: ({ media }) => <output data-testid="video-transport">{media.mediaType}</output>,
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
});
