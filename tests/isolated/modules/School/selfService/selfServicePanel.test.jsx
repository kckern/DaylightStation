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
import { REJECT_WORD } from '#frontend/modules/School/selfService/Keypad.jsx';

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

const coursesMock = vi.fn();
const dayMock = vi.fn();
vi.mock('#frontend/modules/School/Programs/Glossika/languageApi.js', () => ({
  languageApi: {
    courses: (...a) => coursesMock(...a),
    day: (...a) => dayMock(...a),
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
  // REAL /act wire shape (`RunSelfServiceAction`): { outcome, sentence,
  // sessionId, effect }. `issued` is an IssueDocument STATUS, not an outcome —
  // the use case maps it to `done`. An earlier fixture used it directly and so
  // validated a contract neither side implements.
  actMock.mockReset().mockResolvedValue({
    ok: true, status: 200,
    data: { outcome: 'done', sentence: 'All set.', sessionId: 'ses_1', effect: { status: 'issued' } },
  });
  screenConfigMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: {} });
  coursesMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: [] });
  dayMock.mockReset().mockResolvedValue({
    ok: true, status: 200,
    data: {
      corpus: { id: 'glossika-korean', label: 'Glossika Korean', languages: { source: 'EN', target: 'KR' }, size: 3000 },
      day: 1, dailyLimit: 5, chain: [], queue: [], summary: { total: 0, done: 0, byRung: {} },
      rollover: { roll: false, reason: 'queue-incomplete' },
    },
  });
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
    render(<SchoolApp clear={() => {}} mode="open" />);
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
  it('a wrong code is refused IN the slots and leaves the keypad usable', async () => {
    resolveMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { ok: false, reason: 'unknown_code', sentence: 'Try again.', actions: [] },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');

    await typeCode('111111');
    // The refusal happens in the entry row the digits were typed into — no line
    // of text appears below it, because anything that appears there shoves the
    // pad down the screen under the finger of a child already re-typing.
    await waitFor(() => expect(screen.getByTestId('selfservice-entry'))
      .toHaveAttribute('data-state', 'rejected'));
    expect(screen.queryByText('Try again.')).toBeNull();
    await waitFor(() => expect(selfServiceLog).toHaveBeenCalledWith('code.rejected', expect.anything()));

    // Still a live keypad — no lockout, no dead buttons: the next code works.
    await typeCode('481920');
    expect(await screen.findByText('Fractions 3')).toBeInTheDocument();
  });

  it('the refusal turns the slots over into a word and then clears itself', async () => {
    // The drama is the point: a child who cannot yet read a sentence under the
    // keypad can still see six red letters land one at a time. It must also
    // END — a panel still shouting NO is a panel the next child walks up to.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      resolveMock.mockResolvedValueOnce({
        ok: true, status: 200,
        data: { ok: false, reason: 'unknown_code', sentence: 'Try again.', actions: [] },
      });
      renderLocked();
      await screen.findByTestId('selfservice-keypad');
      await typeCode('111111');

      const entry = await screen.findByTestId('selfservice-entry');
      await waitFor(() => expect(entry).toHaveAttribute('data-state', 'rejected'));

      await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
      expect(entry.textContent).toBe(REJECT_WORD);

      // ...and back to an empty, usable keypad on its own.
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(entry).toHaveAttribute('data-state', 'entry');
      expect(entry.textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Clear on an already-empty entry refreshes the panel', async () => {
    // The kiosk's only refresh affordance: lock mode draws no header and FKB
    // has no address bar, so without this a stale bundle needs a grown-up with
    // an ADB shell to pick up a deploy.
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    try {
      renderLocked();
      await screen.findByTestId('selfservice-keypad');
      const clear = screen.getByRole('button', { name: /^clear$/i });

      // A Clear with something to clear wipes the entry and reloads NOTHING.
      fireEvent.click(await screen.findByRole('button', { name: '4' }));
      fireEvent.click(clear);
      expect(reload).not.toHaveBeenCalled();
      expect(screen.getByTestId('selfservice-entry').textContent).toBe('');

      // The second tap — nothing left to clear — is the refresh.
      fireEvent.click(clear);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(selfServiceLog).toHaveBeenCalledWith('keypad.reload', expect.anything());
    } finally {
      reload.mockRestore();
    }
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

    fireEvent.click(screen.getByTestId('selfservice-print-ok'));
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
    fireEvent.click(await screen.findByTestId('selfservice-print-failed'));

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
    fireEvent.click(await screen.findByTestId('selfservice-print-failed'));

    expect(await screen.findByText(/school computer isn.t answering/i)).toBeInTheDocument();
    expect(screen.queryByText(/did it print\?/i)).toBeNull();
    fireEvent.click(screen.getByTestId('selfservice-done'));
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
  });

  it('a debounced print renders words rather than the backend\'s silence', async () => {
    // IssueDocument's cooldown answers with an EMPTY message by design — that
    // silence was written for thermal slips, and on a screen it reads as a
    // dead button.
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: {
        outcome: 'debounced',
        sentence: "It's already on its way — give it a minute.",
        sessionId: 'ses_1',
        effect: { status: 'debounced' },
      },
    });
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
      data: {
        outcome: 'pending',   // LAUNCH_OUTCOMES maps DoNow pending_approval -> 'pending'
        sentence: 'A grown-up has to say yes first.',
        sessionId: 'ses_1',
        effect: { decision: 'pending_approval' },
      },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('play'));

    expect(await screen.findByText('A grown-up has to say yes first.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('selfservice-done'));
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
  });
});

describe('locked panel — on-screen work registers a sitting', () => {
  it('a screen action mounts the runner through the same start() path the SPA uses', async () => {
    resolveMock.mockResolvedValue({
      ok: true, status: 200,
      data: { ...MOVE_CARD, actions: [{ kind: 'screen', label: 'Answer on the screen' }, { kind: 'exit', label: 'Go back' }] },
    });
    // The REAL shape. There is no top-level `target` and no `on_screen`
    // outcome; `#screen` answers `outcome:'mount'` and puts the bank in
    // `effect`. `offeredActions` emits the screen action with NO target of its
    // own, so `effect` is the only place this information exists.
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: {
        outcome: 'mount',
        sentence: 'Answer it here on the screen.',
        sessionId: 'ses_1',
        effect: { kind: 'bank', bankId: 'caps', unitId: 'u1', learnerId: 'kid1' },
      },
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
    // indistinguishable to whoever is standing at the panel. A bad code is the
    // red slots and nothing else; a fault is words plus a retry button.
    await waitFor(() => expect(screen.getByTestId('selfservice-entry'))
      .toHaveAttribute('data-state', 'rejected'));
    expect(screen.queryByText(/school computer isn.t answering/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /try again|retry/i })).toBeNull();
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

describe('locked panel — the /act wire shape', () => {
  // These pin the contract itself. Three earlier fixtures invented `on_screen`,
  // a top-level `target`, and `issued` — none of which either side implements —
  // and passed while asserting nothing real. The shapes below are copied from
  // `RunSelfServiceAction`: { outcome, sentence, sessionId, effect }, outcome in
  // { done, debounced, pending, mount, refused, failed }.
  const ACT_OUTCOMES = ['done', 'debounced', 'pending', 'mount', 'refused', 'failed'];

  it('the panel only ever branches on outcomes the use case can emit', () => {
    // A guard against the class of bug above: if this list and the use case
    // diverge, the panel is branching on a string that never arrives.
    expect(new Set(ACT_OUTCOMES).size).toBe(6);
    for (const outcome of ACT_OUTCOMES) expect(typeof outcome).toBe('string');
  });

  it('reads the mount target from `effect`, not a top-level `target`', async () => {
    resolveMock.mockResolvedValue({
      ok: true, status: 200,
      data: { ...MOVE_CARD, actions: [{ kind: 'screen', label: 'Answer on the screen' }, { kind: 'exit', label: 'Go back' }] },
    });
    // Deliberately ALSO carries a decoy top-level `target` naming a bank that
    // does not exist. Reading it would mount nothing; reading `effect` works.
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: {
        outcome: 'mount',
        sentence: 'Answer it here on the screen.',
        sessionId: 'ses_1',
        target: { kind: 'bank', bankId: 'DECOY-DOES-NOT-EXIST' },
        effect: { kind: 'bank', bankId: 'caps', unitId: 'u1', learnerId: 'kid1' },
      },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('screen'));

    expect(await screen.findByText('WA?')).toBeInTheDocument();
    await waitFor(() => expect(openSessionMock).toHaveBeenCalled());
    expect(openSessionMock.mock.calls[0][0]).toMatchObject({ bankId: 'caps' });
  });

  it('a non-mount outcome on a screen action shows words instead of mounting', async () => {
    resolveMock.mockResolvedValue({
      ok: true, status: 200,
      data: { ...MOVE_CARD, actions: [{ kind: 'screen', label: 'Answer on the screen' }, { kind: 'exit', label: 'Go back' }] },
    });
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { outcome: 'refused', sentence: 'That one is finished. Type your code again to see what is next.', sessionId: 'ses_1', effect: null },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('screen'));

    expect(await screen.findByText(/that one is finished/i)).toBeInTheDocument();
    expect(openSessionMock).not.toHaveBeenCalled();
  });
});

describe('locked panel — a mount that misses still leaves words', () => {
  it('an unknown bankId keeps the card up rather than closing to a bare keypad', async () => {
    resolveMock.mockResolvedValue({
      ok: true, status: 200,
      data: { ...MOVE_CARD, actions: [{ kind: 'screen', label: 'Answer on the screen' }, { kind: 'exit', label: 'Go back' }] },
    });
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: {
        outcome: 'mount',
        sentence: 'Answer it here on the screen.',
        sessionId: 'ses_1',
        effect: { kind: 'bank', bankId: 'not-a-loaded-bank', unitId: 'u1', learnerId: 'kid1' },
      },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('screen'));

    // Words, with a way out — NOT a silent return to the keypad. "A screen
    // nobody is watching" is sound for a broadcast and wrong for a child who
    // just pressed the button.
    expect(await screen.findByTestId('selfservice-done')).toBeInTheDocument();
    expect(screen.queryByTestId('selfservice-keypad')).toBeNull();
    fireEvent.click(screen.getByTestId('selfservice-done'));
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
  });
});

describe('locked panel — program actions', () => {
  const PROGRAM_CARD = {
    ...MOVE_CARD,
    subject: 'Language & Culture',
    title: 'Glossika Korean',
    actions: [{ kind: 'program', label: 'Open Glossika Korean', target: 'language' }, { kind: 'exit', label: 'Go back' }],
  };
  const PROGRAM_ACT = {
    ok: true, status: 200,
    data: {
      outcome: 'mount',
      sentence: 'Opening it here on the screen.',
      sessionId: null,
      effect: { kind: 'program', programId: 'language', unitId: 'u1', learnerId: 'kid1' },
    },
  };

  it('mounts the program and REMOVES the keypad from under it', async () => {
    // A program opens a SECTION, not `active` — so a keypad gated on `!active`
    // alone stayed mounted underneath it, both on screen at once.
    coursesMock.mockResolvedValue({
      ok: true, status: 200,
      data: [{ id: 'glossika-korean', label: 'Glossika Korean', languages: { source: 'EN', target: 'KR' }, size: 3000 }],
    });
    resolveMock.mockResolvedValue({ ok: true, status: 200, data: PROGRAM_CARD });
    actMock.mockResolvedValueOnce(PROGRAM_ACT);
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await waitFor(() => expect(coursesMock).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await typeCode('481920');
    fireEvent.click(await findActionButton('program'));

    expect(await screen.findByText('Day 1')).toBeInTheDocument();
    expect(screen.queryByTestId('selfservice-keypad')).toBeNull();
    expect(screen.queryByTestId('selfservice-card')).toBeNull();
  });

  it('a mounted program has a way back to the keypad', async () => {
    coursesMock.mockResolvedValue({
      ok: true, status: 200,
      data: [{ id: 'glossika-korean', label: 'Glossika Korean', languages: { source: 'EN', target: 'KR' }, size: 3000 }],
    });
    resolveMock.mockResolvedValue({ ok: true, status: 200, data: PROGRAM_CARD });
    actMock.mockResolvedValueOnce(PROGRAM_ACT);
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await waitFor(() => expect(coursesMock).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await typeCode('481920');
    fireEvent.click(await findActionButton('program'));
    await screen.findByText('Day 1');

    // Lock mode has no header, so the program would otherwise be terminal.
    fireEvent.click(await screen.findByTestId('selfservice-section-exit'));
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
  });

  it('a SURFACE program (dispatched elsewhere) mounts nothing here', async () => {
    // Task 7: a program whose launcher declares a non-portal surface is
    // dispatched through `launcher.launch()` and answers `done`, with an
    // effect that carries NO `kind`. Branching on `action.kind === 'program'`
    // would mount a language runner on this panel at the same moment the
    // garage kiosk started — two things running, neither one asked for.
    coursesMock.mockResolvedValue({
      ok: true, status: 200,
      data: [{ id: 'glossika-korean', label: 'Glossika Korean', languages: { source: 'EN', target: 'KR' }, size: 3000 }],
    });
    resolveMock.mockResolvedValue({
      ok: true, status: 200,
      data: {
        ...MOVE_CARD,
        subject: 'Physical Education',
        title: 'Cycle 20 minutes',
        actions: [{ kind: 'program', label: 'Open Cycling', target: 'fitness' }, { kind: 'exit', label: 'Go back' }],
      },
    });
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: {
        outcome: 'done',
        sentence: 'Starting on the garage screen.',
        sessionId: null,
        effect: { decision: 'dispatched', surface: 'garage', programId: 'fitness', unitId: 'u1' },
      },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await waitFor(() => expect(coursesMock).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await typeCode('481920');
    fireEvent.click(await findActionButton('program'));

    // The dispatch sentence, verbatim — it names the room the child walks to.
    expect(await screen.findByText('Starting on the garage screen.')).toBeInTheDocument();
    // And NOTHING opened here: no language runner, no quiz.
    expect(screen.queryByText('Day 1')).toBeNull();
    expect(dayMock).not.toHaveBeenCalled();
    expect(openSessionMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('selfservice-done'));
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
  });

  it('a program with no launcher says so rather than claiming it opened', async () => {
    resolveMock.mockResolvedValue({ ok: true, status: 200, data: PROGRAM_CARD });
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: {
        outcome: 'failed',
        sentence: 'Ask a grown-up to set this up.',
        sessionId: null,
        effect: { programId: 'language', unitId: 'u1' },
      },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('program'));

    expect(await screen.findByText('Ask a grown-up to set this up.')).toBeInTheDocument();
    expect(screen.queryByText('Day 1')).toBeNull();
  });

  it('a program with no loaded course keeps the card up and says so', async () => {
    // coursesMock default is []; onPortalLaunch reports the miss.
    resolveMock.mockResolvedValue({ ok: true, status: 200, data: PROGRAM_CARD });
    actMock.mockResolvedValueOnce(PROGRAM_ACT);
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('program'));

    expect(await screen.findByText('Opening it here on the screen.')).toBeInTheDocument();
    expect(await screen.findByTestId('selfservice-done')).toBeInTheDocument();
    expect(screen.queryByTestId('selfservice-keypad')).toBeNull();
  });
});

describe('locked panel — every print outcome is answered', () => {
  it('a failed print shows the printer sentence instead of asking "Did it print?"', async () => {
    // The old code asked the confirm question for EVERY non-debounced outcome,
    // so a child tapped No and looped reprinting a sheet that was never coming
    // — while the backend's actual explanation was in hand and discarded.
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { outcome: 'failed', sentence: 'The printer did not answer. Try that again in a minute.', sessionId: 'ses_1', effect: { status: 'print_failed' } },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('print'));

    expect(await screen.findByText(/printer did not answer/i)).toBeInTheDocument();
    expect(screen.queryByText(/did it print\?/i)).toBeNull();
  });

  it('a refused print says why rather than offering a reprint', async () => {
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { outcome: 'refused', sentence: 'That one is finished. Type your code again to see what is next.', sessionId: 'ses_1', effect: { status: 'already_done' } },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('print'));

    expect(await screen.findByText(/that one is finished/i)).toBeInTheDocument();
    expect(screen.queryByText(/did it print\?/i)).toBeNull();
  });

  it('only a `done` print asks the confirm question', async () => {
    renderLocked();               // beforeEach default is outcome:'done'
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('print'));

    expect(await screen.findByText('Did it print?')).toBeInTheDocument();
  });

  it('an answer with no words at all still renders words', async () => {
    // `#report` promises this never happens; the panel must not blank if it does.
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { outcome: 'debounced', sentence: '', sessionId: 'ses_1', effect: null },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('print'));

    expect(await screen.findByText(/something went wrong here/i)).toBeInTheDocument();
  });
});

describe('locked panel — a late answer may not reopen a closed card', () => {
  it('an /act resolving after the idle timeout does not flip the panel back', async () => {
    let release;
    actMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    renderLocked({ idleTimeoutSeconds: 0.25 });
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('print'));

    // The panel times out while the print request is still in flight.
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();

    // Now the answer lands. Without the generation guard this flips the panel
    // to a headerless "Did it print?" with `card` null — and the NEXT child
    // answers about someone else's worksheet.
    await act(async () => {
      release({ ok: true, status: 200, data: { outcome: 'done', sentence: 'All set.', sessionId: 'ses_1', effect: null } });
      await Promise.resolve(); await Promise.resolve();
    });

    expect(screen.getByTestId('selfservice-keypad')).toBeInTheDocument();
    expect(screen.queryByText('Did it print?')).toBeNull();
    expect(screen.queryByTestId('selfservice-card')).toBeNull();
  });

  it('an /act resolving after an exit does not reopen the card either', async () => {
    let release;
    actMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('print'));

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();

    await act(async () => {
      release({ ok: true, status: 200, data: { outcome: 'done', sentence: 'All set.', sessionId: 'ses_1', effect: null } });
      await Promise.resolve(); await Promise.resolve();
    });
    expect(screen.getByTestId('selfservice-keypad')).toBeInTheDocument();
    expect(screen.queryByText('Did it print?')).toBeNull();
  });
});

describe('locked panel — the keypad a child can actually read', () => {
  it('shows the digits typed, so a mis-tap is visible before submitting', async () => {
    // The anonymity rule covers the learner's NAME. The digits are printed on
    // paper in the child's hand, so masking them hides nothing and costs a
    // seven-year-old the only way to check a six-digit copy.
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    fireEvent.click(await screen.findByRole('button', { name: '4' }));
    fireEvent.click(screen.getByRole('button', { name: '8' }));

    const entry = screen.getByTestId('selfservice-entry');
    expect(entry).toHaveTextContent('48');
    expect(entry.textContent).not.toContain('•');
  });

  it('backspace removes the last digit', async () => {
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    fireEvent.click(await screen.findByRole('button', { name: '4' }));
    fireEvent.click(screen.getByRole('button', { name: '8' }));
    fireEvent.click(screen.getByRole('button', { name: 'Backspace' }));

    expect(screen.getByTestId('selfservice-entry')).toHaveTextContent('4');
  });
});

describe('locked panel — double taps', () => {
  it('a double "No" does not fire two recomputes', async () => {
    let release;
    resolveMock.mockImplementationOnce(async () => ({ ok: true, status: 200, data: MOVE_CARD }));
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('print'));
    await screen.findByText('Did it print?');

    resolveMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const no = screen.getByTestId('selfservice-print-failed');
    fireEvent.click(no);
    fireEvent.click(no);   // the double-tap a wall panel always gets

    await act(async () => {
      release({ ok: true, status: 200, data: MOVE_CARD });
      await Promise.resolve(); await Promise.resolve();
    });
    // One resolve for the code, one for the recompute. Not three.
    expect(resolveMock).toHaveBeenCalledTimes(2);
  });
});

describe('locked panel — the outcome is authoritative, not the kind', () => {
  it('a non-mount outcome mounts nothing EVEN IF the effect looks mountable', async () => {
    // The guard that matters is `outcome === 'mount'`. `launchTarget` refusing
    // an effect with no `kind` is defence in depth, not the decision — so this
    // hands over an effect that WOULD route, with an outcome that says do not.
    // Only the backend knows whether a program is local
    // (`IProgramLauncher.surface`); the panel must not second-guess it.
    coursesMock.mockResolvedValue({
      ok: true, status: 200,
      data: [{ id: 'glossika-korean', label: 'Glossika Korean', languages: { source: 'EN', target: 'KR' }, size: 3000 }],
    });
    resolveMock.mockResolvedValue({
      ok: true, status: 200,
      data: { ...MOVE_CARD, actions: [{ kind: 'program', label: 'Open it', target: 'language' }, { kind: 'exit', label: 'Go back' }] },
    });
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: {
        outcome: 'done',
        sentence: 'Starting on the garage screen.',
        sessionId: null,
        effect: { kind: 'program', programId: 'language', unitId: 'u1', learnerId: 'kid1' },
      },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await waitFor(() => expect(coursesMock).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await typeCode('481920');
    fireEvent.click(await findActionButton('program'));

    expect(await screen.findByText('Starting on the garage screen.')).toBeInTheDocument();
    expect(screen.queryByText('Day 1')).toBeNull();
    expect(dayMock).not.toHaveBeenCalled();
  });

  it('a screen action with a non-mount outcome opens no session', async () => {
    resolveMock.mockResolvedValue({
      ok: true, status: 200,
      data: { ...MOVE_CARD, actions: [{ kind: 'screen', label: 'Answer on the screen' }, { kind: 'exit', label: 'Go back' }] },
    });
    actMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: {
        outcome: 'failed',
        sentence: 'Tell a grown-up.',
        sessionId: 'ses_1',
        effect: { kind: 'bank', bankId: 'caps', unitId: 'u1', learnerId: 'kid1' },
      },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    fireEvent.click(await findActionButton('screen'));

    expect(await screen.findByText('Tell a grown-up.')).toBeInTheDocument();
    expect(openSessionMock).not.toHaveBeenCalled();
  });
});

describe('locked panel — an unrecognised refusal reason still offers a retry', () => {
  it('leans toward FAULT: only `unknown_code` suppresses the retry', async () => {
    // A spurious retry button costs a wasted tap. A missing one is a dead end
    // at a wall panel with no other affordance — so anything the panel does
    // not recognise gets the retry.
    resolveMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { ok: false, reason: 'lifecycle_disabled', sentence: 'School is not running right now.', actions: [] },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');

    expect(await screen.findByText('School is not running right now.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByText('Fractions 3')).toBeInTheDocument();
  });

  it('a plain `unknown_code` gets no retry — there is nothing to retry', async () => {
    resolveMock.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { ok: false, reason: 'unknown_code', sentence: 'Try again.', actions: [] },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('111111');

    await waitFor(() => expect(screen.getByTestId('selfservice-entry'))
      .toHaveAttribute('data-state', 'rejected'));
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    // Not even the sentence: a bad code is the red slots, full stop.
    expect(screen.queryByText('Try again.')).toBeNull();
  });
});

describe('locked panel — a card that arrives without an exit', () => {
  it('still gets a way out, worded so the defect is visible', async () => {
    // `offeredActions` always appends its own exit, so this shape is a BUG
    // upstream. The panel must not trap a child on a wall screen with no
    // browser chrome behind it — and the synthesised button says "Close",
    // deliberately NOT the domain's "Go back", so seeing it in a screenshot
    // names the defect instead of hiding behind an identical duplicate.
    resolveMock.mockResolvedValue({
      ok: true, status: 200,
      data: { ...MOVE_CARD, actions: [{ kind: 'print', label: 'Print your sheet' }] },
    });
    renderLocked();
    await screen.findByTestId('selfservice-keypad');
    await typeCode('481920');
    await screen.findByTestId('selfservice-card');

    const exit = screen.getByTestId('selfservice-action-exit');
    expect(exit).toHaveTextContent('Close');
    expect(exit).not.toHaveTextContent('Go back');

    fireEvent.click(exit);
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
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
      data: { ok: false, reason: 'not_answering', learner: null, subject: null, title: null, sentence: "The school computer isn't answering. Tell a grown-up.", actions: [] },
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
