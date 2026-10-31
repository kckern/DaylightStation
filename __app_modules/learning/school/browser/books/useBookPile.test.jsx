import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const h = vi.hoisted(() => ({ pile: vi.fn(), filePile: vi.fn(), moveCard: vi.fn(), removeCard: vi.fn(), event: null, reconnect: null }));
vi.mock("../schoolApi.js", () => ({ schoolApi: { bookScans: {
  pile: (...a) => h.pile(...a), filePile: (...a) => h.filePile(...a), moveCard: (...a) => h.moveCard(...a), removeCard: (...a) => h.removeCard(...a),
} } }));
vi.mock("../../../../../frontend/src/hooks/useWebSocket.js", () => ({ useWebSocketSubscription: (_topic, cb) => { h.event = cb; } }));
vi.mock("../../../../../frontend/src/services/WebSocketService.js", () => ({ wsService: { onStatusChange: cb => { h.reconnect = cb; return () => {}; } } }));
vi.mock("../schoolLog.js", () => ({ schoolLog: { bookShelf: vi.fn(), bookShelfError: vi.fn() } }));
import { useBookPile } from "./useBookPile.js";

const card = (over = {}) => ({ id: 'c1', isbn13: '9780064400558', status: 'ready', state: 'unfiled', duplicates: 0, book: { title: 'Hatchet' }, ...over });
const pileOf = (over = {}) => ({ screenId: 'portal', live: true, reader: null, quietGapMs: 120000, lastScanAt: new Date().toISOString(), cards: [], ...over });
const ok = (pile) => ({ ok: true, data: { pile } });

beforeEach(() => { vi.clearAllMocks(); h.pile.mockResolvedValue(ok(pileOf())); h.filePile.mockResolvedValue(ok(pileOf())); });
afterEach(() => { vi.useRealTimers(); });

describe('useBookPile', () => {
  it('refreshes on a school.book-scan message for this screen', async () => {
    renderHook(() => useBookPile({ screenId: 'portal' })); await act(async () => {});
    const count = h.pile.mock.calls.length;
    await act(async () => h.event({ type: 'school.book-scan', screenId: 'elsewhere' }));
    expect(h.pile).toHaveBeenCalledTimes(count);
    await act(async () => h.event({ type: 'school.book-scan', screenId: 'portal' }));
    expect(h.pile).toHaveBeenCalledTimes(count + 1);
  });

  it('auto-files new unfiled cards to the sticky reader', async () => {
    h.pile.mockResolvedValue(ok(pileOf({ reader: 'child-a', cards: [card()] })));
    h.filePile.mockResolvedValue(ok(pileOf({ reader: 'child-a', cards: [card({ state: 'filed', learnerId: 'child-a' })] })));
    renderHook(() => useBookPile({ screenId: 'portal' })); await act(async () => {});
    expect(h.filePile).toHaveBeenCalledTimes(1);
    expect(h.filePile).toHaveBeenCalledWith({ screenId: 'portal', learnerId: 'child-a' });
  });

  it('does not auto-file a loading card, then files it once it is ready', async () => {
    h.pile.mockResolvedValue(ok(pileOf({ reader: 'child-a', cards: [card({ status: 'loading' })] })));
    renderHook(() => useBookPile({ screenId: 'portal' })); await act(async () => {});
    expect(h.filePile).not.toHaveBeenCalled();
    h.pile.mockResolvedValue(ok(pileOf({ reader: 'child-a', cards: [card()] })));
    await act(async () => h.event({ type: 'school.book-scan', screenId: 'portal' }));
    expect(h.filePile).toHaveBeenCalledTimes(1);
  });

  it('stands down while scoped', async () => {
    h.pile.mockResolvedValue(ok(pileOf({ reader: 'child-a', cards: [card()] })));
    renderHook(() => useBookPile({ screenId: 'portal', scopeLearnerId: 'child-b' })); await act(async () => {});
    expect(h.filePile).not.toHaveBeenCalled();
  });

  it('polls every 1.5s while any card is loading', async () => {
    vi.useFakeTimers();
    h.pile.mockResolvedValue(ok(pileOf({ cards: [card({ status: 'loading' })] })));
    renderHook(() => useBookPile({ screenId: 'portal' })); await act(async () => {});
    const count = h.pile.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(h.pile.mock.calls.length).toBeGreaterThan(count);
  });

  it('a face tap files and returns the new pile', async () => {
    h.pile.mockResolvedValue(ok(pileOf({ cards: [card()] })));
    h.filePile.mockResolvedValue(ok(pileOf({ reader: 'child-a', cards: [card({ state: 'filed', learnerId: 'child-a' })] })));
    const { result } = renderHook(() => useBookPile({ screenId: 'portal' })); await act(async () => {});
    expect(result.current.unfiled).toHaveLength(1);
    await act(async () => result.current.file('child-a'));
    expect(result.current.reader).toBe('child-a');
    expect(result.current.unfiled).toHaveLength(0);
  });

  it('is disabled outside the panel surface', async () => {
    const { result } = renderHook(() => useBookPile({ screenId: null })); await act(async () => {});
    expect(result.current.enabled).toBe(false);
    expect(h.pile).not.toHaveBeenCalled();
  });
});
