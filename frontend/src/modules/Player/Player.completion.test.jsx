import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const frames = [];

vi.mock('./components/SinglePlayer.jsx', () => ({
  SinglePlayer: (props) => {
    frames.push(props);
    return <div data-testid="single-player-stub" />;
  },
}));

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.reject(new Error('offline in test'))),
}));

import Player from './Player.jsx';

const latest = () => frames.at(-1);

beforeEach(() => { frames.length = 0; });
afterEach(() => cleanup());

describe('Player natural completion contract', () => {
  it('dispatches completion synchronously before clearing a single item', async () => {
    const order = [];
    const onPlaybackCompleted = vi.fn((info) => order.push(['completed', info]));
    const clear = vi.fn(() => order.push(['clear']));
    render(<Player
      play={{ contentId: 'plex:620707' }}
      onPlaybackCompleted={onPlaybackCompleted}
      clear={clear}
    />);
    await waitFor(() => expect(latest()?.advance).toBeTypeOf('function'));

    act(() => { latest().advance(); });

    expect(order).toEqual([
      ['completed', { reason: 'natural-end', assetId: 'plex:620707' }],
      ['clear'],
    ]);
  });

  it('dispatches before a queue advances to its next item', async () => {
    const order = [];
    render(<Player
      play={[{ contentId: 'plex:1' }, { contentId: 'plex:2' }]}
      onPlaybackCompleted={(info) => order.push(['completed', info.assetId])}
      clear={() => order.push(['clear'])}
    />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));

    act(() => { latest().advance(); });
    expect(order).toEqual([['completed', 'plex:1']]);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:2'));
  });

  it('treats adjacent queue entries for the same asset as separate completions', async () => {
    const onPlaybackCompleted = vi.fn();
    render(<Player
      play={[{ contentId: 'plex:1' }, { contentId: 'plex:1' }]}
      onPlaybackCompleted={onPlaybackCompleted}
      clear={() => {}}
    />);
    await waitFor(() => expect(latest()?.advance).toBeTypeOf('function'));

    act(() => { latest().advance(); });
    await waitFor(() => expect(onPlaybackCompleted).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(latest()?.queuePosition).toBe(1));

    act(() => { latest().advance(); });
    expect(onPlaybackCompleted).toHaveBeenCalledTimes(2);
  });

  it('does not claim completion for manual advance or explicit clear', async () => {
    const onPlaybackCompleted = vi.fn();
    const clear = vi.fn();
    render(<Player
      play={{ contentId: 'plex:620707' }}
      onPlaybackCompleted={onPlaybackCompleted}
      clear={clear}
    />);
    await waitFor(() => expect(latest()?.manualAdvance).toBeTypeOf('function'));

    act(() => { latest().manualAdvance(); });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(onPlaybackCompleted).not.toHaveBeenCalled();

    act(() => { latest().clear(); });
    expect(clear).toHaveBeenCalledTimes(2);
    expect(onPlaybackCompleted).not.toHaveBeenCalled();
  });

  it('deduplicates competing terminal notifications for one media item', async () => {
    const onPlaybackCompleted = vi.fn();
    const clear = vi.fn();
    render(<Player
      play={{ contentId: 'plex:620707' }}
      onPlaybackCompleted={onPlaybackCompleted}
      clear={clear}
    />);
    await waitFor(() => expect(latest()?.advance).toBeTypeOf('function'));

    act(() => {
      latest().advance();
      latest().advance();
    });

    expect(onPlaybackCompleted).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
