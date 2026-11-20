import { describe, it, expect, vi } from 'vitest';
import { classifyTodo } from './classifyTodo.mjs';
import { itemFromWork } from '../domain/triageItem.mjs';

const DAY = 86400000;
const ASOF = Date.UTC(2026, 10, 19);
const item = itemFromWork({
  ref: { provider: 'tasks-a', accountId: 'sample', kind: 'task', id: 't1' }, title: 'Fix gate', description: null,
  status: { category: 'open', native: null }, containerRef: { id: 'l' }, due: { date: '2026-10-01' },
  createdAt: ASOF - 90 * DAY, modifiedAt: ASOF - 40 * DAY, version: '1',
});
const all = new Set(['complete', 'update_task', 'create_task']);
const ev = (c) => vi.fn(async () => ({ model: 'm', answers: { next: { type: 'choice', choice: c, confidence: 0.7, probabilities: {} } } }));
const keys = (p) => p.choices.map((c) => c.key);

describe('classifyTodo', () => {
  it('pre-completes an eligible todo without calling Jev', async () => {
    const evaluate = vi.fn();
    const p = await classifyTodo({ item, autoClose: { eligible: true, reason: 'exact_duplicate', duplicateOf: { id: 'other' } }, evaluate, capabilities: all, asOf: ASOF });
    expect(p.preDo).toEqual({ action: 'complete', reason: 'exact_duplicate' });
    expect(evaluate).not.toHaveBeenCalled();
    expect(keys(p)).toEqual(['do_week', 'push', 'drop', 'shrink']);
    expect(p.suggested).toBe('drop');
    expect(p.why).toBe('Duplicate of \u201ct0\u201d'.replace('t0', 'other'));
  });
  it('describes long-overdue auto-close in plain words', async () => {
    const p = await classifyTodo({ item, autoClose: { eligible: true, reason: 'long_overdue' }, evaluate: vi.fn(), capabilities: all, asOf: ASOF });
    expect(p.why).toBe('Overdue 49 days and untouched for 40 days');
  });
  it('falls through to Jev when auto-close is eligible but complete is unavailable', async () => {
    const evaluate = ev('push');
    const p = await classifyTodo({ item, autoClose: { eligible: true, reason: 'long_overdue' }, evaluate, capabilities: new Set(['update_task']), asOf: ASOF });
    expect(p.preDo).toBeNull();
    expect(evaluate).toHaveBeenCalled();
    expect(keys(p)).toEqual(['do_week', 'push']);
  });
  it('single action: suggests it, but never suggests drop alone', async () => {
    const evaluate = vi.fn();
    const a = await classifyTodo({ item, evaluate, capabilities: new Set(['create_task']), asOf: ASOF });
    expect(a.suggested).toBe('shrink');
    const b = await classifyTodo({ item, evaluate, capabilities: new Set(['complete']), asOf: ASOF });
    expect(b.suggested).toBeNull();
    expect(keys(b)).toEqual(['drop']);
    expect(evaluate).not.toHaveBeenCalled();
  });
  it('degrades on a malformed or out-of-set answer', async () => {
    const bad = vi.fn(async () => ({ answers: { next: { type: 'choice', choice: 'nuke', confidence: 0.9 } } }));
    const p = await classifyTodo({ item, evaluate: bad, capabilities: all, asOf: ASOF });
    expect(p.why).toBe('decision unavailable');
    const none = await classifyTodo({ item, evaluate: vi.fn(async () => ({})), capabilities: all, asOf: ASOF });
    expect(none.suggested).toBeNull();
  });
  it('pluralises and handles zero days', async () => {
    const mk = (due, mod) => itemFromWork({ ...item.facts, due, modifiedAt: mod });
    const one = await classifyTodo({ item: mk({ date: '2026-11-18' }, ASOF), evaluate: ev('push'), capabilities: all, asOf: ASOF });
    expect(one.why).toBe('Overdue 1 day');
    const idle0 = await classifyTodo({ item: mk(null, ASOF), evaluate: ev('push'), capabilities: all, asOf: ASOF });
    expect(idle0.why).toBe('Touched today');
  });
  it('keeps suggested within choices for every output', async () => {
    const outs = [
      await classifyTodo({ item, autoClose: { eligible: true, reason: 'long_overdue' }, evaluate: vi.fn(), capabilities: all, asOf: ASOF }),
      await classifyTodo({ item, evaluate: ev('drop'), capabilities: new Set(['complete', 'create_task']), asOf: ASOF }),
      await classifyTodo({ item, evaluate: ev('push'), capabilities: new Set(), asOf: ASOF }),
      await classifyTodo({ item, evaluate: vi.fn().mockRejectedValue(new Error('x')), capabilities: all, asOf: ASOF }),
      await classifyTodo({ item, evaluate: vi.fn(), capabilities: new Set(['complete']), asOf: ASOF }),
    ];
    for (const p of outs) expect(p.suggested === null || keys(p).includes(p.suggested)).toBe(true);
  });
  it('asks Jev and offers all four choices', async () => {
    const p = await classifyTodo({ item, autoClose: { eligible: false }, evaluate: ev('push'), capabilities: all, asOf: ASOF });
    expect(keys(p)).toEqual(['do_week', 'push', 'drop', 'shrink']);
    expect(p.suggested).toBe('push');
    expect(p.preDo).toBeNull();
    expect(p.why).toBe('Overdue 49 days');
  });
  it('omits drop without complete; push/do_week without update_task; shrink without create_task', async () => {
    const a = await classifyTodo({ item, evaluate: ev('push'), capabilities: new Set(['update_task', 'create_task']), asOf: ASOF });
    expect(keys(a)).toEqual(['do_week', 'push', 'shrink']);
    const b = await classifyTodo({ item, evaluate: ev('drop'), capabilities: new Set(['complete', 'create_task']), asOf: ASOF });
    expect(keys(b)).toEqual(['drop', 'shrink']);
  });
  it('returns an empty card when nothing is available', async () => {
    const evaluate = vi.fn();
    const p = await classifyTodo({ item, evaluate, capabilities: new Set(), asOf: ASOF });
    expect(p.choices).toEqual([]);
    expect(p.why).toBe('no actions available');
    expect(evaluate).not.toHaveBeenCalled();
  });
  it('degrades when evaluate rejects', async () => {
    const p = await classifyTodo({ item, evaluate: vi.fn().mockRejectedValue(new Error('x')), capabilities: all, asOf: ASOF });
    expect(p).toMatchObject({ why: 'decision unavailable', preDo: null, suggested: null });
    expect(p.choices.length).toBe(4);
  });
});
