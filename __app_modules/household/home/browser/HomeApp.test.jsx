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
    entity('switch.office_tv_plug', { name: 'Office TV plug', type: 'power', state: 'on', stateClass: 'on', room: office }),
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
    on: ['light.kitchen', 'light.kitchen_table', 'switch.office_tv_plug'],
    open: ['binary_sensor.office_door'],
    motion: [],
    lowBattery: [{ entityId: 'sensor.remote_battery', pct: 9 }],
    unavailable: ['binary_sensor.hall_motion'],
    thresholds: { lowBatteryPct: 20, motionWindowMinutes: 15 },
  },
};

function routeApi({ entities = entitiesPayload, cameras = { cameras: [] } } = {}) {
  apiMock.mockImplementation(async (path) => {
    if (path.includes('home-dashboard/entities')) {
      if (entities instanceof Error) throw entities;
      return entities;
    }
    if (path.includes('home-dashboard/toggle')) return { ok: true };
    if (path.includes('camera')) return cameras;
    throw new Error(`unexpected ${path}`);
  });
}

const openView = (name) => fireEvent.click(screen.getByRole('link', { name }));
const sentence = () => plain(document.querySelector('.home-status').textContent);
const sectionTitles = () => [...document.querySelectorAll('.home-section__title')].map((el) => el.textContent);

describe('HomeApp — Now', () => {
  beforeEach(() => {
    apiMock.mockReset();
    resetApiResourceCache();
    window.localStorage.clear();
  });

  it('opens on Now with the house in a sentence and only the non-empty sections', async () => {
    routeApi();
    render(<HomeApp />);
    await waitFor(() => expect(document.querySelector('.home-status')).toBeTruthy());
    expect(sentence()).toBe('The house is drawing 505 W, with 2 lights on and a door open in the office.');
    expect(sectionTitles()).toEqual(['On', 'Open', 'Needs attention', 'Climate']);
    // Lit lamps by room, with a plain "Off" each and one for the whole room.
    const kitchenGroup = screen.getByText('Kitchen').closest('.home-section__group');
    expect(within(kitchenGroup).getByLabelText('Kitchen light: turn off')).toBeTruthy();
    expect(within(kitchenGroup).getByLabelText('Turn off all 2 lights in Kitchen')).toBeTruthy();
    // The plug is on but not controllable: counted, listed on demand, no switch.
    expect(screen.getByText('Also on: 1 plug')).toBeTruthy();
    expect(screen.queryByText('Office TV plug')).toBeNull();
    fireEvent.click(screen.getByText('Also on: 1 plug'));
    expect(screen.getByText('Office TV plug')).toBeTruthy();
    expect(screen.queryByLabelText(/Office TV plug: turn/)).toBeNull();
    // A sensor named after its state is named after its room.
    expect(screen.getByText('Office door')).toBeTruthy();
    expect(screen.getByText('1 battery low')).toBeTruthy();
    expect(screen.getByText('1 device not answering')).toBeTruthy();
    expect(screen.queryByText('Hall motion')).toBeNull();
  });

  it('turns off a room\'s lamps with one tap, each as an explicit off', async () => {
    routeApi();
    render(<HomeApp />);
    await waitFor(() => expect(document.querySelector('.home-status')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Turn off all 2 lights in Kitchen'));
    await waitFor(() => expect(apiMock.mock.calls.filter(([p]) => p.includes('toggle'))).toHaveLength(2));
    expect(apiMock).toHaveBeenCalledWith('api/v1/home-dashboard/toggle', { entityId: 'light.kitchen', desiredState: 'off' }, 'POST');
    expect(apiMock).toHaveBeenCalledWith('api/v1/home-dashboard/toggle', { entityId: 'light.kitchen_table', desiredState: 'off' }, 'POST');
  });

  it('says so when the server sends no summary, and still shows the climate', async () => {
    const { summary, ...withoutSummary } = entitiesPayload;
    routeApi({ entities: withoutSummary });
    render(<HomeApp />);
    await waitFor(() => expect(document.querySelector('.home-status')).toBeTruthy());
    expect(sentence()).toBe('All quiet. Nothing is on.');
    expect(screen.getByText(/does not report a house summary/)).toBeTruthy();
    expect(sectionTitles()).toEqual(['Climate']);
  });

  it('shows ErrorState with a working retry when Home Assistant cannot be read', async () => {
    routeApi({ entities: new Error('Home Assistant returned no entities') });
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByText(/returned no entities/)).toBeTruthy());
    routeApi();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(document.querySelector('.home-status')).toBeTruthy());
  });
});

describe('HomeApp — Rooms, Power, Browse', () => {
  beforeEach(() => {
    apiMock.mockReset();
    resetApiResourceCache();
    window.localStorage.clear();
    routeApi();
  });

  it('lists one row per room and opens a room in place, readings behind a disclosure', async () => {
    render(<HomeApp />);
    await waitFor(() => expect(document.querySelector('.home-status')).toBeTruthy());
    openView('Rooms');
    expect(window.localStorage.getItem('home.view')).toBe('rooms');
    const rows = [...document.querySelectorAll('.home-room__row')].map((r) => r.querySelector('.home-room__name').textContent);
    expect(rows).toEqual(['Kitchen', 'Office', 'Elsewhere']);
    const officeRow = document.querySelector('[data-room-id="office"] .home-room__row');
    expect(officeRow.textContent).toContain('71°');
    expect(officeRow.textContent).toContain('dark');
    fireEvent.click(officeRow);
    expect(screen.getByLabelText('Desk lamp: turn on')).toBeTruthy();
    expect(screen.getByText('Office TV plug')).toBeTruthy();
    expect(screen.queryByText('Remote battery')).toBeNull();
    fireEvent.click(screen.getByText('Show all 3 readings and switches'));
    expect(screen.getByText('Remote battery')).toBeTruthy();
  });

  it('summarises power: the whole-house figure, then the top circuits with a bar', async () => {
    render(<HomeApp />);
    await waitFor(() => expect(document.querySelector('.home-status')).toBeTruthy());
    openView('Power');
    expect(sentence()).toBe('Drawing 505 W right now.');
    expect(screen.getByText('Measured by Panel Power')).toBeTruthy();
    expect(screen.getByLabelText('Office, 302 W')).toBeTruthy();
    expect(document.querySelector('.home-power__fill').style.width).toBe('100%');
  });

  it('browses as a list grouped by type, room or state, remembering the grouping', async () => {
    render(<HomeApp />);
    await waitFor(() => expect(document.querySelector('.home-status')).toBeTruthy());
    openView('Browse');
    const headings = () => [...document.querySelectorAll('.home-browse__heading > span:first-child')].map((el) => el.textContent);
    expect(headings()).toEqual(['Lights', 'Power', 'Climate', 'Doors & windows', 'Batteries']);
    expect(screen.queryByText('Hall motion')).toBeNull();
    fireEvent.click(screen.getByText('Show 1 not answering'));
    expect(screen.getByText('Hall motion')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Room' }));
    expect(headings()).toEqual(['Kitchen', 'Office', 'No room']);
    expect(window.localStorage.getItem('home.browse.mode')).toBe('room');
    fireEvent.click(screen.getByRole('radio', { name: 'State' }));
    expect(headings()).toEqual(['On / active', 'Off / idle', 'Readings', 'Unavailable']);
  });

  it('filters the list by search across name and room', async () => {
    render(<HomeApp />);
    await waitFor(() => expect(document.querySelector('.home-status')).toBeTruthy());
    openView('Browse');
    fireEvent.change(screen.getByLabelText('Find an entity'), { target: { value: 'office' } });
    expect(screen.queryByText('Kitchen light')).toBeNull();
    expect(screen.getByText('Office TV plug')).toBeTruthy();
  });

  it('switches lights inline in Browse, through the toggle endpoint, and nothing else', async () => {
    render(<HomeApp />);
    await waitFor(() => expect(document.querySelector('.home-status')).toBeTruthy());
    openView('Browse');
    expect(screen.queryByLabelText(/Office TV plug: turn/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Kitchen light: turn off'));
    // An explicit target, so a change made by someone else is never inverted.
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      'api/v1/home-dashboard/toggle', { entityId: 'light.kitchen', desiredState: 'off' }, 'POST',
    ));
  });

  it('holds the new switch position while the platform has not caught up, and blocks a second tap', async () => {
    let entitiesCalls = 0;
    apiMock.mockImplementation(async (path) => {
      if (path.includes('home-dashboard/entities')) { entitiesCalls += 1; return entitiesPayload; } // still reports "on"
      if (path.includes('home-dashboard/toggle')) return { ok: true };
      return { cameras: [] };
    });
    render(<HomeApp />);
    await waitFor(() => expect(document.querySelector('.home-status')).toBeTruthy());
    openView('Browse');
    fireEvent.click(screen.getByLabelText('Kitchen light: turn off'));
    // The reload after the toggle still says "on"; the switch keeps showing off.
    await waitFor(() => expect(entitiesCalls).toBeGreaterThan(1));
    const sw = screen.getByLabelText('Kitchen light: turn on');
    expect(sw.checked).toBe(false);
    expect(sw.disabled).toBe(true);
    fireEvent.click(sw);
    expect(apiMock.mock.calls.filter(([p]) => p.includes('toggle'))).toHaveLength(1);
  });

  it('opens a detail sheet from a row, with the Home Assistant link only there', async () => {
    render(<HomeApp />);
    await waitFor(() => expect(document.querySelector('.home-status')).toBeTruthy());
    openView('Browse');
    expect(document.querySelector('a[href*="ha.example"]')).toBeNull();
    fireEvent.click(screen.getByLabelText('Office TV plug, On'));
    const sheet = screen.getByRole('dialog', { name: 'Office TV plug' });
    expect(within(sheet).getByText('Office (guessed from the name)')).toBeTruthy();
    expect(within(sheet).getByText('switch.office_tv_plug')).toBeTruthy();
    expect(within(sheet).getByText('Open in Home Assistant').getAttribute('href'))
      .toBe('https://ha.example/history?entity_id=switch.office_tv_plug');
    expect(within(sheet).queryByRole('switch')).toBeNull();
    fireEvent.click(within(sheet).getByLabelText('Close'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the view an old saved tab id pointed at', async () => {
    window.localStorage.setItem('home.view', 'type');
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByLabelText('Find an entity')).toBeTruthy());
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
