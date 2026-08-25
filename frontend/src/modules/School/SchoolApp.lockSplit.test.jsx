import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SchoolApp from './SchoolApp.jsx';

vi.mock('./schoolApi.js', () => ({
  schoolApi: {
    roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'milo', name: 'Milo', birthyear: 2016 }] })),
    wallet: vi.fn(async () => ({ ok: false, status: 503, data: null })),
    surfaceProfile: vi.fn(async () => ({ ok: true, status: 200, data: { surfaceId: 'screen-browser' } })),
    materials: vi.fn(async () => ({ ok: true, status: 200, data: { materials: [] } })),
    banks: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    agendaPreview: vi.fn(async () => ({ ok: true, status: 200, data: { sections: [{ subject: 'math' }, { subject: 'reading' }] } })),
    teacherDay: vi.fn(async () => ({ ok: true, status: 200, data: { learners: [{ learnerId: 'milo', sessions: [{ subject: 'math', outcome: { result: 'passed' } }] }] } })),
  },
}));
vi.mock('./Programs/SentenceLadder/languageApi.js', () => ({
  languageApi: { courses: vi.fn(async () => ({ ok: true, status: 200, data: [] })) },
}));
vi.mock('./useSchoolLaunch.js', () => ({ useSchoolLaunch: vi.fn() }));
vi.mock('./selfService/useScanCeremony.js', () => ({ useScanCeremony: () => ({ current: null, clear: vi.fn() }) }));
vi.mock('./selfService/useSelfService.js', () => ({
  DEFAULT_IDLE_TIMEOUT_SECONDS: 120,
  useSelfService: () => ({
    view: 'keypad', submit: vi.fn(), busy: false, message: null, degraded: false,
    retry: vi.fn(), reload: vi.fn(), card: null, sentence: null, runAction: vi.fn(), confirmPrint: vi.fn(), exit: vi.fn(),
  }),
}));
vi.mock('../../hooks/useShutdownLock.js', () => ({
  useShutdownLock: () => ({ locked: false }),
  ShutdownBlackout: () => null,
}));
vi.mock('../../lib/fkb.js', () => ({ screenOff: vi.fn(() => true) }));

describe('locked kiosk split home', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ presence: { devices: [] } }) }));
    window.history.replaceState({}, '', '/screens/portal');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  it('renders keypad AND the read-only status board side by side', async () => {
    render(<SchoolApp mode="locked" />);
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
    expect(await screen.findByTestId('agenda-status-board')).toBeInTheDocument();
    const split = document.querySelector('.school-lock-split');
    expect(split).toBeTruthy();
    expect(split.getAttribute('data-side')).toBe('keypad-left');
    expect(screen.getByText('Milo')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('swaps sides every 90s without losing keypad entry', async () => {
    vi.useFakeTimers();
    render(<SchoolApp mode="locked" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(screen.getByTestId('selfservice-keypad')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '1' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: '2' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    const split = document.querySelector('.school-lock-split');
    expect(split.getAttribute('data-side')).toBe('keypad-right');
    // The half-typed code survives the flip.
    const slots = [...document.querySelectorAll('.school-selfservice__slot')].map((el) => el.textContent);
    expect(slots.slice(0, 2)).toEqual(['1', '2']);
  });
});
