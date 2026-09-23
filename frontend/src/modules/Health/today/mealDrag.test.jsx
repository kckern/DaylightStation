import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup, renderHook } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { LogTable } from './LogTable.jsx';
import { isDragDeadZone, useMealMoves, MOVED_HIGHLIGHT_MS } from './mealDrag.jsx';

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

  const eggs = { uuid: 'eggs', name: 'Eggs', mealTime: 'morning', version: 3 };

  it('places the row in its new meal at once, sends the move, and offers Undo', async () => {
    apiMock.mockResolvedValue({ versions: { eggs: 4 } });
    const reload = vi.fn();
    const { result } = renderHook(({ day }) => useMealMoves(day), { initialProps: { day: { items: [eggs], reload } } });
    await act(async () => { await result.current.move(eggs, 'evening', 'morning'); });
    expect(result.current.items[0].mealTime).toBe('evening');
    expect(result.current.recentIds.has('eggs')).toBe(true);
    const [path, body, method] = apiMock.mock.calls[0];
    expect(path).toBe('api/v1/health/nutrilist/eggs');
    expect(method).toBe('PUT');
    expect(body).toMatchObject({ mealTime: 'evening', expectedVersion: 3 });
    expect(reload).toHaveBeenCalled();
    expect(result.current.undo.label).toBe('Moved Eggs to Dinner');

    apiMock.mockResolvedValue({ versions: { eggs: 5 } });
    await act(async () => { await result.current.undo.run(); });
    const [, undoBody] = apiMock.mock.calls[1];
    // The undo carries the version the move produced, not the stale one.
    expect(undoBody).toMatchObject({ mealTime: 'morning', expectedVersion: 4 });
    expect(result.current.undo).toBeNull();
  });

  it('a failed move puts the row back and says why', async () => {
    apiMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const { result } = renderHook(() => useMealMoves({ items: [eggs], reload: () => {} }));
    await act(async () => { await result.current.move(eggs, 'evening', 'morning'); });
    expect(result.current.items[0].mealTime).toBe('morning');
    expect(result.current.error).toMatch(/^Couldn't move Eggs/);
    expect(result.current.undo).toBeNull();
  });

  it('a dish carries its ingredients along', async () => {
    apiMock.mockResolvedValue({ versions: {} });
    const dish = { uuid: 'g', kind: 'group', name: 'Salad', mealTime: 'morning', children: [{ uuid: 'c', parentId: 'g', mealTime: 'morning' }] };
    const items = [{ uuid: 'g', kind: 'group', name: 'Salad', mealTime: 'morning' }, { uuid: 'c', parentId: 'g', mealTime: 'morning' }];
    const { result } = renderHook(() => useMealMoves({ items, reload: () => {} }));
    await act(async () => { await result.current.move(dish, 'night', 'morning'); });
    expect(result.current.items.map(row => row.mealTime)).toEqual(['night', 'night']);
    expect(apiMock.mock.calls[0][1].expectedVersions).toEqual({ g: 1, c: 1 });
  });

  it('a whole meal moves as one action with one Undo that moves it all back', async () => {
    apiMock.mockImplementation(async path => ({ versions: { [path.split('/').pop()]: 9 } }));
    const a = { uuid: 'a', name: 'A', mealTime: 'night', version: 1 };
    const b = { uuid: 'b', name: 'B', mealTime: 'night', version: 1 };
    const { result } = renderHook(() => useMealMoves({ items: [a, b], reload: () => {} }));
    await act(async () => { await result.current.moveMeal([a, b], 'evening', 'night'); });
    expect(result.current.items.map(row => row.mealTime)).toEqual(['evening', 'evening']);
    expect(result.current.undo.label).toBe('Moved 2 foods from Snacks to Dinner');
    await act(async () => { await result.current.undo.run(); });
    const undoCalls = apiMock.mock.calls.slice(2);
    expect(undoCalls.map(([, body]) => [body.mealTime, body.expectedVersion])).toEqual([['night', 9], ['night', 9]]);
  });

  it('a meal move that fails midway keeps what moved and puts back the rest', async () => {
    apiMock.mockResolvedValueOnce({ versions: { a: 2 } }).mockRejectedValueOnce(new Error('conflict'));
    const a = { uuid: 'a', name: 'A', mealTime: 'night' };
    const b = { uuid: 'b', name: 'B', mealTime: 'night' };
    const { result } = renderHook(() => useMealMoves({ items: [a, b], reload: () => {} }));
    await act(async () => { await result.current.moveMeal([a, b], 'evening', 'night'); });
    expect(result.current.items.map(row => row.mealTime)).toEqual(['evening', 'night']);
    expect(result.current.error).toMatch(/^Couldn't move 1 of 2 foods/);
    expect(result.current.undo.label).toBe('Moved A to Dinner');
  });

  it('the highlight fades after its moment', async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue({ versions: {} });
      const { result } = renderHook(() => useMealMoves({ items: [eggs], reload: () => {} }));
      await act(async () => { await result.current.move(eggs, 'evening', 'morning'); });
      expect(result.current.recentIds.has('eggs')).toBe(true);
      act(() => { vi.advanceTimersByTime(MOVED_HIGHLIGHT_MS + 10); });
      expect(result.current.recentIds.has('eggs')).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
