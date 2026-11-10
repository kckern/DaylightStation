import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ open: vi.fn(), logged: [] }));
vi.mock("../schoolApi.js", () => ({ schoolApi: { bankOpen: (...a) => h.open(...a) } }));
vi.mock("../../../../../frontend/src/lib/identity/ProfileAvatar.jsx", () => ({ default: () => <span>avatar</span> }));
vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const child = (ctx) => ({
    info: (event, data) => h.logged.push({ level: 'info', event, data, ctx }),
    warn: (event, data) => h.logged.push({ level: 'warn', event, data, ctx }),
    error: () => {}, debug: () => {},
  });
  const getLogger = () => ({ child });
  return { default: getLogger, getLogger };
});

import { useBankDoor, BankDoorSheet, OPEN_FAILED } from "./BankDoor.jsx";

const ROSTER = [{ id: 'child', name: 'Child' }, { id: 'sibling', name: 'Sibling' }];
const TARGET = { kind: 'program', program: 'economy-bank', learnerId: 'child' };

let door = null;
function Harness({ onLaunch, idleTimeoutSeconds = 0 }) {
  door = useBankDoor({ screenId: 'portal', onLaunch });
  return (<><button type="button" data-testid="trigger">cell</button><BankDoorSheet door={door} roster={ROSTER} idleTimeoutSeconds={idleTimeoutSeconds} /></>);
}

beforeEach(() => {
  h.open.mockReset().mockResolvedValue({ ok: true, status: 200, data: { launchTarget: TARGET } });
  h.logged.length = 0;
  door = null;
});

describe('BankDoor', () => {
  it('a refusal opens "Whose bank?"; a face tap there opens that bank: program and learner, no grant', async () => {
    const onLaunch = vi.fn();
    h.open.mockResolvedValueOnce({ ok: false, status: 403, data: { error: 'Choose a current School learner.' } });
    render(<Harness onLaunch={onLaunch} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { await door.choose('ghost', 'coin-cell'); });
    expect(screen.getByRole('dialog', { name: 'Whose bank' })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Child' })));
    expect(h.open).toHaveBeenLastCalledWith({ screenId: 'portal', learnerId: 'child' });
    expect(onLaunch).toHaveBeenCalledWith(TARGET, 'child');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.logged.every((l) => l.ctx?.component === 'school-bank-door')).toBe(true);
  });

  it('a chip names the kid, so it opens straight through the same request', async () => {
    const onLaunch = vi.fn();
    render(<Harness onLaunch={onLaunch} />);
    await act(async () => { await door.choose('child', 'chip'); });
    expect(h.open).toHaveBeenCalledWith({ screenId: 'portal', learnerId: 'child' });
    expect(onLaunch).toHaveBeenCalledWith(TARGET, 'child');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.logged).toContainEqual(expect.objectContaining({ level: 'info', event: 'economy.bank.door-opened', data: { learnerId: 'child', via: 'chip', screenId: 'portal' } }));
  });

  it('a refusal stands on the "whose bank" screen, in the server\'s words', async () => {
    h.open.mockResolvedValue({ ok: false, status: 403, data: { error: 'Choose a current School learner.' } });
    const onLaunch = vi.fn();
    render(<Harness onLaunch={onLaunch} />);
    await act(async () => { await door.choose('ghost', 'chip'); });
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Choose a current School learner.');
    expect(screen.getByRole('dialog', { name: 'Whose bank' })).toBeTruthy();
  });

  it('a target for another program or another kid, or no network, is the plain sentence', async () => {
    h.open.mockResolvedValue({ ok: true, status: 200, data: { launchTarget: { ...TARGET, learnerId: 'sibling' } } });
    const onLaunch = vi.fn();
    render(<Harness onLaunch={onLaunch} />);
    await act(async () => { await door.choose('child'); });
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(OPEN_FAILED);
  });

  it('Back drops a late answer: nothing opens for a kid who walked away', async () => {
    let answer;
    const onLaunch = vi.fn();
    render(<Harness onLaunch={onLaunch} />);
    h.open.mockResolvedValueOnce({ ok: false, status: 403, data: { error: 'Choose a current School learner.' } });
    await act(async () => { await door.choose('ghost', 'coin-cell'); });
    h.open.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Child' }));
    fireEvent.click(screen.getByTestId('screen-header-back'));
    await act(async () => { answer({ ok: true, status: 200, data: { launchTarget: TARGET } }); });
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a 404 (door not wired) never shows the server\'s words', async () => {
    h.open.mockResolvedValue({ ok: false, status: 404, data: { error: 'bank door not configured' } });
    render(<Harness onLaunch={vi.fn()} />);
    await act(async () => { await door.choose('child', 'chip'); });
    expect(screen.getByRole('alert').textContent).toBe(OPEN_FAILED);
  });

  it('focus moves to Back on open and returns to what opened it on close', async () => {
    h.open.mockResolvedValueOnce({ ok: false, status: 403, data: { error: 'Choose a current School learner.' } });
    render(<Harness onLaunch={vi.fn()} />);
    const cell = screen.getByTestId('trigger');
    cell.focus();
    await act(async () => { await door.choose('ghost', 'coin-cell'); });
    expect(document.activeElement).toBe(screen.getByTestId('screen-header-back'));
    fireEvent.click(screen.getByTestId('screen-header-back'));
    expect(document.activeElement).toBe(cell);
  });

  it('an untouched sheet closes itself, refusal and all', async () => {
    vi.useFakeTimers();
    try {
      h.open.mockResolvedValue({ ok: false, status: 403, data: { error: 'Choose a current School learner.' } });
      render(<Harness onLaunch={vi.fn()} idleTimeoutSeconds={30} />);
      await act(async () => { await door.choose('ghost', 'chip'); });
      expect(screen.getByRole('alert')).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
      expect(screen.queryByRole('dialog')).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
