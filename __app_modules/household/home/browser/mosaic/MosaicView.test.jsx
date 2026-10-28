import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { MosaicView } from './MosaicView.jsx';
import { resetApiResourceCache } from '../../../../../frontend/src/lib/hooks/useApiResource.js';

const plain = (s) => s.replace(/[  ]/g, ' ');
const kitchen = { id: 'kitchen', name: 'Kitchen', source: 'provider' };
const office = { id: 'office', name: 'Office', source: 'inferred' };
const entity = (id, over = {}) => ({
  id, domain: id.split('.')[0], name: id, state: 'off', stateClass: 'off', type: 'light',
  room: null, unit: null, deviceClass: null, lastChanged: null, controllable: false, detail: {}, ...over,
});

// The HomeApp fixture; the kitchen light carries a change time (and no
// brightness) so its tooltip reads "On · changed …".
const entities = [
  entity('light.kitchen', { name: 'Kitchen light', state: 'on', stateClass: 'on', controllable: true, room: kitchen, lastChanged: '2026-10-27T20:29:00' }),
  entity('light.kitchen_table', { name: 'Table lamp', state: 'on', stateClass: 'on', controllable: true, room: kitchen }),
  entity('light.office_desk', { name: 'Desk lamp', controllable: true, room: office }),
  entity('switch.office_tv_plug', { name: 'Office TV plug', type: 'power', state: 'on', stateClass: 'on', room: office }),
  entity('sensor.office_temperature', { name: 'Office temperature', type: 'climate', stateClass: 'reading', state: '71.4', unit: '°F', deviceClass: 'temperature', room: office }),
  entity('sensor.panel_power', { name: 'Panel Power', type: 'power', stateClass: 'reading', state: '505', unit: 'W', deviceClass: 'power' }),
  entity('sensor.office_power', { name: 'Office Power', type: 'power', stateClass: 'reading', state: '302', unit: 'W', deviceClass: 'power', room: office }),
  entity('binary_sensor.office_door', { name: 'Open', type: 'openings', state: 'on', stateClass: 'on', deviceClass: 'door', room: office, lastChanged: '2026-10-27T20:29:00' }),
  entity('sensor.remote_battery', { name: 'Remote battery', type: 'battery', stateClass: 'reading', state: '9', unit: '%', room: office }),
  entity('binary_sensor.hall_motion', { name: 'Hall motion', type: 'presence', stateClass: 'unavailable', state: 'unavailable' }),
];
const types = [{ id: 'light', label: 'Lights' }, { id: 'power', label: 'Power' }, { id: 'climate', label: 'Climate' }, { id: 'presence', label: 'Motion & presence' }, { id: 'openings', label: 'Doors & windows' }, { id: 'battery', label: 'Batteries' }];
const summary = {
  on: ['light.kitchen', 'light.kitchen_table', 'switch.office_tv_plug'],
  open: ['binary_sensor.office_door'],
  motion: [],
  stuck: [],
  lowBattery: [{ entityId: 'sensor.remote_battery', pct: 9 }],
  unavailable: ['binary_sensor.hall_motion'],
};
const mosaic = {
  byRoom: [
    { id: 'kitchen', label: 'Kitchen', entityIds: ['light.kitchen', 'light.kitchen_table'] },
    { id: 'office', label: 'Office', entityIds: ['light.office_desk', 'switch.office_tv_plug', 'sensor.office_temperature', 'sensor.office_power', 'binary_sensor.office_door', 'sensor.remote_battery', 'binary_sensor.hall_motion'] },
  ],
  byType: [
    { id: 'light', label: 'Lights', entityIds: ['light.kitchen', 'light.kitchen_table', 'light.office_desk'] },
    { id: 'power', label: 'Power', entityIds: ['switch.office_tv_plug', 'sensor.panel_power', 'sensor.office_power'] },
  ],
};

const renderMosaic = (props = {}) => render(
  <MantineProvider>
    <MosaicView entities={entities} mosaic={mosaic} summary={summary} types={types} haUrl="https://ha.example" toggle={vi.fn()} {...props} />
  </MantineProvider>,
);
const squares = () => [...document.querySelectorAll('.home-square')];
const square = (label) => screen.getByRole('button', { name: new RegExp(`^${label}:`) });

describe('MosaicView', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({ entityId: 'light.kitchen', range: '24h', kind: 'state', hasData: false, intervals: [], points: [], marks: [] });
    resetApiResourceCache();
    window.localStorage.clear();
  });

  it('draws one square per grouped entity, with no words on the grid but the group headers', () => {
    renderMosaic();
    expect(squares()).toHaveLength(9);
    const grid = document.querySelector('.home-mosaic__groups');
    const heads = [...grid.querySelectorAll('.home-mosaic__head')].map((h) => plain(h.textContent));
    expect(heads).toEqual(['Kitchen2 on', 'Office2 on']);
    // Strip the headers: what is left on the grid says nothing in words.
    const clone = grid.cloneNode(true);
    clone.querySelectorAll('.home-mosaic__head').forEach((h) => h.remove());
    expect(clone.textContent.trim()).toBe('');
    // Every square names itself for a screen reader.
    expect(square('Kitchen light').getAttribute('aria-label')).toBe('Kitchen light: On');
    expect(square('Office door').getAttribute('aria-label')).toBe('Office door: Open');
    expect(square('Kitchen light').className).toContain('home-square--on');
    expect(square('Office door').className).toContain('home-square--open');
    expect(square('Office temperature').className).toContain('home-square--temp');
    expect(square('Office temperature').style.getPropertyValue('--tone-pct')).toBe('55');
  });

  it('hover shows one tooltip with name, state and change time; a click opens the drawer', async () => {
    renderMosaic();
    fireEvent.mouseOver(square('Kitchen light'));
    const tip = screen.getByRole('tooltip');
    expect(plain(tip.textContent)).toMatch(/^Kitchen light · On · changed .+/);
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    fireEvent.mouseOver(square('Desk lamp'));
    expect(plain(screen.getByRole('tooltip').textContent)).toBe('Desk lamp · Off');
    fireEvent.keyDown(square('Desk lamp'), { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(square('Kitchen light'));
    const dialog = await screen.findByRole('dialog', { name: 'Kitchen light' });
    expect(within(dialog).getByText('Lights')).toBeTruthy();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('light.kitchen')));
  });

  it('on a touch screen the first tap shows the tooltip and a second tap opens the drawer', async () => {
    renderMosaic();
    const lamp = square('Desk lamp');
    // jsdom has no PointerEvent, so the tap's pointerType is set by hand.
    const touchDown = (el) => {
      const ev = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'pointerType', { value: 'touch' });
      fireEvent(el, ev);
    };
    const tap = (el) => { touchDown(el); fireEvent.mouseOver(el); fireEvent.focus(el); fireEvent.click(el); };
    tap(lamp);
    expect(plain(screen.getByRole('tooltip').textContent)).toBe('Desk lamp · Off');
    expect(screen.queryByRole('dialog')).toBeNull();
    tap(square('Kitchen light'));
    expect(plain(screen.getByRole('tooltip').textContent)).toMatch(/^Kitchen light/);
    expect(screen.queryByRole('dialog')).toBeNull();
    tap(square('Kitchen light'));
    expect(await screen.findByRole('dialog', { name: 'Kitchen light' })).toBeTruthy();
  });

  it('switches to By type, showing the type groups, and remembers it', () => {
    renderMosaic();
    fireEvent.click(screen.getByRole('radio', { name: 'By type' }));
    const labels = [...document.querySelectorAll('.home-mosaic__label')].map((el) => el.textContent);
    expect(labels).toEqual(['Lights', 'Power']);
    expect(squares()).toHaveLength(6);
    expect(window.localStorage.getItem('home.mosaic.mode')).toBe('type');
  });

  it('opens on the saved grouping', () => {
    window.localStorage.setItem('home.mosaic.mode', 'type');
    renderMosaic();
    expect(screen.getByText('Lights')).toBeTruthy();
    expect(screen.queryByText('Kitchen')).toBeNull();
  });

  it('marks a device that needs attention: not answering, or a low battery', () => {
    renderMosaic();
    expect(square('Hall motion').className).toContain('home-square--attention');
    expect(square('Remote battery').className).toContain('home-square--attention');
    expect(square('Desk lamp').className).not.toContain('home-square--attention');
  });

  it('says so when the server does not group the mosaic', () => {
    renderMosaic({ mosaic: undefined });
    expect(screen.getByText('This server does not group the mosaic yet')).toBeTruthy();
    expect(squares()).toHaveLength(0);
  });
});
