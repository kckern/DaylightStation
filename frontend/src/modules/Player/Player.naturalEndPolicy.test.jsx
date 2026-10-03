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
import { setNaturalEndPolicy } from './lib/naturalEndPolicy.js';

const latest = () => frames.at(-1);
let unregister = () => {};

beforeEach(() => { frames.length = 0; });
afterEach(() => { unregister(); cleanup(); });

describe('Player natural-end policy seam (screen end-of-queue / countdown / sleep)', () => {
  it('offers the policy the finished and next items and lets it hold the advance', async () => {
    const policy = vi.fn(() => true);
    unregister = setNaturalEndPolicy(policy);
    const clear = vi.fn();
    render(<Player play={[{ contentId: 'plex:1', title: 'One' }, { contentId: 'plex:2', title: 'Two' }]} clear={clear} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));

    act(() => { latest().advance(); });
    expect(policy).toHaveBeenCalledTimes(1);
    const [ctx, actions] = policy.mock.calls[0];
    expect(ctx).toMatchObject({ isQueue: true, current: { contentId: 'plex:1' }, next: { contentId: 'plex:2' } });
    expect(Object.keys(actions).sort()).toEqual(['advance', 'finish', 'restartQueue', 'stop']);
    // Held: still on the first item.
    await new Promise((r) => setTimeout(r, 30));
    expect(latest().contentId).toBe('plex:1');

    act(() => { actions.advance(); });
    await waitFor(() => expect(latest()?.contentId).toBe('plex:2'));
    expect(clear).not.toHaveBeenCalled();
  });

  it('falls through to the default advance when the policy declines', async () => {
    unregister = setNaturalEndPolicy(() => false);
    render(<Player play={[{ contentId: 'plex:1' }, { contentId: 'plex:2' }]} clear={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    act(() => { latest().advance(); });
    await waitFor(() => expect(latest()?.contentId).toBe('plex:2'));
  });

  it('reports no next item at the end of the queue; finish() ends it the default way', async () => {
    let held;
    unregister = setNaturalEndPolicy((ctx, actions) => { held = { ctx, actions }; return true; });
    const clear = vi.fn();
    render(<Player play={[{ contentId: 'plex:1' }]} clear={clear} />);
    await waitFor(() => expect(latest()?.advance).toBeTypeOf('function'));
    act(() => { latest().advance(); });
    expect(held.ctx.next).toBeNull();
    expect(clear).not.toHaveBeenCalled();
    act(() => { held.actions.finish(); });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('is not consulted when no screen registered a policy', async () => {
    const clear = vi.fn();
    render(<Player play={{ contentId: 'plex:620707' }} clear={clear} />);
    await waitFor(() => expect(latest()?.advance).toBeTypeOf('function'));
    act(() => { latest().advance(); });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('a policy stop lets the same item complete again after it is replayed (countdown cancel, then play to the end)', async () => {
    const policy = vi.fn((_ctx, actions) => { actions.stop(); return true; });
    unregister = setNaturalEndPolicy(policy);
    render(<Player play={[{ contentId: 'plex:1' }, { contentId: 'plex:2' }]} clear={() => {}} />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:1'));
    act(() => { latest().advance(); });
    act(() => { latest().advance(); });
    expect(policy).toHaveBeenCalledTimes(2);
  });
});
