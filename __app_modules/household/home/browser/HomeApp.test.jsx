import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock("../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => apiMock(...a) }));

// The camera surface (snapshot/HLS/detections) has its own tests — HomeApp's
// job is data-state wiring (loading/error/empty/grid), so stub the feed.
vi.mock("../../camera/browser/CameraFeed.jsx", () => ({
  default: ({ cameraId, renderHeader }) => (
    <div data-testid={`camera-${cameraId}`}>
      {renderHeader?.(() => {})}
      mock-feed-{cameraId}
    </div>
  ),
}));

import HomeApp from "./HomeApp.jsx";
import { resetApiResourceCache } from "../../../../frontend/src/lib/hooks/useApiResource.js";

const plain = (s) => s.replace(/ /g, ' ');
const kitchen = { id: 'kitchen', name: 'Kitchen', source: 'provider' };
const office = { id: 'office', name: 'Office', source: 'inferred' };
const entity = (id, over = {}) => ({
  id, domain: id.split('.')[0], name: id, state: 'off', stateClass: 'off', type: 'light',
  room: null, unit: null, deviceClass: null, lastChanged: null, controllable: false, detail: {}, ...over,
});

const entitiesPayload = {
  entities: [
    entity('light.kitchen', { name: 'Kitchen light', state: 'on', stateClass: 'on', controllable: true, room: kitchen, detail: { brightnessPct: 40 } }),
    entity('light.kitchen_table', { name: 'Table lamp', state: 'on', stateClass: 'on', controllable: true, room: kitchen }),
    entity('light.office_desk', { name: 'Desk lamp', controllable: true, room: office }),
    entity('switch.den_tv_plug', { name: 'Den TV plug', type: 'power', state: 'on', stateClass: 'on', room: office }),
    entity('sensor.office_temperature', { name: 'Office temperature', type: 'climate', stateClass: 'reading', state: '71.4', unit: '°F', deviceClass: 'temperature', room: office }),
    entity('sensor.panel_power', { name: 'Panel Power', type: 'power', stateClass: 'reading', state: '505', unit: 'W', deviceClass: 'power' }),
    entity('sensor.office_power', { name: 'Office Power', type: 'power', stateClass: 'reading', state: '302', unit: 'W', deviceClass: 'power', room: office }),
    entity('binary_sensor.office_door', { name: 'Open', type: 'openings', state: 'on', stateClass: 'on', deviceClass: 'door', room: office, lastChanged: '2026-10-27T20:29:00' }),
    entity('sensor.remote_battery', { name: 'Remote battery', type: 'battery', stateClass: 'reading', state: '9', unit: '%', room: office }),
    entity('binary_sensor.hall_motion', { name: 'Hall motion', type: 'presence', stateClass: 'unavailable', state: 'unavailable' }),
  ],
  rooms: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'office', name: 'Office' }],
  types: [{ id: 'light', label: 'Lights' }, { id: 'power', label: 'Power' }, { id: 'climate', label: 'Climate' }, { id: 'presence', label: 'Motion & presence' }, { id: 'openings', label: 'Doors & windows' }, { id: 'battery', label: 'Batteries' }],
  stateClasses: [{ id: 'on', label: 'On / active' }, { id: 'off', label: 'Off / idle' }, { id: 'reading', label: 'Readings' }, { id: 'unavailable', label: 'Unavailable' }],
  haUrl: 'https://ha.example',
  summary: {
    power: {
      wholeHouse: { entityId: 'sensor.panel_power', watts: 505 },
      energyToday: null, energyThisMonth: null,
      topConsumers: [{ entityId: 'sensor.office_power', watts: 302 }],
    },
    on: ['light.kitchen', 'light.kitchen_table', 'switch.den_tv_plug'],
    open: ['binary_sensor.office_door'],
    motion: [],
    lowBattery: [{ entityId: 'sensor.remote_battery', pct: 9 }],
    unavailable: ['binary_sensor.hall_motion'],
    thresholds: { lowBatteryPct: 20, motionWindowMinutes: 15 },
  },
};

const mosaicPayload = {
  byRoom: [
    { id: 'kitchen', label: 'Kitchen', entityIds: ['light.kitchen', 'light.kitchen_table'] },
    { id: 'office', label: 'Office', entityIds: ['light.office_desk', 'switch.den_tv_plug', 'sensor.office_temperature', 'sensor.office_power', 'binary_sensor.office_door', 'sensor.remote_battery', 'binary_sensor.hall_motion'] },
  ],
  byType: [
    { id: 'light', label: 'Lights', entityIds: ['light.kitchen', 'light.kitchen_table', 'light.office_desk'] },
    { id: 'power', label: 'Power', entityIds: ['switch.den_tv_plug', 'sensor.panel_power', 'sensor.office_power'] },
  ],
};
entitiesPayload.mosaic = mosaicPayload;

const DAY = '2026-10-28';
// Two lanes, one day: the shape GET home-dashboard/timeline answers with.
const timelinePayload = (range) => ({
  range, timeZone: 'America/Los_Angeles', generatedAt: `${DAY}T19:00:00.000Z`,
  days: [{ day: DAY, startIso: `${DAY}T07:00:00.000Z`, endIso: `${DAY}T19:00:00.000Z` }],
  lanes: [
    { id: 'power', kind: 'power', label: 'Power', camera: null, entityIds: { primary: 'sensor.panel_power', energy: null },
      days: [{ day: DAY, hasData: true, points: [{ t: Date.parse(`${DAY}T08:00:00Z`), v: 400, max: 500 }, { t: Date.parse(`${DAY}T09:00:00Z`), v: 900, max: 1200 }], total: { kwh: 16.34 } }],
      total: { kwh: 16.34 } },
    { id: 'doorbell', kind: 'events', label: 'Doorbell', camera: 'porch-cam', entityIds: { primary: 'binary_sensor.porch_visitor', energy: null },
      days: [{ day: DAY, hasData: true, marks: [Date.parse(`${DAY}T17:00:00Z`)], total: { count: 1 } }],
      total: { count: 1 } },
  ],
});

function routeApi({ entities = entitiesPayload, cameras = { cameras: [] } } = {}) {
  apiMock.mockImplementation(async (path) => {
    if (path.includes('home-dashboard/entities')) {
      if (entities instanceof Error) throw entities;
      return entities;
    }
    if (path.includes('home-dashboard/timeline')) return timelinePayload(path.split('range=')[1]);
    if (path.includes('/history')) return { kind: 'line', points: [] };
    if (path.includes('home-dashboard/toggle')) return { ok: true };
    if (/camera\/[^/]+\/clips/.test(path)) return { camera: 'porch-cam', day: DAY, clips: [] };
    if (path.includes('camera')) return cameras;
    throw new Error(`unexpected ${path}`);
  });
}

const openView = (name) => fireEvent.click(screen.getByRole('link', { name }));
const STATUS = 'The house is drawing 505 W, with 2 lights on and a door open in the office.';
const statusLines = () => [...document.querySelectorAll('.home-today__now')].map((el) => plain(el.textContent));
const laneLabels = () => [...document.querySelectorAll('.home-lane__label')].map((el) => el.textContent);
const tabLabels = () => [...document.querySelectorAll('.ds-chrome__tab-label')].map((el) => el.textContent);
const lanesShown = () => waitFor(() => expect(laneLabels()).toEqual(['Power', 'Doorbell']));

describe('HomeApp — Today', () => {
  beforeEach(() => {
    apiMock.mockReset();
    resetApiResourceCache();
    window.localStorage.clear();
  });

  it('opens on Today: the house in one sentence, then the lanes', async () => {
    routeApi();
    render(<HomeApp />);
    await lanesShown();
    expect(statusLines()).toEqual([STATUS]);
    expect(apiMock).toHaveBeenCalledWith('api/v1/home-dashboard/timeline?range=today');
  });

  it('offers exactly Today, Mosaic, Rooms and Cameras', async () => {
    routeApi();
    render(<HomeApp />);
    await lanesShown();
    expect(tabLabels()).toEqual(['Today', 'Mosaic', 'Rooms', 'Cameras']);
  });

  it.each([
    ['now', 'Today'], ['power', 'Today'], ['browse', 'Mosaic'], ['type', 'Mosaic'], ['state', 'Mosaic'], ['room', 'Rooms'],
  ])('a saved home.view of "%s" opens %s', async (saved, opens) => {
    window.localStorage.setItem('home.view', saved);
    routeApi();
    render(<HomeApp />);
    if (opens === 'Today') await lanesShown();
    if (opens === 'Mosaic') await waitFor(() => expect(document.querySelectorAll('.home-square').length).toBeGreaterThan(0));
    if (opens === 'Rooms') await waitFor(() => expect(document.querySelectorAll('.home-room__row').length).toBeGreaterThan(0));
    expect(screen.getByRole('link', { name: opens }).getAttribute('aria-current')).toBe('page');
  });

  it('shows ErrorState with a working retry when Home Assistant cannot be read', async () => {
    routeApi({ entities: new Error('Home Assistant returned no entities') });
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByText(/returned no entities/)).toBeTruthy());
    expect(document.querySelector('.home-today')).toBeNull();
    routeApi();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await lanesShown();
    expect(statusLines()).toEqual([STATUS]);
  });
});

describe('HomeApp — Mosaic', () => {
  beforeEach(() => {
    apiMock.mockReset();
    resetApiResourceCache();
    window.localStorage.clear();
    routeApi();
  });

  it('draws every grouped entity as a square and opens its drawer; Escape closes it', async () => {
    render(<HomeApp />);
    await lanesShown();
    openView('Mosaic');
    expect(window.localStorage.getItem('home.view')).toBe('mosaic');
    expect(document.querySelectorAll('.home-square')).toHaveLength(9);
    fireEvent.click(screen.getByRole('button', { name: /^Den TV plug:/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Den TV plug' });
    expect(within(sheet).getByText('switch.den_tv_plug')).toBeTruthy();
    expect(within(sheet).getByText('Open in Home Assistant').getAttribute('href'))
      .toBe('https://ha.example/history?entity_id=switch.den_tv_plug');
    // A plug is not controllable: no switch in its drawer.
    expect(within(sheet).queryByRole('switch')).toBeNull();
    // The app owns the one dismiss stack, so Escape anywhere closes it.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('HomeApp — Rooms', () => {
  beforeEach(() => {
    apiMock.mockReset();
    resetApiResourceCache();
    window.localStorage.clear();
    routeApi();
  });

  it('lists one row per room and opens a room in place, readings behind a disclosure', async () => {
    render(<HomeApp />);
    await lanesShown();
    openView('Rooms');
    expect(window.localStorage.getItem('home.view')).toBe('rooms');
    const rows = [...document.querySelectorAll('.home-room__row')].map((r) => r.querySelector('.home-room__name').textContent);
    expect(rows).toEqual(['Kitchen', 'Office', 'Elsewhere']);
    const officeRow = document.querySelector('[data-room-id="office"] .home-room__row');
    expect(officeRow.textContent).toContain('71°');
    // A dark room says nothing in the lights column; only a lit one gets a figure.
    expect(officeRow.querySelector('.home-room__lights').textContent).toBe('');
    expect(document.querySelector('[data-room-id="kitchen"] .home-room__lights').textContent).toContain('2 on');
    fireEvent.click(officeRow);
    expect(screen.getByLabelText('Desk lamp: turn on')).toBeTruthy();
    expect(screen.getByText('Den TV plug')).toBeTruthy();
    expect(screen.queryByText('Remote battery')).toBeNull();
    fireEvent.click(screen.getByText('Show all 3 readings and switches'));
    expect(screen.getByText('Remote battery')).toBeTruthy();
  });

  it('turns off a room\'s lamps with one tap, each as an explicit off', async () => {
    render(<HomeApp />);
    await lanesShown();
    openView('Rooms');
    fireEvent.click(document.querySelector('[data-room-id="kitchen"] .home-room__row'));
    const off = screen.getByLabelText('Turn off all 2 lights in Kitchen');
    expect(off.textContent).toBe('Turn off both');
    fireEvent.click(off);
    await waitFor(() => expect(apiMock.mock.calls.filter(([p]) => p.includes('toggle'))).toHaveLength(2));
    expect(apiMock).toHaveBeenCalledWith('api/v1/home-dashboard/toggle', { entityId: 'light.kitchen', desiredState: 'off' }, 'POST');
    expect(apiMock).toHaveBeenCalledWith('api/v1/home-dashboard/toggle', { entityId: 'light.kitchen_table', desiredState: 'off' }, 'POST');
  });

  it('holds the new switch position while the platform has not caught up, and blocks a second tap', async () => {
    let entitiesCalls = 0;
    routeApi();
    const routed = apiMock.getMockImplementation();
    apiMock.mockImplementation(async (path, ...rest) => {
      if (path.includes('home-dashboard/entities')) { entitiesCalls += 1; return entitiesPayload; } // still reports "on"
      return routed(path, ...rest);
    });
    render(<HomeApp />);
    await lanesShown();
    openView('Rooms');
    fireEvent.click(document.querySelector('[data-room-id="kitchen"] .home-room__row'));
    fireEvent.click(screen.getByLabelText('Kitchen light: turn off'));
    // The reload after the toggle still says "on"; the switch keeps showing off.
    await waitFor(() => expect(entitiesCalls).toBeGreaterThan(1));
    const sw = screen.getByLabelText('Kitchen light: turn on');
    expect(sw.checked).toBe(false);
    expect(sw.disabled).toBe(true);
    fireEvent.click(sw);
    expect(apiMock.mock.calls.filter(([p]) => p.includes('toggle'))).toHaveLength(1);
  });
});

describe('HomeApp — cameras view', () => {
  beforeEach(() => {
    apiMock.mockReset();
    resetApiResourceCache();
    window.localStorage.setItem('home.view', 'cameras');
  });

  it('shows EmptyState when no cameras are configured', async () => {
    routeApi({ cameras: { cameras: [] } });
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByText('No cameras configured')).toBeTruthy());
  });

  it('renders the camera grid with doorbell first, then alphabetical', async () => {
    routeApi({ cameras: { cameras: [{ id: 'backyard' }, { id: 'doorbell' }, { id: 'garage' }] } });
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByTestId('camera-doorbell')).toBeTruthy());
    const cards = screen.getAllByText(/^doorbell$|^backyard$|^garage$/);
    expect(cards.map((el) => el.textContent)).toEqual(['doorbell', 'backyard', 'garage']);
  });
});
