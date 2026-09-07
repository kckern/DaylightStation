import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
const h = vi.hoisted(() => ({ pending: vi.fn(), claim: vi.fn(), dismiss: vi.fn(), event: null, reconnect: null }));
vi.mock('../schoolApi.js', () => ({ schoolApi: { bookScans: { pending: (...a) => h.pending(...a), claim: (...a) => h.claim(...a), dismiss: (...a) => h.dismiss(...a) } } }));
vi.mock('../../../hooks/useWebSocket.js', () => ({ useWebSocketSubscription: (_topic, cb) => { h.event = cb; } }));
vi.mock('../../../services/WebSocketService', () => ({ wsService: { onStatusChange: cb => { h.reconnect = cb; return () => {}; } } }));
vi.mock('../schoolLog.js', () => ({ schoolLog: { bookShelf: vi.fn(), bookShelfError: vi.fn() } }));
vi.mock('../../../lib/identity/ProfileAvatar.jsx', () => ({ default: () => <span>avatar</span> }));
import BookScanEntry from './BookScanEntry.jsx';
const intent = { id: 'scan1', screenId: 'portal', isbn13: '9780064400558', status: 'ready', book: { title: 'Hatchet' }, expiresAt: new Date(Date.now() + 300000).toISOString() };
const props = { screenId: 'portal', safe: true, roster: [{ id: 'child', name: 'Child' }], onLaunch: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); h.pending.mockResolvedValue({ ok: true, data: { intent } }); h.dismiss.mockResolvedValue({ ok: true }); h.claim.mockResolvedValue({ ok: true, data: { intentId: intent.id, launchTarget: { learnerId: 'child', bookGrant: 'returned-grant' }, bookEntry: { isbn13: intent.isbn13, book: intent.book } } }); });
describe('BookScanEntry real hook', () => {
  it('reads on mount/reconnect, ignores other targets and passes returned authority after avatar selection', async () => {
    render(<BookScanEntry {...props} />); await act(async () => {});
    expect(screen.getByRole('dialog', { name: 'This book was just scanned' })).toBeTruthy();
    expect(screen.getByText('Hatchet')).toBeTruthy();
    const count = h.pending.mock.calls.length;
    act(() => h.event({ type: 'school.book-scan', screenId: 'elsewhere' })); expect(h.pending).toHaveBeenCalledTimes(count);
    await act(async () => h.reconnect({ connected: true })); expect(h.pending.mock.calls.length).toBeGreaterThan(count);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Child' })));
    expect(h.claim).toHaveBeenCalledWith('scan1', { screenId: 'portal', learnerId: 'child' });
    expect(props.onLaunch).toHaveBeenCalledWith(expect.objectContaining({ bookGrant: 'returned-grant', bookEntry: expect.objectContaining({ intentId: 'scan1' }) }), 'child');
  });
  it.each(['quiz', 'book draft', 'save', 'keypad digits', 'launch card'])('defers during %s and offers when idle', async () => {
    const r = render(<BookScanEntry {...props} safe={false} />); await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByText('Book scanned — open when ready')).toBeTruthy();
    expect(h.claim).not.toHaveBeenCalled(); r.rerender(<BookScanEntry {...props} safe />); await act(async () => {});
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('ignores replay after dismissal and stale claims when active work starts', async () => {
    let finish; h.claim.mockImplementation(() => new Promise(r => { finish = r; }));
    const r = render(<BookScanEntry {...props} />); await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Child' }));
    r.rerender(<BookScanEntry {...props} safe={false} />);
    await act(async () => finish({ ok: true, data: { intentId: intent.id, launchTarget: { bookGrant: 'stale' }, bookEntry: {} } }));
    expect(props.onLaunch).not.toHaveBeenCalled();
    r.rerender(<BookScanEntry {...props} safe />); await act(async () => {});
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })));
    await act(async () => h.event({ type: 'school.book-scan', screenId: 'portal' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('does not read or preview in ordinary School tabs', async () => {
    render(<BookScanEntry {...props} screenId="browser" />); await act(async () => {});
    expect(h.pending).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('uses the shared clean book title and author presentation in the scan preview', async () => {
  h.pending.mockResolvedValue({ ok: true, data: { intent: { ...intent, book: { title: '<b>Hatchet</b> [electronic resource]', authors: ['Paulsen, Gary'] } } } });
  render(<BookScanEntry {...props} />); await act(async () => {});
  expect(screen.getByRole('heading', { name: 'Hatchet' })).toBeTruthy();
  expect(screen.getByText('Gary Paulsen')).toBeTruthy();
  expect(screen.queryByText(/electronic resource/)).toBeNull();
});
