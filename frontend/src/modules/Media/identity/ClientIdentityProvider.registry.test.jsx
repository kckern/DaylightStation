// Naming part 2 (RQ-HOUSE-06) and the first-use flag (RQ-RELY-12): the
// browser announces itself, adopts the registry's name, and renames through
// the registry with its 409 answers handed back to the person.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { ClientIdentityProvider, FIRST_USE_KEY } from './ClientIdentityProvider.jsx';
import { useClientIdentity } from './useClientIdentity.js';
import { HouseApiError } from '../house/houseApi.js';
import { STORAGE_KEYS } from '../constants.js';

vi.mock('../externalControl/useControlRegistration.js', () => ({ useControlRegistration: () => ({ ready: false }) }));

let captured;
function Probe() {
  captured = useClientIdentity();
  return <div data-testid="probe">{captured.name}|{captured.room ?? ''}|{String(captured.firstUse)}</div>;
}

function api(overrides = {}) {
  return {
    announceScreen: vi.fn(async ({ id, name }) => ({ screen: { id, name, room: null } })),
    renameScreen: vi.fn(async (id, { name }) => ({ screen: { id, name, room: null }, routines: [] })),
    setScreenRoom: vi.fn(async (id, room) => ({ screen: { id, name: 'X', room } })),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEYS.CLIENT_ID, 'aaaa1111-2222');
});

describe('ClientIdentityProvider and the screen registry', () => {
  it('announces itself on start and adopts the name the household knows it by', async () => {
    const houseApi = api({ announceScreen: vi.fn(async ({ id }) => ({ screen: { id, name: 'Kitchen tablet', room: 'Kitchen' } })) });
    render(<ClientIdentityProvider api={houseApi}><Probe /></ClientIdentityProvider>);
    expect(houseApi.announceScreen).toHaveBeenCalledWith({ id: 'browser:aaaa1111-2222', name: 'Browser aaaa1111', room: undefined });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('Kitchen tablet|Kitchen|'));
    // Persisted: the name survives a reload.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.BROWSER_IDENTITY)).name).toBe('Kitchen tablet');
  });

  it('renames through the registry and keeps the registry answer', async () => {
    const houseApi = api();
    render(<ClientIdentityProvider api={houseApi}><Probe /></ClientIdentityProvider>);
    let result;
    await act(async () => { result = await captured.rename({ name: 'Poo' }); });
    expect(houseApi.renameScreen).toHaveBeenCalledWith('browser:aaaa1111-2222', { name: 'Poo', confirm: false, onCollision: undefined });
    expect(result.ok).toBe(true);
    expect(screen.getByTestId('probe')).toHaveTextContent('Poo|');
  });

  it('hands a taken name back with the suggestion, and routines back for confirmation', async () => {
    const renameScreen = vi.fn()
      .mockRejectedValueOnce(new HouseApiError('taken', { status: 409, code: 'NAME_TAKEN', details: { heldBy: 'fleet:livingroom-tv', suggestion: 'Den TV (2)' } }))
      .mockRejectedValueOnce(new HouseApiError('routines', { status: 409, code: 'ROUTINES_TARGET', details: { routines: [{ id: 'automation:a', name: 'Morning' }] } }))
      .mockResolvedValueOnce({ screen: { id: 'browser:aaaa1111-2222', name: 'Den TV' }, routines: [{ id: 'automation:a', name: 'Morning' }] });
    render(<ClientIdentityProvider api={api({ renameScreen })}><Probe /></ClientIdentityProvider>);
    let first; let second; let third;
    await act(async () => { first = await captured.rename({ name: 'Den TV' }); });
    expect(first).toMatchObject({ ok: false, code: 'NAME_TAKEN', suggestion: 'Den TV (2)', heldBy: 'fleet:livingroom-tv' });
    await act(async () => { second = await captured.rename({ name: 'Den TV' }); });
    expect(second).toMatchObject({ ok: false, code: 'ROUTINES_TARGET', routines: [{ name: 'Morning' }] });
    await act(async () => { third = await captured.rename({ name: 'Den TV', confirm: true }); });
    expect(renameScreen).toHaveBeenLastCalledWith('browser:aaaa1111-2222', { name: 'Den TV', confirm: true, onCollision: undefined });
    expect(third.ok).toBe(true);
  });

  it('renames locally, unique among visible names, when the registry is out of reach', async () => {
    const renameScreen = vi.fn().mockRejectedValue(new HouseApiError('down', { transient: true }));
    render(<ClientIdentityProvider api={api({ renameScreen })}><Probe /></ClientIdentityProvider>);
    let result;
    await act(async () => { result = await captured.rename({ name: 'Dad laptop', existingNames: ['Dad laptop'] }); });
    expect(result).toMatchObject({ ok: true, local: true });
    expect(screen.getByTestId('probe')).toHaveTextContent('Dad laptop (aaaa1111)|');
  });

  it('asks a never-named device for a name once, and remembers the answer', async () => {
    render(<ClientIdentityProvider api={api()}><Probe /></ClientIdentityProvider>);
    expect(screen.getByTestId('probe')).toHaveTextContent('|true');
    act(() => captured.completeFirstUse('skipped'));
    expect(screen.getByTestId('probe')).toHaveTextContent('|false');
    expect(localStorage.getItem(FIRST_USE_KEY)).toBeTruthy();
  });

  it('does not ask a device that already has a chosen name', () => {
    localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, 'Dad laptop');
    render(<ClientIdentityProvider api={api()}><Probe /></ClientIdentityProvider>);
    expect(screen.getByTestId('probe')).toHaveTextContent('Dad laptop||false');
  });
});
