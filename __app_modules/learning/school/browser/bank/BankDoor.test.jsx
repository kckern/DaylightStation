import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ open: vi.fn(), logged: [] }));
vi.mock("../schoolApi.js", () => ({ schoolApi: { bankOpen: (...a) => h.open(...a) } }));
vi.mock("../../../../../frontend/src/lib/identity/ProfileAvatar.jsx", () => ({ default: () => <span>avatar</span> }));
vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const child = () => ({
    info: (event, data) => h.logged.push({ level: 'info', event, data }),
    warn: (event, data) => h.logged.push({ level: 'warn', event, data }),
    error: () => {}, debug: () => {},
  });
  const getLogger = () => ({ child });
  return { default: getLogger, getLogger };
});

import { useBankDoor, BankDoorButton, BankDoorSheet, OPEN_FAILED } from "./BankDoor.jsx";

const ROSTER = [{ id: 'child', name: 'Child' }, { id: 'sibling', name: 'Sibling' }];
const TARGET = { kind: 'program', program: 'economy-bank', learnerId: 'child', bankGrant: 'panel-bank-grant' };

let door = null;
function Harness({ onLaunch }) {
  door = useBankDoor({ screenId: 'portal', onLaunch });
  return (<><BankDoorButton door={door} /><BankDoorSheet door={door} roster={ROSTER} /></>);
}

beforeEach(() => {
  h.open.mockReset().mockResolvedValue({ ok: true, status: 200, data: { launchTarget: TARGET } });
  h.logged.length = 0;
  door = null;
});

describe('BankDoor', () => {
  it('the coin button asks whose bank, then opens it with the minted grant', async () => {
    const onLaunch = vi.fn();
    render(<Harness onLaunch={onLaunch} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('bank-door'));
    expect(screen.getByRole('dialog', { name: 'Whose bank' })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Child' })));
    expect(h.open).toHaveBeenCalledWith({ screenId: 'portal', learnerId: 'child' });
    expect(onLaunch).toHaveBeenCalledWith(TARGET, 'child');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(JSON.stringify(h.logged)).not.toContain('panel-bank-grant');
  });

  it('a chip names the kid, so it opens straight through the same request', async () => {
    const onLaunch = vi.fn();
    render(<Harness onLaunch={onLaunch} />);
    await act(async () => { await door.choose('child', 'chip'); });
    expect(h.open).toHaveBeenCalledWith({ screenId: 'portal', learnerId: 'child' });
    expect(onLaunch).toHaveBeenCalledWith(TARGET, 'child');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.logged).toContainEqual({ level: 'info', event: 'economy.bank.door-opened', data: { learnerId: 'child', via: 'chip', screenId: 'portal' } });
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

  it('no grant, or no network, is the plain sentence', async () => {
    h.open.mockResolvedValue({ ok: true, status: 200, data: { launchTarget: { ...TARGET, bankGrant: null } } });
    const onLaunch = vi.fn();
    render(<Harness onLaunch={onLaunch} />);
    await act(async () => { await door.choose('child'); });
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(OPEN_FAILED);
  });

  it('Back drops a late answer: nothing opens for a kid who walked away', async () => {
    let answer;
    h.open.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const onLaunch = vi.fn();
    render(<Harness onLaunch={onLaunch} />);
    fireEvent.click(screen.getByTestId('bank-door'));
    fireEvent.click(screen.getByRole('button', { name: 'Child' }));
    fireEvent.click(screen.getByTestId('screen-header-back'));
    await act(async () => { answer({ ok: true, status: 200, data: { launchTarget: TARGET } }); });
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
