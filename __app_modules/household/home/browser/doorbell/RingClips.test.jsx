import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    const buttons = screen.getAllByText('Show clip');
    expect(buttons).toHaveLength(2);
    // newest first: the players belong to the four latest rings
    expect(document.querySelector('video').getAttribute('src')).toContain(encodeURIComponent('Rec/clip_5.mp4'));
    fireEvent.click(buttons[0]);
    expect(document.querySelectorAll('video')).toHaveLength(5);
  });

  it('when no day of clips loads, every ring still shows its time, with a retry', async () => {
    apiMock.mockRejectedValue(new Error('camera down'));
    wrap(<RingClips camera="porch-cam" marks={rings.slice(0, 2)} timeZone="UTC" />);
    await waitFor(() => expect(screen.getAllByText('No recording near this ring')).toHaveLength(2));
    expect(document.querySelectorAll('.home-rings__time')).toHaveLength(2);
    apiMock.mockResolvedValue({ clips: rings.map(clipAt) });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(2));
  });

  it('files rings under the household day, not the browser day', async () => {
    apiMock.mockResolvedValue({ clips: [] });
    // 17:00 UTC is 02:00 the next day in Tokyo.
    wrap(<RingClips camera="porch-cam" marks={[base]} timeZone="Asia/Tokyo" />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('api/v1/camera/porch-cam/clips?day=2026-10-29'));
    expect(apiMock).not.toHaveBeenCalledWith('api/v1/camera/porch-cam/clips?day=2026-10-28');
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
    fireEvent.error(first);
    expect(screen.getByText('Recording could not be loaded')).toBeTruthy();
    expect(document.querySelector('video')).toBeNull();
    expect(logged).toContainEqual(expect.objectContaining({ level: 'warn', event: 'home.ring.clip.failed', data: expect.objectContaining({ camera: 'porch-cam', clip: 'Rec/clip_0.mp4' }) }));
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    const again = document.querySelector('video');
    expect(again).toBeTruthy();
    expect(again).not.toBe(first);
    expect(screen.queryByText('Recording could not be loaded')).toBeNull();
  });
});
