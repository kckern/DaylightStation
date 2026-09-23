import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const infoLog = vi.fn();
vi.mock('../../../lib/ui/createAppLogger.js', () => {
  const log = { debug: vi.fn(), info: (...a) => infoLog(...a), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
  log.child = () => log;
  return { createAppLogger: () => log };
});

import {
  addedRowIds, trackAddFlow, noteVisibleRows, resetAddFlow, useAddedRowHighlight,
  ADD_VISIBLE_TIMEOUT_MS, ADDED_HIGHLIGHT_MS,
} from './addFlow.js';

const flows = () => infoLog.mock.calls.filter(([e]) => e === 'add.flow').map(([, d]) => d);

describe('addedRowIds', () => {
  it('reads quick-add, sentence and replay shapes, de-duplicated', () => {
    expect(addedRowIds({ logged: true, item: { uuid: 'q1' } })).toEqual(['q1']);
    expect(addedRowIds({ committed: true, entryIds: ['a', 'b'], items: [{ uuid: 'a' }, { id: 'c' }] })).toEqual(['a', 'b', 'c']);
    expect(addedRowIds(null)).toEqual([]);
    expect(addedRowIds({ items: [{}] })).toEqual([]);
  });
});

describe('trackAddFlow', () => {
  beforeEach(() => { infoLog.mockReset(); resetAddFlow(); });
  afterEach(() => vi.useRealTimers());

  it('logs add.flow once every id is on the day, with both timings', async () => {
    const done = trackAddFlow({ ids: ['a', 'b'], bucket: 'morning', surface: 'inline', kind: 'sentence', submitToCommittedMs: 4210.4, at: 1000 });
    noteVisibleRows([{ uuid: 'a' }], 1100);
    expect(flows()).toHaveLength(0);
    noteVisibleRows([{ uuid: 'a' }, { uuid: 'b' }, { uuid: 'z' }], 1350);
    await expect(done).resolves.toBe(true);
    expect(flows()).toEqual([{ bucket: 'morning', surface: 'inline', kind: 'sentence', submitToCommittedMs: 4210, rows: 2, committedToVisibleMs: 350 }]);
    noteVisibleRows([{ uuid: 'a' }, { uuid: 'b' }], 2000);
    expect(flows()).toHaveLength(1);
  });

  it('with no ids it logs at once with no visible time', async () => {
    await expect(trackAddFlow({ ids: [], bucket: null, surface: 'inline', kind: 'pick', submitToCommittedMs: 80 })).resolves.toBe(false);
    expect(flows()).toEqual([{ bucket: null, surface: 'inline', kind: 'pick', submitToCommittedMs: 80, rows: 0, committedToVisibleMs: null }]);
  });

  it('gives up after the timeout and says so', async () => {
    vi.useFakeTimers();
    const done = trackAddFlow({ ids: ['never'], bucket: 'evening', surface: 'inline', kind: 'pick', submitToCommittedMs: 90 });
    vi.advanceTimersByTime(ADD_VISIBLE_TIMEOUT_MS);
    await expect(done).resolves.toBe(false);
    expect(flows()[0]).toMatchObject({ committedToVisibleMs: null, timedOut: true });
  });
});

describe('useAddedRowHighlight', () => {
  beforeEach(() => { infoLog.mockReset(); resetAddFlow(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('highlights a new row from when it appears, then lets it go', () => {
    const { result, rerender } = renderHook(({ rows }) => useAddedRowHighlight(rows), { initialProps: { rows: [{ uuid: 'old' }] } });
    act(() => { trackAddFlow({ ids: ['new'], bucket: 'morning', surface: 'inline', kind: 'pick', submitToCommittedMs: 50 }); });
    expect(result.current.size).toBe(0);
    rerender({ rows: [{ uuid: 'old' }, { uuid: 'new' }] });
    expect([...result.current]).toEqual(['new']);
    act(() => { vi.advanceTimersByTime(ADDED_HIGHLIGHT_MS); });
    expect(result.current.size).toBe(0);
    rerender({ rows: [{ uuid: 'old' }, { uuid: 'new' }] });
    expect(result.current.size).toBe(0);
  });
});
