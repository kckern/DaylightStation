// Displayer.test.jsx — pins the image-source fallback chain.
//
// Context: a `files:` image resolved fine and streamed fine but rendered as an
// empty <img> on the living-room TV, because Displayer read only `imageUrl` and
// the FileAdapter build then in production emitted only `mediaUrl` for images.
// The blank box was indistinguishable from a slow load. These tests pin that a
// usable src is found wherever the info payload happens to carry it, and that
// "no usable src" is a visible error rather than silence.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import Displayer from './Displayer.jsx';

const ID = 'files:art/fhe/esther.jpg';

beforeEach(() => {
  apiMock.mockReset();
});

async function renderResolved(payload) {
  apiMock.mockResolvedValue(payload);
  render(<Displayer display={{ id: ID }} />);
  return waitFor(() => screen.getByRole('img'));
}

describe('Displayer image source resolution', () => {
  it('uses imageUrl when the payload carries one', async () => {
    const img = await renderResolved({
      title: 'esther',
      mediaType: 'image',
      imageUrl: '/api/v1/canvas/image/fhe/esther.jpg',
      mediaUrl: '/api/v1/proxy/media/stream/art%2Ffhe%2Festher.jpg',
    });
    expect(img).toHaveAttribute('src', '/api/v1/canvas/image/fhe/esther.jpg');
  });

  it('falls back to mediaUrl for an image payload with no imageUrl', async () => {
    const img = await renderResolved({
      title: 'esther',
      mediaType: 'image',
      mediaUrl: '/api/v1/proxy/media/stream/art%2Ffhe%2Festher.jpg',
    });
    expect(img).toHaveAttribute(
      'src',
      '/api/v1/proxy/media/stream/art%2Ffhe%2Festher.jpg'
    );
  });

  it('falls back to image, then thumbnail, before mediaUrl', async () => {
    const img = await renderResolved({
      title: 'esther',
      mediaType: 'image',
      image: '/img/full.jpg',
      thumbnail: '/img/thumb.jpg',
      mediaUrl: '/img/stream.jpg',
    });
    expect(img).toHaveAttribute('src', '/img/full.jpg');
  });

  it('does not fall back to mediaUrl when the payload is not an image', async () => {
    // A video's mediaUrl is a stream, not something an <img> can render.
    // Better to say so than to point <img> at an MP4 and show a broken icon.
    apiMock.mockResolvedValue({
      title: 'ring',
      mediaType: 'video',
      mediaUrl: '/api/v1/proxy/media/stream/clips%2Fring.mp4',
    });
    render(<Displayer display={{ id: 'files:clips/ring.mp4' }} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('reports an error instead of rendering a blank img when no src resolves', async () => {
    apiMock.mockResolvedValue({ title: 'esther', mediaType: 'image' });
    render(<Displayer display={{ id: ID }} />);
    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert.textContent).toMatch(/esther/);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('surfaces a fetch failure as an error', async () => {
    apiMock.mockRejectedValue(new Error('404 Not Found'));
    render(<Displayer display={{ id: ID }} />);
    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert.textContent).toMatch(/404 Not Found/);
  });
});
