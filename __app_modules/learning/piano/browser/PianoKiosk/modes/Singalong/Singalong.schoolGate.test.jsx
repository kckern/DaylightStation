import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Singalong } from './Singalong.jsx';

const h = vi.hoisted(() => ({
  read: vi.fn(), handler: null,
  log: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...args) => h.read(...args) }));
vi.mock('../../../../../../../frontend/src/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_topic, handler) => { h.handler = handler; },
}));
vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => h.log }),
}));
// Stop at the media/hardware boundary; the real Singalong route and entitlement
// consumer must prevent the browser/player subtree from mounting at all.
vi.mock('../Karaoke/Karaoke.jsx', () => ({ Karaoke: () => <div>Karaoke content</div> }));

function payload(overrides = {}) {
  const now = Date.now();
  return { items: [{
    capabilityId: 'piano.karaoke', gateId: 'school.all-learners-complete',
    subject: { kind: 'learner', id: 'kid-one' },
    period: { kind: 'interval', id: 'school-day:2026-11-18', startsAt: now - 1000, endsAt: now + 60000 },
    decision: 'granted', basisState: 'satisfied', degraded: false,
    validFrom: now - 1000, validUntil: now + 60000,
    ...overrides,
  }] };
}
function mount(path = '/piano/singalong') {
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes>
    <Route path="/piano/singalong/*" element={<Singalong />} />
  </Routes></MemoryRouter>);
}
async function settle() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  h.read.mockReset().mockResolvedValue({ items: [] });
  h.handler = null;
  h.log.info.mockClear(); h.log.warn.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('household school gate on the entire karaoke route', () => {
  it.each(['/piano/singalong', '/piano/singalong/plex:123'])(
    'blocks %s before loading media when no household decision exists', async (path) => {
      mount(path);
      await settle();
      expect(screen.queryByText('Karaoke content')).toBeNull();
      expect(screen.getByRole('status').textContent).toMatch(/everyone.*schoolwork/i);
    },
  );
  it.each([
    { decision: 'denied', basisState: 'unsatisfied' },
    { decision: 'granted', basisState: 'indeterminate', degraded: true },
    { decision: 'granted', basisState: 'not_applicable' },
    { validUntil: 1 },
    { validFrom: 4_102_444_800_000 },
    { capabilityId: 'piano.games' },
    { period: { kind: 'interval', id: 'fitness-week:2026-11-18', startsAt: 0, endsAt: 4_102_444_800_000 } },
    { period: { kind: 'interval', id: 'school-day:2026-11-17', startsAt: 0, endsAt: 1 } },
  ])('keeps karaoke closed for an unusable decision: %j', async (overrides) => {
    h.read.mockResolvedValue(payload(overrides));
    mount('/piano/singalong/plex:123'); await settle();
    expect(screen.queryByText('Karaoke content')).toBeNull();
  });
  it('opens from the shared entitlement without querying a selected profile or game pass', async () => {
    h.read.mockResolvedValue(payload()); mount('/piano/singalong/plex:123');
    await screen.findByText('Karaoke content');
    expect(h.read).toHaveBeenCalledWith('api/v1/entitlements?capabilityId=piano.karaoke&subjectKind=learner&periodKind=interval');
  });
  it('removes active playback on live denial and opens automatically when everyone completes', async () => {
    h.read.mockResolvedValue(payload()); mount(); await screen.findByText('Karaoke content');
    h.read.mockResolvedValue(payload({ decision: 'denied', basisState: 'unsatisfied' }));
    await act(async () => h.handler({ payload: { capabilityId: 'piano.karaoke' } }));
    await waitFor(() => expect(screen.queryByText('Karaoke content')).toBeNull());
    h.read.mockResolvedValue(payload());
    await act(async () => h.handler({ payload: { capabilityId: 'piano.karaoke' } }));
    await screen.findByText('Karaoke content');
  });
  it('closes when an entitlement refresh fails', async () => {
    h.read.mockResolvedValue(payload()); mount(); await screen.findByText('Karaoke content');
    h.read.mockRejectedValue(new Error('offline'));
    await act(async () => h.handler({ payload: { capabilityId: 'piano.karaoke' } }));
    await waitFor(() => expect(screen.queryByText('Karaoke content')).toBeNull());
    expect(screen.getByRole('status').textContent).toMatch(/unable to check/i);
  });
  it('polls after a missed live update', async () => {
    vi.useFakeTimers(); h.read.mockResolvedValue(payload()); mount(); await settle();
    expect(screen.getByText('Karaoke content')).toBeTruthy();
    h.read.mockResolvedValue(payload({ decision: 'denied', basisState: 'unsatisfied' }));
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(screen.queryByText('Karaoke content')).toBeNull();
  });
  it('expires a cached grant even while a new request hangs', async () => {
    vi.useFakeTimers(); h.read.mockResolvedValue(payload({ validUntil: Date.now() + 1000 }));
    mount(); await settle(); expect(screen.getByText('Karaoke content')).toBeTruthy();
    h.read.mockImplementation(() => new Promise(() => {}));
    await act(async () => vi.advanceTimersByTimeAsync(1001));
    expect(screen.queryByText('Karaoke content')).toBeNull();
  });
  it('closes immediately on live revocation even if the authoritative refresh hangs', async () => {
    h.read.mockResolvedValue(payload()); mount(); await screen.findByText('Karaoke content');
    h.read.mockImplementation(() => new Promise(() => {}));
    await act(async () => h.handler({ payload: { capabilityId: 'piano.karaoke', to: { decision: 'denied' } } }));
    expect(screen.queryByText('Karaoke content')).toBeNull();
  });
  it('refreshes schoolwork status when the screen becomes visible again', async () => {
    h.read.mockResolvedValue(payload()); mount(); await screen.findByText('Karaoke content');
    h.read.mockResolvedValue(payload({ decision: 'denied', basisState: 'unsatisfied' }));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(screen.queryByText('Karaoke content')).toBeNull());
    vi.restoreAllMocks();
  });
  it('ignores a late grant when a newer read has already denied access', async () => {
    let resolveOld;
    h.read.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    mount(); await settle();
    h.read.mockResolvedValue(payload({ decision: 'denied', basisState: 'unsatisfied' }));
    await act(async () => h.handler({ payload: { capabilityId: 'piano.karaoke' } }));
    await act(async () => resolveOld(payload()));
    expect(screen.queryByText('Karaoke content')).toBeNull();
  });

});
