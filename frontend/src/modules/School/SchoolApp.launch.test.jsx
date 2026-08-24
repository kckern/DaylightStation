import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SchoolApp from './SchoolApp.jsx';

// Capture the WS subscribers, KEYED BY TOPIC, so these tests can push
// `school.launch` messages straight through the REAL useSchoolLaunch hook and
// SchoolApp's real onPortalLaunch routing (pattern: useSchoolLaunch.test.jsx /
// useKioskLaunchCommand.test.js). SchoolApp mounts more than one
// useWebSocketSubscription now (school.launch AND the Slice D scan ceremony's
// `omr` topic) — a single flat slot would let the second subscriber silently
// clobber the first's callback.
const h = vi.hoisted(() => ({ byTopic: {} }));
vi.mock('../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (topic, cb) => { h.byTopic[topic] = cb; },
}));

// Spy on the schoolLog facade so the not-found/program-unavailable warn paths
// are directly observable, not just inferred from "nothing happened".
const bankLogMock = vi.fn();
vi.mock('./schoolLog.js', () => ({
  schoolLog: {
    profile: vi.fn(), session: vi.fn(), answer: vi.fn(), answerError: vi.fn(),
    bank: (...a) => bankLogMock(...a),
    nav: vi.fn(), home: vi.fn(), materials: vi.fn(), materialsError: vi.fn(),
    print: vi.fn(), typing: vi.fn(), player: vi.fn(), surface: vi.fn(),
    feedback: vi.fn(), feedbackError: vi.fn(), standing: vi.fn(), standingError: vi.fn(),
    scan: vi.fn(),
  },
}));

const banksMock = vi.fn();
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
  },
}));

const coursesMock = vi.fn();
const dayMock = vi.fn();
vi.mock('./Programs/SentenceLadder/languageApi.js', () => ({
  languageApi: {
    courses: (...a) => coursesMock(...a),
    day: (...a) => dayMock(...a),
    log: vi.fn(), roll: vi.fn(), pacing: vi.fn(), history: vi.fn(), recording: vi.fn(),
    audioUrl: () => '', recordingUrl: () => '',
  },
}));

vi.mock('../Player/Player.jsx', () => ({
  default: ({ play }) => <div data-testid="player-stub">Player: {play?.contentId ?? 'none'}</div>,
}));

const EMPTY_CATALOG = { ok: true, status: 200, data: { sections: [], materials: [] } };

beforeEach(() => {
  localStorage.clear();
  h.byTopic = {};
  bankLogMock.mockClear();
  banksMock.mockReset().mockResolvedValue({
    ok: true, status: 200,
    data: [{ id: 'caps', title: 'Caps', audience: 'assigned', subject: null, itemCount: 1 }],
  });
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
  it('program:language with a loaded course navigates into the language runner', async () => {
    coursesMock.mockResolvedValue({
      ok: true, status: 200,
      data: [{ id: 'glossika-korean', label: 'Glossika Korean', languages: { source: 'EN', target: 'KR' }, size: 3000 }],
    });
    render(<SchoolApp clear={() => {}} mode="open" />);
    // Wait for the courses fetch to actually resolve (the shelf tile enabling
    // is the same signal the existing "language courses" tests use) before
    // firing the launch — otherwise the handler can see a stale empty list.
    const language = (await screen.findByText('Language & Culture')).closest('button');
    await waitFor(() => expect(language).not.toBeDisabled());

    deliverLaunch('kid1', { kind: 'program', program: 'language' });

    // The SentenceLadderProgram runner mounted for the learner's one loaded course
    // and fetched today's day (Day 1 is its own rendered header, not a stub).
    expect(await screen.findByText('Day 1')).toBeInTheDocument();
    await waitFor(() => expect(dayMock).toHaveBeenCalledWith('kid1', 'glossika-korean', expect.anything()));
    // Claimed via the launch, not the picker: no dialog ever appeared.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('program:language with no course loaded yet does nothing (no crash, no navigation)', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />); // coursesMock default: []
    await screen.findByText('Civilization');

    deliverLaunch('kid1', { kind: 'program', program: 'language' });

    await waitFor(() => expect(bankLogMock).toHaveBeenCalledWith('program-unavailable', { program: 'language' }));
    expect(dayMock).not.toHaveBeenCalled();
    // Still home: the subject wall, not a runner.
    expect(screen.getByText('Civilization')).toBeInTheDocument();
  });

  it('bank launch for a known bank opens the quiz runner directly, bypassing the picker', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibraryAndWaitForBanks();

    deliverLaunch('kid1', { kind: 'bank', bankId: 'caps', unitId: 'u1', sessionId: 'ses_1' });

    expect(await screen.findByText('WA?')).toBeInTheDocument(); // QuizRunner's question
    // The picker-gated path (`onLaunch`) never ran: no ProfilePicker dialog.
    expect(screen.queryByRole('dialog')).toBeNull();
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
