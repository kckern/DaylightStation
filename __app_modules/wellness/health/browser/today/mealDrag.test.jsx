import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup, renderHook } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { LogTable } from "./LogTable.jsx";
import { isDragDeadZone, useMealMoves, MOVED_HIGHLIGHT_MS } from "./mealDrag.jsx";
import { HealthOperationsProvider, useHealthOperations } from "../operations/HealthOperationsProvider.jsx";

const wrapper = ({ children }) => <MantineProvider>{children}</MantineProvider>;

// jsdom ships no PointerEvent, so fireEvent.pointer* would build a bare Event
// with no button/isPrimary/pointerType/client coordinates for dnd-kit to read.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.isPrimary = init.isPrimary ?? true;
      this.pointerType = init.pointerType ?? 'mouse';
      this.pointerId = init.pointerId ?? 1;
    }
  };
}

describe('isDragDeadZone', () => {
  const el = html => { const host = document.createElement('div'); host.innerHTML = html; document.body.append(host); return host; };
  afterEach(() => { document.body.innerHTML = ''; });

  it('the sliders, badges, confirm/delete and expand never start a move', () => {
    const host = el(`<div class="health-row-line">
      <span class="health-row-name"><span class="n">Eggs</span></span>
      <span class="health-row__macros"><b class="m">7</b></span>
      <span class="health-row__portion-cell"><span class="health-portion p">140 g</span></span>
      <span class="health-row__kcal"><small class="k">kcal</small></span>
      <div class="health-row__action"><button class="x">x</button></div>
      <button class="health-row__expand"><svg class="t"></svg></button></div>`);
    for (const sel of ['.m', '.p', '.k', '.x', '.t']) expect(isDragDeadZone(host.querySelector(sel))).toBe(true);
    expect(isDragDeadZone(host.querySelector('.n'))).toBe(false);
    expect(isDragDeadZone(host.querySelector('.health-row-line'))).toBe(false);
  });
});

// jsdom has no layout: give each meal section a box so the drop can be hit.
function layOutSections() {
  const boxes = { Breakfast: 0, Lunch: 200, Dinner: 400, Snacks: 600 };
  for (const [label, top] of Object.entries(boxes)) {
    const section = screen.getByText(label).closest('section');
    section.getBoundingClientRect = () => ({ top, left: 0, right: 400, bottom: top + 180, width: 400, height: 180, x: 0, y: top, toJSON() {} });
  }
}
const pointer = (type, target, x, y) => fireEvent[type](target, { isPrimary: true, button: 0, buttons: 1, pointerType: 'mouse', clientX: x, clientY: y });

describe('dragging a row to another meal', () => {
  const byBucket = new Map([
    ['morning', [{ uuid: 'eggs', name: 'Eggs', calories: 140, mealTime: 'morning', grams: 100 }]],
    ['afternoon', []], ['evening', []], ['night', []], [null, []],
  ]);
  afterEach(cleanup);

  // First in this block: a finished drag leaves dnd-kit's one-shot click
  // suppression on the document, which would swallow this test's click.
  it('a click without travel still opens the editor', () => {
    const onRowTap = vi.fn();
    render(<LogTable byBucket={byBucket} date="2026-09-22" onRowTap={onRowTap} onMoveEntry={() => {}} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Eggs' }));
    expect(onRowTap).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'eggs' }));
  });

  it('drops onto another meal and reports row, target, and source once', async () => {
    const onMove = vi.fn();
    render(<LogTable byBucket={byBucket} date="2026-09-22" onRowTap={() => {}} onMoveEntry={onMove} />, { wrapper });
    layOutSections();
    const name = screen.getByText('Eggs');
    pointer('pointerDown', name, 20, 20);
    pointer('pointerMove', document, 30, 40);
    await act(async () => { pointer('pointerMove', document, 50, 450); });
    expect(document.querySelector('.health-row-line--dragging')).toBeTruthy();
    expect(screen.getByText('Dinner').closest('section').className).toContain('health-meal--drop-over');
    await act(async () => { pointer('pointerUp', document, 50, 450); });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'eggs' }), 'evening', 'morning');
  });

  it('a press on the kcal slider never becomes a move', async () => {
    const onMove = vi.fn();
    render(<LogTable byBucket={byBucket} date="2026-09-22" onRowTap={() => {}} onMoveEntry={onMove} />, { wrapper });
    layOutSections();
    const kcal = document.querySelector('.health-row__kcal');
    pointer('pointerDown', kcal, 300, 20);
    await act(async () => { pointer('pointerMove', document, 300, 450); });
    await act(async () => { pointer('pointerUp', document, 300, 450); });
    expect(document.querySelector('.health-row-line--dragging')).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('dropping back on its own meal moves nothing', async () => {
    const onMove = vi.fn();
    render(<LogTable byBucket={byBucket} date="2026-09-22" onRowTap={() => {}} onMoveEntry={onMove} />, { wrapper });
    layOutSections();
    pointer('pointerDown', screen.getByText('Eggs'), 20, 20);
    await act(async () => { pointer('pointerMove', document, 30, 60); });
    await act(async () => { pointer('pointerUp', document, 30, 60); });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('ingredients of a dish do not drag on their own; the dish does', () => {
    const dish = new Map([
      ['morning', [
        { uuid: 'g', kind: 'group', name: 'Salad', calories: 0, mealTime: 'morning' },
        { uuid: 'c', parentId: 'g', name: 'Spinach', calories: 16, mealTime: 'morning' },
      ]], ['afternoon', []], ['evening', []], ['night', []], [null, []],
    ]);
    render(<LogTable byBucket={dish} date="2026-09-22" onRowTap={() => {}} onMoveEntry={() => {}} />, { wrapper });
    expect(screen.getByText('Salad').closest('.health-row-line').className).toContain('health-row-line--draggable');
    expect(screen.getByText('Spinach').closest('.health-row-line').className).not.toContain('health-row-line--draggable');
  });

  it('the meal header drags the whole meal onto another', async () => {
    const onMoveMeal = vi.fn();
    const meal = new Map([
      ['night', [
        { uuid: 'g', kind: 'group', name: 'Salad', calories: 0, mealTime: 'night' },
        { uuid: 'c', parentId: 'g', name: 'Spinach', calories: 16, mealTime: 'night' },
        { uuid: 'cheese', name: 'Cheese', calories: 121, mealTime: 'night' },
      ]], ['morning', []], ['afternoon', []], ['evening', []], [null, []],
    ]);
    render(<LogTable byBucket={meal} date="2026-09-22" onRowTap={() => {}} onMoveEntry={() => {}} onMoveMeal={onMoveMeal} />, { wrapper });
    layOutSections();
    const header = screen.getByText('Snacks').closest('header');
    pointer('pointerDown', header, 20, 610);
    await act(async () => { pointer('pointerMove', document, 30, 580); });
    await act(async () => { pointer('pointerMove', document, 40, 450); });
    await act(async () => { pointer('pointerUp', document, 40, 450); });
    expect(onMoveMeal).toHaveBeenCalledTimes(1);
    const [rows, to, from] = onMoveMeal.mock.calls[0];
    expect([to, from]).toEqual(['evening', 'night']);
    // Top-level entries only; the dish carries its ingredient.
    expect(rows.map(row => row.uuid).sort()).toEqual(['cheese', 'g']);
    expect(rows.find(row => row.uuid === 'g').children.map(child => child.uuid)).toEqual(['c']);
  });

  it('without a move handler rows are not draggable', () => {
    render(<LogTable byBucket={byBucket} date="2026-09-22" onRowTap={() => {}} />, { wrapper });
    expect(document.querySelector('.health-row-line--draggable')).toBeNull();
  });
});

describe('useMealMoves', () => {
  beforeEach(() => { apiMock.mockReset(); });

  const eggs = { uuid: 'eggs', name: 'Eggs', date: '2026-09-28', mealTime: 'morning', version: 3 };
  const moved = { committed: true, undoToken: 'meal-token' };
  const a = { uuid: 'a', name: 'A', date: '2026-09-28', mealTime: 'night', version: 1 };
  const b = { uuid: 'b', name: 'B', date: '2026-09-28', mealTime: 'night', version: 1 };

  it('places the row at once, sends one command, and Undo uses its token', async () => {
    apiMock.mockResolvedValue(moved);
    const reload = vi.fn();
    const { result } = renderHook(({ day }) => useMealMoves(day), { initialProps: { day: { items: [eggs], reload } } });
    await act(async () => { await result.current.move(eggs, 'evening', 'morning'); });
    expect(result.current.items[0].mealTime).toBe('evening');
    expect(apiMock.mock.calls[0]).toEqual(['api/v1/health/nutrition/foods-move', expect.objectContaining({ date: '2026-09-28', selectedIds: ['eggs'], toMeal: 'evening', expectedVersions: { eggs: 3 } }), 'POST']);
    expect(reload).toHaveBeenCalled();
    expect(result.current.undo.label).toBe('Moved Eggs to Dinner');
    await act(async () => { await result.current.undo.run(); });
    expect(apiMock.mock.calls[1]).toEqual(['api/v1/health/nutrition/meal-undo', expect.objectContaining({ undoToken: 'meal-token' }), 'POST']);
    expect(result.current.undo).toBeNull();
    expect(result.current.items[0].mealTime).toBe('morning');
  });
  it('a failed move puts every row back and offers no Undo', async () => {
    apiMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const { result } = renderHook(() => useMealMoves({ items: [a, b], reload: () => {} }));
    await act(async () => { await result.current.moveMeal([a, b], 'evening', 'night'); });
    expect(result.current.items.map(row => row.mealTime)).toEqual(['night', 'night']);
    expect(result.current.error).toMatch(/^Couldn't move 2 foods/);
    expect(result.current.undo).toBeNull();
  });
  it('a dish sends its parts\' versions', async () => {
    apiMock.mockResolvedValue(moved);
    const dish = { uuid: 'g', kind: 'group', name: 'Salad', date: '2026-09-28', mealTime: 'morning', children: [{ uuid: 'c', parentId: 'g', mealTime: 'morning' }] };
    const { result } = renderHook(() => useMealMoves({ items: [{ ...dish, children: undefined }, dish.children[0]], reload: () => {} }));
    await act(async () => { await result.current.move(dish, 'night', 'morning'); });
    expect(result.current.items.map(row => row.mealTime)).toEqual(['night', 'night']);
    expect(apiMock.mock.calls[0][1].selectedIds).toEqual(['g']);
    expect(apiMock.mock.calls[0][1].expectedVersions).toEqual({ g: 1, c: 1 });
  });
  it('a dish part linked by the short id moves, and comes back, with its dish', async () => {
    const header = { uuid: 'g-uuid', id: 'g1', kind: 'group', name: 'Salad', date: '2026-09-28', mealTime: 'morning' };
    const part = { uuid: 'c', parentId: 'g1', mealTime: 'morning', date: '2026-09-28' };
    let fail;
    apiMock.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const { result } = renderHook(() => useMealMoves({ items: [header, part], reload: () => {} }));
    let pending;
    act(() => { pending = result.current.move({ ...header, children: [part] }, 'night', 'morning'); });
    expect(result.current.items.map(row => row.mealTime)).toEqual(['night', 'night']);
    await act(async () => { fail(new Error('boom')); await pending; });
    expect(result.current.items.map(row => row.mealTime)).toEqual(['morning', 'morning']);
  });
  it('foods from several meals move together with a truthful label', async () => {
    apiMock.mockResolvedValue(moved);
    const { result } = renderHook(() => useMealMoves({ items: [a, { ...b, mealTime: 'morning' }], reload: () => {} }));
    await act(async () => { await result.current.moveMeal([a, { ...b, mealTime: 'morning' }], 'evening', null); });
    expect(result.current.undo.label).toBe('Moved 2 foods to Dinner');
  });
  it('a drop on the meal the food is already in sends nothing and reports nothing', async () => {
    const reload = vi.fn();
    const { result } = renderHook(() => useMealMoves({ items: [eggs], reload }));
    await act(async () => { await result.current.move(eggs, 'morning', 'morning'); });
    expect(apiMock).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.undo).toBeNull();
    expect(result.current.recentIds.has('eggs')).toBe(false);
  });
  it('says whether the foods ended up where they were sent', async () => {
    const { result } = renderHook(() => useMealMoves({ items: [eggs], reload: () => {} }));
    let outcome;
    await act(async () => { outcome = await result.current.moveMeal([eggs], 'morning', null); });
    expect(outcome).toBe('unchanged');
    expect(result.current.error).toBeNull();
    apiMock.mockRejectedValueOnce(Object.assign(new Error('no'), { status: 409 }));
    await act(async () => { outcome = await result.current.moveMeal([eggs], 'evening', null); });
    expect(outcome).toBe('not-moved');
    apiMock.mockResolvedValueOnce(moved);
    await act(async () => { outcome = await result.current.moveMeal([eggs], 'evening', null); });
    expect(outcome).toBe('moved');
  });
  it('only the foods not yet in that meal are sent and counted', async () => {
    apiMock.mockResolvedValue(moved);
    const already = { ...b, mealTime: 'evening' };
    const { result } = renderHook(() => useMealMoves({ items: [a, already], reload: () => {} }));
    await act(async () => { await result.current.moveMeal([a, already], 'evening', null); });
    expect(apiMock.mock.calls[0][1]).toMatchObject({ selectedIds: ['a'], expectedVersions: { a: 1 } });
    expect(result.current.undo.label).toBe('Moved A to Dinner');
  });
  it('a failed Undo keeps the move, says so, and can be tried again as the same operation', async () => {
    apiMock.mockResolvedValueOnce(moved).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ committed: true });
    const { result } = renderHook(() => useMealMoves({ items: [eggs], reload: () => {} }));
    await act(async () => { await result.current.move(eggs, 'evening', 'morning'); });
    await act(async () => { await result.current.undo.run(); });
    expect(result.current.error).toMatch(/^Couldn't undo that move/);
    expect(result.current.items[0].mealTime).toBe('evening');
    expect(result.current.undo.label).toBe('Moved Eggs to Dinner');
    await act(async () => { await result.current.undo.run(); });
    expect(apiMock.mock.calls[2][1].operationId).toBe(apiMock.mock.calls[1][1].operationId);
    expect(result.current.undo).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.items[0].mealTime).toBe('morning');
  });
  it('the highlight fades after its moment', async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue(moved);
      const { result } = renderHook(() => useMealMoves({ items: [eggs], reload: () => {} }));
      await act(async () => { await result.current.move(eggs, 'evening', 'morning'); });
      expect(result.current.recentIds.has('eggs')).toBe(true);
      act(() => { vi.advanceTimersByTime(MOVED_HIGHLIGHT_MS + 10); });
      expect(result.current.recentIds.has('eggs')).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

describe('useMealMoves — moving to another day', () => {
  const eggs = { uuid: 'eggs', name: 'Eggs', date: '2026-09-28', mealTime: 'morning', version: 1 };
  const toast = { uuid: 'toast', name: 'Toast', date: '2026-09-28', mealTime: 'morning', version: 1 };
  beforeEach(() => { apiMock.mockReset(); apiMock.mockResolvedValue({ committed: true, undoToken: 'meal-token' }); });

  it('hides the rows at once and sends one command', async () => {
    const reload = vi.fn();
    const { result } = renderHook(({ day }) => useMealMoves(day), { initialProps: { day: { items: [eggs, toast], reload } } });
    await act(async () => { await result.current.moveToDay([eggs, toast], '2020-01-15'); });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0][1]).toMatchObject({ selectedIds: ['eggs', 'toast'], toDate: '2020-01-15' });
    expect(result.current.items).toEqual([]);
    expect(reload).toHaveBeenCalled();
    expect(result.current.undo.label).toBe('Moved 2 foods to Wed, Jan 15');
  });
  it('moves rows from a day not being viewed without touching the viewed day', async () => {
    const reload = vi.fn();
    const viewed = { ...toast, uuid: 'viewed', date: '2026-09-29' };
    const dish = { uuid: 'dish', name: 'Burrito', kind: 'group', date: '2026-09-28', mealTime: 'morning', version: 3 };
    const part = { uuid: 'part', name: 'Tortilla', parentId: 'dish', date: '2026-09-28', mealTime: 'morning', version: 2 };
    const { result } = renderHook(() => useMealMoves({ items: [viewed], reload }));
    await act(async () => { expect(await result.current.moveFromDay([{ ...dish, children: [] }], '2026-09-29', [dish, part])).toBe('moved'); });
    expect(apiMock.mock.calls[0][1]).toMatchObject({ date: '2026-09-28', toDate: '2026-09-29', selectedIds: ['dish'], expectedVersions: { dish: 3, part: 2 } });
    expect(result.current.items).toEqual([viewed]);
    expect(reload).toHaveBeenCalled();
    expect(result.current.undo.label).toBe('Moved Burrito to Tue, Sep 29');
  });
  it('a failed move from another day leaves the viewed day as it was', async () => {
    apiMock.mockRejectedValue(Object.assign(new Error('changed'), { status: 409 }));
    const viewed = { ...toast, date: '2026-09-29' };
    const { result } = renderHook(() => useMealMoves({ items: [viewed], reload: vi.fn() }));
    await act(async () => { expect(await result.current.moveFromDay([eggs], '2026-09-29', [eggs])).toBe('not-moved'); });
    expect(result.current.items).toEqual([viewed]);
    expect(result.current.error).toContain("Couldn't move Eggs");
  });
  it('a row already on that day is left alone', async () => {
    const { result } = renderHook(() => useMealMoves({ items: [eggs], reload: vi.fn() }));
    await act(async () => { await result.current.moveToDay([eggs], '2026-09-28'); });
    expect(apiMock).not.toHaveBeenCalled();
  });
  it('only the rows not yet on that day are sent', async () => {
    const there = { ...toast, date: '2020-01-15' };
    const { result } = renderHook(() => useMealMoves({ items: [eggs, there], reload: vi.fn() }));
    await act(async () => { await result.current.moveToDay([there, eggs], '2020-01-15'); });
    expect(apiMock.mock.calls[0][1]).toMatchObject({ date: '2026-09-28', selectedIds: ['eggs'], expectedVersions: { eggs: 1 } });
  });
  it('Undo brings the rows back', async () => {
    const { result } = renderHook(() => useMealMoves({ items: [eggs], reload: vi.fn() }));
    await act(async () => { await result.current.moveToDay([eggs], '2020-01-15'); });
    await act(async () => { await result.current.undo.run(); });
    expect(apiMock.mock.calls[1][0]).toBe('api/v1/health/nutrition/meal-undo');
    expect(result.current.items).toEqual([eggs]);
    expect(result.current.undo).toBeNull();
  });
  it('a dish part linked by the short id leaves and returns with its dish', async () => {
    const header = { uuid: 'g-uuid', id: 'g1', kind: 'group', name: 'Salad', date: '2026-09-28', mealTime: 'morning' };
    const part = { uuid: 'c', parentId: 'g1', date: '2026-09-28', mealTime: 'morning' };
    const { result } = renderHook(() => useMealMoves({ items: [header, part], reload: vi.fn() }));
    await act(async () => { await result.current.moveToDay([{ ...header, children: [part] }], '2020-01-15'); });
    expect(result.current.items).toEqual([]);
    await act(async () => { await result.current.undo.run(); });
    expect(result.current.items).toEqual([header, part]);
  });
  it('says whether the foods reached that day', async () => {
    const { result } = renderHook(() => useMealMoves({ items: [eggs], reload: vi.fn() }));
    let outcome;
    await act(async () => { outcome = await result.current.moveToDay([eggs], '2026-09-28'); });
    expect(outcome).toBe('unchanged');
    await act(async () => { outcome = await result.current.moveToDay([eggs], '2020-01-15'); });
    expect(outcome).toBe('moved');
    apiMock.mockRejectedValueOnce(new Error('boom'));
    await act(async () => { outcome = await result.current.moveToDay([toast], '2020-01-15'); });
    expect(outcome).toBe('not-moved');
  });
  it('a failure brings the row back and says so', async () => {
    apiMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useMealMoves({ items: [eggs], reload: vi.fn() }));
    await act(async () => { await result.current.moveToDay([eggs], '2020-01-15'); });
    expect(result.current.items).toEqual([eggs]);
    expect(result.current.error).toMatch(/Couldn't move Eggs/);
  });
});

describe('useMealMoves — inside a Health session', () => {
  const FROM = '2026-09-28', TO = '2020-01-15';
  const eggs = { uuid: 'eggs', name: 'Eggs', date: FROM, mealTime: 'morning', version: 1 };
  const session = ({ children }) => <HealthOperationsProvider userId="u">{children}</HealthOperationsProvider>;
  const render = () => renderHook(() => ({ moves: useMealMoves({ items: [eggs], reload: vi.fn() }), ops: useHealthOperations() }), { wrapper: session });
  const shown = (ops, date, rows) => ops.reconciliation.reconcile({ date, rows }).rows.map(row => [row.uuid, row.version]);
  const movedReply = { committed: true, date: FROM, bucket: null, undoToken: 'meal-token', toDate: TO, items: [{ ...eggs, date: TO, version: 2 }], affectedIds: ['eggs'], affectedDates: [FROM, TO] };
  const undoReply = { committed: true, date: FROM, bucket: null, undoToken: null, items: [{ ...eggs, version: 3 }], affectedIds: ['eggs'], affectedDates: [TO, FROM] };
  beforeEach(() => { apiMock.mockReset(); });

  it('a day move shows on both days, and Undo puts both back', async () => {
    apiMock.mockResolvedValueOnce(movedReply).mockResolvedValueOnce(undoReply);
    const { result } = render();
    await act(async () => { await result.current.moves.moveToDay([eggs], TO); });
    expect(shown(result.current.ops, FROM, [eggs])).toEqual([]);
    expect(shown(result.current.ops, TO, [])).toEqual([['eggs', 2]]);
    await act(async () => { await result.current.moves.undo.run(); });
    expect(shown(result.current.ops, FROM, [eggs])).toEqual([['eggs', 3]]);
    expect(shown(result.current.ops, TO, [{ ...eggs, date: TO, version: 2 }])).toEqual([]);
    expect(result.current.moves.undo).toBeNull();
  });
  const failure = status => Object.assign(new Error(`HTTP ${status}`), { status });
  const operations = result => [...result.current.ops.snapshot.operations.values()];

  it.each([[400], [409]])('a %i refusal puts the row back and leaves the food free', async status => {
    apiMock.mockRejectedValueOnce(failure(status)).mockResolvedValueOnce(movedReply);
    const { result } = render();
    await act(async () => { await result.current.moves.move(eggs, 'evening', 'morning'); });
    expect(result.current.moves.items[0].mealTime).toBe('morning');
    expect(result.current.moves.error).toMatch(/^Couldn't move Eggs/);
    expect(result.current.ops.store.isReserved(['eggs'])).toBe(false);
    expect(operations(result)).toEqual([]);
    await act(async () => { await result.current.moves.move(eggs, 'evening', 'morning'); });
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(result.current.moves.undo).not.toBeNull();
  });
  it('a move stopped by an earlier unfinished change reports that it did not happen', async () => {
    let finish;
    apiMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = render();
    let first;
    act(() => { first = result.current.moves.moveToDay([eggs], TO); });
    let outcome;
    await act(async () => { outcome = await result.current.moves.moveMeal([eggs], 'evening', null); });
    expect(outcome).toBe('not-moved');
    expect(result.current.moves.error).toMatch(/^Can't move Eggs yet/);
    await act(async () => { finish(movedReply); await first; });
  });
  it.each([['a server error', failure(500)], ['a lost connection', new Error('offline')]])('%s keeps the food reserved, since the move may have happened', async (_label, error) => {
    apiMock.mockRejectedValueOnce(error);
    const { result } = render();
    await act(async () => { await result.current.moves.move(eggs, 'evening', 'morning'); });
    expect(result.current.moves.items[0].mealTime).toBe('morning');
    expect(result.current.ops.store.isReserved(['eggs'])).toBe(true);
  });
  it('a refused Undo keeps its offer and leaves the food free', async () => {
    apiMock.mockResolvedValueOnce(movedReply).mockRejectedValueOnce(failure(409));
    const { result } = render();
    await act(async () => { await result.current.moves.moveToDay([eggs], TO); });
    await act(async () => { await result.current.moves.undo.run(); });
    expect(result.current.moves.undo).not.toBeNull();
    expect(result.current.ops.store.isReserved(['eggs'])).toBe(false);
  });
  it('dragging a food whose Undo is unresolved keeps the Undo and changes nothing', async () => {
    apiMock.mockResolvedValueOnce(movedReply).mockRejectedValueOnce(new Error('offline'));
    const { result } = render();
    await act(async () => { await result.current.moves.moveToDay([eggs], TO); });
    await act(async () => { await result.current.moves.undo.run(); });
    const offer = result.current.moves.undo.label;
    await act(async () => { await result.current.moves.move(eggs, 'night', 'morning'); });
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(result.current.moves.undo.label).toBe(offer);
    expect(result.current.moves.items).toEqual([]);
    expect(result.current.moves.error).toMatch(/^Can't move Eggs yet/);
  });
  it('dragging during a move in flight leaves that move on screen', async () => {
    let finish;
    apiMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { result } = render();
    let first;
    act(() => { first = result.current.moves.move(eggs, 'evening', 'morning'); });
    await act(async () => { await result.current.moves.move(eggs, 'night', 'morning'); });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(result.current.moves.items[0].mealTime).toBe('evening');
    expect(result.current.moves.error).toMatch(/^Can't move Eggs yet/);
    await act(async () => { finish({ ...movedReply, toDate: null, toMeal: 'evening', items: [{ ...eggs, mealTime: 'evening', version: 2 }], affectedDates: [FROM] }); await first; });
    expect(result.current.moves.items[0].mealTime).toBe('evening');
    expect(result.current.moves.undo.label).toBe('Moved Eggs to Dinner');
  });
  it('a dropped day move during a move in flight does not hide the row', async () => {
    let finish;
    apiMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { result } = render();
    let first;
    act(() => { first = result.current.moves.move(eggs, 'evening', 'morning'); });
    await act(async () => { await result.current.moves.moveToDay([eggs], TO); });
    expect(result.current.moves.items).toHaveLength(1);
    await act(async () => { finish(movedReply); await first; });
  });
  it('retrying a move from the status row offers Undo and clears the old error', async () => {
    apiMock.mockRejectedValueOnce(failure(500)).mockResolvedValueOnce(movedReply);
    const { result } = render();
    await act(async () => { await result.current.moves.moveToDay([eggs], TO); });
    expect(result.current.moves.undo).toBeNull();
    const [failed] = operations(result);
    await act(async () => { await result.current.ops.retry(failed.id); });
    expect(result.current.moves.error).toBeNull();
    expect(result.current.moves.undo.label).toBe('Moved Eggs to Wed, Jan 15');
    expect(result.current.ops.store.isReserved(['eggs'])).toBe(false);
  });
  it('retrying an Undo from the status row closes the offer', async () => {
    apiMock.mockResolvedValueOnce(movedReply).mockRejectedValueOnce(failure(500)).mockResolvedValueOnce(undoReply);
    const { result } = render();
    await act(async () => { await result.current.moves.moveToDay([eggs], TO); });
    await act(async () => { await result.current.moves.undo.run(); });
    const failed = operations(result).find(op => op.request.path.endsWith('meal-undo'));
    await act(async () => { await result.current.ops.retry(failed.id); });
    expect(result.current.moves.undo).toBeNull();
    expect(result.current.moves.error).toBeNull();
    expect(result.current.moves.items).toEqual([eggs]);
  });
  it('a dish sends the version of a part sitting in another meal, linked by either id', async () => {
    const header = { uuid: 'g-uuid', id: 'g1', kind: 'group', name: 'Salad', date: FROM, mealTime: 'morning', version: 2 };
    const near = { uuid: 'near', parentId: 'g-uuid', date: FROM, mealTime: 'morning', version: 3 };
    const far = { uuid: 'far', parentId: 'g1', date: FROM, mealTime: 'night', version: 4 };
    apiMock.mockResolvedValueOnce({ committed: true, undoToken: 'meal-token', affectedDates: [FROM], affectedIds: ['g-uuid', 'near', 'far'],
      items: [header, near, far].map(row => ({ ...row, mealTime: 'evening', version: row.version + 1 })) });
    const { result } = renderHook(() => useMealMoves({ items: [header, near, far], reload: vi.fn() }), { wrapper: session });
    // The section only knows its own meal, so the far part is not in `children`.
    await act(async () => { await result.current.move({ ...header, children: [near] }, 'evening', 'morning'); });
    expect(apiMock.mock.calls[0][1]).toMatchObject({ selectedIds: ['g-uuid'], expectedVersions: { 'g-uuid': 2, near: 3, far: 4 } });
    expect(result.current.items.map(row => row.mealTime)).toEqual(['evening', 'evening', 'evening']);
  });
  it('a loose food with an old dish link moves without reserving that dish or reading the day again', async () => {
    const dish = { uuid: 'g', kind: 'group', name: 'Salad', date: FROM, mealTime: 'morning', version: 1 };
    const loose = { uuid: 'loose', name: 'Loose', parentId: 'g', date: FROM, mealTime: 'night', version: 1 };
    let finish;
    apiMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => ({ moves: useMealMoves({ items: [dish, loose], reload: vi.fn() }), ops: useHealthOperations() }), { wrapper: session });
    let pending;
    act(() => { pending = result.current.moves.move(loose, 'evening', 'night'); });
    expect(result.current.ops.store.isReserved(['g'])).toBe(false);
    await act(async () => { finish({ committed: true, undoToken: 'meal-token', affectedDates: [FROM], affectedIds: ['loose'], items: [{ ...loose, parentId: null, mealTime: 'evening', version: 2 }] }); await pending; });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(result.current.moves.error).toBeNull();
    expect(result.current.moves.undo.label).toBe('Moved Loose to Dinner');
  });
  it('a food leaves a row linked to it from another meal where it is', async () => {
    const plain = { uuid: 'plain', name: 'Plain', date: FROM, mealTime: 'morning', version: 1 };
    const linked = { uuid: 'linked', parentId: 'plain', date: FROM, mealTime: 'night', version: 1 };
    apiMock.mockResolvedValueOnce({ committed: true, undoToken: 'meal-token', affectedDates: [FROM], affectedIds: ['plain'], items: [{ ...plain, mealTime: 'evening', version: 2 }] });
    const { result } = renderHook(() => useMealMoves({ items: [plain, linked], reload: vi.fn() }), { wrapper: session });
    await act(async () => { await result.current.move(plain, 'evening', 'morning'); });
    expect(apiMock.mock.calls[0][1].expectedVersions).toEqual({ plain: 1 });
    expect(result.current.items.map(row => row.mealTime)).toEqual(['evening', 'night']);
  });
  it('a day move leaves that linked row on screen', async () => {
    const plain = { uuid: 'plain', name: 'Plain', date: FROM, mealTime: 'morning', version: 1 };
    const linked = { uuid: 'linked', parentId: 'plain', date: FROM, mealTime: 'night', version: 1 };
    apiMock.mockResolvedValueOnce({ committed: true, undoToken: 'meal-token', affectedDates: [FROM, TO], affectedIds: ['plain'], items: [{ ...plain, date: TO, version: 2 }] });
    const { result } = renderHook(() => useMealMoves({ items: [plain, linked], reload: vi.fn() }), { wrapper: session });
    await act(async () => { await result.current.moveToDay([plain], TO); });
    expect(result.current.items).toEqual([linked]);
  });
  it('a failed Undo can be run again', async () => {
    apiMock.mockResolvedValueOnce(movedReply).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undoReply);
    const { result } = render();
    await act(async () => { await result.current.moves.moveToDay([eggs], TO); });
    await act(async () => { await result.current.moves.undo.run(); });
    expect(result.current.moves.error).toMatch(/^Couldn't undo that move/);
    expect(result.current.moves.undo).not.toBeNull();
    await act(async () => { await result.current.moves.undo.run(); });
    expect(apiMock).toHaveBeenCalledTimes(3);
    expect(result.current.moves.error).toBeNull();
    expect(result.current.moves.undo).toBeNull();
  });
});


describe('dragging a row onto a day', () => {
  const byBucket = new Map([
    ['morning', [{ uuid: 'eggs', name: 'Eggs', calories: 140, mealTime: 'morning', grams: 100, date: '2020-01-15' }]],
    ['afternoon', []], ['evening', []], ['night', []], [null, []],
  ]);
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('the day dock exists only during a drag, and a drop on a chip moves the row to that day', async () => {
    const onMoveToDay = vi.fn();
    render(<LogTable byBucket={byBucket} date="2020-01-15" onRowTap={() => {}} onMoveEntry={() => {}} onMoveToDay={onMoveToDay} />, { wrapper });
    layOutSections();
    expect(screen.queryByLabelText('Drop on a day to move it')).toBeNull();
    // jsdom has no layout: the chips get a box as they mount.
    const real = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function box() {
      if (this.classList?.contains('health-day-dock__chip') && this.textContent === 'Yesterday') {
        return { top: 300, left: 900, right: 1000, bottom: 340, width: 100, height: 40, x: 900, y: 300, toJSON() {} };
      }
      return real.call(this);
    });
    pointer('pointerDown', screen.getByText('Eggs'), 20, 20);
    pointer('pointerMove', document, 30, 40);
    await act(async () => { pointer('pointerMove', document, 950, 320); });
    expect(screen.getByLabelText('Drop on a day to move it')).toBeTruthy();
    expect(screen.getByText('Yesterday').className).toContain('health-day-dock__chip--over');
    await act(async () => { pointer('pointerUp', document, 950, 320); });
    expect(onMoveToDay).toHaveBeenCalledTimes(1);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const iso = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    expect(onMoveToDay).toHaveBeenCalledWith([expect.objectContaining({ uuid: 'eggs' })], iso, 'morning');
    expect(screen.queryByLabelText('Drop on a day to move it')).toBeNull();
  });
});
