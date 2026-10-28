import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => apiMock(...a) }));
vi.mock("../history/HistoryChart.jsx", () => ({
  default: ({ history }) => <div data-testid="history-chart" data-kind={history.kind} />,
}));

import { TodayView } from './TodayView.jsx';
import { DismissStackProvider } from "../../../../../frontend/src/lib/ui/dismiss/DismissStackProvider.jsx";
import { resetApiResourceCache } from "../../../../../frontend/src/lib/hooks/useApiResource.js";

const plain = (s) => s.replace(/ /g, ' ');
const wrap = (ui) => render(<MantineProvider><DismissStackProvider>{ui}</DismissStackProvider></MantineProvider>);
const entity = (id, over = {}) => ({
  id, domain: id.split('.')[0], name: id, state: 'off', stateClass: 'off', type: 'light',
  room: null, unit: null, deviceClass: null, lastChanged: null, controllable: false, detail: {}, ...over,
});
const entities = [
  entity('sensor.panel_power', { name: 'Panel power', type: 'power', stateClass: 'reading', state: '505', unit: 'W', deviceClass: 'power' }),
  entity('binary_sensor.porch_visitor', { name: 'Porch visitor', type: 'presence', deviceClass: 'occupancy' }),
];
const summary = {
  power: { wholeHouse: { entityId: 'sensor.panel_power', watts: 505 }, energyToday: { kwh: 16.34 }, energyThisMonth: null, topConsumers: [] },
  on: [], open: [], motion: [], lowBattery: [], unavailable: [],
};

const DAY = '2026-10-28';
const ring1 = Date.parse('2026-10-28T17:00:00Z');
const ring2 = Date.parse('2026-10-28T18:30:00Z');
const weekDays = ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', DAY];
const dayInfo = (day) => ({ day, startIso: `${day}T07:00:00.000Z`, endIso: day === DAY ? '2026-10-28T19:00:00.000Z' : `${day.slice(0, 8)}${String(Number(day.slice(8)) + 1).padStart(2, '0')}T07:00:00.000Z` });
const lanesFor = (days) => [
  { id: 'power', kind: 'power', label: 'Power', camera: null, entityIds: { primary: 'sensor.panel_power', energy: null },
    days: days.map((day) => ({ day, hasData: true, points: [{ t: Date.parse(`${day}T08:00:00Z`), v: 400, max: 500 }, { t: Date.parse(`${day}T09:00:00Z`), v: 900, max: 1200 }], total: { kwh: 16.34 } })),
    total: { kwh: 16.34 } },
  { id: 'doorbell', kind: 'events', label: 'Doorbell', camera: 'porch-cam', entityIds: { primary: 'binary_sensor.porch_visitor', energy: null },
    days: days.map((day) => ({ day, hasData: true, marks: day === DAY ? [ring1, ring2] : [], total: { count: day === DAY ? 2 : 0 } })),
    total: { count: 2 } },
  { id: 'garage', kind: 'occupancy', label: 'Garage', camera: null, entityIds: { primary: 'binary_sensor.garage_occupancy', energy: null },
    days: days.map((day) => ({ day, hasData: false, intervals: [], total: { hours: null } })),
    total: { hours: null } },
];
const timeline = (range) => {
  const days = range === 'week' ? weekDays : [DAY];
  return { range, timeZone: 'America/Los_Angeles', generatedAt: '2026-10-28T19:00:00.000Z', days: days.map(dayInfo), lanes: lanesFor(days) };
};
const clips = { camera: 'porch-cam', day: DAY, clips: [{ start: '2026-10-28T16:59:40.000Z', end: '2026-10-28T17:00:30.000Z', name: 'Rec/2026-10-28/clip_a.mp4', labels: ['visitor'] }] };

function route(over = {}) {
  apiMock.mockImplementation(async (path) => {
    if (path.startsWith('api/v1/home-dashboard/timeline?range=')) return over.timeline?.(path) ?? timeline(path.split('=')[1]);
    if (path.startsWith('api/v1/camera/porch-cam/clips?day=')) return { ...clips, day: path.split('=')[1], clips: path.endsWith(DAY) ? clips.clips : [] };
    if (path.includes('/history?range=')) return { entityId: 'x', range: '24h', kind: 'events', hasData: true, camera: 'porch-cam', marks: [], sinceIso: '2026-10-27T19:00:00.000Z', endIso: '2026-10-28T19:00:00.000Z' };
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  apiMock.mockReset();
  resetApiResourceCache?.();
  try { window.localStorage.clear(); } catch { /* none */ }
});

const view = () => wrap(<TodayView entities={entities} rooms={[]} summary={summary} haUrl="https://ha.example" toggle={() => {}} />);

describe('TodayView', () => {
  it('says the house once, then one lane per config entry with its total', async () => {
    route();
    view();
    await screen.findByText('Power');
    expect(apiMock).toHaveBeenCalledWith('api/v1/home-dashboard/timeline?range=today');
    const sentence = 'The house is quiet, drawing 505 W with nothing on.';
    expect(screen.getAllByText((t) => plain(t) === sentence)).toHaveLength(1);
    const lanes = [...document.querySelectorAll('.home-lane')];
    expect(lanes.map((l) => l.querySelector('.home-lane__label').textContent)).toEqual(['Power', 'Doorbell', 'Garage']);
    expect(lanes.map((l) => l.querySelector('.home-lane__total').textContent)).toEqual(['16.3 kWh', '2 rings', '']);
    expect(within(lanes[2]).getByText('No history')).toBeTruthy();
    expect(lanes[0].querySelector('path')).toBeTruthy();
    expect(lanes[1].querySelectorAll('.home-lane__mark')).toHaveLength(2);
  });

  it('Week asks for a week and draws seven rows per lane', async () => {
    route();
    view();
    await screen.findByText('Power');
    fireEvent.click(screen.getByText('Week'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('api/v1/home-dashboard/timeline?range=week'));
    await waitFor(() => expect(document.querySelectorAll('.home-lane')[0].querySelectorAll('.home-lane__week-row')).toHaveLength(7));
    const [power, doorbell, garage] = document.querySelectorAll('.home-lane');
    expect(power.querySelectorAll('.home-lane__week-row')).toHaveLength(7);
    expect(doorbell.querySelectorAll('.home-lane__week-row')).toHaveLength(7);
    expect([...doorbell.querySelectorAll('.home-lane__weekday')].map((d) => d.textContent).join('')).toBe('TFSSMTW');
    // A lane with no history on any day says so once, not seven empty rows.
    expect(within(garage).getByText('No history')).toBeTruthy();
    expect(window.localStorage.getItem('home.today.range')).toBe('week');
  });

  it('the doorbell lane opens a drawer with a clip for the ring that has one', async () => {
    route();
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Doorbell: 2 rings, open details' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(`api/v1/camera/porch-cam/clips?day=${DAY}`));
    expect(await screen.findByText('No recording near this ring')).toBeTruthy();
    const videos = document.querySelectorAll('video');
    expect(videos).toHaveLength(1);
    expect(videos[0].getAttribute('src')).toContain('clips/file?name=');
    expect(videos[0].getAttribute('src')).toContain(encodeURIComponent('Rec/2026-10-28/clip_a.mp4'));
    expect(videos[0].getAttribute('src')).toContain('/api/v1/camera/porch-cam/');
  });

  it('a house with no lanes says how to add one', async () => {
    route({ timeline: (path) => ({ ...timeline('today'), lanes: [] }) });
    view();
    expect(await screen.findByText('No timeline lanes')).toBeTruthy();
    expect(screen.getByText('Add lanes under timeline.lanes in household/home/dashboard.yml')).toBeTruthy();
  });

  it('a failed first load offers a retry', async () => {
    apiMock.mockRejectedValueOnce(new Error('boom'));
    view();
    expect(await screen.findByRole('alert')).toBeTruthy();
    route();
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByText('Power')).toBeTruthy();
  });
});
