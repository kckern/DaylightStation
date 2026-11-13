import { it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PadGlyph, PixelIcon, iconForSymbol } from './SkylinePixelIcons.jsx';
import SkylineFlightHud from './SkylineFlightHud.jsx';
import { createSkylineControlState, describeSkylineControls } from '../../lib/skylineGlider/controllerModel.js';

it('has a drawn icon for every symbol the control model puts on a button', () => {
  const acts = [{ id: 'one', name: 'One', status: 'open' }, { id: 'two', name: 'Two', status: 'locked' }];
  const base = { ...createSkylineControlState({ acts, riders: [] }), actId: 'one', weaponsEnabled: true };
  const phases = ['identity', 'roster', 'flights', 'ready', 'countdown', 'flight', 'menu', 'settings', 'crash', 'result', 'denied', 'save-details', 'stall', 'saving'];
  const symbols = new Set(phases.flatMap((phase) => [
    ...describeSkylineControls({ ...base, phase }),
    ...describeSkylineControls({ ...base, phase, saveStatus: 'error', resumeIntent: 'live' }),
  ]).map((control) => control.icon));
  expect(symbols.size).toBeGreaterThan(8);
  expect([...symbols].filter((symbol) => !iconForSymbol(symbol))).toEqual([]);
  expect(iconForSymbol('?')).toBeNull();
});

it('draws an icon as an outlined bitmap, and nothing for an unknown name', () => {
  const { container } = render(<><PixelIcon name="heart"/><PixelIcon name="no-such-icon"/></>);
  const icons = container.querySelectorAll('svg.sg-icon');
  expect(icons).toHaveLength(1);
  expect(icons[0]).toHaveAttribute('viewBox', '0 0 11 11'); // 9×9 plus the outline pixel all round
  expect(icons[0].querySelector('.sg-icon__body').getAttribute('d')).toMatch(/^M/);
  expect(icons[0].querySelector('.sg-icon__ink').getAttribute('d')).toMatch(/^M/);
});

it('lights exactly the named bike button on the pad glyph', () => {
  const { container } = render(<PadGlyph position={3}/>);
  const lit = [...container.querySelectorAll('.sg-pad__key')].filter((key) => key.dataset.lit === 'true');
  expect(lit.map((key) => key.dataset.slot)).toEqual(['3']);
  // Bottom-left: first column, second row.
  expect(lit[0]).toHaveAttribute('x', '1');
  expect(lit[0]).toHaveAttribute('y', '5');
});

it('shows every heart the flight started with, spent ones dimmed', () => {
  const flight = { lives: 1, courseTime: 0, collectedIds: [], bombsLeft: 2, missilesLeft: 1, boostRemaining: 0, boostRechargeRemaining: 0 };
  const course = { duration_s: 60, rules: { lives: 3 } };
  const { getByRole } = render(<SkylineFlightHud flight={flight} course={course} armed targetsHit={0} power={1}/>);
  const hearts = getByRole('img', { name: '1 hearts left' });
  expect(hearts.querySelectorAll('[data-icon="heart"]')).toHaveLength(3);
  expect(hearts.querySelectorAll('.is-spent')).toHaveLength(2);
});
