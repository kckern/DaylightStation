import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const quiet = vi.hoisted(() => ({ value: null }));
vi.mock('./houseQuiet.js', () => ({ useHouseQuiet: () => quiet.value }));

import { HouseQuietBar, HandleHouseMenu } from './HouseQuietControls.jsx';

beforeEach(() => {
  quiet.value = {
    pauseAll: vi.fn(), stopAll: vi.fn(), resumeAll: vi.fn(), busy: null,
    canResume: false, resumable: [], playingCount: 2, activeCount: 3,
  };
});

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);

describe('house-wide controls (RQ-STEER-13)', () => {
  it('offers Pause all and Stop all on the house view, and Resume all only after a pause', () => {
    const { rerender } = wrap(<HouseQuietBar />);
    fireEvent.click(screen.getByTestId('house-pause-all'));
    fireEvent.click(screen.getByTestId('house-stop-all'));
    expect(quiet.value.pauseAll).toHaveBeenCalled();
    expect(quiet.value.stopAll).toHaveBeenCalled();
    expect(screen.queryByTestId('house-resume-all')).toBeNull();
    quiet.value = { ...quiet.value, canResume: true, resumable: ['a', 'b'] };
    rerender(<MantineProvider><HouseQuietBar /></MantineProvider>);
    fireEvent.click(screen.getByTestId('house-resume-all'));
    expect(screen.getByTestId('house-resume-all')).toHaveTextContent('Resume all (2)');
    expect(quiet.value.resumeAll).toHaveBeenCalled();
  });

  it('hides Pause all / Stop all (and the whole bar) when nothing plays', () => {
    quiet.value = { ...quiet.value, playingCount: 0, activeCount: 0, canResume: false };
    wrap(<HouseQuietBar />);
    expect(screen.queryByTestId('house-pause-all')).toBeNull();
    expect(screen.queryByTestId('house-stop-all')).toBeNull();
    expect(screen.queryByTestId('house-quiet-bar')).toBeNull();
  });
  it('shows only Stop all when something is paused but nothing plays', () => {
    quiet.value = { ...quiet.value, playingCount: 0, activeCount: 1, canResume: false };
    wrap(<HouseQuietBar />);
    expect(screen.queryByTestId('house-pause-all')).toBeNull();
    expect(screen.getByTestId('house-stop-all')).toBeEnabled();
  });

  it('puts the same three on the handle', async () => {
    quiet.value = { ...quiet.value, canResume: true, resumable: ['a'] };
    wrap(<HandleHouseMenu />);
    fireEvent.click(screen.getByTestId('mini-house-menu'));
    fireEvent.click(await screen.findByTestId('mini-pause-all'));
    expect(quiet.value.pauseAll).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('mini-house-menu'));
    expect(await screen.findByTestId('mini-resume-all')).toHaveTextContent('Resume all (1)');
  });
});
