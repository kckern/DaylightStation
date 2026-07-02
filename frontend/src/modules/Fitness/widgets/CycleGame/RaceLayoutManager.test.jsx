import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import RaceLayoutManager from './RaceLayoutManager.jsx';

const panels = {
  distanceChart:  () => <div data-testid="p-chart" />,
  povGrid:        () => <div data-testid="p-pov" />,
  standingsTower: () => <div data-testid="p-tower" />,
  speedoRow:      () => <div data-testid="p-speedo" />
};

describe('RaceLayoutManager', () => {
  it('sidebar mode (≤3): chart, pov, standings tower, speedo all present (tower replaces the oval slot)', () => {
    const { getByTestId, queryByTestId } = render(<RaceLayoutManager panels={panels} fieldSize={2} />);
    ['p-chart', 'p-pov', 'p-tower', 'p-speedo'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(queryByTestId('zone-oval')).toBeNull();
    expect(getByTestId('race-layout').dataset.mode).toBe('sidebar');
  });
  it('wide mode (≥4): no oval; chart, pov, standings tower (docked column), speedo present', () => {
    const { getByTestId, queryByTestId } = render(<RaceLayoutManager panels={panels} fieldSize={4} />);
    ['p-chart', 'p-pov', 'p-tower', 'p-speedo'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(queryByTestId('zone-oval')).toBeNull();
    expect(getByTestId('race-layout').dataset.mode).toBe('wide');
  });
  it('puts the chart before the POV grid in sidebar mode', () => {
    const { getByTestId } = render(<RaceLayoutManager panels={panels} fieldSize={2} />);
    const root = getByTestId('race-layout');
    const zones = [...root.querySelectorAll('[data-testid^="zone-"]')].map((z) => z.dataset.testid);
    expect(zones.indexOf('zone-chart')).toBeLessThan(zones.indexOf('zone-pov'));
  });
  it('puts the chart before the POV grid in wide mode', () => {
    const { getByTestId } = render(<RaceLayoutManager panels={panels} fieldSize={4} />);
    const root = getByTestId('race-layout');
    const zones = [...root.querySelectorAll('[data-testid^="zone-"]')].map((z) => z.dataset.testid);
    expect(zones.indexOf('zone-chart')).toBeLessThan(zones.indexOf('zone-pov'));
  });
  it('renders the standings tower in its own zone in both modes', () => {
    const sidebar = render(<RaceLayoutManager panels={panels} fieldSize={2} />);
    expect(within(sidebar.container).getByTestId('zone-tower')).toBeInTheDocument();
    sidebar.unmount();
    const wide = render(<RaceLayoutManager panels={panels} fieldSize={5} />);
    expect(within(wide.container).getByTestId('zone-tower')).toBeInTheDocument();
  });

  // Recap/playback feeds no speedoRow panel — the layout must NOT render (or
  // reserve a grid track for) a speedo zone, else the chart row is starved and a
  // dead band fills the rest. See RaceRecap (showSpeedos=false).
  const noSpeedo = { ...panels };
  delete noSpeedo.speedoRow;
  it('sidebar without a speedo panel: omits the speedo zone + flags --no-speedo', () => {
    const { getByTestId, queryByTestId } = render(<RaceLayoutManager panels={noSpeedo} fieldSize={2} />);
    expect(queryByTestId('zone-speedo')).toBeNull();
    expect(queryByTestId('p-speedo')).toBeNull();
    ['p-chart', 'p-pov', 'p-tower'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(getByTestId('race-layout').className).toContain('race-layout--no-speedo');
    expect(getByTestId('race-layout').querySelector('.race-layout__main--no-speedo')).toBeTruthy();
  });
  it('wide without a speedo panel: omits the speedo zone + flags --no-speedo', () => {
    const { getByTestId, queryByTestId } = render(<RaceLayoutManager panels={noSpeedo} fieldSize={5} />);
    expect(queryByTestId('zone-speedo')).toBeNull();
    expect(getByTestId('race-layout').className).toContain('race-layout--no-speedo');
    expect(getByTestId('race-layout').querySelector('.race-layout__wide-main--no-speedo')).toBeTruthy();
  });
});
