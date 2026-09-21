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
    expect(screen.getByTestId('house-indicator')).toHaveAccessibleName('0 playing · 1 paused');
  });

  it('opens the canonical Fleet view in one activation', () => {
    render(<MantineProvider><FleetIndicator /></MantineProvider>);
    fireEvent.click(screen.getByTestId('house-indicator'));
    expect(push).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith('fleet', {});
  });
});
