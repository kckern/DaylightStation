import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const push = vi.fn();
let summary = { playing: 0, paused: 0 };
vi.mock('./NavProvider.jsx', () => ({ useNav: () => ({ view: 'home', push }) }));
vi.mock('../fleet/useFleetSummary.js', () => ({ useFleetSummary: () => summary }));

import { FleetIndicator } from './FleetIndicator.jsx';

beforeEach(() => {
  push.mockReset();
  summary = { playing: 0, paused: 0 };
});

describe('FleetIndicator', () => {
  it('names playing screens rather than a generic active total', () => {
    summary = { playing: 1, paused: 0 };
    render(<MantineProvider><FleetIndicator /></MantineProvider>);
    expect(screen.getByTestId('house-indicator')).toHaveAccessibleName('1 playing');
  });

  it('separates playing and paused screens in its copy', () => {
    summary = { playing: 0, paused: 1 };
    render(<MantineProvider><FleetIndicator /></MantineProvider>);
    expect(screen.getByTestId('house-indicator')).toHaveAccessibleName('1 paused');
    summary = { playing: 2, paused: 1 };
    render(<MantineProvider><FleetIndicator /></MantineProvider>);
    expect(screen.getAllByTestId('house-indicator')[1]).toHaveAccessibleName('2 playing, 1 paused');
  });

  it('is hidden when nothing is playing or paused', () => {
    render(<MantineProvider><FleetIndicator /></MantineProvider>);
    expect(screen.queryByTestId('house-indicator')).toBeNull();
  });

  it('opens the canonical Fleet view in one activation', () => {
    summary = { playing: 1, paused: 0 };
    render(<MantineProvider><FleetIndicator /></MantineProvider>);
    fireEvent.click(screen.getByTestId('house-indicator'));
    expect(push).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith('fleet', {});
  });
});
