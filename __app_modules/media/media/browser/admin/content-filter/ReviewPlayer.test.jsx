import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { previewStore } from '../../content-filter/preview/previewStore.js';

const seen = [];
vi.mock('../../playback.mjs', () => ({ default: (props) => { seen.push({ play: props.play, forced: previewStore.isForced('77'), auxiliary: props.auxiliary }); return <div data-testid="player" />; } }));
const { ReviewPlayer } = await import('./ReviewPlayer.jsx');

describe('ReviewPlayer', () => {
  it('forces the filter on before the Player renders, without resume or progress logging (auxiliary), and clears it on unmount', async () => {
    const { findByTestId } = render(<MantineProvider><ReviewPlayer ratingKey="77" /></MantineProvider>);
    await findByTestId('player');
    expect(seen[0]).toEqual({ play: { contentId: 'plex:77', resume: false }, forced: true, auxiliary: true });
    cleanup();
    expect(previewStore.isForced('77')).toBe(false);
  });
});
