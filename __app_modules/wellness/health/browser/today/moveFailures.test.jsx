import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock('../capture/PhotoCapture.jsx', () => ({ PhotoCapture: () => null }));
vi.mock('../capture/VoiceCapture.jsx', () => ({ VoiceCapture: () => null }));
vi.mock('../capture/BarcodeCapture.jsx', () => ({ BarcodeCapture: () => null }));
vi.mock('../capture/CustomFoodSheet.jsx', () => ({ CustomFoodSheet: () => null }));

import { TodayView } from './TodayView.jsx';
import { localTodayISO } from './mealBuckets.js';
import { HealthOperationsProvider } from '../operations/HealthOperationsProvider.jsx';
import { resetApiResourceCache } from '../../../../../frontend/src/lib/hooks/useApiResource.js';

const MOVE_PATH = 'api/v1/health/nutrition/foods-move';
const RAW = /HTTP|\{|502|Bad Gateway/;
const today = localTodayISO();
const eggs = { uuid: 'eggs', name: 'Eggs', date: today, mealTime: 'morning', calories: 10, version: 1 };
const gateway = () => Object.assign(new Error('HTTP 502: Bad Gateway - {"error":"upstream"}'), { status: 502, body: { error: 'upstream' } });
const moved = { committed: true, undoToken: 'meal-move', items: [], affectedIds: ['eggs'] };
let foodsMove;
const api = async (path, body) => {
  if (path === MOVE_PATH) return foodsMove(body);
  if (path.includes('health/day?')) return { items: [eggs], budget: { budget: 2000, food: 0, exercise: 0, remaining: 2000, sessions: [] } };
  if (path.includes('nutrition/pending')) return { pending: [] };
  if (path.includes('observations')) return { observations: [] };
  return {};
};
const open = async () => {
  render(<MemoryRouter><MantineProvider><HealthOperationsProvider userId="u"><TodayView onSetupGoals={() => {}} onCoachTap={() => {}} /></HealthOperationsProvider></MantineProvider></MemoryRouter>);
  await screen.findByText('Eggs');
};
const toasts = () => within(screen.getByRole('region', { name: 'Food log notifications', hidden: true }));
const moveCalls = () => apiMock.mock.calls.filter(call => call[0] === MOVE_PATH);
const openSheet = async () => {
  fireEvent.click(screen.getByRole('button', { name: "Move this day's food" }));
  return within(await screen.findByRole('dialog'));
};
const moveToYesterday = async sheet => {
  fireEvent.click(sheet.getByRole('button', { name: /^Move \d+ selected to another day$/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Yesterday' }));
};
const closeSheet = async () => {
  fireEvent.click(document.querySelector('.health-day-move__close'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
};
/** Starts a sheet move the server has not answered, closes the sheet, and returns how to fail it. */
const closeSheetDuringMove = async () => {
  let reject;
  foodsMove = () => new Promise((_resolve, no) => { reject = no; });
  await open();
  await moveToYesterday(await openSheet());
  await waitFor(() => expect(moveCalls()).toHaveLength(1));
  await closeSheet();
  return err => act(async () => { reject(err); });
};
const moveMealToDinner = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Breakfast actions' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Move all of Breakfast to Dinner' }));
};

beforeEach(() => { resetApiResourceCache(); apiMock.mockReset(); apiMock.mockImplementation(api); foodsMove = async () => { throw gateway(); }; });
afterEach(cleanup);

describe('a failed food move is reported once, by what owns it', () => {
  it('a sheet failure stays in the sheet, with no toast over its Try again', async () => {
    await open();
    const sheet = await openSheet();
    await moveToYesterday(sheet);
    const retry = await sheet.findByRole('button', { name: 'Try again' });
    expect(sheet.getByRole('status').textContent).toMatch(/could not confirm/i);
    expect(toasts().queryByRole('alert')).toBeNull();
    expect(toasts().queryByRole('button', { name: 'Try again' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(retry));
  });
  it('closing the sheet leaves a toast that can finish the same move', async () => {
    await open();
    const sheet = await openSheet();
    await moveToYesterday(sheet);
    await sheet.findByRole('button', { name: 'Try again' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    foodsMove = async () => moved;
    fireEvent.click(await toasts().findByRole('button', { name: 'Try again' }));
    expect(await toasts().findByRole('button', { name: 'Undo move' })).toBeTruthy();
    expect(moveCalls()[1][1].operationId).toBe(moveCalls()[0][1].operationId);
    expect(toasts().queryByRole('button', { name: 'Try again' })).toBeNull();
  });
  it('closing the sheet takes focus straight to the toast that can finish the move', async () => {
    await open();
    await moveToYesterday(await openSheet());
    await screen.findByRole('button', { name: 'Try again' });
    await closeSheet();
    const retry = await toasts().findByRole('button', { name: 'Try again' });
    await waitFor(() => expect(document.activeElement).toBe(retry));
  });
  it('a sheet closed while its move runs leaves an unknown outcome to the toast, which can finish it', async () => {
    const fail = await closeSheetDuringMove();
    await fail(gateway());
    const retry = await toasts().findByRole('button', { name: 'Try again' });
    expect(retry.closest('.ds-toast').textContent).toMatch(/couldn't confirm moving Eggs to Yesterday/i);
    foodsMove = async () => moved;
    fireEvent.click(retry);
    expect(await toasts().findByRole('button', { name: 'Undo move' })).toBeTruthy();
    expect(moveCalls()[1][1].operationId).toBe(moveCalls()[0][1].operationId);
  });
  it('a sheet closed while its move runs leaves a refusal to the toast, with its reason', async () => {
    const fail = await closeSheetDuringMove();
    await fail(Object.assign(new Error('HTTP 400: Bad Request'), { status: 400, body: { error: 'Eggs cannot move to that day' } }));
    const alert = await toasts().findByRole('alert');
    expect(alert.textContent).toMatch(/Couldn't move Eggs to Yesterday: Eggs cannot move to that day/);
    expect(toasts().queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(toasts().getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });
  it('a meal move leaves no error row in the meal, one friendly toast, and a way to free the food', async () => {
    await open();
    await moveMealToDinner();
    const retry = await toasts().findByRole('button', { name: 'Try again' });
    const toast = retry.closest('.ds-toast');
    expect(toast.textContent).toMatch(/couldn't confirm moving Eggs to Dinner/i);
    expect(toast.textContent).not.toMatch(RAW);
    expect(document.querySelector('.health-meal [role=alert]')).toBeNull();
    expect(toasts().getAllByRole('alert')).toHaveLength(1);
    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(toasts().queryByRole('alert')).toBeNull());
    foodsMove = async () => moved;
    await moveMealToDinner();
    await waitFor(() => expect(moveCalls()).toHaveLength(2));
    expect(moveCalls()[1][1].operationId).not.toBe(moveCalls()[0][1].operationId);
  });
  it('a retry the server refuses frees the food and says so plainly', async () => {
    await open();
    await moveMealToDinner();
    const retry = await toasts().findByRole('button', { name: 'Try again' });
    foodsMove = async () => { throw Object.assign(new Error('HTTP 422: nope'), { status: 422, body: { error: '{"code":"BAD"}' } }); };
    await act(async () => { fireEvent.click(retry); });
    const alert = await toasts().findByRole('alert');
    await waitFor(() => expect(alert.textContent).toMatch(/^Couldn't/));
    expect(alert.textContent).not.toMatch(RAW);
    expect(toasts().queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
