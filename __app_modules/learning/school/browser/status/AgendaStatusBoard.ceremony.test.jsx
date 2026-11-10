import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ ws: [], cues: [], unlocks: [] }));
vi.mock("../schoolApi.js", () => ({
  schoolApi: { agendaPreview: vi.fn(), teacherDay: vi.fn(), stateGates: vi.fn(), earningsRoster: vi.fn(), wallet: vi.fn(), economyBank: vi.fn() },
}));
vi.mock("../../../../../frontend/src/hooks/useWebSocket.js", () => ({
  useWebSocketSubscription: (topic, cb) => { h.ws.push({ topic, cb }); },
}));
vi.mock("../../../../../frontend/src/lib/economy/coinCeremonyAudio.js", () => ({
  playCoinCue: (opts) => { h.cues.push(opts); return true; },
  installCoinCueUnlock: (target, opts) => { h.unlocks.push(opts); return () => {}; },
}));
import { schoolApi } from "../schoolApi.js";
import AgendaStatusBoard from "./AgendaStatusBoard.jsx";
import { useCoinCeremony, __resetCoinBaselineForTest } from "./useCoinCeremony.js";
import { BOARD_CACHE_KEY } from "./boardCache.js";

const DAY = '2026-10-21';
const WEEK = { from: '2026-10-19', to: '2026-10-25' };
const KIDS = [{ id: 'test-learner', name: 'Alpha' }, { id: 'test-learner-2', name: 'Beta' }];
const priced = (learnerId, silver, week = WEEK) => ({
  learnerId, totals: { silver, gems: 0 }, pending: { silver: 0, gems: 0 }, windows: { school: week },
  lines: [{ status: 'earned', ruleId: 'green-day', label: 'Green day', amount: { silver, gems: 0 } }],
});
const roster = (...learners) => ({ ok: true, status: 200, data: { windows: { school: WEEK }, learners } });
// No burst wait in these tests: the window is pinned in coinCeremonyModel.test.js.
const NOW = { coalesceWindowMs: 0 };
// The ceremony watches EARNING entries in the bank history; the card's figure
// is the week's projection. `mint` sets what the bank holds: a higher silver
// than before records a payout entry for the difference, a lower one is a
// spend (no entry). `deposit` raises the balance with a non-earning line.
const bank = {};
let seq = 0;
const lineOf = (source, delta, id = null) => ({ ids: [id ?? `txn-${++seq}`], source, kind: source, legs: [{ currency: 'silver', delta }], text: `${delta} silver`, at: '2026-10-21T10:00:00Z' });
const mint = (map) => {
  for (const [id, n] of Object.entries(map)) {
    const cur = bank[id] ?? { silver: n, lines: [] };
    if (n > cur.silver) cur.lines.unshift(lineOf('payout', n - cur.silver));
    cur.silver = n;
    bank[id] = cur;
  }
};
const deposit = (id, n) => { bank[id].lines.unshift(lineOf('deposit', n)); bank[id].silver += n; };
const bankRead = (id) => (id in bank
  ? { ok: true, status: 200, data: { history: bank[id].lines, balances: { silver: bank[id].silver, gold: 0 } } }
  : { ok: false, status: 0, data: null });
const silverShown = (n) => screen.queryByRole('img', { name: `${n} silver earned this week` });
const poke = async (learnerId = 'test-learner') => {
  await act(async () => h.ws.filter((x) => x.topic === 'school').at(-1).cb({ event: 'story-read', learnerId, studyDay: DAY }));
};
// The hook promotes on a setTimeout, so an ABSENCE of a pop is only proven
// after real time has passed (a bare `act` would pass vacuously).
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

beforeEach(() => {
  localStorage.clear();
  __resetCoinBaselineForTest();
  h.ws.length = 0;
  h.cues.length = 0;
  h.unlocks.length = 0;
  vi.clearAllMocks();
  for (const k of Object.keys(bank)) delete bank[k];
  seq = 0;
  schoolApi.economyBank.mockImplementation(async (id) => bankRead(id));
  schoolApi.wallet.mockResolvedValue({ ok: false, status: 0, data: null });
  schoolApi.stateGates.mockResolvedValue({ ok: false, status: 0, data: null });
  schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
  schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [{ subject: 'math', next: { unitId: 'math.01' } }], entries: [{ unitId: 'math.01', subject: 'math' }] } });
});

describe('the coin ceremony on the board', () => {
  it('the first read is a baseline, not news, even when the cached figure was lower', async () => {
    localStorage.setItem(BOARD_CACHE_KEY, JSON.stringify({
      studyDay: DAY, learners: {}, rings: {},
      earnings: { 'test-learner': { silver: 10, gems: 0, ...WEEK } },
    }));
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 12))); mint({ 'test-learner': 12 });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={NOW} />);
    await waitFor(() => expect(silverShown(12)).toBeTruthy());
    await settle();
    expect(screen.queryByTestId('coin-ceremony')).toBeNull();
    expect(h.cues).toHaveLength(0);
  });

  it('a rise pops +N, the week total, the face and name, and plays the coin once', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 12))); mint({ 'test-learner': 12 });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={NOW} />);
    await waitFor(() => expect(silverShown(12)).toBeTruthy());
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 15))); mint({ 'test-learner': 15 });
    await poke();
    const pop = await screen.findByTestId('coin-ceremony');
    expect(within(pop).getByText('+3')).toBeTruthy();
    expect(within(pop).getByText('15 silver')).toBeTruthy();
    expect(within(pop).getByText('Alpha')).toBeTruthy();
    // The pop sits inside the board pane, never beside it.
    expect(screen.getByTestId('agenda-status-board').contains(pop)).toBe(true);
    await settle();
    expect(h.cues).toEqual([{ sound: 'school/_ux/coin.mp3', volume: 0.8 }]);
    expect(h.unlocks).toEqual([{ sound: 'school/_ux/coin.mp3' }]);
  });

  it('a merged rise for the child on screen updates the pop without replaying the coin', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 12))); mint({ 'test-learner': 12 });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={NOW} />);
    await waitFor(() => expect(silverShown(12)).toBeTruthy());
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 15))); mint({ 'test-learner': 15 });
    await poke();
    await screen.findByTestId('coin-ceremony');
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 17))); mint({ 'test-learner': 17 });
    await poke();
    await waitFor(() => expect(within(screen.getByTestId('coin-ceremony')).getByText('+5')).toBeTruthy());
    expect(within(screen.getByTestId('coin-ceremony')).getByText('17 silver')).toBeTruthy();
    await settle();
    expect(h.cues).toHaveLength(1);
  });

  it('a drop in the bank is not celebrated', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 12))); mint({ 'test-learner': 12 });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={NOW} />);
    await waitFor(() => expect(silverShown(12)).toBeTruthy());
    await settle();
    mint({ 'test-learner': 8 });
    await poke();
    await waitFor(() => expect(schoolApi.economyBank.mock.calls.length).toBeGreaterThanOrEqual(3));
    await settle();
    expect(screen.queryByTestId('coin-ceremony')).toBeNull();
    expect(h.cues).toHaveLength(0);
  });

  it('a projected-but-unminted rise moves the card figure and produces no ceremony', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 12))); mint({ 'test-learner': 12 });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={NOW} />);
    await waitFor(() => expect(silverShown(12)).toBeTruthy());
    await settle();
    // The week now prices 5 more silver; the bank has not minted it.
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 17)));
    await poke();
    await waitFor(() => expect(silverShown(17)).toBeTruthy());
    await settle();
    expect(screen.queryByTestId('coin-ceremony')).toBeNull();
    expect(h.cues).toHaveLength(0);
  });

  it('a mint announced by coins-changed pops exactly once, with the minted total', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 17))); mint({ 'test-learner': 12 });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={NOW} />);
    await waitFor(() => expect(silverShown(17)).toBeTruthy());
    await settle();
    mint({ 'test-learner': 15 });
    await act(async () => h.ws.filter((x) => x.topic === 'school').at(-1).cb({ event: 'coins-changed', learnerId: 'test-learner' }));
    const pop = await screen.findByTestId('coin-ceremony', {}, { timeout: 4000 });
    expect(within(pop).getByText('+3')).toBeTruthy();
    expect(within(pop).getByText('15 silver')).toBeTruthy();
    // A further read with no new mint is no news.
    await poke();
    await settle();
    expect(h.cues).toHaveLength(1);
  });

  it('two children rising together pop one at a time', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 12), priced('test-learner-2', 4))); mint({ 'test-learner': 12, 'test-learner-2': 4 });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={NOW} />);
    await waitFor(() => expect(silverShown(12)).toBeTruthy());
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 14), priced('test-learner-2', 9))); mint({ 'test-learner': 14, 'test-learner-2': 9 });
    await poke();
    const first = await screen.findByTestId('coin-ceremony');
    expect(within(first).getByText('Alpha')).toBeTruthy();
    expect(within(first).getByText('+2')).toBeTruthy();
    fireEvent.click(within(first).getByRole('button'));
    await waitFor(() => expect(within(screen.getByTestId('coin-ceremony')).getByText('Beta')).toBeTruthy());
    expect(within(screen.getByTestId('coin-ceremony')).getByText('+5')).toBeTruthy();
    // The new pop starts fresh, not in the previous one's exit.
    expect(within(screen.getByTestId('coin-ceremony')).getByRole('button').className).not.toMatch(/is-exiting/);
    await settle();
    expect(h.cues).toHaveLength(2);
  });

  it('enabled: false shows nothing', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 12))); mint({ 'test-learner': 12 });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={{ ...NOW, enabled: false }} />);
    await waitFor(() => expect(silverShown(12)).toBeTruthy());
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 15))); mint({ 'test-learner': 15 });
    await poke();
    await waitFor(() => expect(silverShown(15)).toBeTruthy());
    await settle();
    expect(screen.queryByTestId('coin-ceremony')).toBeNull();
    expect(h.cues).toHaveLength(0);
  });

  it('a stale done (a tap during the exit window) does not skip the next child', async () => {
    const KIDS3 = [...KIDS, { id: 'test-learner-3', name: 'Gamma' }];
    const fig = (n) => ({ silver: n, lines: Array.from({ length: n - 1 }, (_, i) => lineOf('payout', 1, `p${i}`)) });
    const { result } = renderHook(() => useCoinCeremony({ kids: KIDS3, config: NOW }));
    act(() => result.current.observe({ 'test-learner': fig(1), 'test-learner-2': fig(1), 'test-learner-3': fig(1) }));
    act(() => result.current.observe({ 'test-learner': fig(2), 'test-learner-2': fig(2), 'test-learner-3': fig(2) }));
    await waitFor(() => expect(result.current.toast?.kid.id).toBe('test-learner'));
    const firstId = result.current.toast.id;
    act(() => result.current.done(firstId));
    await waitFor(() => expect(result.current.toast?.kid.id).toBe('test-learner-2'));
    act(() => result.current.done(firstId));
    await settle();
    expect(result.current.toast?.kid.id).toBe('test-learner-2');
  });

  it('bank reads that land out of order: the older one is dropped, so one pop', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 12))); mint({ 'test-learner': 12 });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={NOW} />);
    await waitFor(() => expect(silverShown(12)).toBeTruthy());
    await settle();
    let resolveA; let resolveB;
    const held = [];
    schoolApi.economyBank.mockImplementation((id) => (id === 'test-learner' && held.length < 2
      ? new Promise((r) => { held.push(r); if (held.length === 1) resolveA = r; else resolveB = r; })
      : Promise.resolve(bankRead(id))));
    await poke('test-learner');
    await poke('test-learner');
    await waitFor(() => { expect(resolveA).toBeTypeOf('function'); expect(resolveB).toBeTypeOf('function'); });
    const older = bankRead('test-learner');
    mint({ 'test-learner': 15 });
    const newer = bankRead('test-learner');
    await act(async () => { resolveB(newer); });
    await screen.findByTestId('coin-ceremony');
    // The older read lands last: dropped, it must not reset the baseline.
    await act(async () => { resolveA({ ...older, data: { ...older.data, history: older.data.history.slice(1) } }); });
    await settle();
    await poke();
    await settle();
    expect(h.cues).toHaveLength(1);
    expect(within(screen.getByTestId('coin-ceremony')).getByText('+3')).toBeTruthy();
  });

  it('a deposit raises the balance but does not pop; a later mint pops only the minted silver', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 12))); mint({ 'test-learner': 12 });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={NOW} />);
    await waitFor(() => expect(silverShown(12)).toBeTruthy());
    await settle();
    deposit('test-learner', 20);
    await poke();
    await waitFor(() => expect(schoolApi.economyBank.mock.calls.length).toBeGreaterThanOrEqual(3));
    await settle();
    expect(screen.queryByTestId('coin-ceremony')).toBeNull();
    mint({ 'test-learner': 34 });
    await poke();
    const pop = await screen.findByTestId('coin-ceremony');
    expect(within(pop).getByText('+2')).toBeTruthy();
    expect(within(pop).getByText('34 silver')).toBeTruthy();
    expect(h.cues).toHaveLength(1);
  });

  it('a spend and a mint between two reads pops the minted amount', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 12))); mint({ 'test-learner': 12 });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={NOW} />);
    await waitFor(() => expect(silverShown(12)).toBeTruthy());
    await settle();
    mint({ 'test-learner': 8 });
    mint({ 'test-learner': 11 });
    await poke();
    const pop = await screen.findByTestId('coin-ceremony');
    expect(within(pop).getByText('+3')).toBeTruthy();
  });

  it('a same-week reload (seed equals the first read) then a rise pops once', async () => {
    localStorage.setItem(BOARD_CACHE_KEY, JSON.stringify({
      studyDay: DAY, learners: {}, rings: {},
      earnings: { 'test-learner': { silver: 12, gems: 0, ...WEEK } },
    }));
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 12))); mint({ 'test-learner': 12 });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={NOW} />);
    await waitFor(() => expect(schoolApi.earningsRoster).toHaveBeenCalled());
    await settle();
    expect(screen.queryByTestId('coin-ceremony')).toBeNull();
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 15))); mint({ 'test-learner': 15 });
    await poke();
    const pop = await screen.findByTestId('coin-ceremony');
    expect(within(pop).getByText('+3')).toBeTruthy();
    await settle();
    expect(h.cues).toHaveLength(1);
  });

  it('unmounting mid-pop clears its timers and plays no further cue', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 12), priced('test-learner-2', 4))); mint({ 'test-learner': 12, 'test-learner-2': 4 });
    const { unmount } = render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={{ ...NOW, durationMs: 1000 }} />);
    await waitFor(() => expect(silverShown(12)).toBeTruthy());
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 14), priced('test-learner-2', 9))); mint({ 'test-learner': 14, 'test-learner-2': 9 });
    await poke();
    await screen.findByTestId('coin-ceremony');
    await settle();
    expect(h.cues).toHaveLength(1);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    unmount();
    // Past the first pop's duration + exit: Beta's pop would have come by now.
    await act(async () => { await new Promise((r) => setTimeout(r, 1500)); });
    expect(h.cues).toHaveLength(1);
    expect(screen.queryByTestId('coin-ceremony')).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('a rise earned while the board was unmounted (child on a runner) pops once on remount', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 9))); mint({ 'test-learner': 9 });
    const first = render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={NOW} />);
    await waitFor(() => expect(silverShown(9)).toBeTruthy());
    await settle();
    first.unmount();
    // The child finishes work on the Portal; the board comes back (its
    // cache seed still says 9, and the seed is never news).
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('test-learner', 12))); mint({ 'test-learner': 12 });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} coinCeremony={NOW} />);
    const pop = await screen.findByTestId('coin-ceremony');
    expect(within(pop).getByText('+3')).toBeTruthy();
    expect(within(pop).getByText('12 silver')).toBeTruthy();
    await settle();
    expect(screen.getAllByTestId('coin-ceremony')).toHaveLength(1);
    expect(h.cues).toEqual([{ sound: 'school/_ux/coin.mp3', volume: 0.8 }]);
  });
});
