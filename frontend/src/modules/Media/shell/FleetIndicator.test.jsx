import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let summary = { total: 0, online: 0, offline: 0 };
vi.mock('../fleet/useFleetSummary.js', () => ({
  useFleetSummary: vi.fn(() => summary),
}));

const navCtx = { push: vi.fn() };
vi.mock('./NavProvider.jsx', () => ({
  useNav: vi.fn(() => navCtx),
}));

import { FleetIndicator } from './FleetIndicator.jsx';

beforeEach(() => {
  navCtx.push.mockClear();
  summary = { total: 0, online: 0, offline: 0 };
});

describe('FleetIndicator', () => {
  it('renders total/online counts', () => {
    summary = { total: 2, online: 1, offline: 0 };
    render(<FleetIndicator />);
    expect(screen.getByTestId('fleet-indicator').textContent).toContain('1/2');
  });

  it('renders nothing meaningful when total=0 (no devices)', () => {
    summary = { total: 0, online: 0, offline: 0 };
    render(<FleetIndicator />);
    expect(screen.getByTestId('fleet-indicator').textContent).toContain('0/0');
  });

  it('click navigates to fleet view', () => {
    summary = { total: 2, online: 2, offline: 0 };
    render(<FleetIndicator />);
    fireEvent.click(screen.getByTestId('fleet-indicator'));
    expect(navCtx.push).toHaveBeenCalledWith('fleet', {});
  });
});
