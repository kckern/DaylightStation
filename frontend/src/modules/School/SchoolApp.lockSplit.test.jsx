import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SchoolApp from './SchoolApp.jsx';

vi.mock('./schoolApi.js', () => ({
  schoolApi: {
    roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'learner3', name: 'Learner3', birthyear: 2016 }] })),
    wallet: vi.fn(async () => ({ ok: false, status: 503, data: null })),
    surfaceProfile: vi.fn(async () => ({ ok: true, status: 200, data: { surfaceId: 'screen-browser' } })),
    materials: vi.fn(async () => ({ ok: true, status: 200, data: { materials: [] } })),
    banks: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    // Discs are per-ASSIGNMENT now, so the fixture has to carry unit ids.
    agendaPreview: vi.fn(async () => ({ ok: true, status: 200, data: {
      sections: [{ subject: 'math', next: { unitId: 'math.01' } }, { subject: 'reading', next: { unitId: 'read.01' } }],
      entries: [{ unitId: 'math.01', subject: 'math' }, { unitId: 'read.01', subject: 'reading' }],
    } })),
    teacherDay: vi.fn(async () => ({ ok: true, status: 200, data: { learners: [{ learnerId: 'learner3', sessions: [{ unitId: 'math.01', subject: 'math', outcome: { result: 'passed' } }] }] } })),
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

const side = () => document.querySelector('.school-lock-split').getAttribute('data-side');
const slots = () => [...document.querySelectorAll('.school-selfservice__slot')].map((el) => el.textContent);
/** A wall-panel jab: pointerdown lands the key, the click is its own release. */
const jab = (name) => {
  const key = screen.getByRole('button', { name });
  fireEvent.pointerDown(key);
  fireEvent.click(key);
};
/**
 * Wall-clock passage, in slices. React flushes passive effects on a macrotask
 * the fake clock does not own, so ONE long `advanceTimersByTimeAsync` runs
 * every interval tick before the effect that released the flip has committed —
 * a harness artefact that would read as "the flip never came".
 */
const advance = async (ms, slice = 5_000) => {
  for (let left = ms; left > 0; left -= slice) {
     
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(slice, left)); });
  }
};

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
    expect(screen.getByText('Learner3')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('swaps sides every 90s on an idle panel, without remounting the keypad', async () => {
    vi.useFakeTimers();
    render(<SchoolApp mode="locked" />);
    await advance(50);
    const keypad = screen.getByTestId('selfservice-keypad');
    await advance(91_000);
    expect(side()).toBe('keypad-right');
    // The flip is a LAYOUT flip: the very same element, never a remount — which
    // is what "keypad entry survives" was really guarding. Entry state can no
    // longer be observed across a flip, because a code in progress now holds
    // the flip back (see the deferral tests below).
    expect(screen.getByTestId('selfservice-keypad')).toBe(keypad);
  });

  /* BURN-IN MITIGATION MAY NEVER PREEMPT AN INTERACTION IN PROGRESS.
     `direction: rtl` moves the whole pad to the other half of a 1280x800
     screen. The typed digits survive it; the KEYS do not stay under the finger
     already reaching for them, and a child mid-code taps where a key no longer
     is. So the flip waits for a genuinely idle panel. */

  it('holds the flip while a code is half typed, and keeps the digits', async () => {
    vi.useFakeTimers();
    render(<SchoolApp mode="locked" />);
    await advance(50);
    jab('1'); jab('2');
    // A child copying six digits off a paper slip, one at a time. The pad is
    // MID-CODE at the moment the flip comes due, with no recent touch at all —
    // which is exactly why recency alone cannot be the whole test.
    await advance(50_000);
    jab('3');
    await advance(41_000);
    expect(side()).toBe('keypad-left');
    expect(slots().slice(0, 3)).toEqual(['1', '2', '3']);
  });

  it('flips promptly once the entry is cleared — not a further full 90s', async () => {
    vi.useFakeTimers();
    render(<SchoolApp mode="locked" />);
    await advance(50);
    jab('1'); jab('2');
    await advance(50_000);
    jab('3');
    await advance(41_000);
    expect(side()).toBe('keypad-left');   // deferred, and now overdue
    jab('Clear');
    // Only the quiet window after that tap, plus a tick — nowhere near another
    // 90s. A code finished at second 89 costs the flip seconds, not a cycle.
    await advance(10_000);
    expect(side()).toBe('keypad-right');
  });

  it('holds the flip for a moment after the last touch, even on an empty entry', async () => {
    vi.useFakeTimers();
    render(<SchoolApp mode="locked" />);
    await advance(85_000);
    jab('1');
    jab('Backspace');            // entry back to empty, but a finger was just here
    await advance(6_000);
    expect(side()).toBe('keypad-left');
    await advance(6_000);
    expect(side()).toBe('keypad-right');
  });

  it('an abandoned half-typed code cannot pin the bright half of the screen', async () => {
    // Nobody is standing there any more. Without a bound, three digits left on
    // screen at bedtime would hold the flip until morning — burn-in protection
    // starved by litter.
    vi.useFakeTimers();
    render(<SchoolApp mode="locked" />);
    await advance(50);
    jab('1'); jab('2');
    await advance(50_000);
    jab('3');                                 // still here at t=50s…
    await advance(45_000);
    expect(side()).toBe('keypad-left');        // …so the flip is deferred at 90s
    expect(slots()[0]).toBe('1');
    // …and then walks off. The entry is litter, not an interaction: it clears
    // itself, and the overdue flip lands on the next quiet tick.
    await advance(70_000);
    expect(slots().slice(0, 3)).toEqual(['', '', '']);
    expect(side()).toBe('keypad-right');
  });
});
