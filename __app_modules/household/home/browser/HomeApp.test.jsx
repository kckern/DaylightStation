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

const entity = (id, over = {}) => ({
  id, domain: id.split('.')[0], name: id, state: 'off', stateClass: 'off', type: 'light',
  room: null, unit: null, deviceClass: null, lastChanged: null, controllable: false, attributes: {}, ...over,
});

const entitiesPayload = {
  entities: [
    entity('light.kitchen', { name: 'Kitchen light', state: 'on', stateClass: 'on', controllable: true, room: { id: 'kitchen', name: 'Kitchen', source: 'provider' } }),
    entity('switch.office_tv_plug', { name: 'Office TV plug', type: 'power', room: { id: 'office', name: 'Office', source: 'inferred' } }),
    entity('sensor.office_temperature', { name: 'Office temperature', type: 'climate', stateClass: 'reading', state: '71.4', unit: '°F', room: { id: 'office', name: 'Office', source: 'provider' } }),
    entity('binary_sensor.hall_motion', { name: 'Hall motion', type: 'presence', stateClass: 'unavailable', state: 'unavailable' }),
  ],
  rooms: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'office', name: 'Office' }],
  types: [{ id: 'light', label: 'Lights' }, { id: 'power', label: 'Power' }, { id: 'climate', label: 'Climate' }, { id: 'presence', label: 'Motion & presence' }],
  stateClasses: [{ id: 'on', label: 'On / active' }, { id: 'off', label: 'Off / idle' }, { id: 'reading', label: 'Readings' }, { id: 'unavailable', label: 'Unavailable' }],
  haUrl: 'https://ha.example',
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

const groupTitles = () => [...document.querySelectorAll('.ds-card__title')].map((el) => el.textContent);

describe('HomeApp — entity dashboard', () => {
  beforeEach(() => {
    apiMock.mockReset();
    resetApiResourceCache();
    window.localStorage.clear();
  });

  it('opens grouped by type, hiding unavailable entities', async () => {
    routeApi();
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByText('Kitchen light')).toBeTruthy());
    expect(groupTitles()).toEqual(['Lights', 'Power', 'Climate']);
    expect(screen.queryByText('Hall motion')).toBeNull();
    expect(screen.getByText('71.4 °F')).toBeTruthy();
  });

  it('groups by room with a "No room" group, and remembers the view', async () => {
    routeApi();
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByText('Kitchen light')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Hide unavailable'));
    fireEvent.click(screen.getByText('By room'));
    expect(groupTitles()).toEqual(['Kitchen', 'Office', 'No room']);
    expect(window.localStorage.getItem('home.view')).toBe('room');
  });

  it('groups by state and always shows the unavailable ones there', async () => {
    routeApi();
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByText('Kitchen light')).toBeTruthy());
    fireEvent.click(screen.getByText('By state'));
    expect(groupTitles()).toEqual(['On / active', 'Off / idle', 'Readings', 'Unavailable']);
    expect(screen.getByText('Hall motion')).toBeTruthy();
  });

  it('filters by search across name and room', async () => {
    routeApi();
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByText('Kitchen light')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Find an entity'), { target: { value: 'office' } });
    expect(screen.queryByText('Kitchen light')).toBeNull();
    expect(screen.getByText('Office TV plug')).toBeTruthy();
  });

  it('switches only controllable entities, through the toggle endpoint', async () => {
    routeApi();
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByText('Kitchen light')).toBeTruthy());
    expect(screen.queryByLabelText(/Office TV plug: turn/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Kitchen light: turn off'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      'api/v1/home-dashboard/toggle', { entityId: 'light.kitchen', desiredState: 'toggle' }, 'POST',
    ));
  });

  it('links each entity to Home Assistant when the config names a URL', async () => {
    routeApi();
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByText('Kitchen light')).toBeTruthy());
    const tile = document.querySelector('[data-entity-id="light.kitchen"]');
    expect(within(tile).getByLabelText('Open Kitchen light in Home Assistant').getAttribute('href'))
      .toBe('https://ha.example/history?entity_id=light.kitchen');
  });

  it('shows ErrorState with a working retry when Home Assistant cannot be read', async () => {
    routeApi({ entities: new Error('Home Assistant returned no entities') });
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByText(/returned no entities/)).toBeTruthy());
    routeApi();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('Kitchen light')).toBeTruthy());
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
