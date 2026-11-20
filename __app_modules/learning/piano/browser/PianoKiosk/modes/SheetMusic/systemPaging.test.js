import { describe, it, expect } from 'vitest';
import { engravedSystems, systemCuts, pageAt, pageStops, nextStart, prevStart, startForSystems, startForCursor, tallestSystem } from './systemPaging.js';

// Nine systems, 250px apart, each 200px of staff: the shape of the Jesu score.
const rects = Array.from({ length: 9 }, (_, system) => [0, 1, 2, 3].map(() => ({ left: 0, right: 10, top: 60 + system * 250, bottom: 260 + system * 250, system }))).flat();
const systems = engravedSystems(rects);
const cuts = systemCuts(systems, 2320);

describe('systemPaging', () => {
  it('reads one entry per system with the measures it holds', () => {
    expect(systems).toHaveLength(9);
    expect(systems[2]).toMatchObject({ system: 2, top: 560, bottom: 760, firstMeasure: 8, lastMeasure: 11 });
  });

  it('cuts midway between systems when nothing is measured', () => {
    expect(cuts).toHaveLength(10);
    expect(cuts[0]).toBe(0);
    expect(cuts[1]).toBe(285);
    expect(cuts[9]).toBe(2320);
  });

  it('cuts in the widest strip without ink', () => {
    // A pedal bracket under system 0 (260-280) and a passage number over system 1 (285-310).
    const inked = systemCuts(systems.slice(0, 2), 600, [[40, 280], [285, 520]]);
    expect(inked[1]).toBe(282.5);
    expect(inked[0]).toBe(40);
    expect(inked[2]).toBe(520);
    // A frame through the whole gap is ignored.
    expect(systemCuts(systems.slice(0, 2), 600, [[0, 600]])[1]).toBe(285);
  });

  it('shows only whole systems, centred in the window', () => {
    const page = pageAt(cuts, 0, 622);
    expect(page).toMatchObject({ start: 0, end: 2, top: 0, bottom: 535, hasPrev: false, hasNext: true, index: 0 });
    expect(page.bottom - page.top).toBeLessThanOrEqual(622);
    expect(page.shift).toBe(Math.round((622 - 535) / 2));
  });

  it('turns by whole pages and ends on a full one', () => {
    expect(pageStops(cuts, 622)).toEqual([0, 2, 4, 6, 7]);
    expect(nextStart(cuts, 0, 622)).toBe(2);
    expect(nextStart(cuts, 6, 622)).toBe(7);
    expect(nextStart(cuts, 7, 622)).toBe(7);
    expect(prevStart(cuts, 7, 622)).toBe(5);
    expect(prevStart(cuts, 2, 622)).toBe(0);
    expect(prevStart(cuts, 0, 622)).toBe(0);
    expect(pageAt(cuts, 7, 622)).toMatchObject({ start: 7, end: 9, hasNext: false, hasPrev: true, index: 4, pages: 5 });
    // A start past the last full page is pulled back to it.
    expect(pageAt(cuts, 8, 622).start).toBe(7);
  });

  it('always shows one system, even in a window too short for it', () => {
    expect(pageAt(cuts, 3, 100)).toMatchObject({ start: 3, end: 4 });
    expect(pageAt(cuts, 3, 100).shift).toBe(-cuts[3]);
  });

  it('turns to the page that holds a passage whole', () => {
    // Already on screen: stay.
    expect(startForSystems(cuts, 622, 0, 1, 1)).toBe(0);
    // On a fixed page: go there.
    expect(startForSystems(cuts, 622, 0, 4, 5)).toBe(4);
    // Across two fixed pages: start at its first system.
    expect(startForSystems(cuts, 622, 0, 1, 2)).toBe(1);
    // The last systems: the last full page.
    expect(startForSystems(cuts, 622, 0, 8, 8)).toBe(7);
  });

  it('keeps the cursor on the page, and turns ahead of it while the music runs', () => {
    // On the page, not running: the page stays, even on its last system.
    expect(startForCursor(cuts, 622, 0, 0)).toBe(0);
    expect(startForCursor(cuts, 622, 0, 1)).toBe(0);
    // Running: reaching the last system on the page moves it to the top, so the
    // cursor stays on screen and the next system is readable before it is needed.
    expect(startForCursor(cuts, 622, 0, 0, { ahead: true })).toBe(0);
    expect(startForCursor(cuts, 622, 0, 1, { ahead: true })).toBe(1);
    expect(pageAt(cuts, 1, 622)).toMatchObject({ start: 1, end: 3 });
    // Three to a page: two systems are played before it turns.
    expect(startForCursor(cuts, 800, 0, 1, { ahead: true })).toBe(0);
    expect(startForCursor(cuts, 800, 0, 2, { ahead: true })).toBe(2);
    // The end of the piece is already showing: nothing to turn to.
    expect(startForCursor(cuts, 622, 7, 8, { ahead: true })).toBe(7);
    // The last page is a full one, so the cursor's system is not always its first.
    expect(startForCursor(cuts, 622, 6, 7, { ahead: true })).toBe(7);
    // Off the page (a restart, a page turned by hand, a loop that wraps): go to it.
    expect(startForCursor(cuts, 622, 4, 0)).toBe(0);
    expect(startForCursor(cuts, 622, 0, 5)).toBe(5);
    expect(startForCursor(cuts, 622, 0, 8)).toBe(7);
    // One system to a page: it turns as the cursor crosses to the next system.
    expect(startForCursor(cuts, 300, 2, 2, { ahead: true })).toBe(2);
    expect(startForCursor(cuts, 300, 2, 3, { ahead: true })).toBe(3);
    // A turn that would show nothing new waits: system 2 is too tall to join system 1.
    const uneven = [0, 250, 500, 1000, 1250];
    expect(startForCursor(uneven, 520, 0, 1, { ahead: true })).toBe(0);
    expect(startForCursor(uneven, 520, 0, 2, { ahead: true })).toBe(2);
    // No such system: stay.
    expect(startForCursor(cuts, 622, 2, -1)).toBe(2);
    expect(startForCursor([], 622, 0, 0)).toBe(0);
  });

  it('fits a page to its ink, not to the white paper between systems', () => {
    // Each system's ink is 200px of the 285 between its cuts.
    const ink = systems.map((system) => [system.top, system.bottom]);
    const inked = systemCuts(systems, 2320, ink);
    expect(inked.ink[1]).toEqual([310, 510]);
    // Two systems are 450px of ink and a 10px margin each side: they fit a 479px
    // window that cut to cut (535px) would give to one system alone.
    expect(pageAt(cuts, 0, 479)).toMatchObject({ start: 0, end: 1 });
    const page = pageAt(inked, 0, 479);
    expect(page).toMatchObject({ start: 0, end: 2, top: inked[0], bottom: inked[2] });
    // The ink, with its margin, is centred: 60 (the top of the paper) to 520.
    expect(page.shift).toBe(Math.round((479 - 460) / 2) - 60);
    expect(pageStops(inked, 479)).toEqual([0, 2, 4, 6, 7]);
    expect(tallestSystem(inked)).toBe(220);
  });

  it('measures the tallest system, cut to cut', () => {
    expect(tallestSystem(cuts)).toBe(285);
    expect(tallestSystem([])).toBe(0);
  });

  it('is empty for a score with no systems', () => {
    expect(systemCuts([], 0)).toEqual([]);
    expect(pageAt([], 0, 622)).toBeNull();
    expect(pageStops([], 622)).toEqual([]);
  });
});
