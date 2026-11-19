// The bar against the real provider, moves hook, day-instruction service, meal
// commands and YAML ledger. Only the network between them is simulated, so a
// lost reply means the server finished and the browser never heard.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../capture/VoiceCapture.jsx', () => ({ VoiceCapture: () => null }));
import { YamlNutriListDatastore } from '../../server/adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { MealFoodCommands } from '../../server/application/health/MealFoodCommands.mjs';
import { DayInstructionService } from '../../server/application/health/DayInstructionService.mjs';
import { HealthOperationsProvider } from '../operations/HealthOperationsProvider.jsx';
import { DayInputBar } from './DayInputBar.jsx';
import { dayEntries, useMealMoves } from './mealDrag.jsx';

const date = '2026-11-18', yesterday = '2026-11-17';
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const food = (uuid, extra = {}) => ({ uuid, userId: 'u', name: uuid, date, mealTime: 'morning', grams: 10, unit: 'g', amount: 10, calories: 20, protein: 1, ...extra });
let root, store, commands, service, lose, sent;

const captureFoods = async ({ text, date: day, operationId }) => {
  const logId = `log-${operationId.slice(0, 12)}`;
  await store.saveMany([food(`food-${logId}`, { name: text, date: day, logId })]);
  return { committed: true, logId };
};
const answer = (route, body) => {
  if (route.endsWith('/day-input')) {
    const { type, content, date: day, operationId, resolved = {} } = body;
    return store.runOperation('u', operationId, { operation: 'day-input', type, content, date: day, resolved },
      () => service.execute('u', { text: content, date: day, today: date, operationId, resolved, captureFoods }));
  }
  if (route.endsWith('/foods-move')) return commands.moveFoods('u', { ...body, today: date });
  if (route.endsWith('/meal-undo')) return commands.undo('u', body);
  return store.findByDate('u', new URL(route, 'http://x').searchParams.get('date')).then(items => ({ items }));
};
const send = async (route, body) => {
  if (body?.operationId) sent.push({ route, operationId: body.operationId });
  let result;
  try { result = await answer(route, body); }
  catch (err) { throw Object.assign(new Error(`HTTP ${err.status}`), { status: err.status, body: { error: err.message, code: err.code } }); }
  const kind = route.split('/').pop();
  if (lose.delete(kind)) throw new Error('Network error: the reply was lost');
  return result;
};

function Day() {
  const [items, setItems] = useState([]);
  const reload = useCallback(async () => setItems(await store.findByDate('u', date)), []);
  useEffect(() => { reload(); }, [reload]);
  const moves = useMealMoves({ items, reload });
  return <>
    <DayInputBar date={date} today={date} entries={dayEntries(moves.items)} onResult={reload}
      onMoveDay={(rows, iso, options) => moves.moveFromDay(rows, iso, null, options)} />
    <output data-testid="undo">{moves.undo?.label || ''}</output>
    <output data-testid="count">{items.length}</output>
  </>;
}
const open = async count => {
  render(<MantineProvider><HealthOperationsProvider userId="u" send={send}><Day /></HealthOperationsProvider></MantineProvider>);
  await waitFor(() => expect(screen.getByTestId('count').textContent).toBe(String(count)));
};
const say = words => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Log food or change this day' }), { target: { value: words } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};
const names = async day => (await store.findByDate('u', day)).map(row => row.name).sort();
const openSheet = async () => {
  fireEvent.click(screen.getByRole('button', { name: "Move this day's food" }));
  return within(await screen.findByRole('dialog'));
};
const moveToYesterday = async sheet => {
  fireEvent.click(sheet.getByRole('button', { name: /selected to another day$/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Yesterday' }));
};
const seedDish = () => store.saveMany([
  food('stew-id', { name: 'Stew', kind: 'group', mealTime: 'evening', calories: 0, protein: 0 }),
  food('carrot', { name: 'Carrot', parentId: 'stew-id', mealTime: 'evening' }),
  food('stray', { name: 'Stray', parentId: 'stew-id', mealTime: 'morning' }),
  food('eggs', { name: 'Eggs' }),
]);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-input-stack-'));
  store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(root, rel) } }, logger: silent });
  commands = new MealFoodCommands({ nutritionItems: store, logger: silent });
  const reader = { available: true, read: async () => ({ intent: 'add' }), matchFoods: async () => [], assignMeals: async () => ({}) };
  service = new DayInstructionService({ nutritionItems: store, reader, mealCommands: commands, entryRevisions: {}, logger: silent });
  lose = new Set(); sent = [];
});
afterEach(() => { cleanup(); fs.rmSync(root, { recursive: true, force: true }); });

describe('a reply lost after the server committed', () => {
  it('Dismiss, then Send with the same words, logs the food once', async () => {
    await open(0);
    lose.add('day-input');
    say('eggs');
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(await names(date)).toEqual(['eggs']);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Log food or change this day' }).value).toBe(''));
    expect(await names(date)).toEqual(['eggs']);
    expect(new Set(sent.filter(call => call.route.endsWith('/day-input')).map(call => call.operationId)).size).toBe(1);
  });
  it('different words after Dismiss are a new request', async () => {
    await open(0);
    lose.add('day-input');
    say('eggs');
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    say('toast');
    await waitFor(async () => expect(await names(date)).toEqual(['eggs', 'toast']));
  });
});

describe("the sheet's unknown outcome", () => {
  it('offers Try again with the same operation and finishes as a normal move', async () => {
    await store.saveMany([food('eggs', { name: 'Eggs' })]);
    await open(1);
    const sheet = await openSheet();
    lose.add('foods-move');
    await moveToYesterday(sheet);
    const retry = await sheet.findByRole('button', { name: 'Try again' });
    expect(sheet.queryByText(/not moved/i)).toBeNull();
    expect(sheet.getByText(/could not confirm/i)).toBeTruthy();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await names(yesterday)).toEqual(['Eggs']);
    expect(screen.getByTestId('undo').textContent).toBe('Moved Eggs to Yesterday');
    const moves = sent.filter(call => call.route.endsWith('/foods-move'));
    expect(moves).toHaveLength(2);
    expect(moves[1].operationId).toBe(moves[0].operationId);
  });
});

describe('a dish part stranded in another meal', () => {
  it('moves with its ticked dish and says so', async () => {
    await seedDish();
    await open(4);
    const sheet = await openSheet();
    const stray = sheet.getByRole('checkbox', { name: 'Stray' });
    expect(stray.disabled).toBe(true);
    expect(stray.checked).toBe(true);
    expect(sheet.getByText('Moves with Stew')).toBeTruthy();
    expect(sheet.getByRole('button', { name: 'Move 2 selected to another day' })).toBeTruthy();
    await moveToYesterday(sheet);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await names(yesterday)).toEqual(['Carrot', 'Eggs', 'Stew', 'Stray']);
  });
  it('stays when its dish is unticked and it was not ticked itself', async () => {
    await seedDish();
    await open(4);
    const sheet = await openSheet();
    fireEvent.click(sheet.getByRole('checkbox', { name: 'Stew' }));
    const stray = sheet.getByRole('checkbox', { name: 'Stray' });
    expect(stray.disabled).toBe(false);
    expect(stray.checked).toBe(false);
    await moveToYesterday(sheet);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await names(yesterday)).toEqual(['Eggs']);
    expect(await names(date)).toEqual(['Carrot', 'Stew', 'Stray']);
  });
  it('can be ticked on its own once its dish is unticked', async () => {
    await seedDish();
    await open(4);
    const sheet = await openSheet();
    fireEvent.click(sheet.getByRole('checkbox', { name: 'Stew' }));
    fireEvent.click(sheet.getByRole('checkbox', { name: 'Eggs' }));
    fireEvent.click(sheet.getByRole('checkbox', { name: 'Stray' }));
    await moveToYesterday(sheet);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => {});
    expect(await names(yesterday)).toEqual(['Stray']);
    expect(await names(date)).toEqual(['Carrot', 'Eggs', 'Stew']);
  });
});
