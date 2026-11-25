import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import ArticleRow from './Reader/ArticleRow.jsx';
import { FeedPlayerProvider, useFeedPlayer } from './players/FeedPlayerContext.jsx';
import FeedCard from './Scroll/cards/FeedCard.jsx';

vi.mock('../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

const readerVideo = {
  id: 'reader:1',
  contentType: 'youtube',
  title: 'First video',
  meta: { videoId: 'first123456', imageWidth: 640, imageHeight: 360, playable: true },
  state: { isRead: true },
};
const cardVideo = { ...readerVideo, id: 'youtube:cached-id', image: 'https://images.example/first.jpg' };
const secondVideo = {
  ...cardVideo,
  title: 'Second video',
  meta: { ...cardVideo.meta, videoId: 'second12345' },
};
const firstStream = 'https://video.example/first.mp4';
const secondStream = 'https://video.example/second.mp4';
const playerResult = url => ({ sections: [{ type: 'player', data: { provider: 'youtube', url, mimeType: 'video/mp4' } }] });
const detailRequests = () => DaylightAPI.mock.calls.map(([path]) => path).filter(path => path.startsWith('/api/v1/feed/detail/'));

function ActiveMedia() {
  const { activeMedia, pausedMedia } = useFeedPlayer();
  return <output aria-label="Active and paused media">{`${activeMedia?.item.id || ''}|${pausedMedia?.item.id || ''}`}</output>;
}

function StartFixtureAudio() {
  const { play } = useFeedPlayer();
  return <button onClick={() => play({ id: 'fixture-audio' }, 'plex:42')}>Play fixture audio</button>;
}

describe('Feed inline YouTube playback', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  test('Reader keeps the same stream and playback ownership when display metadata changes', async () => {
    DaylightAPI.mockImplementation(async path => path.startsWith('/api/v1/feed/detail/')
      ? playerResult(firstStream)
      : { annotations: [] });
    const view = article => (
      <FeedPlayerProvider>
        <StartFixtureAudio />
        <ArticleRow article={article} />
        <ActiveMedia />
      </FeedPlayerProvider>
    );
    const { container, rerender } = render(view(readerVideo));
    fireEvent.click(screen.getByRole('button', { name: 'Play fixture audio' }));
    const ownership = screen.getByLabelText('Active and paused media');
    expect(ownership).toHaveTextContent(/^fixture-audio\|$/);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /First video/ })));
    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', firstStream);
    expect(ownership).toHaveTextContent(/^\|fixture-audio$/);

    await act(async () => rerender(view({
      ...readerVideo, title: 'Updated title', meta: { ...readerVideo.meta, imageWidth: 1080 },
    })));

    expect(detailRequests()).toHaveLength(1);
    const request = new URL(detailRequests()[0], 'https://feed.example');
    expect(request.pathname).toBe('/api/v1/feed/detail/youtube%3Afirst123456');
    expect(request.searchParams.get('quality')).toBe('720p');
    expect(JSON.parse(request.searchParams.get('meta'))).toEqual({ videoId: 'first123456' });
    expect(ownership).toHaveTextContent(/^\|fixture-audio$/);
    expect(container.querySelector('video')).toBe(video);
    expect(video).toHaveAttribute('src', firstStream);
  });

  test('Reader and Scroll share a pending stream read, and reopening asks for a fresh stream', async () => {
    const first = Promise.withResolvers();
    const second = Promise.withResolvers();
    DaylightAPI.mockImplementation(path => {
      if (!path.startsWith('/api/v1/feed/detail/')) return Promise.resolve({ annotations: [] });
      return detailRequests().length === 1 ? first.promise : second.promise;
    });
    const canonicalCard = { ...cardVideo, id: 'youtube:first123456', title: 'Scroll video' };
    const { container } = render(
      <FeedPlayerProvider>
        <ArticleRow article={readerVideo} />
        <FeedCard item={canonicalCard} />
      </FeedPlayerProvider>,
    );
    const disclosure = screen.getByRole('button', { name: /First video/ });
    fireEvent.click(disclosure);
    fireEvent.click(screen.getByRole('button', { name: 'Play Scroll video' }));

    expect(detailRequests()).toHaveLength(1);
    await act(async () => first.resolve(playerResult(firstStream)));
    // 6462102aa7: inline video has a single owner. The Reader player's play() claim
    // clears the card's inline claim, so the one shared stream ends up in the Reader row.
    expect(container.querySelectorAll('video')).toHaveLength(1);
    expect(container.querySelector('.article-row video')).toHaveAttribute('src', firstStream);

    fireEvent.click(disclosure);
    fireEvent.click(disclosure);
    expect(detailRequests()).toHaveLength(2);
    expect(container.querySelector('.article-row video')).not.toBeInTheDocument();
    await act(async () => second.resolve(playerResult(secondStream)));
    expect(container.querySelector('.article-row video')).toHaveAttribute('src', secondStream);
  });

  test('Scroll never applies an older video result to a replacement on the same card route', async () => {
    const first = Promise.withResolvers();
    const second = Promise.withResolvers();
    DaylightAPI.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = item => <FeedPlayerProvider><FeedCard item={item} /><ActiveMedia /></FeedPlayerProvider>;
    const { container, rerender } = render(view(cardVideo));
    fireEvent.click(screen.getByRole('button', { name: 'Play First video' }));
    rerender(view(secondVideo));

    await act(async () => second.resolve(playerResult(secondStream)));
    expect(container.querySelector('video')).toHaveAttribute('src', secondStream);
    await act(async () => first.resolve(playerResult(firstStream)));

    expect(container.querySelector('video')).toHaveAttribute('src', secondStream);
    expect(screen.getByLabelText('Active and paused media')).toHaveTextContent(/^\|$/);
    expect(detailRequests()).toHaveLength(2);
    const request = new URL(detailRequests()[1], 'https://feed.example');
    expect(request.pathname).toBe('/api/v1/feed/detail/youtube%3Acached-id');
    expect(request.searchParams.get('quality')).toBe('720p');
    expect(JSON.parse(request.searchParams.get('meta'))).toEqual({ videoId: 'second12345' });
  });

  test('Scroll uses autoplay on fallback and allows the replacement to play natively', async () => {
    DaylightAPI.mockResolvedValueOnce(playerResult(firstStream)).mockResolvedValueOnce(playerResult(secondStream));
    const view = item => <FeedPlayerProvider><FeedCard item={item} /></FeedPlayerProvider>;
    const { container, rerender } = render(view(cardVideo));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Play First video' })));
    fireEvent.error(container.querySelector('video'));
    expect(screen.getByTitle('First video')).toHaveAttribute('src', 'https://www.youtube.com/embed/first123456?autoplay=1&rel=0');

    await act(async () => rerender(view(secondVideo)));

    expect(container.querySelector('video')).toHaveAttribute('src', secondStream);
  });

  test('Scroll falls back immediately after a 503 from the detail endpoint', async () => {
    const { DaylightAPI: realDaylightAPI } = await vi.importActual('../../../../frontend/src/lib/api.mjs');
    vi.useFakeTimers();
    const fetchDetail = vi.fn(async () => new Response(null, { status: 503, statusText: 'Service Unavailable' }));
    vi.stubGlobal('fetch', fetchDetail);
    DaylightAPI.mockImplementation(realDaylightAPI);
    render(<FeedPlayerProvider><FeedCard item={cardVideo} /></FeedPlayerProvider>);

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Play First video' })));

    expect(screen.getByTitle('First video')).toHaveAttribute('src', 'https://www.youtube.com/embed/first123456?autoplay=1&rel=0');
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(fetchDetail).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('/api/v1/feed/detail/youtube%3Acached-id?'),
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
