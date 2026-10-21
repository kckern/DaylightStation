import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BankStrip, { chipFromBank, nextLabel, PRINT_FALLBACK, DEFAULT_DEVICE_ID } from "./BankStrip.jsx";
import { COINS_COALESCE_MS } from "../status/schoolRefreshEvents.js";

vi.mock("../schoolApi.js", () => ({
  schoolApi: { economyBank: vi.fn(), nextItem: vi.fn(), printNext: vi.fn() },
}));
const wsHandlers = [];
vi.mock("../../../../../frontend/src/hooks/useWebSocket.js", () => ({
  useWebSocketSubscription: (topic, cb) => { wsHandlers.push({ topic, cb }); },
}));
const logged = [];
vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const child = () => ({
    info: (event, data) => logged.push({ level: 'info', event, data }),
    warn: (event, data) => logged.push({ level: 'warn', event, data }),
    error: (event, data) => logged.push({ level: 'error', event, data }),
    debug: () => {},
  });
  const getLogger = () => ({ child });
  return { default: getLogger, getLogger };
});
import { schoolApi } from "../schoolApi.js";

const KIDS = [{ id: 'kid-b', name: 'Bee' }, { id: 'kid-a', name: 'Ay' }, { id: 'kid-c', name: 'Cee' }];
const none = { passId: null, state: 'none', capUsed: false };
const bank = (silver, { gems = 0, pass = none } = {}) => ({
  ok: true, status: 200,
  data: { balances: { silver, gold: 0, gems }, history: [], pass: { 'piano.games': pass }, offers: {}, weekEndsAt: null, studyDay: '2026-10-21' },
});
const next = (title, { printable = true, reward = null, subject = 'math' } = {}) => ({
  ok: true, status: 200, data: { subject, unit: { unitId: `u-${title}`, title, subject }, printable, reward },
});
const latestSchool = () => wsHandlers.filter((h) => h.topic === 'school').at(-1).cb;
const chips = () => screen.getAllByTestId('bank-chip');

beforeEach(() => {
  wsHandlers.length = 0;
  logged.length = 0;
  schoolApi.economyBank.mockReset();
  schoolApi.nextItem.mockReset();
  schoolApi.printNext.mockReset();
  schoolApi.nextItem.mockResolvedValue({ ok: true, status: 200, data: { subject: null, unit: null, printable: false, reward: null } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('BankStrip model', () => {
  it('reads silver, gems and the sneak from the bank; can not tell is no tick', () => {
    expect(chipFromBank(bank(7, { gems: 2 }).data)).toEqual({ silver: 7, gems: 2, sneakUsed: false });
    expect(chipFromBank(bank(1, { pass: { state: 'consumed', capUsed: true } }).data).sneakUsed).toBe(true);
    expect(chipFromBank(bank(1, { pass: { state: 'active', capUsed: false } }).data).sneakUsed).toBe(true);
    expect(chipFromBank(bank(1, { pass: { state: 'refunded', capUsed: true } }).data).sneakUsed).toBe(true);
    expect(chipFromBank(bank(1, { pass: { state: 'unknown', capUsed: null } }).data).sneakUsed).toBe(false);
    expect(chipFromBank({ balances: {} })).toBeNull();
    expect(chipFromBank(null)).toBeNull();
  });

  it('labels the next sheet with its reward only when the economy prices it', () => {
    expect(nextLabel(next('Math 4-02').data)).toBe('Math 4-02');
    expect(nextLabel(next('Math 4-02', { reward: { silver: 2 } }).data)).toBe('+2 silver · Math 4-02');
    expect(nextLabel(next('Math 4-02', { reward: { silver: 2, gems: 1 } }).data)).toBe('+2 silver · +1 gem · Math 4-02');
    expect(nextLabel(next('Math 4-02', { printable: false }).data)).toBeNull();
    expect(nextLabel({ unit: null, printable: false })).toBeNull();
  });
});

describe('BankStrip', () => {
  it('renders one chip per kid in roster order, never ranked by silver', async () => {
    const silver = { 'kid-b': 1, 'kid-a': 30, 'kid-c': 12 };
    schoolApi.economyBank.mockImplementation(async (id) => bank(silver[id]));
    render(<BankStrip kids={KIDS} />);
    await waitFor(() => expect(screen.getByLabelText('12 silver this week')).toBeTruthy());
    expect(chips().map((chip) => chip.dataset.learner)).toEqual(['kid-b', 'kid-a', 'kid-c']);
    expect(chips().map((chip) => within(chip).getByRole('img', { name: /silver this week/ }).textContent)).toEqual(['1', '30', '12']);
    expect(screen.queryByText(/top/i)).toBeNull();
  });

  it('a failed bank says "bank is napping" for that kid alone, with no number', async () => {
    schoolApi.economyBank.mockImplementation(async (id) => (id === 'kid-a' ? { ok: false, status: 500, data: null } : bank(4)));
    render(<BankStrip kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('bank is napping')).toBeTruthy());
    const napping = chips().find((chip) => chip.dataset.learner === 'kid-a');
    expect(within(napping).queryByRole('img', { name: /silver/ })).toBeNull();
    expect(napping.textContent).not.toMatch(/\d/);
    await waitFor(() => expect(screen.getAllByLabelText('4 silver this week')).toHaveLength(2));
    expect(logged).toContainEqual({ level: 'warn', event: 'economy.balance.unavailable', data: { learnerId: 'kid-a', status: 500 } });
  });

  it('a bank call that throws is napping too, and never seeds a figure from local storage', async () => {
    localStorage.setItem('school.board.v1', JSON.stringify({ earnings: { 'kid-b': { silver: 99 } } }));
    schoolApi.economyBank.mockRejectedValue(new Error('offline'));
    render(<BankStrip kids={[KIDS[0]]} />);
    await waitFor(() => expect(screen.getByText('bank is napping')).toBeTruthy());
    expect(screen.queryByText('99')).toBeNull();
    localStorage.clear();
  });

  it('shows the sneak-used tick when today\'s pass is used, and not when the ledger cannot tell', async () => {
    schoolApi.economyBank.mockImplementation(async (id) => bank(3, {
      pass: id === 'kid-b' ? { state: 'consumed', capUsed: true } : id === 'kid-a' ? { state: 'unknown', capUsed: null } : none,
    }));
    render(<BankStrip kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByLabelText('3 silver this week')).toHaveLength(3));
    expect(screen.getAllByLabelText('Sneak used today')).toHaveLength(1);
    expect(within(chips()[0]).getByLabelText('Sneak used today')).toBeTruthy();
  });

  it('shows a gem only when there are gems', async () => {
    schoolApi.economyBank.mockImplementation(async (id) => bank(3, { gems: id === 'kid-b' ? 2 : 0 }));
    render(<BankStrip kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByLabelText('3 silver this week')).toHaveLength(3));
    expect(screen.getAllByRole('img', { name: '2 gems' })).toHaveLength(1);
  });

  it('Print calls print-next, disables itself in flight, toasts the sentence and re-reads that kid', async () => {
    schoolApi.economyBank.mockResolvedValue(bank(5));
    schoolApi.nextItem.mockResolvedValue(next('Math 4-02'));
    let answer;
    schoolApi.printNext.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    render(<BankStrip kids={[KIDS[0]]} deviceId="hall-panel" />);
    const button = await screen.findByRole('button', { name: /Print Math 4-02 for Bee/ });
    expect(screen.getByText('Math 4-02')).toBeTruthy();
    expect(screen.queryByText(/\+\d+ silver/)).toBeNull();
    const reads = schoolApi.economyBank.mock.calls.length;

    fireEvent.click(button);
    expect(schoolApi.printNext).toHaveBeenCalledWith('kid-b', 'math', 'hall-panel');
    await waitFor(() => expect(button.disabled).toBe(true));
    fireEvent.click(button);
    expect(schoolApi.printNext).toHaveBeenCalledTimes(1);

    await act(async () => { answer({ ok: true, status: 200, data: { status: 'printed', outcome: 'done', sentence: 'Your sheet is printing.' } }); });
    expect(screen.getByRole('status').textContent).toBe('Your sheet is printing.');
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(schoolApi.economyBank.mock.calls.length).toBe(reads + 1);
    expect(logged).toContainEqual({ level: 'info', event: 'economy.strip.print-tapped', data: { learnerId: 'kid-b', subject: 'math', deviceId: 'hall-panel' } });
  });

  it('a refused print toasts the calm fallback; with no screen id the device is the Portal', async () => {
    schoolApi.economyBank.mockResolvedValue(bank(5));
    schoolApi.nextItem.mockResolvedValue(next('Math 4-02'));
    schoolApi.printNext.mockResolvedValue({ ok: false, status: 404, data: { error: 'not found' } });
    render(<BankStrip kids={[KIDS[0]]} />);
    fireEvent.click(await screen.findByRole('button', { name: /Print/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(PRINT_FALLBACK));
    expect(schoolApi.printNext).toHaveBeenCalledWith('kid-b', 'math', DEFAULT_DEVICE_ID);
  });

  it('shows no Print when the next item is not paper', async () => {
    schoolApi.economyBank.mockResolvedValue(bank(5));
    schoolApi.nextItem.mockResolvedValue(next('Math Facts', { printable: false }));
    render(<BankStrip kids={[KIDS[0]]} />);
    await waitFor(() => expect(screen.getByLabelText('5 silver this week')).toBeTruthy());
    await waitFor(() => expect(schoolApi.nextItem).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Print/ })).toBeNull();
    expect(screen.queryByText('Math Facts')).toBeNull();
  });

  it('re-reads only the named kid on coins-changed, once per burst', async () => {
    schoolApi.economyBank.mockResolvedValue(bank(5));
    render(<BankStrip kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByLabelText('5 silver this week')).toHaveLength(3));
    vi.useFakeTimers();
    schoolApi.economyBank.mockClear();
    schoolApi.nextItem.mockClear();
    schoolApi.economyBank.mockResolvedValue(bank(9));
    const onSchool = latestSchool();
    act(() => {
      onSchool({ event: 'coins-changed', learnerId: 'kid-a' });
      onSchool({ event: 'coins-changed', learnerId: 'kid-a' });
      onSchool({ event: 'coins-changed', learnerId: 'kid-a' });
      onSchool({ event: 'coins-changed', learnerId: 'not-on-roster' });
      onSchool({ event: 'something-else', learnerId: 'kid-b' });
    });
    expect(schoolApi.economyBank).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(COINS_COALESCE_MS); });
    expect(schoolApi.economyBank.mock.calls).toEqual([['kid-a']]);
    expect(schoolApi.nextItem.mock.calls).toEqual([['kid-a']]);
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByLabelText('9 silver this week')).toBeTruthy());
  });
});
