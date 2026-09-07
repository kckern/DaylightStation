import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  plexConfig: { music_playlists: [{ id: 'playlist-1', name: 'Workout' }] },
  musicEnabled: false,
  setMusicOverride: vi.fn(),
  setSelectedPlaylistId: vi.fn(),
}));
vi.mock('@/context/FitnessContext.jsx', () => ({ useFitnessContext: () => state }));
vi.mock('@/modules/Player/Player.jsx', () => ({ default: () => null }));
vi.mock('@/modules/Fitness/nav/usePersistentVolume.js', () => ({ usePersistentVolume: () => ({ volume: 0.1, setVolume: vi.fn(), applyToPlayer: vi.fn() }) }));
import FitnessMusicPlayer from './FitnessMusicPlayer.jsx';

it('chooses the default playlist without creating a persistent manual music override', async () => {
  const view = render(<FitnessMusicPlayer selectedPlaylistId={null} />);
  await waitFor(() => expect(state.setSelectedPlaylistId).toHaveBeenCalledWith('playlist-1'));
  expect(state.setMusicOverride).not.toHaveBeenCalled();
  view.unmount();
});
