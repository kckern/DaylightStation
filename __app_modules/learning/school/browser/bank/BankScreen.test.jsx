import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import BankScreen, { NAPPING, NOTHING_TO_SPEND, COINS_SOON } from "./BankScreen.jsx";
import { earnItems, goldCountdown, historyByDay, schoolDoneFrom, spendItems } from "./bankScreenModel.js";

vi.mock("../schoolApi.js", () => ({
  schoolApi: { economyBank: vi.fn(), agendaPreview: vi.fn(), nextItem: vi.fn(), earningsRoster: vi.fn() },
}));
const wsHandlers = [];
vi.mock("../../../../../frontend/src/hooks/useWebSocket.js", () => ({
  useWebSocketSubscription: (topic, cb) => { wsHandlers.push({ topic, cb }); },
}));
const logged = [];
vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const child = (ctx) => ({
    info: (event, data) => logged.push({ level: 'info', event, data, ctx }),
    warn: (event, data) => logged.push({ level: 'warn', event, data, ctx }),
    error: (event, data) => logged.push({ level: 'error', event, data, ctx }),
    debug: () => {},
  });
  const getLogger = () => ({ child });
  return { default: getLogger, getLogger };
});
import { schoolApi } from "../schoolApi.js";

// Wednesday 2026-10-21, 10:00 local. The week closes Monday 04:00 local.
const NOW = new Date(2026, 9, 21, 10, 0).getTime();
const CLOSE = new Date(2026, 9, 26, 4, 0).toISOString();
const KID = { id: 'kid', name: 'Kay' };
const none = { passId: null, state: 'none', capUsed: false };

const bankData = (over = {}) => ({
  userId: 'kid', mode: 'live', studyDay: '2026-10-21',
  balances: { silver: 7, gold: 12, gems: 1 },
  history: [
    { text: '+2 silver · Math 4-02 passed', at: new Date(2026, 9, 21, 9, 0).toISOString(), kind: 'earn', ids: ['a'], source: 'payout', label: 'Math 4-02 passed', legs: [{ currency: 'silver', delta: 2 }], balanceAfter: { silver: 7, gold: 12, gems: 1 } },
    { text: '−3 silver · early pass', at: new Date(2026, 9, 21, 8, 0).toISOString(), kind: 'spend', ids: ['s'], source: 'spend', label: 'early pass', legs: [{ currency: 'silver', delta: -3 }], balanceAfter: { silver: 5, gold: 12, gems: 1 } },
    { text: '+1 silver · Green day', at: new Date(2026, 9, 20, 18, 0).toISOString(), kind: 'earn', ids: ['b'], source: 'mystery-ref', label: 'Green day', legs: [{ currency: 'silver', delta: 1 }], balanceAfter: { silver: 8, gold: 12, gems: 1 } },
    { text: '12 silver → 12 gold · Sunday', at: new Date(2026, 9, 18, 20, 0).toISOString(), kind: 'convert', ids: ['c', 'd'], source: 'conversion', label: 'silver → gold', legs: [{ currency: 'silver', delta: -12 }, { currency: 'gold', delta: 12 }], balanceAfter: { silver: 7, gold: 12, gems: 1 } },
  ],
  pass: { 'piano.games': none },
  offers: { 'piano.games': [] },
  weekEndsAt: CLOSE,
  weekEndsOn: '2026-10-25',
  ...over,
});
const ok = (data) => ({ ok: true, status: 200, data });
const AGENDA = {
  sections: [
    { subject: 'math', next: { unitId: 'm1', title: 'Fractions 4-03' }, obligation: { state: 'obligated' } },
    { subject: 'scripture', next: { unitId: 's1', title: 'Isaiah 52' }, obligation: { state: 'served' } },
    { subject: 'geography', next: { unitId: 'g1', title: 'Rivers' }, obligation: { state: 'obligated' } },
  ],
  errors: [],
};

// The board's roster read: Kay's week so far, two earned lines.
const ROSTER_EARNINGS = {
  windows: { school: { from: '2026-10-19', to: '2026-10-25' } },
  learners: [{
    learnerId: 'kid', totals: { silver: 9, gems: 0 }, pending: { silver: 2, gems: 0 },
    lines: [
      { ruleId: 'korean-daily', label: 'Korean (each day done)', status: 'earned', amount: { silver: 6, gems: 0 } },
      { ruleId: 'green-day', label: 'Green day', status: 'earned', amount: { silver: 3, gems: 0 } },
    ],
  }],
};
const tab = (id) => fireEvent.click(screen.getByTestId(`bank-tab-${id}`));

async function renderScreen(props = {}) {
  const view = render(<BankScreen learner={KID} onExit={vi.fn()} now={NOW} {...props} />);
  await act(async () => {});
  return view;
}

beforeEach(() => {
  wsHandlers.length = 0;
  logged.length = 0;
  schoolApi.economyBank.mockReset().mockResolvedValue(ok(bankData()));
  schoolApi.earningsRoster.mockReset().mockResolvedValue(ok(ROSTER_EARNINGS));
  schoolApi.agendaPreview.mockReset().mockResolvedValue(ok(AGENDA));
  schoolApi.nextItem.mockReset().mockResolvedValue(ok({ subject: 'math', unit: { unitId: 'm1', title: 'Fractions 4-03' }, printable: true, reward: null }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('goldCountdown', () => {
  // Only the two server dates decide the words: the panel's own clock and
  // timezone do not enter into it (the instant only flags a passed close).
  const say = (studyDay, weekEndsOn) => goldCountdown({ studyDay, weekEndsOn, weekEndsAt: CLOSE, now: NOW });
  it('counts whole days between today\'s study day and the close\'s', () => {
    expect(say('2026-10-21', '2026-10-25')).toBe('becomes gold in 4 days');
    expect(say('2026-10-24', '2026-10-25')).toBe('becomes gold tomorrow night');
    expect(say('2026-10-25', '2026-10-25')).toBe('becomes gold tonight');
    expect(say('2026-10-25', '2026-11-01')).toBe('becomes gold in 7 days');
    expect(say('2026-12-31', '2027-01-03')).toBe('becomes gold in 3 days');
  });

  it('the same two dates say the same thing whatever the instant or the clock', () => {
    const a = goldCountdown({ studyDay: '2026-10-25', weekEndsOn: '2026-10-25', weekEndsAt: '2026-10-26T11:00:00.000Z', now: Date.parse('2026-10-25T23:30:00Z') });
    const b = goldCountdown({ studyDay: '2026-10-25', weekEndsOn: '2026-10-25', weekEndsAt: '2026-10-26T11:00:00.000Z', now: Date.parse('2026-10-26T08:00:00Z') });
    expect(a).toBe('becomes gold tonight');
    expect(b).toBe(a);
  });

  it('a close already past is happening now', () => {
    expect(goldCountdown({ studyDay: '2026-10-25', weekEndsOn: '2026-10-25', weekEndsAt: '2026-10-26T11:00:00.000Z', now: Date.parse('2026-10-26T11:00:01Z') }))
      .toBe('becoming gold now');
  });

  it('says nothing without both dates', () => {
    expect(goldCountdown({ studyDay: '2026-10-21', weekEndsOn: null, now: NOW })).toBeNull();
    expect(goldCountdown({ studyDay: null, weekEndsOn: '2026-10-25', now: NOW })).toBeNull();
  });
});

describe('historyByDay', () => {
  it('groups newest first under Today, Yesterday, then the date', () => {
    const groups = historyByDay(bankData().history, NOW);
    expect(groups.map((g) => g.label).slice(0, 2)).toEqual(['Today', 'Yesterday']);
    expect(groups).toHaveLength(3);
    expect(groups[2].lines[0].text).toBe('12 silver → 12 gold · Sunday');
  });
});

describe('spendItems', () => {
  const offer = (rows) => ({ 'piano.games': rows });
  it('nothing on sale is empty: every price 0 quotes []', () => {
    expect(spendItems({ offers: offer([]), pass: { 'piano.games': none } }).empty).toBe(true);
    expect(spendItems({ offers: {} }).empty).toBe(true);
  });

  it('the server\'s affordable wins over a local count; the count is the fallback', () => {
    const { items } = spendItems({
      offers: offer([{ coin: 'silver', price: 5, affordable: false }, { coin: 'gold', price: 2 }]),
      pass: { 'piano.games': none }, balances: { silver: 9, gold: 1 },
    });
    expect(items[0].prices.map((p) => p.state)).toEqual(['not enough yet', '1 more gold']);
  });

  it('per coin: can buy, or how many more', () => {
    const { items } = spendItems({
      offers: offer([{ coin: 'silver', price: 10, affordable: false }, { coin: 'gold', price: 2, affordable: true }]),
      pass: { 'piano.games': none }, balances: { silver: 7, gold: 12 },
    });
    expect(items[0].prices).toEqual([
      { coin: 'silver', price: 10, state: '3 more silver' },
      { coin: 'gold', price: 2, state: 'can buy at the piano' },
    ]);
    expect(items[0].note).toBeNull();
  });

  it('today\'s pass used: after school is done', () => {
    const { items } = spendItems({
      offers: offer([{ coin: 'silver', price: 3, affordable: true }]),
      pass: { 'piano.games': { state: 'consumed', capUsed: true } }, balances: { silver: 7 }, schoolDone: false,
    });
    expect(items[0].note).toBe('after school is done');
    expect(items[0].prices[0].state).toBeNull();
  });

  it('an unknown pass claims neither used nor available', () => {
    const { items } = spendItems({
      offers: offer([{ coin: 'silver', price: 3, affordable: true }]),
      pass: { 'piano.games': { state: 'unknown', capUsed: null } }, balances: { silver: 7 },
    });
    expect(items[0].note).toBe("Can't check today's pass right now.");
    expect(items[0].prices[0].state).toBeNull();
  });

  it('a complete day needs no pass', () => {
    const { items } = spendItems({
      offers: offer([{ coin: 'silver', price: 3, affordable: true }]),
      pass: { 'piano.games': none }, balances: { silver: 7 }, schoolDone: true,
    });
    expect(items[0].note).toBe('Open now: school is done.');
  });
});

describe('earnItems and schoolDoneFrom', () => {
  it('next sheet first, then the owed sections, no duplicates, no invented amounts', () => {
    const { items } = earnItems({ agenda: AGENDA, next: { subject: 'math', unit: { unitId: 'm1', title: 'Fractions 4-03' }, reward: null } });
    expect(items.map((i) => i.title)).toEqual(['Fractions 4-03', 'Rivers']);
    expect(items.every((i) => i.reward === null)).toBe(true);
  });

  it('shows a reward only when the economy prices it', () => {
    const { items } = earnItems({ agenda: null, next: { subject: 'math', unit: { unitId: 'm1', title: 'F' }, reward: { silver: 2 } } });
    expect(items[0].reward).toBe('+2 silver');
  });

  it('school is done when nothing is owed; unknown on a fault', () => {
    expect(schoolDoneFrom(AGENDA)).toBe(false);
    expect(schoolDoneFrom({ sections: [{ obligation: { state: 'served' } }], errors: [] })).toBe(true);
    expect(schoolDoneFrom({ sections: [{ obligation: { state: 'faulted' } }], errors: [] })).toBeNull();
    expect(schoolDoneFrom(null)).toBeNull();
  });
});

describe('BankScreen', () => {
  it('opens on History: balances (one emphasized), the unpaid week, then the ledger; no buy button', async () => {
    await renderScreen();
    expect(screen.getByRole('heading', { name: 'Bank' })).toBeInTheDocument();
    expect(screen.getByTestId('screen-header')).toHaveTextContent('Kay');

    const balances = screen.getByTestId('bank-balances');
    const stats = balances.querySelectorAll('.ds-stat');
    expect(stats).toHaveLength(3);
    expect(balances.querySelectorAll('.ds-stat--emphasis')).toHaveLength(1);
    expect(stats[0]).toHaveClass('ds-stat--emphasis');
    expect(stats[0]).toHaveTextContent('Silver');
    expect(stats[0]).toHaveTextContent('7');
    expect(stats[0]).toHaveTextContent('becomes gold in 4 days');
    expect(stats[1]).toHaveTextContent('12');
    expect(stats[1]).toHaveTextContent('yours for good');
    expect(stats[2]).toHaveTextContent('yours for good');

    expect(screen.getByTestId('bank-pending')).toHaveTextContent('9 silver so far');
    expect(screen.getByTestId('bank-history')).toBeInTheDocument();
    expect(screen.queryByTestId('bank-spend')).toBeNull();
    expect(screen.queryByTestId('bank-earn')).toBeNull();
    expect(screen.queryByRole('button', { name: /buy/i })).toBeNull();
  });
});

describe('BankScreen tabs', () => {
  it('are a tablist of History, How to earn, How to spend; History is selected on open', async () => {
    await renderScreen();
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['History', 'How to earn', 'How to spend']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0].id);
  });

  it('switching shows the earn list and the spend list, and logs each change', async () => {
    schoolApi.economyBank.mockResolvedValue(ok(bankData({
      offers: { 'piano.games': [{ coin: 'silver', price: 10, affordable: false }] },
    })));
    await renderScreen();
    tab('earn');
    expect(screen.getByRole('tab', { name: 'How to earn' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('bank-history')).toBeNull();
    const earn = screen.getByTestId('bank-earn');
    expect(earn).toHaveTextContent('Fractions 4-03');
    expect(earn).toHaveTextContent('Rivers');
    expect(earn).not.toHaveTextContent('Isaiah 52');
    tab('spend');
    expect(screen.getByTestId('bank-offer')).toHaveTextContent('3 more silver');
    tab('history');
    expect(screen.getByTestId('bank-history')).toBeInTheDocument();
    const changes = logged.filter((l) => l.event === 'economy.bank.tab-changed').map((l) => l.data);
    expect(changes).toEqual([
      { learnerId: 'kid', tab: 'earn' }, { learnerId: 'kid', tab: 'spend' }, { learnerId: 'kid', tab: 'history' },
    ]);
  });

  it('arrow keys, Home and End move between tabs; Escape is not bound', async () => {
    const onExit = vi.fn();
    await renderScreen({ onExit });
    const history = screen.getByRole('tab', { name: 'History' });
    history.focus();
    fireEvent.keyDown(history, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'How to earn' })).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'How to earn' }));
    fireEvent.keyDown(document.activeElement, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'How to spend' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'How to spend' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(onExit).not.toHaveBeenCalled();
  });
});

describe('BankScreen history table', () => {
  const rowsOf = (day) => within(day).getAllByTestId('bank-ledger-row');

  it('has the four column headers, once', async () => {
    await renderScreen();
    const table = screen.getByTestId('bank-ledger');
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Coin', 'Amount', 'Description', 'Balance']);
    expect(table.querySelectorAll('thead')).toHaveLength(1);
  });

  it('groups rows under day headers, newest day first', async () => {
    await renderScreen();
    const days = screen.getAllByTestId('bank-ledger-day');
    expect(days.map((d) => d.querySelector('.school-bank-ledger__day th').textContent).slice(0, 2)).toEqual(['Today', 'Yesterday']);
    expect(days).toHaveLength(3);
    expect(rowsOf(days[0])).toHaveLength(2);
    expect(rowsOf(days[1])).toHaveLength(1);
    expect(rowsOf(days[2])).toHaveLength(1);
  });

  it('each row: icon, signed amount, source and label, balance after', async () => {
    await renderScreen();
    const [today, yesterday, sunday] = screen.getAllByTestId('bank-ledger-day');
    const [earned, spent] = rowsOf(today);
    expect(earned.querySelectorAll('td')[0].querySelector('svg.coin-icon')).toHaveAttribute('data-metal', 'silver');
    expect(earned.querySelectorAll('td')[1]).toHaveTextContent('+2');
    expect(earned.querySelectorAll('td')[1].querySelector('.is-plus')).not.toBeNull();
    expect(earned.querySelectorAll('td')[2]).toHaveTextContent('Earned \u00b7 Math 4-02 passed');
    expect(earned.querySelectorAll('td')[3]).toHaveTextContent('7 silver');
    expect(spent.querySelectorAll('td')[1]).toHaveTextContent('\u22123');
    expect(spent.querySelectorAll('td')[1].querySelector('.is-minus')).not.toBeNull();
    expect(spent.querySelectorAll('td')[2]).toHaveTextContent('Spent \u00b7 early pass');
    expect(spent.querySelectorAll('td')[3]).toHaveTextContent('5 silver');
    // A conversion shows both coins and both signed amounts.
    const [convert] = rowsOf(sunday);
    const cells = convert.querySelectorAll('td');
    expect(cells[0].querySelector('svg[data-metal="silver"]')).not.toBeNull();
    expect(cells[0].querySelector('svg[data-metal="gold"]')).not.toBeNull();
    expect(cells[1]).toHaveTextContent('\u221212');
    expect(cells[1]).toHaveTextContent('+12');
    expect(cells[3]).toHaveTextContent('7 silver \u00b7 12 gold');
    expect(yesterday).toBeTruthy();
  });

  it('an unknown source shows no raw ref', async () => {
    await renderScreen();
    const [, yesterday] = screen.getAllByTestId('bank-ledger-day');
    const [row] = rowsOf(yesterday);
    expect(row).toHaveTextContent('Green day');
    expect(row.textContent).not.toMatch(/mystery-ref/);
    expect(row.querySelectorAll('td')[2].textContent).toBe('Green day');
  });

  it('lists the unpaid week\'s lines; hidden for a stale week and for no figure', async () => {
    await renderScreen();
    const pending = screen.getByTestId('bank-pending');
    expect([...pending.querySelectorAll('li')].map((li) => li.textContent))
      .toEqual(['+6 silver \u00b7 Korean (each day done)', '+3 silver \u00b7 Green day']);
    expect(pending).toHaveTextContent('+2 more possible');
    cleanup();

    schoolApi.economyBank.mockResolvedValue(ok(bankData({ studyDay: '2026-11-03' })));
    await renderScreen();
    expect(screen.queryByTestId('bank-pending')).toBeNull();
    cleanup();

    schoolApi.earningsRoster.mockResolvedValue({ ok: false, status: 500, data: null });
    await renderScreen();
    expect(screen.queryByTestId('bank-pending')).toBeNull();
    expect(screen.getByTestId('bank-ledger')).toBeInTheDocument();
  });

  it('an empty history says so', async () => {
    schoolApi.economyBank.mockResolvedValue(ok(bankData({ history: [] })));
    await renderScreen();
    expect(screen.getByTestId('bank-history')).toHaveTextContent('Nothing here yet.');
    expect(screen.queryByTestId('bank-ledger')).toBeNull();
  });

  it('an older server\'s text-only line still reads, with no amounts', async () => {
    schoolApi.economyBank.mockResolvedValue(ok(bankData({ history: [{ text: '+1 silver · Green day', at: new Date(2026, 9, 21, 8, 0).toISOString(), kind: 'earn', ids: ['x'] }] })));
    await renderScreen();
    expect(screen.getByTestId('bank-ledger-row').textContent).toContain('+1 silver · Green day');
  });
});

describe('BankScreen states and spend', () => {
  it('says what a kid is short by, and when a used pass opens again', async () => {
    schoolApi.economyBank.mockResolvedValue(ok(bankData({
      offers: { 'piano.games': [{ coin: 'silver', price: 10, affordable: false }] },
    })));
    await renderScreen();
    tab('spend');
    expect(screen.getByTestId('bank-offer')).toHaveTextContent('10 silver');
    expect(screen.getByTestId('bank-offer')).toHaveTextContent('3 more silver');
    cleanup();

    schoolApi.economyBank.mockResolvedValue(ok(bankData({
      pass: { 'piano.games': { state: 'consumed', capUsed: true } },
      offers: { 'piano.games': [{ coin: 'silver', price: 3, affordable: true }] },
    })));
    await renderScreen();
    tab('spend');
    expect(screen.getByTestId('bank-offer')).toHaveTextContent('after school is done');
    expect(screen.getByTestId('bank-offer')).not.toHaveTextContent('can buy');
  });

  it.each([['dry-run'], ['off'], [undefined]])('before coins are live (%s): coins start soon, no balance, still ways to earn', async (mode) => {
    schoolApi.economyBank.mockResolvedValue(ok(bankData({ mode, balances: { silver: 0, gold: 0, gems: 0 } })));
    await renderScreen();
    expect(screen.getByTestId('bank-soon')).toHaveTextContent(COINS_SOON);
    expect(screen.queryByTestId('bank-balances')).toBeNull();
    expect(screen.queryByTestId('bank-history')).toBeNull();
    const body = () => screen.getByTestId('bank-screen').querySelector('.school-bank-screen__body');
    expect(body().textContent).not.toMatch(/\d/);
    expect(body().textContent).not.toMatch(/in the bank/);
    tab('spend');
    expect(screen.getByTestId('bank-soon')).toBeInTheDocument();
    expect(screen.queryByTestId('bank-spend')).toBeNull();
    tab('earn');
    expect(screen.getByTestId('bank-earn')).toHaveTextContent('Fractions 4-03');
  });

  it('a failed bank read naps: the sentence, no numbers, no cache', async () => {
    schoolApi.economyBank.mockResolvedValue({ ok: false, status: 503, data: null });
    await renderScreen();
    expect(screen.getByTestId('bank-napping')).toHaveTextContent(NAPPING);
    expect(screen.queryByTestId('bank-balances')).toBeNull();
    expect(screen.queryByTestId('bank-history')).toBeNull();
    expect(screen.queryByTestId('bank-pending')).toBeNull();
    const body = () => screen.getByTestId('bank-screen').querySelector('.school-bank-screen__body');
    expect(body().textContent).not.toMatch(/\d/);
    tab('spend');
    expect(screen.getByTestId('bank-napping')).toBeInTheDocument();
    expect(screen.queryByTestId('bank-spend')).toBeNull();
    // How to earn does not come from the bank.
    tab('earn');
    expect(screen.getByTestId('bank-earn')).toHaveTextContent('Fractions 4-03');
    expect(logged).toContainEqual(expect.objectContaining({ level: 'warn', event: 'economy.bank.unavailable', data: { learnerId: 'kid', status: 503 } }));
  });

  it('nothing on sale says so on the spend tab', async () => {
    await renderScreen();
    tab('spend');
    expect(screen.getByTestId('bank-spend')).toHaveTextContent(NOTHING_TO_SPEND);
  });

  it('a later failed re-read drops the numbers it had', async () => {
    vi.useFakeTimers();
    await renderScreen();
    expect(screen.getByTestId('bank-balances')).toBeInTheDocument();
    schoolApi.economyBank.mockResolvedValue({ ok: false, status: 0, data: null });
    const school = wsHandlers.filter((h) => h.topic === 'school').at(-1).cb;
    act(() => { school({ event: 'coins-changed', learnerId: 'kid' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(screen.queryByTestId('bank-balances')).toBeNull();
    expect(screen.getByTestId('bank-napping')).toBeInTheDocument();
  });

  it('ignores another kid\'s events', async () => {
    vi.useFakeTimers();
    await renderScreen();
    const calls = schoolApi.economyBank.mock.calls.length;
    const school = wsHandlers.filter((h) => h.topic === 'school').at(-1).cb;
    act(() => { school({ event: 'coins-changed', learnerId: 'sibling' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(schoolApi.economyBank.mock.calls.length).toBe(calls);
  });

  it('logs the opening once, as economy.bank.opened from school-bank-screen', async () => {
    await renderScreen();
    const opened = logged.filter((l) => l.event === 'economy.bank.opened');
    expect(opened).toEqual([expect.objectContaining({ level: 'info', data: { learnerId: 'kid' }, ctx: { component: 'school-bank-screen' } })]);
  });

  it('Back leaves; an idle screen leaves on its own', async () => {
    const onExit = vi.fn();
    await renderScreen({ onExit });
    fireEvent.click(screen.getByTestId('screen-header-back'));
    expect(onExit).toHaveBeenCalledWith('back');
    cleanup();

    vi.useFakeTimers();
    const idleExit = vi.fn();
    await renderScreen({ onExit: idleExit, idleTimeoutSeconds: 60 });
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
    expect(idleExit).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(idleExit).toHaveBeenCalledWith('idle');
  });

  it('overlapping loads: a first read that lands last never overwrites the newer one', async () => {
    vi.useFakeTimers();
    const answers = [];
    schoolApi.economyBank.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    await renderScreen();
    const school = wsHandlers.filter((h) => h.topic === 'school').at(-1).cb;
    act(() => { school({ event: 'coins-changed', learnerId: 'kid' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(answers).toHaveLength(2);
    await act(async () => { answers[1](ok(bankData({ balances: { silver: 9, gold: 12, gems: 1 } }))); });
    await act(async () => { answers[0](ok(bankData({ balances: { silver: 3, gold: 12, gems: 1 } }))); });
    const silver = screen.getByTestId('bank-balances').querySelector('.ds-stat');
    expect(silver).toHaveTextContent('9');
    expect(silver).not.toHaveTextContent('3');
  });
});

describe('BankScreen coins', () => {
  it('the balances draw the standard silver and gold coins', async () => {
    await renderScreen();
    const balances = screen.getByTestId('bank-balances');
    expect(balances.querySelectorAll('svg.coin-icon[data-metal="silver"]')).toHaveLength(1);
    expect(balances.querySelectorAll('svg.coin-icon[data-metal="gold"]')).toHaveLength(1);
    expect(balances.querySelectorAll('svg.gem-icon')).toHaveLength(1);
  });
});
