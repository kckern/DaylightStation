import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

import { applyFrozenOrder, orderSnapshot, useFlipMoves, FLIP_CLASS } from './sectionOrder.js';
import { LogTable } from './LogTable.jsx';
import { PortionContext } from './usePortionDraft.js';

const entry = (uuid, children = []) => ({ row: { uuid }, children: children.map(id => ({ uuid: id })) });
const keys = list => list.map(e => e.row.uuid);

describe('applyFrozenOrder', () => {
  it('puts a re-sorted list back in the snapshot order, children included', () => {
    const before = [entry('a'), entry('g', ['x', 'y']), entry('b')];
    const snap = orderSnapshot(before);
    const resorted = [entry('b'), entry('a'), entry('g', ['y', 'x'])];
    const out = applyFrozenOrder(resorted, snap);
    expect(keys(out)).toEqual(['a', 'g', 'b']);
    expect(out[1].children.map(c => c.uuid)).toEqual(['x', 'y']);
  });

  it('new entries go after the frozen ones; no snapshot means no change', () => {
    const snap = orderSnapshot([entry('a'), entry('b')]);
    expect(keys(applyFrozenOrder([entry('new'), entry('b'), entry('a')], snap))).toEqual(['a', 'b', 'new']);
    const list = [entry('z')];
    expect(applyFrozenOrder(list, null)).toBe(list);
  });
});

describe('LogTable — no reordering under a live drag', () => {
  afterEach(cleanup);
  const rowsWith = (appleKcal) => new Map([['evening', [
    { uuid: 'apple', name: 'Apple', mealTime: 'evening', calories: appleKcal, grams: 100, unit: 'g', amount: 100 },
    { uuid: 'rice', name: 'Rice', mealTime: 'evening', calories: 300, grams: 200, unit: 'g', amount: 200 },
  ]]]);
  const names = container => [...container.querySelectorAll('.health-row-name')].map(n => n.getAttribute('aria-label'));
  const view = (byBucket, draft) => <MantineProvider><PortionContext.Provider value={draft ? { draft } : null}>
    <LogTable date="2026-09-06" byBucket={byBucket} onRowTap={() => {}} />
  </PortionContext.Provider></MantineProvider>;

  it('holds the order during the draft, re-sorts once it ends', () => {
    const { container, rerender } = render(view(rowsWith(100), null));
    expect(names(container)).toEqual(['Edit Rice', 'Edit Apple']);
    const draft = { row: { uuid: 'apple' }, status: 'editing' };
    rerender(view(rowsWith(100), draft));
    // The preview makes the apple the heaviest — it must not jump to the top.
    rerender(view(rowsWith(900), draft));
    expect(names(container)).toEqual(['Edit Rice', 'Edit Apple']);
    rerender(view(rowsWith(900), { ...draft, status: 'saving' }));
    expect(names(container)).toEqual(['Edit Rice', 'Edit Apple']);
    rerender(view(rowsWith(900), null));
    expect(names(container)).toEqual(['Edit Apple', 'Edit Rice']);
  });
});

describe('useFlipMoves', () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; vi.restoreAllMocks(); });
  const setup = () => {
    const root = document.createElement('div');
    const a = document.createElement('div'); a.dataset.entryKey = 'a';
    const b = document.createElement('div'); b.dataset.entryKey = 'b';
    root.append(a, b);
    const tops = new Map([[root, 0], [a, 0], [b, 30]]);
    for (const node of [root, a, b]) node.getBoundingClientRect = () => ({ top: tops.get(node) });
    return { root, a, b, tops };
  };

  it('translates moved rows from their old place and animates them home', () => {
    window.matchMedia = () => ({ matches: false });
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { cb(); return 1; });
    const { root, a, b, tops } = setup();
    const { rerender } = renderHook(({ order }) => useFlipMoves({ current: root }, order), { initialProps: { order: 'a|b' } });
    tops.set(a, 30); tops.set(b, 0); // swapped
    const seen = [];
    raf.mockImplementation(cb => { seen.push([a.style.transform, b.style.transform]); cb(); return 1; });
    rerender({ order: 'b|a' });
    expect(seen[0]).toEqual(['translateY(-30px)', 'translateY(30px)']);
    expect(a.classList.contains(FLIP_CLASS)).toBe(true);
    expect(a.style.transform).toBe('');
  });

  it('does nothing under prefers-reduced-motion', () => {
    window.matchMedia = query => ({ matches: query === '(prefers-reduced-motion: reduce)' });
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { root, a, b, tops } = setup();
    const { rerender } = renderHook(({ order }) => useFlipMoves({ current: root }, order), { initialProps: { order: 'a|b' } });
    tops.set(a, 30); tops.set(b, 0);
    rerender({ order: 'b|a' });
    expect(a.style.transform).toBe('');
    expect(a.classList.contains(FLIP_CLASS)).toBe(false);
    expect(raf).not.toHaveBeenCalled();
  });
});
