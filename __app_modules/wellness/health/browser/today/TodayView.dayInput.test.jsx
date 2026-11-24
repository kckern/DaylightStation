import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, useLocation } from 'react-router-dom';

const apiMock = vi.fn();
const camera = vi.hoisted(() => ({ current: null, stop: () => {} }));
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock('../capture/PhotoCapture.jsx', () => ({ PhotoCapture: () => null }));
vi.mock('../capture/VoiceCapture.jsx', () => ({ VoiceCapture: ({ bucket, onCapture }) => (bucket === 'morning' ? <button onClick={() => onCapture('data:audio/webm;base64,zzz', bucket)}>Record breakfast</button> : null) }));
vi.mock('../../../../../frontend/src/lib/camera/useBarcodeScanner.js', () => ({
  useBarcodeScanner: args => { camera.current = args; return { cameraState: 'live', stop: camera.stop }; },
}));

import { DismissStackProvider } from '@/lib/ui/dismiss/DismissStackProvider.jsx';
import { TodayView } from './TodayView.jsx';
import { HealthOperationsProvider } from '../operations/HealthOperationsProvider.jsx';
import { localTodayISO } from './mealBuckets.js';
import { addDaysISO } from './moveDays.js';
import { primeApiResource, resetApiResourceCache } from '../../../../../frontend/src/lib/hooks/useApiResource.js';
import { RECONSTRUCTION_LOG_ID } from '../../portable/contracts/nutrition/reconstruction.mjs';

const today = localTodayISO();
const food = (uuid, extra = {}) => ({ uuid, name: uuid, date: today, mealTime: 'morning', calories: 10, version: 1, ...extra });
let items, dayInput, dayReads, foodsMove, mealUndo, lookupBarcode, commitBarcode;
const api = async (path, body) => {
  if (path === 'api/v1/health/nutrition/day-input') return dayInput(body);
  if (path === 'api/v1/health/nutrition/meal-undo') return mealUndo(body);
  if (path === 'api/v1/health/nutrition/foods-move') return foodsMove();
  if (path.includes('/nutrition/barcode-lookup?')) return lookupBarcode();
  if (path === 'api/v1/health/nutrition/barcode-commit') return commitBarcode(body);
  if (path === 'api/v1/health/nutrition/input') return { transcribeFailed: true, audioRef: 'va_1', responseText: 'Your recording is saved.' };
  if (path.includes('health/day?')) {
    if (path === `api/v1/health/day?date=${today}`) dayReads += 1;
    return { items, budget: { budget: 2000, food: 0, exercise: 0, remaining: 2000, sessions: [] } };
  }
  if (path.includes('nutrition/pending')) return { pending: [] };
  if (path.includes('observations')) return { observations: [] };
  return {};
};
const LocationProbe = () => <output data-testid="health-location">{useLocation().search}</output>;
const open = async ({ session = false, path = '/health' } = {}) => {
  const view = <TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />;
  render(<MemoryRouter initialEntries={[path]}><LocationProbe /><MantineProvider><DismissStackProvider>{session ? <HealthOperationsProvider userId="u" send={apiMock}>{view}</HealthOperationsProvider> : view}</DismissStackProvider></MantineProvider></MemoryRouter>);
  await waitFor(() => expect(dayReads).toBeGreaterThan(0));
  if (/[?&]capture=/.test(path)) return null;
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
  localStorage.clear();
  resetApiResourceCache(); apiMock.mockReset(); apiMock.mockImplementation(api);
  items = [food('Eggs')]; dayReads = 0; dayInput = async () => ({});
  mealUndo = async () => ({ committed: true, affectedIds: [], affectedDates: [] });
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
  describe('focus after a move from a meal\'s menu', () => {
    const pickFromMealMenu = async (name, options) => {
      await open(options);
      const opener = await screen.findByRole('button', { name: 'Breakfast actions' });
      opener.focus();
      fireEvent.click(opener);
      const item = await screen.findByRole('menuitem', { name });
      item.focus();
      fireEvent.click(item);
    };
    const refusal = () => Object.assign(new Error('HTTP 422'), { status: 422, body: { error: 'This entry changed.' } });
    it('a refused move to another day lands on the toast reporting it', async () => {
      foodsMove = async () => { throw refusal(); };
      await pickFromMealMenu('Yesterday');
      const toast = await toasts().findByText("Couldn't move Eggs to Yesterday: This entry changed.");
      const dismiss = within(toast.closest('.ds-toast')).getByRole('button', { name: 'Dismiss' });
      await waitFor(() => expect(document.activeElement).toBe(dismiss));
      expect(await screen.findByRole('button', { name: 'Breakfast actions' })).toBeTruthy();
    });
    it('a refused move to another meal does the same', async () => {
      foodsMove = async () => { throw refusal(); };
      await pickFromMealMenu('Move all of Breakfast to Lunch');
      const toast = await toasts().findByText("Couldn't move Eggs: This entry changed.");
      await waitFor(() => expect(document.activeElement).toBe(within(toast.closest('.ds-toast')).getByRole('button', { name: 'Dismiss' })));
    });
    it('a move with no known outcome lands on Try again', async () => {
      foodsMove = async () => { throw new Error('Network error: the reply was lost'); };
      await pickFromMealMenu('Yesterday', { session: true });
      const retry = await toasts().findByRole('button', { name: 'Try again' });
      await waitFor(() => expect(document.activeElement).toBe(retry));
    });
    it('a finished move lands on its Undo', async () => {
      await pickFromMealMenu('Yesterday');
      const undo = await toasts().findByRole('button', { name: 'Undo move' });
      await waitFor(() => expect(document.activeElement).toBe(undo));
    });
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
  it("every item of a meal's menu gets the finger-sized treatment", async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Breakfast actions' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.length).toBeGreaterThan(3);
    for (const item of items) expect(item.classList.contains('health-move-menu__item')).toBe(true);
  });
  describe('a failed meal Undo whose toast a newer change replaced', () => {
    const cards = () => [...document.querySelectorAll('.ds-toast')].map(node => node.textContent);
    const unconfirmed = () => cards().filter(text => /confirm that undo/i.test(text));
    const send = words => {
      fireEvent.change(screen.getByRole('textbox', { name: 'Log food or change this day' }), { target: { value: words } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    };
    const failUndoThenReplaceIt = async () => {
      items = [food('Eggs'), food('Toast', { logId: 'log-1' })];
      const replies = [
        async () => ({ committed: true, outcome: 'committed', kind: 'added', undoToken: 'meal-a', logId: 'log-1', date: today, entryIds: ['Toast'], affectedIds: ['Toast'], items: [food('Toast', { logId: 'log-1' })] }),
        async () => ({ committed: true, outcome: 'committed', kind: 'changed', message: 'Updated Eggs', undoToken: 'meal-b', affectedIds: ['Eggs'], items: [food('Eggs')] }),
      ];
      dayInput = () => replies.shift()();
      mealUndo = async () => { throw Object.assign(new Error('HTTP 502: Bad Gateway'), { status: 502 }); };
      await open({ session: true });
      send('toast');
      fireEvent.click(await screen.findByRole('button', { name: 'Undo meal change' }));
      await screen.findByText(/couldn't confirm that undo/i);
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Log food or change this day' }).readOnly).toBe(false));
      send('the eggs were scrambled');
      await screen.findByText('Updated Eggs');
    };
    it('is reported once, by the page', async () => {
      await failUndoThenReplaceIt();
      await waitFor(() => expect(unconfirmed()).toHaveLength(1));
      expect(within(screen.getByText(/confirm that undo/i).closest('.ds-toast')).getByRole('button', { name: 'Try again' })).toBeTruthy();
      expect(toasts().getByText(/^Added Toast to Today/)).toBeTruthy();
    });
    it('retires the day offer when the retry finishes it, because the food may be gone', async () => {
      await failUndoThenReplaceIt();
      mealUndo = async () => ({ committed: true, affectedIds: ['Toast'], affectedDates: [today] });
      fireEvent.click(await toasts().findByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(unconfirmed()).toHaveLength(0));
      await waitFor(() => expect(toasts().queryByText(/^Added Toast to Today/)).toBeNull());
      expect(toasts().getByText('Updated Eggs')).toBeTruthy();
    });
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

describe('TodayView barcode review', () => {
  const upc = '012345678905';
  const product = { name: 'Granola', amount: 40, unit: 'g', grams: 40, calories: 170 };
  const postPath = 'api/v1/health/nutrition/barcode-commit';
  const detect = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Scan barcode to Breakfast' }));
    await act(async () => { camera.current.onDecode(upc); });
  };
  beforeEach(() => {
    lookupBarcode = async () => ({ upc, product });
    commitBarcode = async ({ bucket }) => ({
      committed: true, undoToken: 'meal-scan', entryIds: ['granola'], items: [food('granola', { name: 'Granola', mealTime: bucket })],
    });
  });
  it('readRequiresConfirmation', async () => {
    await open({ session: true });
    await detect();
    expect(await screen.findByText('Granola')).toBeTruthy();
    expect(calls(postPath)).toHaveLength(0);
    expect(calls('api/v1/health/nutrition/input')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls(postPath)).toHaveLength(0);
    await detect();
    fireEvent.change(await screen.findByLabelText('Meal'), { target: { value: 'evening' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log item' }));
    expect(await screen.findByText('Logged')).toBeTruthy();
    expect(calls(postPath)).toHaveLength(1);
    expect(calls(postPath)[0][1]).toMatchObject({ upc, bucket: 'evening', product });
    fireEvent.click(screen.getByRole('button', { name: 'Undo logged item' }));
    await waitFor(() => expect(calls('api/v1/health/nutrition/meal-undo')[0][1]).toMatchObject({ undoToken: 'meal-scan' }));
    expect(screen.getByRole('button', { name: 'Scan another' })).toBeTruthy();
  });
  it('keeps the open barcode Undo when an earlier commit finishes last', async () => {
    const complete = [];
    commitBarcode = () => new Promise(resolve => complete.push(resolve));
    const result = (name, undoToken) => ({ committed: true, undoToken, entryIds: [name], items: [food(name)] });
    mealUndo = vi.fn().mockRejectedValueOnce(new Error('Lost Undo reply'))
      .mockResolvedValue({ committed: true, affectedIds: [], affectedDates: [] });
    await open({ session: true });
    await detect();
    fireEvent.click(await screen.findByRole('button', { name: 'Log item' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await detect();
    fireEvent.click(await screen.findByRole('button', { name: 'Log item' }));
    await act(async () => complete[1](result('Granola', 'meal-second')));
    const sheet = within(screen.getByRole('dialog', { name: 'Scan barcode' }));
    fireEvent.click(sheet.getByRole('button', { name: 'Undo logged item' }));
    await sheet.findByRole('alert');
    await act(async () => complete[0](result('Oats', 'meal-first')));
    fireEvent.click(sheet.getByRole('button', { name: 'Undo logged item' }));
    expect(await sheet.findByText('Log undone')).toBeTruthy();
    const undoRequests = calls('api/v1/health/nutrition/meal-undo').map(([, body]) => body);
    expect(undoRequests).toEqual([
      { undoToken: 'meal-second', operationId: expect.any(String) },
      { undoToken: 'meal-second', operationId: undoRequests[0].operationId },
    ]);
    fireEvent.click(sheet.getByRole('button', { name: 'Done' }));
    expect(await toasts().findByText(/^Added Oats/)).toBeTruthy();
  });
  it('retries an uncertain reply with the same payload and uses a new ID for another scan', async () => {
    const success = commitBarcode;
    commitBarcode = vi.fn().mockRejectedValueOnce(new Error('Lost response')).mockImplementation(success);
    await open({ session: true });
    await detect();
    fireEvent.click(await screen.findByRole('button', { name: 'Log item' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry log' }));
    expect(await screen.findByText('Logged')).toBeTruthy();
    expect(calls(postPath)[1][1]).toEqual(calls(postPath)[0][1]);
    fireEvent.click(screen.getByRole('button', { name: 'Scan another' }));
    await act(async () => { camera.current.onDecode(upc); });
    fireEvent.click(await screen.findByRole('button', { name: 'Log item' }));
    expect(await screen.findByText('Logged')).toBeTruthy();
    expect(calls(postPath)[2][1]).toMatchObject({ upc, operationId: expect.any(String) });
    expect(calls(postPath)[2][1].operationId).not.toBe(calls(postPath)[0][1].operationId);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Scan barcode' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Log food or change this day' })).toBeTruthy();
  });
  it('logs a physical shortcut scan, keeps scanning, and returns to the host on Done', async () => {
    const finish = vi.fn();
    window.addEventListener('daylight:barcode-shortcut-done', finish);
    try {
      await open({ session: true, path: '/health?capture=barcode' });
      await act(async () => { camera.current.onDecode(upc); });
      expect(await screen.findByText(/^Logged /)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Log item' })).toBeNull();
      // The scanner stays open for the next item; Done is what hands control back.
      expect(finish).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
    } finally {
      window.removeEventListener('daylight:barcode-shortcut-done', finish);
    }
  });
  it('offers manual food details for an unknown UPC without writing', async () => {
    lookupBarcode = async () => ({ upc, product: null });
    await open({ session: true });
    await detect();
    fireEvent.click(await screen.findByRole('button', { name: 'Enter food details' }));
    expect(screen.getByRole('dialog', { name: 'New food' })).toBeTruthy();
    expect(calls(postPath)).toHaveLength(0);
    expect(calls('api/v1/health/nutrition/catalog')).toHaveLength(0);
  });
  it('opens the confirmed entry only after View in Health', async () => {
    await open({ session: true });
    await detect();
    fireEvent.click(await screen.findByRole('button', { name: 'Log item' }));
    const viewEntry = await screen.findByRole('button', { name: 'View in Health' });
    expect(screen.queryByRole('dialog', { name: 'Granola' })).toBeNull();
    fireEvent.click(viewEntry);
    expect(screen.getByRole('dialog', { name: 'Granola' })).toBeTruthy();
  });
  it('ignores a stale lookup after Back', async () => {
    let answer;
    lookupBarcode = () => new Promise(resolve => { answer = resolve; });
    await open({ session: true });
    await detect();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await act(async () => answer({ upc, product }));
    expect(screen.queryByRole('button', { name: 'Log item' })).toBeNull();
    expect(calls(postPath)).toHaveLength(0);
  });
  it('keeps the prepared operation when Back leaves a commit in flight', async () => {
    let finish;
    commitBarcode = () => new Promise(resolve => { finish = resolve; });
    await open({ session: true });
    await detect();
    fireEvent.click(await screen.findByRole('button', { name: 'Log item' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(calls(postPath)).toHaveLength(1);
    const body = calls(postPath)[0][1];
    const record = JSON.parse(localStorage.getItem(`daylight.health.barcode-operations:u:${body.operationId}`));
    expect(record).toMatchObject({ kind: 'barcode-commit', phase: 'pending', request: { body } });
    await act(async () => finish({ committed: true, undoToken: 'meal-scan', entryIds: ['granola'], items: [food('granola')] }));
    expect(screen.queryByText('Logged')).toBeNull();
    expect(calls(postPath)).toHaveLength(1);
  });
});

describe('opening saved captures', () => {
  it('keeps a saved-meal link through revalidation of a stale cached day', async () => {
    const path = `api/v1/health/day?date=${today}`;
    primeApiResource(path, { items: [food('Eggs')] });
    let finishRead;
    apiMock.mockImplementation((route, body) => {
      if (route !== path) return api(route, body);
      dayReads += 1;
      return new Promise(resolve => { finishRead = resolve; });
    });
    await open({ path: `/health?date=${today}&mealLog=saved-meal` });
    expect(screen.getByTestId('health-location').textContent).toContain('mealLog=saved-meal');
    await act(async () => finishRead({ items: [food('Soup', { logId: 'saved-meal' })] }));
    expect(await screen.findByRole('dialog', { name: 'Soup' })).toBeTruthy();
    expect(screen.getByTestId('health-location').textContent).not.toContain('mealLog');
  });

  it('reports a missing saved meal after the day answers', async () => {
    await open({ path: `/health?date=${today}&mealLog=removed` });
    expect(await toasts().findByText('This saved meal was not found on this day.')).toBeTruthy();
    expect(screen.getByTestId('health-location').textContent).not.toContain('mealLog');
  });

  it('closes Health capture status while taking an older barcode receipt to its date', async () => {
    const date = addDaysISO(today, -3);
    items = [food('Granola', { date })];
    localStorage.setItem('daylight.health.barcode-receipts:u:receipt', JSON.stringify({
      id: 'receipt', userId: 'u', kind: 'barcode-commit', date, bucket: 'morning', startedAt: 1,
      receipt: { entryId: 'Granola', undoToken: 'token' },
    }));
    await open({ session: true, path: '/health?capture=status' });
    fireEvent.click(await screen.findByRole('button', { name: 'View in Health' }));
    await waitFor(() => expect(screen.getByTestId('health-location').textContent).toContain(`date=${date}`));
    expect(screen.getByTestId('health-location').textContent).not.toContain('capture=');
    expect(screen.queryByRole('dialog', { name: 'Health capture status' })).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Granola' })).toBeTruthy();
  });
});
