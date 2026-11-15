import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RewardsModal from './RewardsModal.jsx';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';

vi.mock('../schoolApi.js', () => ({ schoolApi: { earningsPreview: vi.fn(), economyBank: vi.fn(), gems: vi.fn() } }));

const alex = { id: 'alex', name: 'Alex' };
const ok = (data) => ({ ok: true, data });
const preview = (id, silver) => ok({ learnerId: id, totals: { silver }, lines: [], windows: { school: { from: '2026-11-09', to: '2026-11-15' } } });
const gems = {
  mode: 'live', learners: [{ learnerId: 'alex', name: 'Alex' }, { learnerId: 'jamie', name: 'Jamie' }],
  categories: [{ id: 'reading', label: 'Reading', color: '#99bbcc' }, { id: 'rings', label: 'Most rings', color: '#99bbcc' }],
  cells: {
    reading: { alex: { state: 'pending', week: 0, streak: { have: 3, need: 4, reach: 'on-track' }, parts: [{ ruleId: 'reader', label: 'Story time', state: 'pending', progress: { have: 3, need: 4 }, reach: 'on-track', items: [] }] }, jamie: { state: 'earned', week: 90 } },
    rings: { alex: { state: 'leading', week: 0, held: 1, parts: [{ ruleId: 'ring', cadence: 'contest', label: 'Most rings', state: 'leading', score: { mine: 150, best: 400, unit: 'rings', standings: [{ learnerId: 'jamie', name: 'Jamie', value: 400 }] } }] } },
  },
};

beforeEach(() => {
  const dialogPrototype = Object.getPrototypeOf(document.createElement('dialog'));
  vi.spyOn(dialogPrototype, 'showModal').mockImplementation(function () { this.setAttribute('open', ''); });
  vi.spyOn(dialogPrototype, 'close').mockImplementation(function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); });
  schoolApi.earningsPreview.mockResolvedValue(preview('alex', 24));
  schoolApi.economyBank.mockResolvedValue(ok({ mode: 'live', balances: { silver: 15, gold: 3 } }));
  schoolApi.gems.mockResolvedValue(ok(gems));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('RewardsModal', () => {
  it('shows only the selected child, their real totals and own progress without standings', async () => {
    const onOpenBank = vi.fn();
    render(<RewardsModal learner={alex} onClose={vi.fn()} onOpenBank={onOpenBank} />);
    const modal = screen.getByRole('dialog', { name: "Alex's rewards" });
    expect(await within(modal).findByText('24')).toBeTruthy();
    expect(within(modal).getByText('3')).toBeTruthy();
    expect(within(modal).getByText(/3 of 4 days/)).toBeTruthy();
    expect(modal.textContent).not.toMatch(/Jamie|400|standings/i);
    expect(modal.textContent).toContain('150 rings');
    expect(schoolApi.earningsPreview).toHaveBeenCalledWith('alex');
    fireEvent.click(within(modal).getByRole('button', { name: 'Open bank details' }));
    expect(onOpenBank).toHaveBeenCalledWith('alex');
  });

  it('keeps loading and failed reads distinct from zero and permits independent success', async () => {
    schoolApi.earningsPreview.mockResolvedValue({ ok: false });
    schoolApi.economyBank.mockResolvedValue({ ok: false });
    schoolApi.gems.mockResolvedValue({ ok: false });
    render(<RewardsModal learner={alex} onClose={vi.fn()} />);
    expect(screen.getByText('Loading silver…')).toBeTruthy();
    expect(await screen.findByText('Silver is unavailable.')).toBeTruthy();
    expect(screen.getByText('Gold is unavailable.')).toBeTruthy();
    expect(screen.getByText('Gems are unavailable.')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows coins-start-soon in an off economy and never renders an unrelated preview', async () => {
    schoolApi.economyBank.mockResolvedValue(ok({ mode: 'preview', balances: { silver: 0, gold: 0 } }));
    schoolApi.earningsPreview.mockResolvedValue(preview('jamie', 999));
    render(<RewardsModal learner={alex} onClose={vi.fn()} />);
    expect(await screen.findByText('Coins start soon.')).toBeTruthy();
    expect(screen.queryByText('999')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('drops late answers and clears old data when the learner changes', async () => {
    let resolve;
    schoolApi.earningsPreview.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const { rerender } = render(<RewardsModal learner={alex} onClose={vi.fn()} />);
    await waitFor(() => expect(schoolApi.earningsPreview).toHaveBeenCalledWith('alex'));
    schoolApi.earningsPreview.mockResolvedValue(preview('jamie', 7));
    rerender(<RewardsModal learner={{ id: 'jamie', name: 'Jamie' }} onClose={vi.fn()} />);
    await screen.findByText('7');
    await act(async () => resolve(preview('alex', 999)));
    expect(screen.queryByText('999')).toBeNull();
    expect(screen.getByRole('dialog', { name: "Jamie's rewards" })).toBeTruthy();
  });

  it('treats an empty off-mode gem board as not started, not an outage', async () => {
    schoolApi.gems.mockResolvedValue(ok({ mode: 'off', learners: [], categories: [], cells: {} }));
    render(<RewardsModal learner={alex} onClose={vi.fn()} />);
    expect(await screen.findByText('Gems start soon.')).toBeTruthy();
    expect(screen.queryByText('Gems are unavailable.')).toBeNull();
  });

  it('bounds stalled reads and ignores their answers after the timeout', async () => {
    vi.useFakeTimers();
    let resolve;
    schoolApi.earningsPreview.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<RewardsModal learner={alex} onClose={vi.fn()} idleMs={0} />);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(screen.getByText('Silver is unavailable.')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    await act(async () => resolve(preview('alex', 999)));
    expect(screen.queryByText('999')).toBeNull();
  });

  it('formats contest display values and keeps provisional gems distinct from earned gems', async () => {
    schoolApi.gems.mockResolvedValue(ok({ ...gems, cells: { ...gems.cells, rings: {
      alex: { state: 'earned', week: 1, held: 2, parts: [{ ruleId: 'race', label: 'Best lap', cadence: 'contest', state: 'leading', score: { mine: 1e6 / 314, value: 314, unit: 'seconds' } }] },
    } } }));
    render(<RewardsModal learner={alex} onClose={vi.fn()} />);
    expect(await screen.findByText('5:14')).toBeTruthy();
    expect(screen.getByText('1 gem this week, and 1 more while leading')).toBeTruthy();
    expect(screen.queryByText('2 gems earned this week')).toBeNull();
  });

  it('closes on Escape/native cancel, backdrop, close and idle, resetting idle on interaction', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<RewardsModal learner={alex} onClose={onClose} idleMs={1000} />);
    const modal = screen.getByRole('dialog');
    fireEvent(modal, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close rewards' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(modal, { clientX: -1 });
    expect(onClose).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(900));
    fireEvent.pointerDown(modal);
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(onClose).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('owns Escape before the surrounding app can exit', () => {
    const background = vi.fn();
    window.addEventListener('keydown', background);
    try {
      const onClose = vi.fn();
      render(<RewardsModal learner={alex} onClose={onClose} />);
      fireEvent.keyDown(screen.getByRole('button', { name: 'Close rewards' }), { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(background).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', background);
    }
  });

  it('marks human rewards activity for the Portal idle gate without logging every gesture', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(schoolLog, 'selfService');
    render(<RewardsModal learner={alex} onClose={vi.fn()} idleMs={0} />);
    const activityCount = () => log.mock.calls.filter(([event]) => event === 'board.rewards-activity').length;
    expect(activityCount()).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(activityCount()).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(activityCount()).toBe(2);
  });
});
