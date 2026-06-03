import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RaceLayoutManager from './RaceLayoutManager.jsx';

const panels = {
  speedoRow: () => <div data-testid="p-speedo">speedo</div>,
  rankings: () => <div data-testid="p-rankings">rank</div>,
  distanceChart: () => <div data-testid="p-chart">chart</div>
};

describe('RaceLayoutManager', () => {
  it('renders the panel each zone is assigned, and collapses null zones', () => {
    render(<RaceLayoutManager
      decision={{ zones: { bottom: 'speedoRow', topLeft: 'distanceChart', topCenter: null, topRight: 'rankings' } }}
      panels={panels}
    />);
    expect(screen.getByTestId('p-speedo')).toBeInTheDocument();
    expect(screen.getByTestId('p-chart')).toBeInTheDocument();
    expect(screen.getByTestId('p-rankings')).toBeInTheDocument();
    expect(screen.getByTestId('zone-topCenter')).toHaveClass('race-layout__zone--empty');
  });

  it('renders nothing (no crash) for a zone assigned an id missing from the panels map', () => {
    render(<RaceLayoutManager
      decision={{ zones: { bottom: 'speedoRow', topLeft: 'lapTable', topCenter: null, topRight: null } }}
      panels={panels}
    />);
    expect(screen.getByTestId('p-speedo')).toBeInTheDocument();
    // lapTable isn't in the map yet (Phase D) — zone renders empty, no throw
    expect(screen.getByTestId('zone-topLeft')).toBeInTheDocument();
  });
});
