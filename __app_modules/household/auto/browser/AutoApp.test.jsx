import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import AutoApp from './AutoApp.jsx';

vi.mock('../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

function expectMainFor(element) {
  const main = screen.getByRole('main');
  expect(main).toBeVisible();
  expect(main).toContainElement(element);
  expect(main.closest('.auto-app.ds-root')).toBeTruthy();
  expect(main).toHaveClass('ds-chrome__main');
}

it('keeps loading, failure, and a successful empty garage inside one main', async () => {
  let rejectVehicles;
  let failed = false;
  DaylightAPI.mockImplementation(path => {
    if (!path.endsWith('/vehicles')) return Promise.resolve({});
    if (failed) return Promise.resolve({ vehicles: [] });
    return new Promise((_, reject) => { rejectVehicles = reject; });
  });
  render(<AutoApp />);
  expectMainFor(screen.getByLabelText('Loading garage'));
  expect(screen.getByRole('heading', { name: 'Garage', level: 1 })).toBeVisible();
  expect(screen.queryByRole('navigation')).toBeNull();
  failed = true;
  await act(async () => rejectVehicles(new Error('Garage unavailable')));
  expectMainFor(await screen.findByRole('alert'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expectMainFor(await screen.findByText('No vehicles yet'));
});

it('preserves one main when selecting a car and returning to the garage', async () => {
  const cars = [{ id: 'first', label: 'First car' }, { id: 'second', label: 'Second car' }];
  DaylightAPI.mockImplementation(path => Promise.resolve(path.endsWith('/vehicles')
    ? { vehicles: cars } : { odometer: { km: 120 }, fuel: { needsMoreData: true }, trip_count: 0 }));
  render(<AutoApp />);
  const car = await screen.findByRole('button', { name: 'First car' });
  expectMainFor(car);
  car.focus();
  fireEvent.click(car);
  expectMainFor(await screen.findByText('Odometer'));
  expect(screen.getByRole('heading', { name: 'First car' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Car' })).toHaveAttribute('aria-current', 'page');
  const back = screen.getByRole('button', { name: 'Back to garage' });
  expect(back).toHaveFocus();
  fireEvent.click(back);
  expectMainFor(await screen.findByRole('button', { name: 'Second car' }));
  expect(screen.getByRole('button', { name: 'First car' })).toHaveFocus();
  expect(screen.queryByRole('navigation')).toBeNull();
});

it.each([
  { fuelState: 'a matching fill-up', logs: [{ date: '2026-10-08', place: 'station' }], prompts: 0 },
  { fuelState: 'no fill-ups', logs: [], prompts: 1 },
])('checks the fuel log before prompting to log a stop with $fuelState', async ({ logs, prompts }) => {
  let resolveFuel;
  const fuel = new Promise(resolve => { resolveFuel = resolve; });
  const vehicles = 'api/v1/automotive/vehicles';
  DaylightAPI.mockImplementation(path => {
    if (path === vehicles) return Promise.resolve({ vehicles: [{ id: 'wagon', label: 'Family wagon' }] });
    if (path === `${vehicles}/wagon`) return Promise.resolve({
      odometer: { km: 320 }, fuel: { needsMoreData: true, fillCount: 0 }, trip_count: 0,
    });
    if (path === `${vehicles}/wagon/fuel`) return fuel;
    if (path === `${vehicles}/wagon/journeys`) return Promise.resolve({ journeys: [{
      id: 'station-trip',
      title: 'Drive to the station',
      has_fuel_stop: true,
      stops: [{ is_fuel_stop: true, place_id: 'station', arrived_at: '2026-10-08T15:00:00Z' }],
    }] });
    return Promise.resolve({});
  });
  render(<AutoApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'Drives', exact: true }));
  expect(await screen.findByText('Drive to the station')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Log the fill-up' })).not.toBeInTheDocument();

  await act(async () => resolveFuel({ logs }));
  expect(screen.queryAllByRole('button', { name: 'Log the fill-up' })).toHaveLength(prompts);
});
