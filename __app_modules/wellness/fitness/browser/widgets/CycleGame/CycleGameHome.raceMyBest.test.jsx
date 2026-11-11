import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CycleGameHome from "./CycleGameHome.jsx";

const here = path.dirname(fileURLToPath(import.meta.url));
const people = [{ id: 'user_1', name: 'User_1' }, { id: 'user_2', name: 'User_2' }];
const oneRider = [{ id: 'a', name: 'A', rider: 'user_1' }, { id: 'b', name: 'B', rider: null }];
const twoRiders = [{ id: 'a', name: 'A', rider: 'user_1' }, { id: 'b', name: 'B', rider: 'user_2' }];

afterEach(cleanup);

describe('CycleGameHome — "Race my best" is opt-in', () => {
  it('is shown OFF by default for a lone rider and reports a press', () => {
    const onToggle = vi.fn();
    const { getByTestId } = render(
      <CycleGameHome bikes={oneRider} people={people} raceType="distance" canStart onToggleRaceMyBest={onToggle} />
    );
    const sw = getByTestId('race-my-best');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.textContent).toBe('Race my best');
    fireEvent.click(sw);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('reads as on when the container says so, and a second press turns it off (removes the rival)', () => {
    const onToggle = vi.fn();
    const { getByTestId } = render(
      <CycleGameHome bikes={oneRider} people={people} raceType="distance" canStart raceMyBest onToggleRaceMyBest={onToggle} />
    );
    const sw = getByTestId('race-my-best');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('is hidden with two riders (they race each other) and with a hand-picked ghost', () => {
    const { queryByTestId, rerender } = render(
      <CycleGameHome bikes={twoRiders} people={people} raceType="distance" onToggleRaceMyBest={() => {}} />
    );
    expect(queryByTestId('race-my-best')).toBeNull();
    rerender(
      <CycleGameHome bikes={oneRider} people={people} raceType="distance" onToggleRaceMyBest={() => {}}
        ghost={{ displayName: 'Old race', winCondition: 'distance', goalM: 300 }} />
    );
    expect(queryByTestId('race-my-best')).toBeNull();
  });

  it('cannot be pressed while a start is pending', () => {
    const onToggle = vi.fn();
    const { getByTestId } = render(
      <CycleGameHome bikes={oneRider} people={people} raceType="distance" busy onToggleRaceMyBest={onToggle} />
    );
    fireEvent.click(getByTestId('race-my-best'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});

// The starting grid is the point of the lobby: its tiles never shrink or crop
// (2026-11-10: squashed to half-moons when the cards and rail grew around them).
describe('starting grid tiles keep their shape', () => {
  const css = fs.readFileSync(path.join(here, 'home/BikeSlot.scss'), 'utf8');
  const block = (sel) => {
    const at = css.indexOf(sel);
    expect(at).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', at);
    return css.slice(open + 1, css.indexOf('\n  &', open + 1) > 0 ? css.indexOf('\n  &', open + 1) : undefined);
  };

  it('a slot has a fixed width, a fixed aspect ratio and never flexes', () => {
    const slot = block('.cgh-slot {');
    expect(slot).toMatch(/\bflex:\s*none;/);
    expect(slot).not.toMatch(/flex-shrink:\s*[1-9]/);
    expect(slot).not.toMatch(/flex:\s*\d+\s+[1-9]/);
    expect(slot).toMatch(/\baspect-ratio:\s*3\s*\/\s*4;/);
    expect(slot).toMatch(/\bwidth:\s*136px;/);
  });

  it('the device circle is a fixed square that never flexes', () => {
    const wrap = css.slice(css.indexOf('&__device-wrap {'), css.indexOf('}', css.indexOf('&__device-wrap {')));
    expect(wrap).toMatch(/flex:\s*none;/);
    expect(wrap).toMatch(/aspect-ratio:\s*1;/);
    expect(wrap).toMatch(/width:\s*96px;/);
    expect(wrap).toMatch(/height:\s*96px;/);
  });

  it('six slots fit the kiosk main column (1381x777 CSS px, rail 260 px)', () => {
    // 1381 - 64 nav rail - 16 frame margin = ~1301 content; minus 2x24 padding, 28 gap, 260 rail.
    const column = 1301 - 48 - 28 - 260;
    expect(6 * 136 + 5 * 16).toBeLessThanOrEqual(column);
  });

  it('the grid section and row take their height first (no flex-shrink)', () => {
    const home = fs.readFileSync(path.join(here, 'CycleGameHome.scss'), 'utf8');
    const section = home.slice(home.indexOf('.cgh-grid-section {'), home.indexOf('}', home.indexOf('.cgh-grid-section {')));
    expect(section).toMatch(/flex:\s*none;/);
    expect(section).not.toMatch(/min-height:\s*0/);
    const grid = home.slice(home.indexOf('.cgh-grid {'), home.indexOf('&::before', home.indexOf('.cgh-grid {')));
    expect(grid).toMatch(/flex:\s*none;/);
    expect(grid).toMatch(/flex-wrap:\s*nowrap;/);
  });
});

// No scrollbar on the lobby's main column (owner, 2026-11-10). The column must
// FIT; the screenshot harness measures scrollHeight <= clientHeight per state
// (lobbyMainOverflow), this guards the CSS that would bring a scrollbar back.
describe('lobby main column never scrolls', () => {
  const home = fs.readFileSync(path.join(here, 'CycleGameHome.scss'), 'utf8');
  const start = home.indexOf('&__main {');
  const main = home.slice(start, home.indexOf('\n  }', start));
  it('declares no scrolling overflow and keeps every child at its own height', () => {
    expect(main).not.toMatch(/overflow(-y)?:\s*(auto|scroll)/);
    expect(main).toMatch(/overflow:\s*visible;/);
    expect(main).toMatch(/> \* \{ flex: none; \}/);
  });
  it('has no boost-rule styles left', () => {
    expect(home).not.toContain('cgh-boost-rule');
  });
});
