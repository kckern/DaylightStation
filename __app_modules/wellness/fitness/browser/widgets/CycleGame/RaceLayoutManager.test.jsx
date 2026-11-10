import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import RaceLayoutManager from "./RaceLayoutManager.jsx";

const panels = {
  distanceChart:  () => <div data-testid="p-chart" />,
  povGrid:        () => <div data-testid="p-pov" />,
  standingsTower: () => <div data-testid="p-tower" />,
  speedoRow:      () => <div data-testid="p-speedo" />
};

describe('RaceLayoutManager', () => {
  it('sidebar mode (≤3): chart, pov, standings tower, speedo all present (tower replaces the oval slot)', () => {
    const { getByTestId, queryByTestId } = render(<RaceLayoutManager panels={panels} mode="sidebar" />);
    ['p-chart', 'p-pov', 'p-tower', 'p-speedo'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(queryByTestId('zone-oval')).toBeNull();
    expect(getByTestId('race-layout').dataset.mode).toBe('sidebar');
  });
  it('wide mode (≥4): no oval; chart, pov, standings tower (docked column), speedo present', () => {
    const { getByTestId, queryByTestId } = render(<RaceLayoutManager panels={panels} mode="wide" />);
    ['p-chart', 'p-pov', 'p-tower', 'p-speedo'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(queryByTestId('zone-oval')).toBeNull();
    expect(getByTestId('race-layout').dataset.mode).toBe('wide');
  });
  it('puts the chart before the POV grid in sidebar mode', () => {
    const { getByTestId } = render(<RaceLayoutManager panels={panels} mode="sidebar" />);
    const root = getByTestId('race-layout');
    const zones = [...root.querySelectorAll('[data-testid^="zone-"]')].map((z) => z.dataset.testid);
    expect(zones.indexOf('zone-chart')).toBeLessThan(zones.indexOf('zone-pov'));
  });
  // Wide mode pairs the chart with the standings tower in the top row; the POV
  // grid is the docked right-edge column, so it comes last in DOM order.
  it('puts the chart, then the tower, then the POV grid in wide mode', () => {
    const { getByTestId } = render(<RaceLayoutManager panels={panels} mode="wide" />);
    const root = getByTestId('race-layout');
    const zones = [...root.querySelectorAll('[data-testid^="zone-"]')].map((z) => z.dataset.testid);
    expect(zones.indexOf('zone-chart')).toBeLessThan(zones.indexOf('zone-tower'));
    expect(zones.indexOf('zone-tower')).toBeLessThan(zones.indexOf('zone-pov'));
  });
  it('renders the standings tower in its own zone in both modes', () => {
    const sidebar = render(<RaceLayoutManager panels={panels} mode="sidebar" />);
    expect(within(sidebar.container).getByTestId('zone-tower')).toBeInTheDocument();
    sidebar.unmount();
    const wide = render(<RaceLayoutManager panels={panels} mode="wide" />);
    expect(within(wide.container).getByTestId('zone-tower')).toBeInTheDocument();
  });

  // Recap/playback feeds no speedoRow panel — the layout must NOT render (or
  // reserve a grid track for) a speedo zone, else the chart row is starved and a
  // dead band fills the rest. See RaceRecap (showSpeedos=false).
  const noSpeedo = { ...panels };
  delete noSpeedo.speedoRow;
  it('sidebar without a speedo panel: omits the speedo zone + flags --no-speedo', () => {
    const { getByTestId, queryByTestId } = render(<RaceLayoutManager panels={noSpeedo} mode="sidebar" />);
    expect(queryByTestId('zone-speedo')).toBeNull();
    expect(queryByTestId('p-speedo')).toBeNull();
    ['p-chart', 'p-pov', 'p-tower'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(getByTestId('race-layout').className).toContain('race-layout--no-speedo');
    expect(getByTestId('race-layout').querySelector('.race-layout__main--no-speedo')).toBeTruthy();
  });
  it('wide without a speedo panel: omits the speedo zone + flags --no-speedo', () => {
    const { getByTestId, queryByTestId } = render(<RaceLayoutManager panels={noSpeedo} mode="wide" />);
    expect(queryByTestId('zone-speedo')).toBeNull();
    expect(getByTestId('race-layout').className).toContain('race-layout--no-speedo');
    expect(getByTestId('race-layout').querySelector('.race-layout__wide-main--no-speedo')).toBeTruthy();
  });

  // Solo: one live rider and their rival. Chart across the top, a band of the
  // rider's gauge beside the pace panel, the POV as a right column. No tower.
  const soloPanels = { ...panels, paceDelta: () => <div data-testid="p-pace" /> };
  delete soloPanels.standingsTower;
  it('solo mode: chart, speedo, pace panel and POV; no tower zone and no empty zone', () => {
    const { getByTestId, queryByTestId, container } = render(<RaceLayoutManager panels={soloPanels} mode="solo" />);
    expect(getByTestId('race-layout').dataset.mode).toBe('solo');
    ['p-chart', 'p-speedo', 'p-pace', 'p-pov'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(queryByTestId('zone-tower')).toBeNull();
    expect(container.querySelector('.race-layout__zone--empty')).toBeNull();
    // The band holds the gauge then the pace panel; the POV is outside the main column.
    const band = getByTestId('race-layout').querySelector('.race-layout__solo-band');
    const bandZones = [...band.querySelectorAll('[data-testid^="zone-"]')].map((z) => z.dataset.testid);
    expect(bandZones).toEqual(['zone-speedo', 'zone-pace']);
    const main = getByTestId('race-layout').querySelector('.race-layout__solo-main');
    expect(main.contains(getByTestId('zone-chart'))).toBe(true);
    expect(main.contains(getByTestId('zone-pov'))).toBe(false);
  });
  it('solo without a speedo panel: the band holds the pace panel alone, no empty zone', () => {
    const noSpeedoSolo = { ...soloPanels };
    delete noSpeedoSolo.speedoRow;
    const { getByTestId, queryByTestId, container } = render(<RaceLayoutManager panels={noSpeedoSolo} mode="solo" />);
    expect(queryByTestId('zone-speedo')).toBeNull();
    expect(getByTestId('p-pace')).toBeInTheDocument();
    expect(container.querySelector('.race-layout__solo-band--no-speedo')).toBeTruthy();
    expect(container.querySelector('.race-layout__zone--empty')).toBeNull();
  });
  it('defaults to the sidebar layout when no mode is given', () => {
    const { getByTestId } = render(<RaceLayoutManager panels={panels} />);
    expect(getByTestId('race-layout').dataset.mode).toBe('sidebar');
  });
});
