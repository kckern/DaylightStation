import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { projectPortion } from './portionPreview.js';
import { usePortionDraft } from './usePortionDraft.js';
import { foodPortion } from '@shared-contracts/health/foodQuantity.mjs';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));
const date = '2026-09-05';
const chia = { uuid: 'chia', version: 1, date, kind: 'food', mealTime: 'afternoon', grams: 14, calories: 70, protein: 3, carbs: 4.5, fat: 4, settled: false };
const yogurt = { uuid: 'yogurt', version: 2, date, kind: 'food', mealTime: 'afternoon', grams: null, amount: 170, unit: 'ml', calories: 160, protein: 25, carbs: 6, fat: 3.5, originalQuantity: { amount: 1, unit: 'g' } };
const scale = { uuid: 'scale', kind: 'food', mealTime: 'afternoon', grams: 458, calories: 641, protein: null, carbs: null, fat: null };
const dinner = { uuid: 'dinner', kind: 'food', mealTime: 'evening', calories: 668 };
const items = [chia, yogurt, scale, dinner];
const budget = { food: 1539, remaining: 596, macros: { protein: 65 } };
const day = () => ({ items, budget, reload: vi.fn() });

describe('shared portion draft', () => {
  it('previews a macro correction and sends one semantic numeric command', async () => {
    api.mockReset().mockResolvedValue({ data: { version: 2 }, versions: { chia: 2 } });
    const { result } = renderHook(() => usePortionDraft(day(), date));
    act(() => { result.current.control.begin(chia, 'protein'); result.current.control.preview(5); });
    expect(result.current.items[0]).toMatchObject({ grams: 14, protein: 5, calories: 78, carbs: 4.5 });
    expect(result.current.budget.food).toBe(1547);
    expect(api).not.toHaveBeenCalled();
    await act(() => result.current.control.commit());
    expect(api.mock.calls[0][1]).toMatchObject({ numericEdit: { field: 'protein', value: 5 }, expectedVersions: { chia: 1 } });
  });
  it('projects the incident sequence into row, meal, day and remaining totals', () => {
    const result = projectPortion(items, budget, { row: chia, portion: { value: 28, unit: 'g' } });
    expect(result.items[0]).toMatchObject({ grams: 28, calories: 140, protein: 6, settled: false });
    expect(result.items.filter(row => row.mealTime === 'afternoon').reduce((n, row) => n + row.calories, 0)).toBe(941);
    expect(result.budget).toMatchObject({ food: 1609, remaining: 526, macros: { protein: 68 } });
    expect(chia.grams).toBe(14);
  });
  it('scales volume without inventing grams and preserves unknown nutrients', () => {
    expect(foodPortion(yogurt)).toEqual({ value: 170, unit: 'ml' });
    const result = projectPortion([yogurt, scale], null, { row: yogurt, portion: { value: 340, unit: 'ml' } });
    expect(result.items[0]).toMatchObject({ grams: null, amount: 340, calories: 320 });
    const next = projectPortion([scale], null, { row: scale, portion: { value: 916, unit: 'g' } });
    expect(next.items[0]).toMatchObject({ calories: 1282, protein: null, carbs: null, fat: null });
  });
  it('keeps a group non-additive and scales its children', () => {
    const children = [{ ...chia, parentId: 'group' }, { ...chia, uuid: 'chia2', parentId: 'group' }];
    const group = { uuid: 'group', kind: 'group', grams: 28, calories: 0, children };
    const result = projectPortion([group, ...children], { food: 140, remaining: 100 }, { row: group, portion: { value: 56, unit: 'g' } });
    expect(result.budget).toMatchObject({ food: 280, remaining: -40 });
    expect(result.items.map(row => row.calories)).toEqual([0, 140, 140]);
  });
  it('does not write during preview or cancel; preserves the gesture baseline through polling', () => {
    api.mockReset();
    const { result, rerender } = renderHook(props => usePortionDraft(props, date), { initialProps: day() });
    act(() => { result.current.control.begin(chia); result.current.control.preview(28); });
    rerender({ ...day(), items: [{ ...chia, grams: 21, calories: 105, version: 2 }, yogurt, scale, { ...dinner, calories: 700 }], budget: { ...budget, food: 1606, remaining: 529 } });
    expect(result.current.items[0].calories).toBe(140);
    expect(result.current.items[3].calories).toBe(700);
    expect(result.current.budget.food).toBe(1641);
    expect(api).not.toHaveBeenCalled();
    act(() => result.current.control.cancel());
    expect(result.current.items[0].grams).toBe(21);
    expect(api).not.toHaveBeenCalled();
  });
  it('deduplicates release and retains the overlay until the matching snapshot arrives', async () => {
    let resolve;
    api.mockReset().mockImplementation(() => new Promise(done => { resolve = done; }));
    const props = day();
    const { result, rerender } = renderHook(props => usePortionDraft(props, date), { initialProps: props });
    act(() => { result.current.control.begin(chia); result.current.control.preview(28); });
    let request;
    act(() => { request = result.current.control.commit(); result.current.control.commit(); });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][1]).toMatchObject({ portion: { value: 28, unit: 'g' }, expectedVersion: 1, expectedVersions: { chia: 1 } });
    await act(async () => { resolve({ data: { ...chia, version: 2 }, versions: { chia: 2 } }); await request; });
    expect(result.current.items[0].grams).toBe(28);
    expect(props.reload).toHaveBeenCalledTimes(1);
    rerender({ ...props, items: [{ ...chia, grams: 28, calories: 140, version: 2 }, ...items.slice(1)], budget: { ...budget, food: 1609, remaining: 526 } });
    expect(result.current.control.draft).toBeNull();
    expect(result.current.budget.food).toBe(1609);
  });
  it('retains a conflict, then explicitly rebases the intended quantity with a new command ID', async () => {
    api.mockReset().mockRejectedValueOnce(Object.assign(new Error('changed'), { status: 409 }));
    const { result } = renderHook(() => usePortionDraft(day(), date));
    act(() => { result.current.control.begin(chia); result.current.control.preview(28); });
    await act(() => result.current.control.commit());
    expect(result.current.control.draft).toMatchObject({ status: 'error', conflict: true, portion: { value: 28 } });
    const firstId = api.mock.calls[0][1].operationId;
    api.mockResolvedValueOnce({ items: [{ ...chia, grams: 21, version: 2 }] })
      .mockResolvedValueOnce({ data: { ...chia, version: 3 }, versions: { chia: 3 } });
    await act(() => result.current.control.retry());
    expect(api.mock.calls[2][1]).toMatchObject({ portion: { value: 28, unit: 'g' }, expectedVersion: 2 });
    expect(api.mock.calls[2][1].operationId).not.toBe(firstId);
  });
  it('refuses to rebase a group with unseen children', async () => {
    api.mockReset().mockRejectedValueOnce(Object.assign(new Error('changed'), { status: 409 }));
    const child = { ...chia, parentId: 'group' };
    const group = { uuid: 'group', kind: 'group', version: 1, grams: 14, calories: 0, children: [child] };
    const { result } = renderHook(() => usePortionDraft({ ...day(), items: [group, child] }, date));
    act(() => { result.current.control.begin(group); result.current.control.preview(28); });
    await act(() => result.current.control.commit());
    api.mockResolvedValueOnce({ items: [group, child, { ...child, uuid: 'new' }] });
    await act(() => result.current.control.retry());
    expect(api).toHaveBeenCalledTimes(2);
    expect(result.current.control.draft.error).toContain('Group membership changed');
  });
  it('discards a previous day draft and does not resurrect it when an in-flight save returns', async () => {
    let resolve;
    api.mockReset().mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(selected => usePortionDraft(day(), selected), { initialProps: date });
    act(() => { result.current.control.begin(chia); result.current.control.preview(28); });
    let request;
    act(() => { request = result.current.control.commit(); });
    rerender('2026-09-06');
    expect(result.current.control.draft).toBeNull();
    act(() => { expect(result.current.control.begin(yogurt)).toBe(true); });
    await act(async () => { resolve({ data: { ...chia, version: 2 }, versions: { chia: 2 } }); await request; });
    expect(result.current.control.draft.row.uuid).toBe('yogurt');
  });
});
