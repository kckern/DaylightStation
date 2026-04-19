import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let castTargetCtx = { mode: 'transfer', targetIds: [], setMode: vi.fn(), toggleTarget: vi.fn(), clearTargets: vi.fn() };
vi.mock('./useCastTarget.js', () => ({
  useCastTarget: vi.fn(() => castTargetCtx),
}));

let fleetCtx = { devices: [{ id: 'lr', name: 'Living Room' }, { id: 'ot', name: 'Office' }], byDevice: new Map(), loading: false, error: null };
vi.mock('../fleet/FleetProvider.jsx', () => ({
  useFleetContext: vi.fn(() => fleetCtx),
}));

import { CastTargetChip } from './CastTargetChip.jsx';

beforeEach(() => {
  castTargetCtx = { mode: 'transfer', targetIds: [], setMode: vi.fn(), toggleTarget: vi.fn(), clearTargets: vi.fn() };
  fleetCtx = { devices: [{ id: 'lr', name: 'Living Room' }, { id: 'ot', name: 'Office' }], byDevice: new Map(), loading: false, error: null };
});

describe('CastTargetChip', () => {
  it('shows "No target" label when targetIds is empty', () => {
    render(<CastTargetChip />);
    expect(screen.getByTestId('cast-target-chip')).toHaveTextContent(/no target/i);
  });

  it('shows selected target names joined', () => {
    castTargetCtx = { ...castTargetCtx, targetIds: ['lr', 'ot'] };
    render(<CastTargetChip />);
    expect(screen.getByTestId('cast-target-chip')).toHaveTextContent(/Living Room.*Office/);
  });

  it('clicking the chip opens a popover', () => {
    render(<CastTargetChip />);
    fireEvent.click(screen.getByTestId('cast-target-chip'));
    expect(screen.getByTestId('cast-popover')).toBeInTheDocument();
  });

  it('popover lists each fleet device with a checkbox and a mode toggle', () => {
    render(<CastTargetChip />);
    fireEvent.click(screen.getByTestId('cast-target-chip'));
    expect(screen.getByTestId('cast-target-checkbox-lr')).toBeInTheDocument();
    expect(screen.getByTestId('cast-target-checkbox-ot')).toBeInTheDocument();
    expect(screen.getByTestId('cast-mode-transfer')).toBeInTheDocument();
    expect(screen.getByTestId('cast-mode-fork')).toBeInTheDocument();
  });

  it('checkbox click calls toggleTarget', () => {
    render(<CastTargetChip />);
    fireEvent.click(screen.getByTestId('cast-target-chip'));
    fireEvent.click(screen.getByTestId('cast-target-checkbox-lr'));
    expect(castTargetCtx.toggleTarget).toHaveBeenCalledWith('lr');
  });

  it('mode toggle calls setMode', () => {
    render(<CastTargetChip />);
    fireEvent.click(screen.getByTestId('cast-target-chip'));
    fireEvent.click(screen.getByTestId('cast-mode-fork'));
    expect(castTargetCtx.setMode).toHaveBeenCalledWith('fork');
  });
});
