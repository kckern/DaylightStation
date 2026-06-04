import { describe, it, expect } from 'vitest';
import { RACE_PANELS, panelById } from './racePanels.js';

const snap = (over = {}) => ({
  fieldSize: 2, isSolo: false, lapsEnabled: false, leaderGapM: 0, lapDeltaMax: 0,
  phase: 'MID', events: [], ...over
});

describe('racePanels registry', () => {
  it('every panel has the descriptor contract', () => {
    RACE_PANELS.forEach((p) => {
      expect(typeof p.id).toBe('string');
      expect(Array.isArray(p.zones)).toBe(true);
      expect(['wide', 'standard', 'focus']).toContain(p.sizeHint);
      expect(typeof p.candidacy).toBe('function');
      expect(typeof p.priority).toBe('function');
    });
  });

  it('speedoRow is always a candidate; rankings/chart need fieldSize >= 2', () => {
    expect(panelById('speedoRow').candidacy(snap({ fieldSize: 1, isSolo: true }))).toBe(true);
    expect(panelById('rankings').candidacy(snap({ fieldSize: 1, isSolo: true }))).toBe(false);
    expect(panelById('rankings').candidacy(snap({ fieldSize: 2 }))).toBe(true); // ghost counts
    // Solo: chart is suppressed ONLY when laps are on (the lap table takes the
    // stage). A solo race with no laps still shows the chart as a pace line.
    expect(panelById('distanceChart').candidacy(snap({ fieldSize: 1, isSolo: true, lapsEnabled: true }))).toBe(false);
    expect(panelById('distanceChart').candidacy(snap({ fieldSize: 1, isSolo: true, lapsEnabled: false }))).toBe(true);
  });

  it('lapPanel needs laps and is boosted when solo', () => {
    expect(panelById('lapPanel').candidacy(snap({ lapsEnabled: false }))).toBe(false);
    const grouped = panelById('lapPanel').priority(snap({ lapsEnabled: true, isSolo: false }));
    const solo = panelById('lapPanel').priority(snap({ lapsEnabled: true, isSolo: true }));
    expect(solo).toBeGreaterThan(grouped);
  });

  it('racePistons needs competitors (fieldSize >= 2)', () => {
    expect(panelById('racePistons').candidacy(snap({ fieldSize: 1, isSolo: true }))).toBe(false);
    expect(panelById('racePistons').candidacy(snap({ fieldSize: 2 }))).toBe(true);
  });

  it('cameraZoom only candidates on its trigger events', () => {
    expect(panelById('cameraZoom').candidacy(snap({ events: [] }))).toBe(false);
    expect(panelById('cameraZoom').candidacy(snap({ events: [{ type: 'LAPPING_IMMINENT' }] }))).toBe(true);
    expect(panelById('cameraZoom').transient.minHoldS).toBeGreaterThan(0);
  });
});
