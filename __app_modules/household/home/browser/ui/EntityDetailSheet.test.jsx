import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => apiMock(...a) }));
vi.mock("../history/HistoryChart.jsx", () => ({
  default: ({ history }) => <div data-testid="history-chart" data-kind={history.kind} />,
}));

import { EntityDetailSheet } from './EntityDetailSheet.jsx';
import { DismissStackProvider } from "../../../../../frontend/src/lib/ui/dismiss/DismissStackProvider.jsx";
import { resetApiResourceCache } from "../../../../../frontend/src/lib/hooks/useApiResource.js";

const wrap = (ui) => render(<MantineProvider><DismissStackProvider>{ui}</DismissStackProvider></MantineProvider>);
const entity = (id, over = {}) => ({
  id, domain: id.split('.')[0], name: id, state: 'off', stateClass: 'off', type: 'light',
  room: null, unit: null, deviceClass: null, lastChanged: null, controllable: false, detail: {}, ...over,
});
const temperature = entity('sensor.den_temperature', { name: 'Den temperature', type: 'climate', stateClass: 'reading', state: '70.1', unit: '°F' });
const line = (points) => ({ entityId: 'x', range: '24h', kind: 'line', hasData: points.length > 0, camera: null, points, sinceIso: '2026-10-27T00:00:00.000Z', endIso: '2026-10-28T00:00:00.000Z' });

beforeEach(() => { apiMock.mockReset(); resetApiResourceCache?.(); });

describe('EntityDetailSheet history', () => {
  it('loads 24 h of history, switches to 7 d, and keeps the switch only for a controllable entity', async () => {
    apiMock.mockResolvedValue(line([{ t: 1, v: 70, max: 71 }]));
    wrap(<EntityDetailSheet entity={temperature} haUrl="https://ha.example" onClose={() => {}} />);
    expect(apiMock).toHaveBeenCalledWith('api/v1/home-dashboard/entities/sensor.den_temperature/history?range=24h');
    expect((await screen.findByTestId('history-chart')).dataset.kind).toBe('line');
    fireEvent.click(screen.getByText('7 d'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('api/v1/home-dashboard/entities/sensor.den_temperature/history?range=7d'));
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('says when the range has no history, and shows the HA link last, over the muted id', async () => {
    apiMock.mockResolvedValue(line([]));
    wrap(<EntityDetailSheet entity={temperature} haUrl="https://ha.example" onClose={() => {}} />);
    expect(await screen.findByText('No history in this range')).toBeTruthy();
    expect(screen.queryByTestId('history-chart')).toBeNull();
    const body = document.querySelector('.home-detail');
    expect(body.lastElementChild.previousElementSibling.textContent).toBe('Open in Home Assistant');
    expect(body.lastElementChild.textContent).toBe('sensor.den_temperature');
  });

  it('a series of nulls with no known value (hasData false) is no history', async () => {
    apiMock.mockResolvedValue({ ...line([{ t: 1, v: null, max: null }]), hasData: false });
    wrap(<EntityDetailSheet entity={temperature} onClose={() => {}} />);
    expect(await screen.findByText('No history in this range')).toBeTruthy();
  });

  it('a lamp that was off all day still draws its (flat) history', async () => {
    apiMock.mockResolvedValue({ entityId: 'light.den', range: '24h', kind: 'state', hasData: true, camera: null, intervals: [], sinceIso: '2026-10-27T00:00:00.000Z', endIso: '2026-10-28T00:00:00.000Z' });
    wrap(<EntityDetailSheet entity={entity('light.den')} onClose={() => {}} />);
    expect((await screen.findByTestId('history-chart')).dataset.kind).toBe('state');
    expect(screen.queryByText('No history in this range')).toBeNull();
  });

  it('a doorbell with no rings in range draws its axis, and the rings list says none', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('/history?range=')) return { entityId: 'binary_sensor.porch_visitor', range: '24h', kind: 'events', hasData: true, camera: 'porch-cam', marks: [], sinceIso: '2026-10-27T19:00:00.000Z', endIso: '2026-10-28T19:00:00.000Z' };
      throw new Error(`unexpected ${path}`);
    });
    wrap(<EntityDetailSheet entity={entity('binary_sensor.porch_visitor', { type: 'presence' })} onClose={() => {}} />);
    expect((await screen.findByTestId('history-chart')).dataset.kind).toBe('events');
    expect(screen.getByText('No rings in this range')).toBeTruthy();
    expect(screen.queryByText('No history in this range')).toBeNull();
  });

  it('a failed read offers a retry', async () => {
    apiMock.mockRejectedValueOnce(new Error('boom'));
    wrap(<EntityDetailSheet entity={temperature} onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    apiMock.mockResolvedValue(line([{ t: 1, v: 70, max: 71 }]));
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByTestId('history-chart')).toBeTruthy();
  });

  it('a lamp keeps its switch; extra renders between the history and the link', async () => {
    apiMock.mockResolvedValue({ entityId: 'light.panel_lamp', range: '24h', kind: 'state', hasData: true, camera: null, intervals: [{ from: 1, to: 2 }], sinceIso: '2026-10-27T00:00:00.000Z', endIso: '2026-10-28T00:00:00.000Z' });
    wrap(<EntityDetailSheet entity={entity('light.panel_lamp', { controllable: true })} haUrl="https://ha.example" onClose={() => {}} extra={<p data-testid="extra">lane</p>} />);
    expect(screen.getByRole('switch')).toBeTruthy();
    expect((await screen.findByTestId('history-chart')).dataset.kind).toBe('state');
    const kids = [...document.querySelector('.home-detail').children];
    const iHistory = kids.findIndex((k) => k.classList.contains('home-history'));
    const iExtra = kids.findIndex((k) => k.querySelector('[data-testid="extra"]') || k.dataset.testid === 'extra');
    expect(iHistory).toBeGreaterThan(-1);
    expect(iExtra).toBeGreaterThan(iHistory);
    expect(kids[kids.length - 2].textContent).toBe('Open in Home Assistant');
  });

  it('opens as a side panel', () => {
    apiMock.mockResolvedValue(line([]));
    wrap(<EntityDetailSheet entity={temperature} onClose={() => {}} />);
    expect(document.querySelector('.ds-sheet').classList.contains('ds-sheet--side')).toBe(true);
  });

  it('a doorbell shows the clip of each ring in the range, with no extra passed', async () => {
    const ring = Date.parse('2026-10-28T17:00:00Z');
    apiMock.mockImplementation(async (path) => {
      if (path.includes('/history?range=')) {
        return { entityId: 'binary_sensor.porch_visitor', range: '24h', kind: 'events', hasData: true, camera: 'porch-cam', timeZone: 'Asia/Tokyo', marks: [ring], sinceIso: '2026-10-27T19:00:00.000Z', endIso: '2026-10-28T19:00:00.000Z' };
      }
      if (path.startsWith('api/v1/camera/porch-cam/clips?day=')) {
        return { camera: 'porch-cam', clips: [{ start: '2026-10-28T16:59:50.000Z', end: '2026-10-28T17:00:40.000Z', name: 'Rec/clip_a.mp4', labels: [] }] };
      }
      throw new Error(`unexpected ${path}`);
    });
    wrap(<EntityDetailSheet entity={entity('binary_sensor.porch_visitor', { type: 'presence' })} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelectorAll('video')).toHaveLength(1));
    expect(document.querySelector('video').getAttribute('src')).toContain('/api/v1/camera/porch-cam/clips/file?name=');
    // 17:00 UTC is 02:00 on the 29th in the history's zone: that day is the one asked for.
    expect(apiMock).toHaveBeenCalledWith('api/v1/camera/porch-cam/clips?day=2026-10-29');
  });

  it('an events history with no camera adds nothing', async () => {
    apiMock.mockResolvedValue({ entityId: 'binary_sensor.hall_button', range: '24h', kind: 'events', hasData: true, camera: null, marks: [1], sinceIso: '2026-10-27T19:00:00.000Z', endIso: '2026-10-28T19:00:00.000Z' });
    wrap(<EntityDetailSheet entity={entity('binary_sensor.hall_button')} onClose={() => {}} />);
    expect(await screen.findByTestId('history-chart')).toBeTruthy();
    expect(document.querySelector('.home-detail__extra')).toBeNull();
  });
});

describe('EntityDetailSheet facts', () => {
  const stateHistory = { range: '24h', kind: 'state', hasData: true, camera: null, intervals: [], sinceIso: '2026-10-27T00:00:00.000Z', endIso: '2026-10-28T00:00:00.000Z' };
  beforeEach(() => apiMock.mockResolvedValue(stateHistory));

  it('a controllable lamp carries its switch on the state line, and says its state once', () => {
    wrap(<EntityDetailSheet entity={entity('light.den', { name: 'Den lamp', controllable: true })} onClose={() => {}} />);
    const state = document.querySelector('.home-detail__state');
    expect(state.querySelector('[role="switch"]')).toBeTruthy();
    expect(document.querySelector('.home-detail__control')).toBeNull();
    expect(screen.getAllByText('Off')).toHaveLength(1);
  });

  it('no Kind row; an inferred room is italic without a "guessed" note; the id sits under the link', () => {
    wrap(<EntityDetailSheet entity={entity('light.den', { room: { id: 'den', name: 'Den', source: 'inferred' } })} haUrl="https://ha.example" onClose={() => {}} />);
    const facts = document.querySelector('.home-detail__facts');
    expect([...facts.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Room']);
    const room = facts.querySelector('dd');
    expect(room.textContent).toBe('Den');
    expect(room.classList.contains('home-inferred')).toBe(true);
    expect(screen.queryByText(/guessed from the name/)).toBeNull();
    const body = document.querySelector('.home-detail');
    const last = body.lastElementChild;
    expect(last.classList.contains('home-detail__id')).toBe(true);
    expect(last.textContent).toBe('light.den');
    expect(last.previousElementSibling.textContent).toBe('Open in Home Assistant');
  });

  it('a room set in Home Assistant reads plainly; no room means no Room row', () => {
    const { unmount } = wrap(<EntityDetailSheet entity={entity('light.den', { room: { id: 'den', name: 'Den', source: 'provider' } })} onClose={() => {}} />);
    const room = document.querySelector('.home-detail__facts dd');
    expect(room.textContent).toBe('Den');
    expect(room.classList.contains('home-inferred')).toBe(false);
    unmount();
    wrap(<EntityDetailSheet entity={entity('light.den')} onClose={() => {}} />);
    expect(screen.queryByText('Room')).toBeNull();
    expect(screen.queryByText('Not placed in a room')).toBeNull();
  });
});
