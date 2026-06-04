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

  it('weights the top columns by the assigned panels\' sizeHint', () => {
    const decision = { zones: { topLeft: 'rankings', topCenter: 'cameraZoom', topRight: null, bottom: 'speedoRow' } };
    const panels = {
      rankings: () => <div data-testid="p-rankings" />,
      cameraZoom: () => <div data-testid="p-camera" />,
      speedoRow: () => <div data-testid="p-speedo" />
    };
    const { container } = render(<RaceLayoutManager decision={decision} panels={panels} />);
    const top = container.querySelector('.race-layout__top');
    expect(top.style.getPropertyValue('--top-cols')).toBe('1fr 2fr'); // rankings(1) + camera(2)
  });
  it('reserves a stable bottom band when the speedo row is present, collapses it when absent', () => {
    const withSpeedo = { zones: { topLeft: 'rankings', bottom: 'speedoRow' } };
    const noSpeedo = { zones: { topLeft: 'rankings', bottom: null } };
    const panels = { rankings: () => <div />, speedoRow: () => <div /> };
    const a = render(<RaceLayoutManager decision={withSpeedo} panels={panels} />);
    expect(a.container.querySelector('.race-layout').style.getPropertyValue('--rows')).toBe('1fr minmax(240px, 48%)');
    const b = render(<RaceLayoutManager decision={noSpeedo} panels={panels} />);
    expect(b.container.querySelector('.race-layout').style.getPropertyValue('--rows')).toBe('1fr 0px');
  });

  it('renders a two-column solo split (gauge left, the single top panel right) when solo', () => {
    const { container } = render(<RaceLayoutManager
      decision={{ zones: { bottom: 'speedoRow', topLeft: 'distanceChart', topCenter: null, topRight: null } }}
      panels={panels}
      solo
    />);
    expect(screen.getByTestId('race-layout-solo')).toBeInTheDocument();
    // left column = the bottom-zone panel (the gauge); right column = the one filled top panel
    expect(screen.getByTestId('zone-solo-left')).toContainElement(screen.getByTestId('p-speedo'));
    expect(screen.getByTestId('zone-solo-right')).toContainElement(screen.getByTestId('p-chart'));
    // the velodrome top-row / band markup is absent in solo mode
    expect(container.querySelector('.race-layout__top')).toBeNull();
  });

  it('falls back to the velodrome grid (no solo split) when solo is not set', () => {
    const { container } = render(<RaceLayoutManager
      decision={{ zones: { bottom: 'speedoRow', topLeft: 'distanceChart' } }}
      panels={panels}
    />);
    expect(screen.queryByTestId('race-layout-solo')).toBeNull();
    expect(container.querySelector('.race-layout__top')).not.toBeNull();
  });
});
