// Displayer.test.jsx — pins the image-source fallback chain.
//
// Context: a `files:` image resolved fine and streamed fine but rendered as an
// empty <img> on the living-room TV, because Displayer read only `imageUrl` and
// the FileAdapter build then in production emitted only `mediaUrl` for images.
// The blank box was indistinguishable from a slow load. These tests pin that a
// usable src is found wherever the info payload happens to carry it, and that
// "no usable src" is a visible error rather than silence.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import Displayer from './Displayer.jsx';
import { resetApiResourceCache } from '../../lib/hooks/useApiResource.js';

const ID = 'files:art/fhe/esther.jpg';

beforeEach(() => {
  apiMock.mockReset();
  resetApiResourceCache();
});

async function renderResolved(payload) {
  apiMock.mockResolvedValue(payload);
  render(<Displayer display={{ id: ID }} />);
  return waitFor(() => screen.getByRole('img'));
}

describe('Displayer image source resolution', () => {
  it('uses a caller-hydrated payload without reading item metadata again', () => {
    render(<Displayer display={{ id: ID, title: 'Provided', mediaType: 'image', imageUrl: '/provided.jpg' }} />);

    expect(screen.getByRole('img')).toHaveAttribute('src', '/provided.jpg');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it.each([
    ['42', '/api/v1/info/42'],
    ['files/art/fhe/sea glass.jpg', '/api/v1/info/files/art/fhe/sea%20glass.jpg'],
  ])('keeps server resolution for the legacy display ID %s', async (id, path) => {
    apiMock.mockResolvedValue({ title: 'Legacy item', imageUrl: '/legacy.jpg' });
    render(<Displayer display={{ id }} />);

    expect(await screen.findByRole('img', { name: 'Legacy item' })).toHaveAttribute('src', '/legacy.jpg');
    expect(apiMock).toHaveBeenCalledWith(path, {}, 'GET', { signal: expect.any(AbortSignal) });
  });

  it('shows a malformed qualified ID as an error', () => {
    render(<Displayer display={{ id: 'canvas:' }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid display content ID');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('revalidates a previously accepted descriptor for an ordinary menu display', async () => {
    apiMock.mockResolvedValueOnce({ title: 'Previous image', imageUrl: '/previous.jpg' });
    const first = render(<Displayer display={{ id: ID }} />);
    await screen.findByRole('img', { name: 'Previous image' });
    first.unmount();

    apiMock.mockResolvedValueOnce({ title: 'Current image', imageUrl: '/current.jpg' });
    render(<Displayer display={{ id: ID }} />);
    expect(await screen.findByRole('img', { name: 'Current image' })).toHaveAttribute('src', '/current.jpg');
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

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

  it('loads the new item when the same display instance receives a different id', async () => {
    apiMock.mockImplementation(path => Promise.resolve({
      title: path.endsWith('%2Fsecond.jpg') ? 'second' : 'esther',
      mediaType: 'image',
      imageUrl: path.endsWith('%2Fsecond.jpg') ? '/second.jpg' : '/esther.jpg',
    }));
    const { rerender } = render(<Displayer display={{ id: ID }} />);
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', '/esther.jpg'));

    rerender(<Displayer display={{ id: 'files:art/fhe/second.jpg' }} />);

    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', '/second.jpg'), { timeout: 1000 });
    expect(apiMock).toHaveBeenCalledWith('/api/v1/info/files/art%2Ffhe%2Fsecond.jpg', {}, 'GET', { signal: expect.any(AbortSignal) });
  });

  it('releases its pending descriptor when another item replaces it', async () => {
    const previous = Promise.withResolvers();
    apiMock.mockReturnValueOnce(previous.promise)
      .mockResolvedValueOnce({ title: 'Next image', imageUrl: '/next.jpg' });
    const { rerender } = render(<Displayer display={{ id: ID }} />);
    const { signal } = apiMock.mock.calls[0][3];

    rerender(<Displayer display={{ id: 'canvas:next.jpg' }} />);
    await screen.findByRole('img', { name: 'Next image' });
    expect(signal.aborted).toBe(true);

    await act(async () => { previous.resolve({ title: 'Previous image', imageUrl: '/previous.jpg' }); });
    expect(screen.getByRole('img')).toHaveAttribute('src', '/next.jpg');
    expect(screen.queryByRole('img', { name: 'Previous image' })).toBeNull();
  });
});
