import { it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SkylineFlightHud from './SkylineFlightHud.jsx';

const flight = { lives: 3, courseTime: 0, collectedIds: ['a', 'b'], bombsLeft: 2, missilesLeft: 1, boostRemaining: 0, boostRechargeRemaining: 0 };
const sheet = { url: '/sheet.png', width: 64, height: 64 };
const coinZone = { collectible: { frames: ['collectible.spin.0', 'collectible.spin.1'], fps: 8 } };
const coinAssets = { images: new Map(), sheet, frames: { 'collectible.spin.0': { x: 16, y: 0, w: 12, h: 16 } }, missing: [] };

it('counts pickups with the zone\'s own collectible sprite (a coin on coin levels)', () => {
  const course = { duration_s: 60, rules: { lives: 3 }, zone: coinZone };
  render(<SkylineFlightHud flight={flight} course={course} assets={coinAssets} armed targetsHit={0} power={1}/>);
  const stat = screen.getByTestId('skyline-glider-collected');
  expect(stat).toHaveTextContent('2');
  const sprite = stat.querySelector('svg[data-collectible="sprite"]');
  expect(sprite).not.toBeNull();
  expect(sprite).toHaveAttribute('viewBox', '16 0 12 16');
  expect(sprite.querySelector('image')).toHaveAttribute('href', '/sheet.png');
  expect(stat.querySelector('[data-icon="bell"]')).toBeNull();
});

it('keeps the bell where the zone draws bells (no collectible sprite loaded)', () => {
  const course = { duration_s: 60, rules: { lives: 3 }, zone: { collectible: {} } };
  render(<SkylineFlightHud flight={flight} course={course} armed targetsHit={0} power={1}/>);
  expect(screen.getByTestId('skyline-glider-collected').querySelector('[data-icon="bell"]')).not.toBeNull();
});

it('has a touch "more" button that opens the sound sheet', () => {
  const onMore = vi.fn();
  render(<SkylineFlightHud flight={flight} course={{ duration_s: 60, rules: { lives: 3 } }} armed targetsHit={0} power={1} onMore={onMore}/>);
  fireEvent.click(screen.getByRole('button', { name: /sound and settings/i }));
  expect(onMore).toHaveBeenCalledTimes(1);
});
