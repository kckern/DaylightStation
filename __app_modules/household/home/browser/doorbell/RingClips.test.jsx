import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => apiMock(...a) }));
const logged = vi.hoisted(() => []);
vi.mock('../homeLogger.js', () => {
  const make = () => ({
    child: () => make(),
    ...Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [level, (event, data) => logged.push({ level, event, data })])),
  });
  const homeLogger = make();
  return { homeLogger, default: homeLogger };
});

import { RingClips } from './RingClips.jsx';

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);
const base = Date.parse('2026-10-28T17:00:00Z');
const rings = Array.from({ length: 6 }, (_, i) => base + i * 600_000);
const clipAt = (t, i) => ({ start: new Date(t - 5000).toISOString(), end: new Date(t + 25000).toISOString(), name: `Rec/clip_${i}.mp4`, labels: [] });

beforeEach(() => { apiMock.mockReset(); logged.length = 0; });

describe('RingClips', () => {
  it('mounts players for the newest four clips; older rings offer theirs on request', async () => {
    apiMock.mockResolvedValue({ clips: rings.map(clipAt) });
    wrap(<RingClips camera="porch-cam" marks={rings} timeZone="UTC" />);
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(4));
    const buttons = screen.getAllByRole('button', { name: /show clip of/i });
    expect(buttons).toHaveLength(2);
    // newest first: the players belong to the four latest rings
    expect(document.querySelector('video').getAttribute('src')).toContain(encodeURIComponent('Rec/clip_5.mp4'));
    const row = buttons[0].closest('li');
    buttons[0].focus();
    expect(buttons[0]).toHaveFocus();
    fireEvent.click(buttons[0]);
    expect(document.querySelectorAll('video')).toHaveLength(5);
    expect(within(row).getByRole('button', { name: /play the clip/i })).toHaveFocus();
  });

  it('when no day of clips loads, every ring still shows its time, with a retry', async () => {
    let resolveRetry;
    apiMock
      .mockRejectedValueOnce(new Error('camera down'))
      .mockImplementationOnce(() => new Promise(resolve => { resolveRetry = resolve; }));
    wrap(<>
      <button type="button" aria-label="Other control">Other</button>
      <RingClips camera="porch-cam" marks={rings.slice(0, 2)} timeZone="UTC" />
    </>);
    await waitFor(() => expect(screen.getByText('Clips could not be loaded.')).toBeTruthy());
    expect(document.querySelectorAll('.home-rings__time')).toHaveLength(2);
    expect(screen.queryByText('No recording near this ring')).toBeNull();
    const retry = screen.getByRole('button', { name: /retry/i });
    retry.focus();
    fireEvent.click(retry);
    const region = screen.getByRole('region', { name: 'Rings' });
    await waitFor(() => expect(region).toHaveAttribute('aria-busy', 'true'));
    expect(region).toHaveFocus();
    const other = screen.getByRole('button', { name: 'Other control' });
    other.focus();
    resolveRetry({ clips: rings.map(clipAt) });
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(2));
    expect(other).toHaveFocus();
  });

  it('files rings under the household day, not the browser day', async () => {
    apiMock.mockResolvedValue({ clips: [] });
    // 17:00 UTC is 02:00 the next day in Tokyo.
    wrap(<RingClips camera="porch-cam" marks={[base]} timeZone="Asia/Tokyo" />);
    await waitFor(() => expect(apiMock.mock.calls.map(([url]) => url)).toEqual(['api/v1/camera/porch-cam/clips?day=2026-10-29']));
  });

  it('refreshes clips when a new ring arrives on a day already being viewed', async () => {
    const addedRing = base + 30 * 60_000;
    apiMock
      .mockResolvedValueOnce({ clips: [clipAt(base, 0)] })
      .mockResolvedValueOnce({ clips: [clipAt(base, 0), clipAt(addedRing, 1)] });
    const view = marks => <MantineProvider><RingClips camera="porch-cam" marks={marks} timeZone="UTC" /></MantineProvider>;
    const tree = render(view([base]));
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(1));

    tree.rerender(view([base, addedRing]));

    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(2));
    expect(apiMock.mock.calls.map(([path]) => path)).toEqual([
      'api/v1/camera/porch-cam/clips?day=2026-10-28',
      'api/v1/camera/porch-cam/clips?day=2026-10-28',
    ]);
  });

  it('keeps an active clip mounted when a same-day refresh fails', async () => {
    const addedRing = base + 30 * 60_000;
    apiMock
      .mockResolvedValueOnce({ clips: [clipAt(base, 0)] })
      .mockRejectedValueOnce(new Error('camera refresh failed'));
    const view = marks => <MantineProvider><RingClips camera="porch-cam" marks={marks} timeZone="UTC" /></MantineProvider>;
    const tree = render(view([base]));
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(1));
    const video = document.querySelector('video');
    const row = video.closest('li');
    fireEvent.click(within(row).getByRole('button', { name: /play the clip/i }));
    expect(video).toHaveAttribute('controls');
    await waitFor(() => expect(video).toHaveFocus());

    tree.rerender(view([base, addedRing]));

    await screen.findByText('Clips could not be loaded.');
    expect(row.querySelector('video')).toBe(video);
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveFocus();
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('clears a failed recording when a refresh finds a replacement for the same ring', async () => {
    const addedRing = base + 30 * 60_000;
    const secondAddedRing = base + 60 * 60_000;
    const oldClip = {
      start: new Date(base + 60_000).toISOString(),
      end: new Date(base + 90_000).toISOString(),
      name: 'Rec/old-clip.mp4',
      labels: [],
    };
    const replacement = {
      start: new Date(base).toISOString(),
      end: new Date(base + 25_000).toISOString(),
      name: 'Rec/replacement-clip.mp4',
      labels: [],
    };
    apiMock
      .mockResolvedValueOnce({ clips: [oldClip] })
      .mockResolvedValueOnce({ clips: [replacement] })
      .mockResolvedValueOnce({ clips: [oldClip] });
    const view = marks => <MantineProvider>
      <button type="button" aria-label="Other control">Other</button>
      <RingClips camera="porch-cam" marks={marks} timeZone="UTC" />
    </MantineProvider>;
    const tree = render(view([base]));
    await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toContain(encodeURIComponent(oldClip.name)));
    const row = document.querySelector('video').closest('li');
    const firstPlayer = row.querySelector('video');
    fireEvent.error(firstPlayer);
    expect(within(row).getByText('Recording could not be loaded')).toBeVisible();
    const retry = within(row).getByRole('button', { name: /retry recording from/i });
    retry.focus();

    tree.rerender(view([base, addedRing]));

    await waitFor(() => expect(within(row).getByRole('button', { name: /play the clip/i })).toBeVisible());
    expect(within(row).getByRole('button', { name: /play the clip/i })).toHaveFocus();
    expect(row.querySelector('video')).toHaveAttribute('src', expect.stringContaining(encodeURIComponent(replacement.name)));
    expect(within(row).queryByText('Recording could not be loaded')).toBeNull();

    const other = screen.getByRole('button', { name: 'Other control' });
    other.focus();
    tree.rerender(view([base, addedRing, secondAddedRing]));

    await waitFor(() => expect(row.querySelector('video')).toHaveAttribute('src', expect.stringContaining(encodeURIComponent(oldClip.name))));
    expect(within(row).getByRole('button', { name: /play the clip/i })).toBeVisible();
    expect(within(row).queryByText('Recording could not be loaded')).toBeNull();
    fireEvent.error(firstPlayer);
    expect(within(row).queryByText('Recording could not be loaded')).toBeNull();
    expect(other).toHaveFocus();
  });

  it('resets playback controls when a ring cycles through different recording sources', async () => {
    const addedRing = base + 30 * 60_000;
    const secondAddedRing = base + 60 * 60_000;
    const oldClip = clipAt(base, 0);
    const replacement = {
      start: new Date(base + 5_000).toISOString(),
      end: new Date(base + 25_000).toISOString(),
      name: 'Rec/replacement-clip.mp4',
      labels: [],
    };
    apiMock
      .mockResolvedValueOnce({ clips: [oldClip] })
      .mockResolvedValueOnce({ clips: [replacement] })
      .mockResolvedValueOnce({ clips: [oldClip] });
    const view = marks => <MantineProvider>
      <button type="button" aria-label="Other control">Other</button>
      <RingClips camera="porch-cam" marks={marks} timeZone="UTC" />
    </MantineProvider>;
    const tree = render(view([base]));
    await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toContain(encodeURIComponent(oldClip.name)));
    const row = document.querySelector('video').closest('li');
    fireEvent.click(within(row).getByRole('button', { name: /play the clip/i }));
    expect(row.querySelector('video')).toHaveAttribute('controls');
    await waitFor(() => expect(row.querySelector('video')).toHaveFocus());

    tree.rerender(view([base, addedRing]));
    await waitFor(() => expect(row.querySelector('video')).toHaveAttribute('src', expect.stringContaining(encodeURIComponent(replacement.name))));
    const replacementPlay = within(row).getByRole('button', { name: /play the clip/i });
    expect(replacementPlay).toBeVisible();
    expect(replacementPlay).toHaveFocus();

    const other = screen.getByRole('button', { name: 'Other control' });
    other.focus();
    tree.rerender(view([base, addedRing, secondAddedRing]));

    await waitFor(() => expect(row.querySelector('video')).toHaveAttribute('src', expect.stringContaining(encodeURIComponent(oldClip.name))));
    expect(within(row).getByRole('button', { name: /play the clip/i })).toBeVisible();
    expect(row.querySelector('video')).not.toHaveAttribute('controls');
    expect(other).toHaveFocus();
  });

  it('consumes source-change focus handoffs before later background failures', async () => {
    const addedRing = base + 30 * 60_000;
    const secondAddedRing = base + 60 * 60_000;
    const oldClip = clipAt(base, 0);
    const replacement = {
      start: new Date(base + 5_000).toISOString(),
      end: new Date(base + 25_000).toISOString(),
      name: 'Rec/replacement-clip.mp4',
      labels: [],
    };
    apiMock
      .mockResolvedValueOnce({ clips: [oldClip] })
      .mockResolvedValueOnce({ clips: [replacement] })
      .mockResolvedValueOnce({ clips: [oldClip] });
    const view = marks => <MantineProvider>
      <button type="button" aria-label="Other control">Other</button>
      <RingClips camera="porch-cam" marks={marks} timeZone="UTC" />
    </MantineProvider>;
    const tree = render(view([base]));
    await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toContain(encodeURIComponent(oldClip.name)));
    const row = document.querySelector('video').closest('li');
    within(row).getByRole('button', { name: /play the clip/i }).focus();

    tree.rerender(view([base, addedRing]));
    await waitFor(() => expect(row.querySelector('video')).toHaveAttribute('src', expect.stringContaining(encodeURIComponent(replacement.name))));
    const replacementPlay = within(row).getByRole('button', { name: /play the clip/i });
    expect(replacementPlay).toHaveFocus();

    const other = screen.getByRole('button', { name: 'Other control' });
    other.focus();
    fireEvent.error(row.querySelector('video'));
    expect(within(row).getByRole('button', { name: /retry recording from/i })).toBeInTheDocument();
    expect(other).toHaveFocus();

    tree.rerender(view([base, addedRing, secondAddedRing]));
    await waitFor(() => expect(row.querySelector('video')).toHaveAttribute('src', expect.stringContaining(encodeURIComponent(oldClip.name))));
    expect(within(row).getByRole('button', { name: /play the clip/i })).toBeVisible();
    expect(other).toHaveFocus();
  });

  it('keeps the error when a refresh returns the same failed recording', async () => {
    const addedRing = base + 30 * 60_000;
    const clip = clipAt(base, 0);
    apiMock
      .mockResolvedValueOnce({ clips: [clip] })
      .mockResolvedValueOnce({ clips: [clip] });
    const view = marks => <MantineProvider><RingClips camera="porch-cam" marks={marks} timeZone="UTC" /></MantineProvider>;
    const tree = render(view([base]));
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(1));
    const row = document.querySelector('video').closest('li');
    fireEvent.error(document.querySelector('video'));
    const retry = within(row).getByRole('button', { name: /retry recording from/i });
    retry.focus();

    tree.rerender(view([base, addedRing]));

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(within(row).getByText('Recording could not be loaded')).toBeVisible();
    expect(within(row).getByRole('button', { name: /retry recording from/i })).toHaveFocus();
    expect(within(row).queryByRole('button', { name: /play the clip/i })).toBeNull();
  });

  it('does not duplicate the hook refresh when a new ring adds a camera day', async () => {
    const nextDayRing = Date.parse('2026-10-29T12:00:00Z');
    apiMock.mockResolvedValue({ clips: [clipAt(base, 0), clipAt(nextDayRing, 1)] });
    const view = marks => <MantineProvider><RingClips camera="porch-cam" marks={marks} timeZone="UTC" /></MantineProvider>;
    const tree = render(view([base]));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));

    tree.rerender(view([base, nextDayRing]));

    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(2));
    expect(apiMock.mock.calls.map(([path]) => path)).toEqual([
      'api/v1/camera/porch-cam/clips?day=2026-10-28',
      'api/v1/camera/porch-cam/clips?day=2026-10-28',
      'api/v1/camera/porch-cam/clips?day=2026-10-29',
    ]);
  });

  it('refreshes a new ring without publishing a superseded lookup batch', async () => {
    const nearMidnight = Date.parse('2026-10-28T00:01:00Z');
    const addedRing = nearMidnight + 30 * 60_000;
    const reads = new Map();
    const staleResults = [];
    apiMock.mockImplementation(path => {
      const day = path.split('day=')[1];
      const count = (reads.get(day) || 0) + 1;
      reads.set(day, count);
      if (count === 1) return new Promise(resolve => staleResults.push(() => resolve({ clips: [] })));
      return Promise.resolve({ clips: day === '2026-10-28' ? [clipAt(nearMidnight, 0), clipAt(addedRing, 1)] : [] });
    });
    const view = marks => <MantineProvider><RingClips camera="porch-cam" marks={marks} timeZone="UTC" /></MantineProvider>;
    const tree = render(view([nearMidnight]));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));

    tree.rerender(view([nearMidnight, addedRing]));

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(2));
    staleResults.forEach(resolve => resolve());
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(2));
    expect([...reads.entries()]).toEqual([['2026-10-27', 2], ['2026-10-28', 2]]);
  });

  it('a clip shows its first frame with one play button, and gets native controls only once tapped', async () => {
    apiMock.mockResolvedValue({ clips: [clipAt(rings[0], 0)] });
    wrap(<RingClips camera="porch-cam" marks={[rings[0]]} timeZone="UTC" />);
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(1));
    const video = document.querySelector('video');
    expect(video.hasAttribute('controls')).toBe(false);
    const play = screen.getByRole('button', { name: /play the clip/i });
    video.play = vi.fn(() => Promise.resolve());
    fireEvent.click(play);
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.play).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /play the clip/i })).toBeNull();
  });

  it('a clip that fails to load says so, logs it, and retries by remounting the player', async () => {
    apiMock.mockResolvedValue({ clips: [clipAt(rings[0], 0)] });
    wrap(<RingClips camera="porch-cam" marks={[rings[0]]} timeZone="UTC" />);
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(1));
    const first = document.querySelector('video');
    const row = first.closest('li');
    fireEvent.error(first);
    expect(screen.getByText('Recording could not be loaded')).toBeTruthy();
    expect(document.querySelector('video')).toBeNull();
    expect(logged).toContainEqual(expect.objectContaining({ level: 'warn', event: 'home.ring.clip.failed', data: expect.objectContaining({ camera: 'porch-cam', clip: 'Rec/clip_0.mp4' }) }));
    const retry = screen.getByRole('button', { name: /retry recording from/i });
    retry.focus();
    fireEvent.click(retry);
    const again = document.querySelector('video');
    expect(again).toBeTruthy();
    expect(again).not.toBe(first);
    expect(screen.queryByText('Recording could not be loaded')).toBeNull();
    expect(within(row).getByRole('button', { name: /play the clip/i })).toHaveFocus();
  });

  it('moves focus from a failed Play button to that ring’s Retry button', async () => {
    apiMock.mockResolvedValue({ clips: [clipAt(rings[0], 0)] });
    wrap(<RingClips camera="porch-cam" marks={[rings[0]]} timeZone="UTC" />);
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(1));
    const video = document.querySelector('video');
    const row = video.closest('li');
    const play = within(row).getByRole('button', { name: /play the clip/i });
    play.focus();

    fireEvent.error(video);

    const retry = within(row).getByRole('button', { name: /retry recording from/i });
    expect(retry).toHaveFocus();
  });

  it('moves focus from failed native video controls to that ring’s Retry button', async () => {
    apiMock.mockResolvedValue({ clips: [clipAt(rings[0], 0)] });
    wrap(<RingClips camera="porch-cam" marks={[rings[0]]} timeZone="UTC" />);
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(1));
    const video = document.querySelector('video');
    const row = video.closest('li');
    fireEvent.click(within(row).getByRole('button', { name: /play the clip/i }));
    expect(video).toHaveAttribute('controls');
    video.focus();
    expect(video).toHaveFocus();

    fireEvent.error(video);

    const retry = within(row).getByRole('button', { name: /retry recording from/i });
    expect(retry).toHaveFocus();
  });

  it('keeps focus on another ring when an unfocused clip fails', async () => {
    apiMock.mockResolvedValue({ clips: [clipAt(rings[0], 0), clipAt(rings[1], 1)] });
    wrap(<RingClips camera="porch-cam" marks={rings.slice(0, 2)} timeZone="UTC" />);
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(2));
    const videos = document.querySelectorAll('video');
    const focusedRow = videos[0].closest('li');
    const failingRow = videos[1].closest('li');
    const focusedPlay = within(focusedRow).getByRole('button', { name: /play the clip/i });
    focusedPlay.focus();

    fireEvent.error(videos[1]);

    expect(within(failingRow).getByRole('button', { name: /retry recording from/i })).toBeInTheDocument();
    expect(focusedPlay).toHaveFocus();
  });
});

it('distinguishes a failed camera day from no recording and retries only that day', async () => {
  const tomorrow = base + 86_400_000;
  let unavailableDayReads = 0;
  let finishRetry;
  apiMock.mockImplementation(async path => {
    const day = path.split('day=')[1];
    if (day === '2026-10-29' && unavailableDayReads++ === 0) throw new Error('Camera offline');
    if (day === '2026-10-29') {
      return new Promise(resolve => { finishRetry = () => resolve({ clips: [clipAt(tomorrow, 1)] }); });
    }
    return day === '2026-10-28' ? { clips: [clipAt(base, 0)] } : { clips: [] };
  });
  wrap(<>
    <button type="button" aria-label="Other control">Other</button>
    <RingClips camera="porch-cam" marks={[base, tomorrow]} timeZone="UTC" />
  </>);
  await screen.findByText('Recording availability unknown');
  expect(document.querySelectorAll('.home-rings__time')).toHaveLength(2);
  expect(document.querySelectorAll('video')).toHaveLength(1);
  const retry = screen.getByRole('button', { name: 'Retry unavailable day lookups' });
  retry.focus();
  fireEvent.click(retry);
  await waitFor(() => expect(finishRetry).toBeTypeOf('function'));
  const region = screen.getByRole('region', { name: 'Rings' });
  expect(region).toHaveAttribute('aria-busy', 'true');
  expect(region).toHaveFocus();
  expect(document.querySelectorAll('video')).toHaveLength(1);
  expect(apiMock.mock.calls.slice(2).map(([path]) => path.split('day=')[1])).toEqual(['2026-10-29']);
  const other = screen.getByRole('button', { name: 'Other control' });
  other.focus();
  finishRetry();
  await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(2));
  expect(other).toHaveFocus();
  expect(screen.queryByText('Recording availability unknown')).toBeNull();
  expect(screen.queryByText('No recording near this ring')).toBeNull();
});

it('aborts reads from the previous camera when the selected camera changes', async () => {
  let previous;
  apiMock.mockImplementation(async (path, _body, _method, { signal }) => {
    if (path.includes('first-camera')) {
      previous = signal;
      return new Promise(() => {});
    }
    return { clips: [clipAt(base, 0)] };
  });
  const list = camera => <MantineProvider><RingClips camera={camera} marks={[base]} timeZone="UTC" /></MantineProvider>;
  const tree = render(list('first-camera'));
  tree.rerender(list('second-camera'));
  await waitFor(() => expect(document.querySelector('video')).toBeTruthy());
  expect(document.querySelector('video').getAttribute('src')).toContain('second-camera');
  expect(previous.aborted).toBe(true);
});
