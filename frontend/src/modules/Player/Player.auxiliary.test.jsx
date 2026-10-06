import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Auxiliary Players (music behind, brief clips) must never write the play
// ledger; ordinary Players are unchanged.
const seen = [];
vi.mock('./components/SinglePlayer.jsx', async () => {
  const { useIsAuxiliaryPlayer } = await import('./lib/auxiliaryPlayerContext.js');
  return { SinglePlayer: () => { seen.push(useIsAuxiliaryPlayer()); return <div />; } };
});
vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.reject(new Error('offline'))) }));
import Player from './Player.jsx';

afterEach(() => { cleanup(); seen.length = 0; });

describe('auxiliary Player context', () => {
  it('is on for an auxiliary Player', async () => {
    render(<Player auxiliary play={{ contentId: 'plex:1' }} clear={() => {}} />);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen.every(Boolean)).toBe(true);
  });
  it('is off for an ordinary Player', async () => {
    render(<Player play={{ contentId: 'plex:1' }} clear={() => {}} />);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen.some(Boolean)).toBe(false);
  });
});
