import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MacroBarRow } from './MacroBarRow.jsx';

// jsdom CANNOT see layout, so nothing here asserts a rendered pixel width.
// What it CAN see is the value we put into the style attribute and the class
// we chose — those are the decisions this component makes, and those are what
// is asserted. Geometry lives in health.scss.

const MACROS = { protein: 82, carbs: 140, fat: 40, fiber: 12, sugar: 60, sodium: 2480, cholesterol: 120 };
const fill = (label) => screen.getByLabelText(new RegExp(`^${label} `)).querySelector('.health-macrobar__fill');
const item = (label) => screen.getByLabelText(new RegExp(`^${label} `)).closest('.health-macrobar__item');

describe('MacroBarRow — nothing to say, nothing rendered', () => {
  it('renders nothing when no goals are configured', () => {
    const { container } = render(<MacroBarRow macros={MACROS} goals={{}} microCoverage={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the budget has not arrived', () => {
    const { container } = render(<MacroBarRow macros={undefined}
      goals={{ macroGoals: { proteinG: 150 } }} microCoverage={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders only the macros that actually have a target', () => {
    render(<MacroBarRow macros={MACROS} goals={{ macroGoals: { proteinG: 150, carbsG: null, fatG: null } }} microCoverage={{}} />);
    expect(screen.getByText('Protein')).toBeTruthy();
    expect(screen.queryByText('Carbs')).toBeNull();
    expect(screen.queryByText('Fat')).toBeNull();
  });
});

describe('MacroBarRow — macro bars', () => {
  it('fills toward the goal and puts every number in the accessible name', () => {
    render(<MacroBarRow macros={MACROS} goals={{ macroGoals: { proteinG: 150 } }} microCoverage={{}} />);
    const bar = screen.getByLabelText(/^Protein /);
    expect(bar.getAttribute('aria-label')).toBe('Protein 82 of 150 g goal, 55 percent');
    expect(fill('Protein').style.width).toBe('55%');
    expect(item('Protein').className).toContain('health-macrobar__item--goal');
  });

  it('marks an over-GOAL macro as a warning, not a danger, and clamps the fill at 100%', () => {
    render(<MacroBarRow macros={MACROS} goals={{ macroGoals: { proteinG: 50 } }} microCoverage={{}} />);
    expect(item('Protein').className).toContain('--over-goal');
    expect(item('Protein').className).not.toContain('--over-limit');
    expect(fill('Protein').style.width).toBe('100%');
    expect(screen.getByLabelText(/^Protein /).getAttribute('aria-label')).toMatch(/over goal$/);
  });
});

describe('MacroBarRow — watch micros', () => {
  const withWatch = (watchMicros, microCoverage = {}) => render(
    <MacroBarRow macros={MACROS} goals={{ watchMicros }} microCoverage={microCoverage} />,
  );

  it('a ceiling micro over its limit is DANGER', () => {
    withWatch([{ key: 'sodium', limit: 2300, direction: 'ceiling' }]);
    expect(item('Sodium').className).toContain('--over-limit');
    expect(screen.getByLabelText(/^Sodium /).getAttribute('aria-label'))
      .toBe('Sodium 2,480 of 2,300 mg limit, over limit');
  });

  it('a ceiling micro under its limit is not flagged at all', () => {
    withWatch([{ key: 'sodium', limit: 5000, direction: 'ceiling' }]);
    expect(item('Sodium').className).toContain('health-macrobar__item--limit');
    expect(item('Sodium').className).not.toContain('--over-limit');
    expect(fill('Sodium').style.width).toBe('50%');
  });

  it('a FLOOR micro under target is incomplete, never danger', () => {
    withWatch([{ key: 'fiber', limit: 30, direction: 'floor' }]);
    expect(item('Fiber').className).toContain('health-macrobar__item--floor');
    expect(item('Fiber').className).not.toContain('--over-limit');
    expect(fill('Fiber').style.width).toBe('40%');
  });

  it('a FLOOR micro past target reads as reached', () => {
    withWatch([{ key: 'fiber', limit: 10, direction: 'floor' }]);
    expect(item('Fiber').className).toContain('--reached');
    expect(screen.getByLabelText(/^Fiber /).getAttribute('aria-label')).toMatch(/target reached/);
  });

  it('ignores a watch entry for an unknown micro or a non-positive limit', () => {
    withWatch([{ key: 'potassium', limit: 3500, direction: 'ceiling' }, { key: 'sodium', limit: 0, direction: 'ceiling' }]);
    expect(screen.queryByText('Sodium')).toBeNull();
  });
});

// The reason this component exists in the shape it does. A stored micro is
// ALWAYS a number — 0 when nothing measured it — so a bar summed over rows
// with no provenance is arithmetic over ignorance. The caption is the only
// thing that says so.
describe('MacroBarRow — coverage honesty', () => {
  const watch = [{ key: 'sodium', limit: 2300, direction: 'ceiling' }];

  it('captions the bar when some counted items lack micro data', () => {
    render(<MacroBarRow macros={MACROS} goals={{ watchMicros: watch }}
      microCoverage={{ sodium: { covered: 3, total: 7 } }} />);
    expect(screen.getByText('based on 3 of 7 items')).toBeTruthy();
    expect(screen.getByLabelText(/^Sodium /).getAttribute('aria-label')).toMatch(/based on 3 of 7 items$/);
  });

  it('captions a bar with ZERO coverage — the most misleading case of all', () => {
    render(<MacroBarRow macros={{ ...MACROS, sodium: 0 }} goals={{ watchMicros: watch }}
      microCoverage={{ sodium: { covered: 0, total: 5 } }} />);
    expect(screen.getByText('based on 0 of 5 items')).toBeTruthy();
  });

  it('drops the caption only when EVERY counted item carries micro data', () => {
    render(<MacroBarRow macros={MACROS} goals={{ watchMicros: watch }}
      microCoverage={{ sodium: { covered: 7, total: 7 } }} />);
    expect(screen.queryByText(/based on/)).toBeNull();
  });

  it('shows no caption on an empty day — "0 of 0 items" is noise, not honesty', () => {
    render(<MacroBarRow macros={{ ...MACROS, sodium: 0 }} goals={{ watchMicros: watch }}
      microCoverage={{ sodium: { covered: 0, total: 0 } }} />);
    expect(screen.queryByText(/based on/)).toBeNull();
  });

  it('never captions a MACRO bar — macros are stored on every row and are not coverage-gated', () => {
    render(<MacroBarRow macros={MACROS} goals={{ macroGoals: { proteinG: 150 } }}
      microCoverage={{ sodium: { covered: 1, total: 9 } }} />);
    expect(screen.queryByText(/based on/)).toBeNull();
  });
});
