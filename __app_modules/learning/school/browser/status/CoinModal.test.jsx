import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock("../schoolApi.js", () => ({ schoolApi: { economyBank: vi.fn() } }));
vi.mock("../schoolLog.js", () => ({ schoolLog: { selfService: vi.fn(), selfServiceError: vi.fn() } }));
import { schoolLog } from "../schoolLog.js";
import { schoolApi } from "../schoolApi.js";
import CoinModal from "./CoinModal.jsx";
import { AUTO_CLOSE_MS } from "./TermModal.jsx";

// Wednesday 2026-10-21, 10:00 local.
const NOW = new Date(2026, 9, 21, 10, 0).getTime();
const KID = { id: 'test-learner', name: 'Alpha' };
const at = (d, h) => new Date(2026, 9, d, h, 0).toISOString();
const FIGURE = {
  silver: 9, gems: 0, pendingSilver: 2, pendingGems: 0, from: '2026-10-19', to: '2026-10-25',
  earned: [
    { ruleId: 'korean-daily', label: 'Korean (each day done)', silver: 6, gems: 0 },
    { ruleId: 'green-day', label: 'Green day', silver: 3, gems: 0 },
  ],
};
// Oldest to newest: +12 gold from 12 silver (silver 6 left), −3 silver, +2 silver.
const BANK = {
  mode: 'live',
  balances: { silver: 5, gold: 12, gems: 1 },
  history: [
    { text: '+2 silver · Korean (each day done)', at: at(21, 9), kind: 'earn', ids: ['e'], source: 'payout', label: 'Korean (each day done)', legs: [{ currency: 'silver', delta: 2 }], balanceAfter: { silver: 5, gold: 12, gems: 1 } },
    { text: '−3 silver · early pass', at: at(20, 15), kind: 'spend', ids: ['s'], source: 'spend', label: 'early pass', legs: [{ currency: 'silver', delta: -3 }], balanceAfter: { silver: 3, gold: 12, gems: 1 } },
    { text: '12 silver → 12 gold · Sunday', at: at(18, 20), kind: 'convert', ids: ['g', 'o'], source: 'conversion', label: 'silver → gold', legs: [{ currency: 'silver', delta: -12 }, { currency: 'gold', delta: 12 }], balanceAfter: { silver: 6, gold: 12, gems: 1 } },
  ],
};
const ok = (data) => ({ ok: true, status: 200, data });

async function open(props = {}) {
  const onClose = props.onClose ?? vi.fn();
  render(<CoinModal kid={KID} figure={FIGURE} onClose={onClose} now={NOW} {...props} />);
  await act(async () => {});
  return { onClose, dialog: screen.getByRole('dialog', { name: "Alpha's coins" }) };
}

beforeEach(() => { schoolLog.selfService.mockClear(); schoolApi.economyBank.mockReset().mockResolvedValue(ok(BANK)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('CoinModal', () => {
  it('reads that learner\'s bank and shows the three balances', async () => {
    const { dialog } = await open();
    expect(schoolApi.economyBank).toHaveBeenCalledWith('test-learner');
    const balances = within(dialog).getByTestId('coin-modal-balances');
    expect(within(balances).getByLabelText('5 silver')).toBeTruthy();
    expect(within(balances).getByLabelText('12 gold')).toBeTruthy();
    expect(within(balances).getByLabelText('1 gem')).toBeTruthy();
    expect(balances.querySelector('svg.coin-icon[data-metal="silver"]')).toBeTruthy();
    expect(balances.querySelector('svg.coin-icon[data-metal="gold"]')).toBeTruthy();
  });

  it('shows this week\'s unpaid silver as its own labelled section', async () => {
    const { dialog } = await open();
    const pending = within(dialog).getByTestId('coin-modal-pending');
    expect(within(pending).getByRole('heading', { name: 'This week, not yet paid' })).toBeTruthy();
    expect(pending.textContent).toContain('9 silver so far');
    expect([...pending.querySelectorAll('li')].map((li) => li.textContent))
      .toEqual(['+6 silver · Korean (each day done)', '+3 silver · Green day']);
    expect(pending.textContent).toContain('+2 more possible');
  });

  it('the ledger runs newest first by day: signed, named by source, with the balance after each line', async () => {
    const { dialog } = await open();
    const ledger = within(dialog).getByTestId('coin-modal-ledger');
    expect(within(ledger).getByText('Today')).toBeTruthy();
    expect(within(ledger).getByText('Yesterday')).toBeTruthy();
    const lines = within(ledger).getAllByTestId('coin-ledger-line');
    expect(lines.map((l) => l.getAttribute('data-source'))).toEqual(['payout', 'spend', 'conversion']);
    expect(within(lines[0]).getByText('Earned')).toBeTruthy();
    expect(within(lines[0]).getByText('Korean (each day done)')).toBeTruthy();
    expect(within(lines[0]).getByText('+2 silver')).toHaveClass('is-plus');
    expect(within(lines[0]).getByText('5 silver')).toBeTruthy();
    expect(within(lines[1]).getByText('Spent')).toBeTruthy();
    expect(within(lines[1]).getByText('−3 silver')).toHaveClass('is-minus');
    expect(within(lines[1]).getByText('3 silver')).toBeTruthy();
    expect(within(lines[2]).getByText('Converted')).toBeTruthy();
    expect(within(lines[2]).getByText('−12 silver')).toBeTruthy();
    expect(within(lines[2]).getByText('+12 gold')).toBeTruthy();
    expect(within(lines[2]).getByText('6 silver · 12 gold')).toBeTruthy();
  });

  it('focus lands on Close; Close, a tap anywhere, Escape and the clock all close it', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<CoinModal kid={KID} figure={FIGURE} onClose={onClose} now={NOW} />);
    const close = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
    act(() => { vi.advanceTimersByTime(AUTO_CLOSE_MS - 1); });
    expect(onClose).toHaveBeenCalledTimes(3);
    act(() => { vi.advanceTimersByTime(1); });
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('a bank that cannot be read naps, and the unpaid week still shows', async () => {
    schoolApi.economyBank.mockResolvedValue({ ok: false, status: 503, data: null });
    const { dialog } = await open();
    expect(within(dialog).getByTestId('coin-modal-napping').textContent).toBe('The bank is napping. Try again soon.');
    expect(within(dialog).queryByTestId('coin-modal-balances')).toBeNull();
    expect(within(dialog).getByTestId('coin-modal-pending').textContent).toContain('9 silver so far');
  });

  it('no figure this week says so; an older server\'s text-only line still reads', async () => {
    schoolApi.economyBank.mockResolvedValue(ok({ ...BANK, history: [{ text: '+1 silver · Green day', at: at(21, 8), kind: 'earn', ids: ['x'] }] }));
    const { dialog } = await open({ figure: null });
    expect(within(dialog).getByTestId('coin-modal-pending').textContent).toContain('Nothing earned yet this week.');
    const [only] = within(dialog).getAllByTestId('coin-ledger-line');
    expect(only.textContent).toContain('+1 silver · Green day');
  });

  it('logs open, and the reason it closed', async () => {
    const { dialog } = await open();
    expect(schoolLog.selfService).toHaveBeenCalledWith('coin-modal.opened', { learnerId: 'test-learner' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(schoolLog.selfService).toHaveBeenCalledWith('coin-modal.closed', { learnerId: 'test-learner', reason: 'button' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(schoolLog.selfService).toHaveBeenCalledWith('coin-modal.closed', { learnerId: 'test-learner', reason: 'escape' });
    fireEvent.click(dialog);
    expect(schoolLog.selfService).toHaveBeenCalledWith('coin-modal.closed', { learnerId: 'test-learner', reason: 'tap' });
  });
});
