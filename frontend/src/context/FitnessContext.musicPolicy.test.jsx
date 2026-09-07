import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
vi.mock('../services/WebSocketService', () => ({ wsService: { subscribe: () => () => {}, onStatusChange: () => () => {} } }));
vi.mock('../lib/logging/Logger.js', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  logger.child = () => logger;
  return { default: () => logger, getLogger: () => logger };
});
import { FitnessProvider, useFitnessContext } from './FitnessContext.jsx';
import getLogger from '../lib/logging/Logger.js';
const config = { users: { primary: [] }, plex: { nomusic_labels: ['NoMusic'], music_playlists: [{ id: 'playlist-1' }] }, sensors: {} };

describe('Fitness music policy across navigation', () => {
  it('clears automatic music when a tagged video is replaced by an untagged video', async () => {
    let context;
    function Probe() { context = useFitnessContext(); return null; }
    render(<FitnessProvider fitnessConfiguration={config}><Probe /></FitnessProvider>);
    await act(async () => context.setFitnessPlayQueue([{ id: 'video-1', labels: [' NoMusic '] }]));
    await waitFor(() => expect(context.musicEnabled).toBe(true));
    await act(async () => context.setFitnessPlayQueue([{ id: 'video-2', labels: ['KidsFun'] }]));
    await waitFor(() => expect(context.musicEnabled).toBe(false));
    expect(context.selectedPlaylistId).toBeNull();
    expect(getLogger().info).toHaveBeenCalledWith('fitness.music.decision', expect.objectContaining({
      previous: expect.objectContaining({ contentId: 'video-1', enabled: true }),
      current: expect.objectContaining({ contentId: 'video-2', labels: ['kidsfun'], enabled: false, source: 'media-label', manualOverride: null }),
    }));
  });

  it('scopes standalone automatic playback to the chart, while preserving explicit manual choices', async () => {
    let context;
    function Probe() { context = useFitnessContext(); return null; }
    render(<FitnessProvider fitnessConfiguration={config}><Probe /></FitnessProvider>);
    await act(async () => context.setStandaloneMusicEnabled(true));
    await waitFor(() => expect(context.musicEnabled).toBe(true));
    await act(async () => context.setStandaloneMusicEnabled(false));
    await act(async () => context.setFitnessPlayQueue([{ id: 'video-2', labels: [] }]));
    await waitFor(() => expect(context.musicEnabled).toBe(false));
    await act(async () => context.setMusicOverride(true));
    await act(async () => context.setFitnessPlayQueue([{ id: 'video-3', labels: [] }]));
    expect(context.musicEnabled).toBe(true);
    await act(async () => context.setMusicOverride(false));
    expect(context.musicEnabled).toBe(false);
  });
});
