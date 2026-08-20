/**
 * The locked self-service panel (self-service access codes design, §3).
 *
 * These drive SchoolApp mounted the way `portal.yml` mounts it — as a widget
 * with no `clear` — plus the per-screen `school: { mode: locked }` narrowing.
 * Everything below is the child's view of the wall panel: a keypad, a launch
 * card, and the two ways out (exit, idle timeout).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import SchoolApp from '#frontend/modules/School/SchoolApp.jsx';

// Capture the WS subscriber so a `school.launch` broadcast can be pushed
// through the REAL useSchoolLaunch hook (pattern: SchoolApp.launch.test.jsx).
const h = vi.hoisted(() => ({ handlers: [] }));
vi.mock('#frontend/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_topic, cb) => { h.handlers[0] = cb; },
}));

const selfServiceLog = vi.fn();
const selfServiceErrorLog = vi.fn();
vi.mock('#frontend/modules/School/schoolLog.js', () => ({
  schoolLog: {
    profile: vi.fn(), session: vi.fn(), answer: vi.fn(), answerError: vi.fn(),
    bank: vi.fn(), nav: vi.fn(), home: vi.fn(), materials: vi.fn(), materialsError: vi.fn(),
    print: vi.fn(), typing: vi.fn(), player: vi.fn(), surface: vi.fn(),
    feedback: vi.fn(), feedbackError: vi.fn(), standing: vi.fn(), standingError: vi.fn(),
    teacherToday: vi.fn(), teacherTodayError: vi.fn(),
    selfService: (...a) => selfServiceLog(...a),
    selfServiceError: (...a) => selfServiceErrorLog(...a),
  },
  default: {},
}));

const resolveMock = vi.fn();
const actMock = vi.fn();
const openSessionMock = vi.fn();
const screenConfigMock = vi.fn();

vi.mock('#frontend/modules/School/schoolApi.js', () => ({
  schoolApi: {
    roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'kid1', name: 'Alpha', birthyear: 2016 }] })),
    banks: vi.fn(async () => ({
      ok: true, status: 200,
      data: [{ id: 'caps', title: 'Caps', audience: 'assigned', subject: null, itemCount: 1 }],
    })),
    bank: vi.fn(async (id) => ({
      ok: true, status: 200,
      data: { id, title: 'Caps', audience: 'assigned', items: [{ id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] }] },
    })),
    openSession: (...a) => openSessionMock(...a),
    answer: vi.fn(async () => ({ ok: true, status: 200, data: { correct: true, expected: 'Olympia', attemptId: 'att_1' } })),
    materials: vi.fn(async () => ({ ok: true, status: 200, data: { sections: [], materials: [] } })),
    materialUnits: vi.fn(async () => ({ ok: true, status: 200, data: { material: {}, units: [] } })),
    unitProgress: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
    quizRequests: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    requestQuiz: vi.fn(async () => ({ ok: true, status: 200, data: { requested: true, duplicate: false } })),
    report: vi.fn(async () => ({ ok: true, status: 200, data: { learners: [] } })),
    results: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    materialProgress: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    surfaceProfile: vi.fn(async () => ({ ok: false, status: 404, data: null })),
    certification: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    periods: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    reportCard: vi.fn(async () => ({ ok: true, status: 200, data: null })),
    reviewLearner: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    agendaPreview: vi.fn(async () => ({ ok: true, status: 200, data: { sections: [] } })),
    selfServiceResolve: (...a) => resolveMock(...a),
    selfServiceAct: (...a) => actMock(...a),
    screenSchoolConfig: (...a) => screenConfigMock(...a),
  },
  default: {},
}));

vi.mock('#frontend/modules/School/Programs/Glossika/languageApi.js', () => ({
  languageApi: {
    courses: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    day: vi.fn(async () => ({ ok: true, status: 200, data: null })),
    log: vi.fn(), roll: vi.fn(), pacing: vi.fn(), history: vi.fn(), recording: vi.fn(),
    audioUrl: () => '', recordingUrl: () => '',
  },
}));

vi.mock('#frontend/modules/Player/Player.jsx', () => ({
  default: ({ play }) => <div data-testid="player-stub">Player: {play?.contentId ?? 'none'}</div>,
}));

// Labels here are FIXTURE values, not the domain's wording. `offeredActions`
// owns what every button says (and Task 5 is changing several of them right
// now: the media button gains a room name, `retry` splits paper from screen).
// So these tests assert that whatever label ARRIVES is what renders — never
// that a particular sentence is correct. See the pass-through test below.
const MOVE_CARD = {
  ok: true,
  learner: 'kid1',
  learnerId: 'kid1',
  subject: 'Mathematics',
  title: 'Fractions 3',
  sentence: null,
  actions: [
    { kind: 'print', label: 'Print your sheet' },
    { kind: 'exit', label: 'Go back' },
  ],
};

beforeEach(() => {
  localStorage.clear();
  h.handlers.length = 0;
  selfServiceLog.mockClear();
  selfServiceErrorLog.mockClear();
  openSessionMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { sessionId: 'ses_1' } });
  resolveMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: MOVE_CARD });
  actMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { outcome: 'issued', sentence: 'Printing now.' } });
  screenConfigMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: {} });
});

/**
 * Find a card button by the action's KIND. Labels belong to `offeredActions`
 * and move with session state and config (Task 5 is changing two of them right
 * now), so no test should have to know what a button says in order to press it.
 * Yes / No / Done / the digits are LaunchCard's and Keypad's own words, so
 * those are matched by name quite deliberately.
 */
const actionButton = (kind) => screen.getByTestId(`selfservice-action-${kind}`);
const findActionButton = (kind) => screen.findByTestId(`selfservice-action-${kind}`);

/** Tap a code into the keypad and submit it. */
async function typeCode(code) {
  for (const digit of String(code)) {
    fireEvent.click(await screen.findByRole('button', { name: digit }));
  }
  fireEvent.click(screen.getByRole('button', { name: /^(go|enter)$/i }));
}

const renderLocked = (props = {}) => render(<SchoolApp mode="locked" {...props} />);

describe('locked panel — which surface renders', () => {
  it('lock mode renders the keypad instead of the browsable home', async () => {
    renderLocked();
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
    // The subject wall never mounts: no shelves, no breadcrumb.
    expect(screen.queryByText('Civilization')).toBeNull();
    expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).toBeNull();
  });

  it('unlocked mode still renders the normal browsable home', async () => {
    render(<SchoolApp clear={() => {}} />);
    expect(await screen.findByText('Civilization')).toBeInTheDocument();
    expect(screen.queryByTestId('selfservice-keypad')).toBeNull();
  });

  it('names no learner on the lock screen', async () => {
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    // 'Alpha' is the only roster learner in these fixtures; a lock screen that
    // named her would tell a child whose codes to guess.
    expect(screen.queryByText(/alpha/i)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('locked panel — typing a code', () => {
  it('a wrong code says "Try again" and leaves the keypad usable', async () => {
    resolveMock.mockResolvedValueOnce({ ok: true, status: 200, data: { ok: false, sentence: 'Try again' } });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');

    await typeCode('111111');
    expect(await screen.findByText(/try again/i)).toBeInTheDocument();
    await waitFor(() => expect(selfServiceLog).toHaveBeenCalledWith('code.rejected', expect.anything()));

    // Still a live keypad — no lockout, no dead buttons: the next code works.
    await typeCode('481920');
    expect(await screen.findByText('Fractions 3')).toBeInTheDocument();
  });

  it('a valid code renders the launch card with its offered actions', async () => {
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');

    expect(await screen.findByText('Fractions 3')).toBeInTheDocument();
    expect(screen.getByText('Mathematics')).toBeInTheDocument();
    expect(actionButton('print')).toBeInTheDocument();
    expect(actionButton('exit')).toBeInTheDocument();
    expect(resolveMock).toHaveBeenCalledWith('481920');
    await waitFor(() => expect(selfServiceLog).toHaveBeenCalledWith('code.resolved', expect.anything()));
  });

  it('the exit on the card returns to the lock screen', async () => {
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('exit'));

    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
    expect(screen.queryByText('Fractions 3')).toBeNull();
  });
});

describe('locked panel — printing', () => {
  it('a normal print asks "Did it print?" and Yes returns to the lock screen', async () => {
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('print'));

    expect(await screen.findByText(/did it print\?/i)).toBeInTheDocument();
    expect(actMock).toHaveBeenCalledWith({ code: '481920', action: 'print' });

    fireEvent.click(screen.getByRole('button', { name: /^yes$/i }));
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
    await waitFor(() => expect(selfServiceLog).toHaveBeenCalledWith('print.confirmed', expect.anything()));
  });

  it('"No" recomputes the card from the server rather than relabelling here', async () => {
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('print'));

    // The session is at `issued` now, so the DOMAIN answers with its own
    // reprint wording. The panel must show whatever it sends, not invent it.
    resolveMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { ...MOVE_CARD, actions: [{ kind: 'print', label: 'ZZ-REPRINT-LABEL' }, { kind: 'exit', label: 'Go back' }] },
    });
    fireEvent.click(await screen.findByRole('button', { name: /^no$/i }));

    // A print is offered again — keyed on KIND. Whether the domain calls it
    // "Print it again" at `issued` is the domain's business, not this test's.
    expect(await findActionButton('print')).toBeInTheDocument();
    expect(screen.queryByText(/did it print\?/i)).toBeNull();
    // A second /resolve is the recompute; without it the frontend would have
    // had to decide the reprint wording itself.
    await waitFor(() => expect(resolveMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(selfServiceLog).toHaveBeenCalledWith('print.retried', expect.anything()));
  });

  it('"No" on a recompute that fails lands on words, not a stuck confirm', async () => {
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('print'));

    resolveMock.mockResolvedValueOnce({ ok: false, status: 0, data: null });
    fireEvent.click(await screen.findByRole('button', { name: /^no$/i }));

    expect(await screen.findByText(/school computer isn.t answering/i)).toBeInTheDocument();
    expect(screen.queryByText(/did it print\?/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
  });

  it('a debounced print renders words rather than the backend\'s silence', async () => {
    // IssueDocument's cooldown answers with an EMPTY message by design — that
    // silence was written for thermal slips, and on a screen it reads as a
    // dead button.
    actMock.mockResolvedValueOnce({ ok: true, status: 200, data: { outcome: 'debounced', sentence: '' } });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('print'));

    expect(await screen.findByText(/already on its way/i)).toBeInTheDocument();
    await waitFor(() => expect(selfServiceLog).toHaveBeenCalledWith('print.debounced', expect.anything()));
    // And it is not the "Did it print?" confirm — the child is told to wait.
    expect(screen.queryByText(/did it print\?/i)).toBeNull();
  });
});

describe('locked panel — play and launch', () => {
  it('shows the returned sentence verbatim and Done returns to the lock screen', async () => {
    resolveMock.mockResolvedValue({
      ok: true, status: 200,
      data: { ...MOVE_CARD, actions: [{ kind: 'play', label: 'Play in the living room', target: 'livingroom-tv' }, { kind: 'exit', label: 'Go back' }] },
    });
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { outcome: 'pending_approval', sentence: 'A grown-up has to say yes first.' },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('play'));

    expect(await screen.findByText('A grown-up has to say yes first.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
  });
});

describe('locked panel — on-screen work registers a sitting', () => {
  it('a screen action mounts the runner through the same start() path the SPA uses', async () => {
    resolveMock.mockResolvedValue({
      ok: true, status: 200,
      data: { ...MOVE_CARD, actions: [{ kind: 'screen', label: 'Answer on the screen' }, { kind: 'exit', label: 'Go back' }] },
    });
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { outcome: 'on_screen', sentence: 'Answer on the screen.', target: { kind: 'bank', bankId: 'caps' } },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('screen'));

    // QuizRunner's first question — and, decisively, a session opened through
    // schoolApi.openSession, which is what PortalSurface.occupancy() reads.
    expect(await screen.findByText('WA?')).toBeInTheDocument();
    await waitFor(() => expect(openSessionMock).toHaveBeenCalled());
    expect(openSessionMock.mock.calls[0][0]).toMatchObject({ bankId: 'caps' });
  });
});

describe('locked panel — school.launch still lands', () => {
  it('a broadcast launch opens the quiz even while the panel is locked', async () => {
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    // `banks` lands on its own un-awaited promise, separate from the one that
    // gates the first render — fire before it resolves and onPortalLaunch
    // correctly (but flakily, from here) sees an empty list. Flush it first.
    await waitFor(() => expect(h.handlers[0]).toBeTypeOf('function'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => {
      h.handlers[0]({ topic: 'school', type: 'school.launch', learnerId: 'kid1', target: { kind: 'bank', bankId: 'caps' } });
    });

    expect(await screen.findByText('WA?')).toBeInTheDocument();
    await waitFor(() => expect(openSessionMock).toHaveBeenCalled());
  });
});

describe('locked panel — idle timeout', () => {
  it('returns to the lock screen after the configured idle window', async () => {
    renderLocked({ idleTimeoutSeconds: 0.25 });
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    expect(await screen.findByText('Fractions 3')).toBeInTheDocument();

    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
    expect(screen.queryByText('Fractions 3')).toBeNull();
    await waitFor(() => expect(selfServiceLog).toHaveBeenCalledWith('idle.timeout', expect.anything()));
  });
});

describe('locked panel — the domain owns the wording', () => {
  it('renders every action.label verbatim and sends back action.kind', async () => {
    // Deliberately nonsense labels: if either renders as anything else, the
    // frontend is deciding wording it does not own. Task 5 is changing the real
    // strings under us (the media button gains a room name, `retry` becomes
    // composition-aware) — this test survives that because it asserts
    // pass-through, not content.
    resolveMock.mockResolvedValue({
      ok: true, status: 200,
      data: {
        ...MOVE_CARD,
        actions: [
          { kind: 'retry', label: 'ZZ-ARBITRARY-RETRY' },
          { kind: 'exit', label: 'ZZ-ARBITRARY-EXIT' },
        ],
      },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');

    expect(await findActionButton('retry')).toHaveTextContent('ZZ-ARBITRARY-RETRY');
    expect(actionButton('exit')).toHaveTextContent('ZZ-ARBITRARY-EXIT');

    fireEvent.click(actionButton('retry'));
    // `kind` is the action's identity — it is what /act looks up. The label
    // never goes back over the wire.
    await waitFor(() => expect(actMock).toHaveBeenCalledWith({ code: '481920', action: 'retry' }));
  });

  it('a card with no work on it is still a card, not a refusal', async () => {
    // `served` and `locked` resolutions carry a sentence and only an exit.
    // Without `ok`, that is indistinguishable from a bad code — and telling a
    // child who already finished their maths that they mistyped would be a lie.
    resolveMock.mockResolvedValue({
      ok: true, status: 200,
      data: {
        ok: true, learner: 'kid1', subject: 'Mathematics', title: 'Fractions 3',
        sentence: 'You already did this today.',
        actions: [{ kind: 'exit', label: 'Go back' }],
      },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');

    expect(await screen.findByTestId('selfservice-card')).toBeInTheDocument();
    expect(screen.getByText('You already did this today.')).toBeInTheDocument();
    expect(screen.getByText('Fractions 3')).toBeInTheDocument();
    // Emphatically NOT the keypad's refusal path.
    expect(screen.queryByTestId('selfservice-keypad')).toBeNull();
    expect(selfServiceLog).not.toHaveBeenCalledWith('code.rejected', expect.anything());
  });

  it('a bad code and a backend fault do not look the same on the wall', async () => {
    resolveMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { ok: false, reason: 'unknown_code', sentence: 'Try again.', actions: [] },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('111111');

    // A minting/expiry bug must not read as an outage, or the two are
    // indistinguishable to whoever is standing at the panel.
    expect(await screen.findByText('Try again.')).toBeInTheDocument();
    expect(screen.queryByText(/school computer isn.t answering/i)).toBeNull();
  });

  it('prefers the `reason` discriminator over the sentence for a fault', async () => {
    // The retry affordance must survive the backend rewording its copy for a
    // child — matching on the sentence alone makes a typo a dead end.
    resolveMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { ok: false, reason: 'not_answering', sentence: 'Something went wrong at school HQ.', actions: [] },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');

    expect(await screen.findByText('Something went wrong at school HQ.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByText('Fractions 3')).toBeInTheDocument();
  });
});

describe('locked panel — escape', () => {
  it('returns to the lock screen WITHOUT swallowing the key', async () => {
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    await screen.findByText('Fractions 3');

    // portal.yml maps idle escape to `reload` — the kiosk's only refresh
    // affordance, since FKB has no address bar. Consuming the event here
    // would strand the panel on a bad deploy.
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(event); });

    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
    expect(event.defaultPrevented).toBe(false);
    expect(event.cancelBubble).toBe(false);
  });

  it('is not even bound while the panel is idle', async () => {
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByTestId('selfservice-keypad')).toBeInTheDocument();
  });
});

describe('locked panel — degraded backend', () => {
  it('a 404 from /resolve says so in words and offers a retry, keypad alive', async () => {
    resolveMock.mockResolvedValueOnce({ ok: false, status: 404, data: null });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');

    expect(await screen.findByText(/school computer isn.t answering/i)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /try again|retry/i });

    // The retry re-attempts the same code; the keypad was never dead.
    fireEvent.click(retry);
    expect(await screen.findByText('Fractions 3')).toBeInTheDocument();
    expect(resolveMock).toHaveBeenCalledTimes(2);
  });

  it('an unreachable backend (network error) degrades the same way', async () => {
    resolveMock.mockResolvedValue({ ok: false, status: 0, data: null });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');

    expect(await screen.findByText(/school computer isn.t answering/i)).toBeInTheDocument();
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
  });

  it('a fault the backend caught (200 + the not-answering card) still offers a retry', async () => {
    // ResolveAccessCode never throws: it catches its own faults and answers a
    // 200 `{ok:false}` carrying the not-answering wording. Read as a plain
    // wrong code, that would leave a keypad with no retry.
    resolveMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { ok: false, learner: null, subject: null, title: null, sentence: "The school computer isn't answering. Tell a grown-up.", actions: [] },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');

    expect(await screen.findByText(/school computer isn.t answering/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByText('Fractions 3')).toBeInTheDocument();
  });

  it('a 500 from /resolve degrades rather than showing "Try again"', async () => {
    resolveMock.mockResolvedValueOnce({ ok: false, status: 500, data: { error: 'boom' } });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');

    expect(await screen.findByText(/school computer isn.t answering/i)).toBeInTheDocument();
    await waitFor(() => expect(selfServiceErrorLog).toHaveBeenCalled());
  });
});
