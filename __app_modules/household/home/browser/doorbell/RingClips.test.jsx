import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { RingClips } from './RingClips.jsx';

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);
const base = Date.parse('2026-10-28T17:00:00Z');
const rings = Array.from({ length: 6 }, (_, i) => base + i * 600_000);
const clipAt = (t, i) => ({ start: new Date(t - 5000).toISOString(), end: new Date(t + 25000).toISOString(), name: `Rec/clip_${i}.mp4`, labels: [] });

beforeEach(() => apiMock.mockReset());

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
});
