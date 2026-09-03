import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import SchoolApp from './SchoolApp.jsx';
import { DEFAULT_IDLE_TIMEOUT_SECONDS } from './selfService/useSelfService.js';

// Capture the WS subscribers, KEYED BY TOPIC, so these tests can push
// `school.launch` messages straight through the REAL useSchoolLaunch hook and
// SchoolApp's real onPortalLaunch routing (pattern: useSchoolLaunch.test.jsx /
// useKioskLaunchCommand.test.js). SchoolApp mounts more than one
// useWebSocketSubscription now (school.launch AND the Slice D scan ceremony's
// `omr` topic) — a single flat slot would let the second subscriber silently
// clobber the first's callback.
// A LIST per topic, not one slot: two hooks now subscribe to `school`
// (useSchoolLaunch, and the scan ceremony for `piano-lesson-complete`), so a
// single slot let the second registration replace the first and launches
// stopped landing. The real `wsService.subscribe` keys every subscription
// separately (`sub_${id}`) and fans out to all, so a list is the accurate
// model. `h.byTopic[topic]` stays callable and fans out, keeping call sites
// unchanged; callbacks dedupe by identity because both hooks memoize theirs.
const h = vi.hoisted(() => ({ byTopic: {}, subs: {} }));
vi.mock('../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (topic, cb) => {
    const list = (h.subs[topic] ||= []);
    if (!list.includes(cb)) list.push(cb);
    h.byTopic[topic] = (payload) => list.forEach((fn) => fn(payload));
  },
}));

// Spy on the schoolLog facade so the not-found/program-unavailable warn paths
// are directly observable, not just inferred from "nothing happened".
const bankLogMock = vi.fn();
const bookShelfLogMock = vi.fn();
const selfServiceErrorMock = vi.fn();
vi.mock('./schoolLog.js', () => ({
  schoolLog: {
    profile: vi.fn(), session: vi.fn(), answer: vi.fn(), answerError: vi.fn(),
    bank: (...a) => bankLogMock(...a),
    nav: vi.fn(), home: vi.fn(), materials: vi.fn(), materialsError: vi.fn(),
    print: vi.fn(), typing: vi.fn(), player: vi.fn(), surface: vi.fn(),
    feedback: vi.fn(), feedbackError: vi.fn(), standing: vi.fn(), standingError: vi.fn(),
    scan: vi.fn(),
    bookShelf: (...a) => bookShelfLogMock(...a), bookShelfError: vi.fn(),
    selfService: vi.fn(), selfServiceError: (...a) => selfServiceErrorMock(...a),
  },
}));

const banksMock = vi.fn();
const companionProgressMock = vi.fn();
const materialsMock = vi.fn();
const materialUnitsMock = vi.fn();
const unitProgressMock = vi.fn();
vi.mock('./schoolApi.js', () => ({
  schoolApi: {
    roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'kid1', name: 'Alpha', birthyear: 2016 }] })),
    banks: (...a) => banksMock(...a),
    bank: vi.fn(async (id) => ({
      ok: true, status: 200,
      data: { id, title: 'Caps', audience: 'assigned', items: [{ id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] }] },
    })),
    openSession: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 'ses_1' } })),
    answer: vi.fn(async () => ({ ok: true, status: 200, data: { correct: true, expected: 'Olympia', attemptId: 'att_1' } })),
    materials: (...a) => materialsMock(...a),
    materialUnits: (...a) => materialUnitsMock(...a),
    unitProgress: (...a) => unitProgressMock(...a),
    quizRequests: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    requestQuiz: vi.fn(async () => ({ ok: true, status: 200, data: { requested: true, duplicate: false } })),
    report: vi.fn(async () => ({ ok: true, status: 200, data: { learners: [{ id: 'kid1', name: 'Alpha', reports: [] }] } })),
    results: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    materialProgress: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    surfaceProfile: vi.fn(async () => ({ ok: false, status: 404, data: { error: 'surface-profile-unresolved' } })),
    certification: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    // Feedback delivery + kid-visible standing (Task 9) — the student panel
    // fetches these unconditionally once a learner is claimed.
    periods: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    reportCard: vi.fn(async () => ({ ok: true, status: 200, data: null })),
    reviewLearner: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    // Today's dry-run plan (debt W7a) — the student panel fetches this
    // unconditionally once a learner is claimed.
    agendaPreview: vi.fn(async () => ({ ok: true, status: 200, data: { sections: [] } })),
    companionProgress: (...a) => companionProgressMock(...a),
    // The locked wall panel: keypad resolve/act, and what the status board
    // beside it asks for.
    selfServiceResolve: (...a) => resolveMock(...a),
    selfServiceAct: (...a) => actMock(...a),
    selfServicePrinterStatus: vi.fn(async () => ({ ok: false, status: 404, data: null })),
    wallet: vi.fn(async () => ({ ok: false, status: 503, data: null })),
    teacherDay: vi.fn(async () => ({ ok: true, status: 200, data: { learners: [] } })),
  },
}));
const resolveMock = vi.fn();
const actMock = vi.fn();

const coursesMock = vi.fn();
const dayMock = vi.fn();
vi.mock('./Programs/SentenceLadder/languageApi.js', () => ({
  languageApi: {
    courses: (...a) => coursesMock(...a),
    day: (...a) => dayMock(...a),
    previewDay: vi.fn(async () => ({ ok: true, status: 200, data: null })),
    log: vi.fn(), roll: vi.fn(), pacing: vi.fn(), history: vi.fn(), recording: vi.fn(),
    audioUrl: () => '', recordingUrl: () => '',
  },
}));

vi.mock('../Player/Player.jsx', () => ({
  default: ({ play }) => <div data-testid="player-stub">Player: {play?.contentId ?? 'none'}</div>,
}));

// The reading shelf (book-shelf UI design §2) is stubbed to the shape SchoolApp
// depends on — its root class, its heading — and records the props it was
// handed, so the mount contract is asserted here without the real hook's
// fetches. The cube runner is stubbed likewise so "the shelf, not the cube"
// is a direct observation rather than an absence.
const bookShelfProps = vi.fn();
vi.mock('./books/BookShelf.jsx', () => ({
  default: (props) => {
    bookShelfProps(props);
    return <section className="school-books"><h2>Reading</h2></section>;
  },
}));
vi.mock('./Programs/RubiksCube/RubiksCubeProgram.jsx', () => ({
  default: () => <div data-testid="cube-stub">cube</div>,
}));

// `onPortalLaunch` RETURNS whether it mounted, and the keypad keeps its card
// up on `false`. The WS path above drops that boolean, so the real hook is
// wrapped (not replaced) to hand the test the same `claim`/`onLaunch` pair
// SchoolApp registers, for calling directly where the answer matters.
const launchHook = vi.hoisted(() => ({ claim: null, onLaunch: null }));
vi.mock('./useSchoolLaunch.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    useSchoolLaunch: (args) => {
      launchHook.claim = args.claim;
      launchHook.onLaunch = args.onLaunch;
      return mod.useSchoolLaunch(args);
    },
  };
});

const EMPTY_CATALOG = { ok: true, status: 200, data: { sections: [], materials: [] } };

beforeEach(() => {
  localStorage.clear();
  h.byTopic = {};
  h.subs = {};
  bankLogMock.mockClear();
  bookShelfLogMock.mockClear();
  selfServiceErrorMock.mockClear();
  resolveMock.mockReset();
  actMock.mockReset();
  bookShelfProps.mockClear();
  launchHook.claim = null;
  launchHook.onLaunch = null;
  banksMock.mockReset().mockResolvedValue({
    ok: true, status: 200,
    data: [{ id: 'caps', title: 'Caps', audience: 'assigned', subject: null, itemCount: 1 }],
  });
  companionProgressMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: null });
  materialsMock.mockReset().mockResolvedValue(EMPTY_CATALOG);
  materialUnitsMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { material: {}, units: [] } });
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

// Deliver a `school.launch` message the way the backend broadcasts it: the
// full payload the WS layer hands every subscribed filter, `topic` included.
const deliverLaunch = (learnerId, target) => h.byTopic.school({ topic: 'school', type: 'school.launch', learnerId, target });

// `banks` loads via its own un-awaited `schoolApi.banks()` fetch — a separate
// promise from the materials/courses `Promise.all` that gates the subject
// wall's render. Firing a bank-targeted launch before it resolves means
// `onPortalLaunch`'s `banks.find` correctly (but flakily, from the test's
// point of view) sees an empty list and answers not-found. Opening the
// Library and waiting for a bank tile to appear is a deterministic proof
// that `banks` state has actually landed.
async function openLibraryAndWaitForBanks() {
  fireEvent.click(await screen.findByRole('button', { name: /library/i }));
  await screen.findByText('Caps');
}

describe('SchoolApp — Portal launch subscription (school.launch)', () => {
  it('a learner-scoped Sentence Ladder launch mounts the assigned corpus', async () => {
    coursesMock.mockResolvedValue({
      ok: true, status: 200,
      data: [{ id: 'glossika-korean', label: 'Glossika Korean', languages: { source: 'EN', target: 'KR' }, size: 3000 }],
    });
    render(<SchoolApp clear={() => {}} mode="open" />);
    await waitFor(() => expect(coursesMock).toHaveBeenCalled());

    deliverLaunch('kid1', {
      kind: 'program', program: 'sentence-ladder', corpusId: 'glossika-korean', studyGrant: 'signed-grant',
    });

    // The SentenceLadderProgram runner mounted for the learner's one loaded course
    // and fetched today's day (Day 1 is its own rendered header, not a stub).
    expect(await screen.findByText('Day 1')).toBeInTheDocument();
    await waitFor(() => expect(dayMock).toHaveBeenCalledWith(
      'kid1', 'glossika-korean', expect.anything(), 'signed-grant', expect.anything(),
    ));
    // Claimed via the launch, not the picker: no dialog ever appeared.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a launch for an unavailable corpus does nothing (no crash, no navigation)', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />); // coursesMock default: []
    await screen.findByText('Civilization');

    deliverLaunch('kid1', { kind: 'program', program: 'sentence-ladder', corpusId: 'missing', studyGrant: 'signed-grant' });

    await waitFor(() => expect(bankLogMock).toHaveBeenCalledWith('program-unavailable', { program: 'sentence-ladder' }));
    expect(dayMock).not.toHaveBeenCalled();
    // Still home: the subject wall, not a runner.
    expect(screen.getByText('Civilization')).toBeInTheDocument();
  });

  it('does not mount Sentence Ladder when a broadcast has no scoped grant', async () => {
    coursesMock.mockResolvedValue({
      ok: true, status: 200,
      data: [{ id: 'glossika-korean', label: 'Korean', languages: { source: 'EN', target: 'KR' }, size: 10 }],
    });
    render(<SchoolApp clear={() => {}} mode="open" />);
    await waitFor(() => expect(coursesMock).toHaveBeenCalled());
    deliverLaunch('kid1', { kind: 'program', program: 'sentence-ladder', corpusId: 'glossika-korean' });
    await waitFor(() => expect(bankLogMock).toHaveBeenCalledWith('program-unavailable', { program: 'sentence-ladder' }));
    expect(dayMock).not.toHaveBeenCalled();
  });

  it('bank launch for a known bank opens the quiz runner directly, bypassing the picker', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibraryAndWaitForBanks();

    deliverLaunch('kid1', { kind: 'bank', bankId: 'caps', unitId: 'u1', sessionId: 'ses_1' });

    expect(await screen.findByText('WA?')).toBeInTheDocument(); // QuizRunner's question
    // The picker-gated path (`onLaunch`) never ran: no ProfilePicker dialog.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // The companion descriptor's LAST HOP. `participation` rides the backend
  // handler's `open()` effect all the way to here, and the player reads it for
  // two things: the required-companion clamp, and whether to ask the server for
  // the gate at all. Dropping it on this hop is invisible in every other test —
  // the read-along still mounts and still plays — so it is pinned end to end,
  // through the real routing, by the one behaviour that cannot happen without it.
  const COMPANION = {
    kind: 'companion', presentation: 'readalong', companionId: 'cmp_1', title: 'Psalms',
    parts: [{ id: 'p1', title: 'Psalms 49', contentId: 'readalong:scripture/ps-49' }],
    state: {}, participation: 'required',
  };

  it('a required companion the household already satisfied opens straight onto its code', async () => {
    companionProgressMock.mockResolvedValue({
      ok: true, status: 200,
      data: { ok: true, tracked: true, satisfied: true, code: ['B', 'D'], remainingParts: 0, gate: 'open' },
    });
    render(<SchoolApp clear={() => {}} mode="open" />);
    await screen.findByText('Civilization');

    deliverLaunch('kid1', COMPANION);

    expect(await screen.findByTestId('readalong-code')).toHaveTextContent('BD');
    expect(companionProgressMock).toHaveBeenCalledWith('cmp_1', expect.objectContaining({
      partId: 'p1', playedRanges: [], maxRate: 1,
    }));
  });

  it('an optional companion opens with no gate probe and no card', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await screen.findByText('Civilization');

    deliverLaunch('kid1', { ...COMPANION, participation: 'optional' });

    await screen.findByTestId('player-stub');
    expect(companionProgressMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('readalong-finish')).toBeNull();
  });

  it('bank launch for an unknown bankId does nothing visible and logs a warn', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibraryAndWaitForBanks(); // banks state resolved deterministically

    deliverLaunch('kid1', { kind: 'bank', bankId: 'nonexistent', unitId: 'u1', sessionId: 'ses_1' });

    await waitFor(() => expect(bankLogMock).toHaveBeenCalledWith('not-found', { bankId: 'nonexistent' }));
    expect(screen.queryByText('WA?')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Still in the Library, no runner opened.
    expect(screen.getByText('Caps')).toBeInTheDocument();
  });
});

// Task 14 of the book-shelf plan: a `book-log` launch target — the reading
// code, resolved by the agenda — mounts the shelf beside the cube, the reels
// and the ladder. The grant is the shelf's only identity (design §2), so a
// target without one, or without a learner, is refused with `false` and the
// keypad keeps its card up.
describe('SchoolApp — book-log launch target mounts the reading shelf', () => {
  const BOOK_TARGET = { kind: 'program', program: 'book-log', learnerId: 'kid1', bookGrant: 'signed-book-grant' };

  async function renderOpenPanel() {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await screen.findByText('Civilization');
    expect(typeof launchHook.onLaunch).toBe('function');
  }

  it('a book-log target with a grant and a learner mounts the shelf, not the cube, and answers true', async () => {
    await renderOpenPanel();

    let mounted;
    await act(async () => {
      launchHook.claim('kid1');
      mounted = await launchHook.onLaunch(BOOK_TARGET, 'kid1');
    });

    expect(mounted).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Reading' })).toBeInTheDocument();
    expect(document.querySelector('.school-books')).not.toBeNull();
    expect(screen.queryByTestId('cube-stub')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    // The mount contract: the learner and grant from the target, the idle
    // knob from the panel's own lock config (the default here — no screen
    // config in `open` mode), and an exit the shelf can call.
    expect(bookShelfProps).toHaveBeenCalled();
    const props = bookShelfProps.mock.calls.at(-1)[0];
    expect(props.learnerId).toBe('kid1');
    expect(props.grant).toBe('signed-book-grant');
    expect(props.idleTimeoutSeconds).toBe(DEFAULT_IDLE_TIMEOUT_SECONDS);
    expect(typeof props.onExit).toBe('function');

    // Logged as a launch, never with the grant.
    expect(bookShelfLogMock).toHaveBeenCalledWith('launch', { learnerId: 'kid1' });
    expect(JSON.stringify(bookShelfLogMock.mock.calls)).not.toContain('signed-book-grant');
  });

  it('a book-log target without a grant answers false and mounts nothing', async () => {
    await renderOpenPanel();

    let mounted;
    await act(async () => {
      launchHook.claim('kid1');
      mounted = await launchHook.onLaunch({ kind: 'program', program: 'book-log', learnerId: 'kid1' }, 'kid1');
    });

    expect(mounted).toBe(false);
    expect(document.querySelector('.school-books')).toBeNull();
    expect(bookShelfProps).not.toHaveBeenCalled();
    // Refused by THIS branch — named, and not as a fall-through.
    expect(bookShelfLogMock).toHaveBeenCalledWith('launch-refused', { reason: 'no-grant' });
    expect(bankLogMock).not.toHaveBeenCalledWith('launch-unroutable', expect.anything());
    // Still home: the subject wall.
    expect(screen.getByText('Civilization')).toBeInTheDocument();
  });

  it('a book-log target with no learner anywhere answers false and mounts nothing', async () => {
    await renderOpenPanel();

    let mounted;
    await act(async () => {
      mounted = await launchHook.onLaunch({ kind: 'program', program: 'book-log', bookGrant: 'signed-book-grant' }, null);
    });

    expect(mounted).toBe(false);
    expect(document.querySelector('.school-books')).toBeNull();
    expect(bookShelfProps).not.toHaveBeenCalled();
    expect(bookShelfLogMock).toHaveBeenCalledWith('launch-refused', { reason: 'no-learner' });
    expect(JSON.stringify(bookShelfLogMock.mock.calls)).not.toContain('signed-book-grant');
    expect(bankLogMock).not.toHaveBeenCalledWith('launch-unroutable', expect.anything());
    expect(screen.getByText('Civilization')).toBeInTheDocument();
  });
});

// The path that actually exists for the shelf. `BookLogProgramLauncher.launch()`
// is inert and nothing broadcasts `school.launch` for `book-log`; a child
// types the reading code at the LOCKED wall panel, `/act` answers
// `outcome: 'mount'`, and `useSelfService.launchTarget` hands the effect to
// `onPortalLaunch`. Driven through the real keypad, the real hook and the
// real routing, with only the two HTTP calls faked to what the backend sends
// (`RunSelfServiceAction`: `{ ...target, programId, unitId, learnerId }`).
describe('SchoolApp — the reading code at the locked panel opens the shelf', () => {
  // `ResolveAccessCode` answers `{ ok, learner: '<id>', subject, title,
  // sentence, ...projection }`; the top-level `learner` is what the hook
  // claims identity from, and the shelf's guard reads that identity.
  const READING_CARD = {
    ok: true, learner: 'kid1', subject: 'english', title: 'Reading', sentence: null,
    schema: 'school.self-service-card/v2',
    context: {
      learner: { id: 'kid1', displayName: 'Alpha', avatar: { kind: 'learner', id: 'kid1' } },
      taxonomy: { subject: { id: 'english', label: 'English' } },
      trail: [{ kind: 'subject', id: 'english', label: 'English' }],
      progress: [],
    },
    presentation: { status: 'ready', message: null },
    actions: [
      { kind: 'program', label: 'Open my books', target: 'book-log', role: 'primary' },
      { kind: 'exit', label: 'Go back', role: 'secondary' },
    ],
  };
  const MOUNT_EFFECT = {
    kind: 'program', program: 'book-log', programId: 'book-log', unitId: null,
    learnerId: 'kid1', bookGrant: 'signed-book-grant',
  };

  /** A wall-panel jab: pointerdown lands the key, the click is its own release. */
  const jab = (name) => {
    const key = screen.getByRole('button', { name });
    fireEvent.pointerDown(key);
    fireEvent.click(key);
  };

  async function typeCodeAndOpen() {
    resolveMock.mockResolvedValue({ ok: true, status: 200, data: READING_CARD });
    actMock.mockResolvedValue({
      ok: true, status: 200,
      data: { outcome: 'mount', sentence: 'Opening it here on the screen.', effect: MOUNT_EFFECT },
    });
    render(<SchoolApp mode="locked" />);
    await screen.findByTestId('selfservice-keypad');
    for (const d of '123456') jab(d);
    // Auto-submit settles, the card comes up with the domain's own words.
    fireEvent.click(await screen.findByTestId('selfservice-action-program'));
    await waitFor(() => expect(actMock).toHaveBeenCalledWith({ code: '123456', action: 'program' }));
  }

  it('resolve → act → mount: the shelf, with the grant, and no second Done over it', async () => {
    await typeCodeAndOpen();

    expect(await screen.findByRole('heading', { name: 'Reading' })).toBeInTheDocument();
    const props = bookShelfProps.mock.calls.at(-1)[0];
    expect(props.learnerId).toBe('kid1');
    expect(props.grant).toBe('signed-book-grant');
    expect(props.idleTimeoutSeconds).toBe(DEFAULT_IDLE_TIMEOUT_SECONDS);
    // The card closed (a confirmed mount), the keypad is behind the shelf,
    // and the locked panel's own Done overlay stays off the workspace.
    expect(selfServiceErrorMock).not.toHaveBeenCalledWith('mount.refused', expect.anything());
    expect(screen.queryByTestId('selfservice-keypad')).toBeNull();
    expect(screen.queryByTestId('selfservice-section-exit')).toBeNull();
    expect(bookShelfLogMock).toHaveBeenCalledWith('launch', { learnerId: 'kid1' });
  });

  it('the shelf’s Done returns the panel to the keypad', async () => {
    await typeCodeAndOpen();
    await screen.findByRole('heading', { name: 'Reading' });

    await act(async () => { bookShelfProps.mock.calls.at(-1)[0].onExit('done'); });

    expect(screen.queryByRole('heading', { name: 'Reading' })).toBeNull();
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
  });

  it('an identity lapse with the shelf up returns the panel to the keypad, never a blank wall', async () => {
    await typeCodeAndOpen();
    await screen.findByRole('heading', { name: 'Reading' });

    // The 10-minute lapse is judged on the NEXT input after the gap
    // (useIdleGap), so: the clock jumps, then one touch.
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000);
    try {
      await act(async () => { fireEvent.pointerDown(window); });
    } finally {
      clock.mockRestore();
    }

    expect(screen.queryByRole('heading', { name: 'Reading' })).toBeNull();
    expect(document.querySelector('.school-books')).toBeNull();
    expect(await screen.findByTestId('selfservice-keypad')).toBeInTheDocument();
  });
});
