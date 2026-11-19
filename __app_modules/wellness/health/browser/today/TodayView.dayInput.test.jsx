import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock('../capture/PhotoCapture.jsx', () => ({ PhotoCapture: () => null }));
vi.mock('../capture/VoiceCapture.jsx', () => ({ VoiceCapture: ({ bucket, onCapture }) => (bucket === 'morning' ? <button onClick={() => onCapture('data:audio/webm;base64,zzz', bucket)}>Record breakfast</button> : null) }));
vi.mock('../capture/BarcodeCapture.jsx', () => ({ BarcodeCapture: () => null }));
vi.mock('../capture/CustomFoodSheet.jsx', () => ({ CustomFoodSheet: () => null }));

import { TodayView } from './TodayView.jsx';
import { localTodayISO } from './mealBuckets.js';
import { addDaysISO } from './moveDays.js';
import { resetApiResourceCache } from '../../../../../frontend/src/lib/hooks/useApiResource.js';
import { RECONSTRUCTION_LOG_ID } from '../../portable/contracts/nutrition/reconstruction.mjs';

const today = localTodayISO();
const food = (uuid, extra = {}) => ({ uuid, name: uuid, date: today, mealTime: 'morning', calories: 10, version: 1, ...extra });
let items, dayInput, dayReads, foodsMove;
const api = async (path, body) => {
  if (path === 'api/v1/health/nutrition/day-input') return dayInput(body);
  if (path === 'api/v1/health/nutrition/meal-undo') return { committed: true, affectedIds: [], affectedDates: [] };
  if (path === 'api/v1/health/nutrition/foods-move') return foodsMove();
  if (path === 'api/v1/health/nutrition/input') return { transcribeFailed: true, audioRef: 'va_1', responseText: 'Your recording is saved.' };
  if (path.includes('health/day?')) { dayReads += 1; return { items, budget: { budget: 2000, food: 0, exercise: 0, remaining: 2000, sessions: [] } }; }
  if (path.includes('nutrition/pending')) return { pending: [] };
  if (path.includes('observations')) return { observations: [] };
  return {};
};
const open = async () => {
  render(<MemoryRouter><MantineProvider><TodayView onSetupGoals={() => {}} onCoachTap={() => {}} /></MantineProvider></MemoryRouter>);
  await waitFor(() => expect(dayReads).toBeGreaterThan(0));
  return screen.findByRole('textbox', { name: 'Log food or change this day' });
};
const say = async words => {
  const field = await open();
  fireEvent.change(field, { target: { value: words } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};
const toasts = () => within(screen.getByRole('region', { name: 'Food log notifications' }));
const calls = path => apiMock.mock.calls.filter(call => call[0] === path);

beforeEach(() => {
  resetApiResourceCache(); apiMock.mockReset(); apiMock.mockImplementation(api);
  items = [food('Eggs')]; dayReads = 0; dayInput = async () => ({});
  foodsMove = async () => ({ committed: true, undoToken: 'meal-sheet', items: [], affectedIds: [] });
});
afterEach(cleanup);

describe('TodayView day input', () => {
  it('sits directly above the meals', async () => {
    const field = await open();
    const bar = field.closest('.health-day-input');
    expect(bar.nextElementSibling.querySelector('.health-log') || bar.nextElementSibling.classList.contains('health-log')).toBeTruthy();
  });
  it('gives added food the capture toast, with its day buttons and Undo', async () => {
    dayInput = async () => ({ committed: true, outcome: 'committed', kind: 'added', message: 'Logged Toast', undoToken: 'meal-a', logId: 'log-1', date: today, entryIds: ['toast'],
      items: [food('Toast', { logId: 'log-1', mealTime: 'afternoon' })] });
    await say('toast');
    expect(await toasts().findByText(/^Added Toast to Today/)).toBeTruthy();
    expect(toasts().getByRole('button', { name: 'Move to Yesterday' })).toBeTruthy();
    fireEvent.click(toasts().getByRole('button', { name: 'Undo meal change' }));
    await waitFor(() => expect(calls('api/v1/health/nutrition/meal-undo')[0][1]).toMatchObject({ undoToken: 'meal-a' }));
  });
  it('names no meal when the foods landed in several', async () => {
    dayInput = async () => ({ committed: true, outcome: 'committed', kind: 'added', undoToken: 'meal-a', logId: 'log-1', date: today, mealTime: 'morning',
      items: [food('Toast', { logId: 'log-1' }), food('Soup', { logId: 'log-1', mealTime: 'evening' })] });
    await say('toast for breakfast, soup for dinner');
    expect(await toasts().findByText('Added 2 foods to Today')).toBeTruthy();
  });
  it('names the meal when every food shares it', async () => {
    dayInput = async () => ({ committed: true, outcome: 'committed', kind: 'added', undoToken: 'meal-a', logId: 'log-1', date: today,
      items: [food('Toast', { logId: 'log-1' }), food('Jam', { logId: 'log-1' })] });
    await say('toast and jam');
    expect(await toasts().findByText('Added 2 foods to Today, Breakfast')).toBeTruthy();
  });
  it('accepts added food from a replayed reply that has no committed flag', async () => {
    dayInput = async () => ({ outcome: 'committed', kind: 'added', message: 'Logged Toast', undoToken: 'meal-a', logId: 'log-1', date: today, items: [food('Toast', { logId: 'log-1' })] });
    await say('toast');
    expect(await toasts().findByRole('button', { name: 'Move to Yesterday' })).toBeTruthy();
  });
  it('shows a move with the service message and an Undo that refreshes the day', async () => {
    dayInput = async () => ({ committed: true, outcome: 'committed', kind: 'moved', message: 'Moved Eggs to Yesterday', undoToken: 'meal-m', toDate: addDaysISO(today, -1),
      entryIds: ['Eggs'], affectedDates: [today, addDaysISO(today, -1)], items: [] });
    await say('move the eggs to yesterday');
    expect(await toasts().findByText('Moved Eggs to Yesterday')).toBeTruthy();
    expect(toasts().queryByRole('button', { name: 'Move to Yesterday' })).toBeNull();
    const before = dayReads;
    fireEvent.click(toasts().getByRole('button', { name: 'Undo meal change' }));
    await waitFor(() => expect(calls('api/v1/health/nutrition/meal-undo')[0][1]).toMatchObject({ undoToken: 'meal-m' }));
    await waitFor(() => expect(dayReads).toBeGreaterThan(before));
  });
  it('a committed change reloads the day', async () => {
    dayInput = async () => ({ committed: true, outcome: 'committed', kind: 'changed', message: 'Updated Eggs', undoToken: 'meal-c', items: [] });
    const field = await open();
    const before = dayReads;
    fireEvent.change(field, { target: { value: 'those were scrambled' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await toasts().findByText('Updated Eggs')).toBeTruthy();
    await waitFor(() => expect(dayReads).toBeGreaterThan(before));
  });
  it('a move retires the capture toast of the food it took away', async () => {
    let reply = { committed: true, outcome: 'committed', kind: 'added', undoToken: 'meal-a', logId: 'log-1', date: today, entryIds: ['Toast'], items: [food('Toast', { logId: 'log-1' })] };
    dayInput = async () => reply;
    await say('toast');
    await toasts().findByRole('button', { name: 'Move to Yesterday' });
    reply = { committed: true, outcome: 'committed', kind: 'moved', message: 'Moved Toast to Yesterday', undoToken: 'meal-m', toDate: addDaysISO(today, -1), entryIds: ['Toast'], items: [food('Toast', { logId: 'log-1', date: addDaysISO(today, -1) })] };
    fireEvent.change(screen.getByRole('textbox', { name: 'Log food or change this day' }), { target: { value: 'move that to yesterday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await toasts().findByText('Moved Toast to Yesterday');
    expect(toasts().queryByRole('button', { name: 'Move to Yesterday' })).toBeNull();
  });
  it('says why when nothing changed, without refreshing', async () => {
    dayInput = async () => ({ committed: false, outcome: 'no-change', message: 'Please make one change at a time.' });
    const field = await open();
    const before = dayReads;
    fireEvent.change(field, { target: { value: 'move this and that' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await toasts().findByText('Please make one change at a time.')).toBeTruthy();
    expect(dayReads).toBe(before);
  });
  it('a notice leaves a meal recording\'s saved retry in place', async () => {
    dayInput = async () => ({ committed: false, outcome: 'no-food', message: "I couldn't find any food in that." });
    const field = await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Record breakfast' }));
    expect(await toasts().findByText('Your recording is saved.')).toBeTruthy();
    fireEvent.change(field, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await toasts().findByText("I couldn't find any food in that.")).toBeTruthy();
    expect(toasts().getByText('Your recording is saved.')).toBeTruthy();
    expect(toasts().getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
  it('a failed sheet move keeps selection mode and its ticks', async () => {
    let refuse;
    foodsMove = () => new Promise((_, reject) => { refuse = () => reject(Object.assign(new Error('HTTP 422'), { status: 422, body: { error: 'This entry changed.' } })); });
    await open();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Select foods' }))[0]);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Eggs' }));
    fireEvent.click(screen.getByRole('button', { name: "Move this day's food" }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move 1 selected to another day', hidden: false }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Yesterday' }));
    await waitFor(() => expect(refuse).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Select Eggs', hidden: true })).toBeNull());
    await act(async () => { refuse(); });
    const tick = await screen.findByRole('checkbox', { name: 'Select Eggs', hidden: true });
    expect(tick.checked).toBe(true);
    expect(await screen.findByText('Couldn\'t move Eggs to Yesterday: This entry changed.', { selector: '.health-day-move__note' })).toBeTruthy();
  });
  it('the page keeps working when day input is unavailable', async () => {
    dayInput = async () => { throw Object.assign(new Error('HTTP 503: Service Unavailable'), { status: 503, body: { error: 'Day input is unavailable right now', code: 'DAY_INPUT_UNAVAILABLE' } }); };
    await say('eggs');
    expect((await screen.findByRole('alert')).textContent).toContain('Day input is unavailable right now');
    expect(screen.getByText('Eggs')).toBeTruthy();
    expect(screen.getByText('Lunch')).toBeTruthy();
  });
  it('the sheet lists Ungrouped and broken-link rows and keeps dishes whole', async () => {
    items = [
      food('Stew', { id: 'stew1', kind: 'group', mealTime: 'evening' }),
      food('Carrot', { parentId: 'Stew', mealTime: 'evening' }),
      food('Stray', { parentId: 'Stew', mealTime: 'morning' }),
      food('Lost', { parentId: 'gone' }),
      food('Loose', { mealTime: null }),
    ];
    await open();
    await screen.findByText('Stew');
    fireEvent.click(screen.getByRole('button', { name: "Move this day's food" }));
    for (const name of ['Stew', 'Stray', 'Lost', 'Loose']) expect(await screen.findByRole('checkbox', { name })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Carrot' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Move 3 selected to another day' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Yesterday' }));
    await waitFor(() => expect(calls('api/v1/health/nutrition/foods-move')).toHaveLength(1));
    const sent = calls('api/v1/health/nutrition/foods-move')[0][1];
    expect([...sent.selectedIds].sort()).toEqual(['Loose', 'Lost', 'Stew']);
    expect(Object.keys(sent.expectedVersions)).toEqual(expect.arrayContaining(['Carrot', 'Stray']));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Stew' })).toBeNull());
  });
  it('the sheet holds only real food, and only real food offers it', async () => {
    items = [food('Eggs'), food('Estimate', { logId: RECONSTRUCTION_LOG_ID }), food('Rejected', { status: 'rejected' })];
    await open();
    await screen.findByText('Eggs');
    fireEvent.click(screen.getByRole('button', { name: "Move this day's food" }));
    expect(await screen.findByRole('checkbox', { name: 'Eggs' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Estimate' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Rejected' })).toBeNull();
  });
  it('a day of estimates offers no whole-day move', async () => {
    items = [food('Estimate', { logId: RECONSTRUCTION_LOG_ID })];
    await open();
    await screen.findByText('Estimate');
    expect(screen.queryByRole('button', { name: "Move this day's food" })).toBeNull();
  });
  it('an empty day offers no whole-day move', async () => {
    items = [];
    await open();
    expect(screen.queryByRole('button', { name: "Move this day's food" })).toBeNull();
  });
});
