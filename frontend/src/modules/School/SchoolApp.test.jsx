import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SchoolApp, { parseSchoolPath } from './SchoolApp.jsx';
import { schoolApi } from './schoolApi.js';

// Spy on the schoolLog facade so the launch-refused path (F12) is directly
// observable, not just inferred from the rendered panel.
const surfaceLogMock = vi.fn();
vi.mock('./schoolLog.js', () => ({
  schoolLog: {
    profile: vi.fn(), session: vi.fn(), answer: vi.fn(), answerError: vi.fn(),
    bank: vi.fn(), nav: vi.fn(), home: vi.fn(), materials: vi.fn(), materialsError: vi.fn(),
    print: vi.fn(), typing: vi.fn(), player: vi.fn(),
    surface: (...a) => surfaceLogMock(...a),
    feedback: vi.fn(), feedbackError: vi.fn(), standing: vi.fn(), standingError: vi.fn(),
  },
}));

const banksMock = vi.fn();
const materialsMock = vi.fn();
const materialUnitsMock = vi.fn();
const unitProgressMock = vi.fn();
const learningCatalogsMock = vi.fn();
const learningLessonMock = vi.fn();
const surfaceProfileMock = vi.fn();
const certificationMock = vi.fn();

describe('Sentence Ladder route authority', () => {
  it('does not reconstruct a learner launch from a direct URL or refresh', () => {
    expect(parseSchoolPath('/school/sentence-ladder/glossika-korean')).toEqual({
      section: null, materialPath: [],
    });
  });
});
vi.mock('./schoolApi.js', () => ({
  schoolApi: {
    roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'kid1', name: 'Alpha', birthyear: 2016 }, { id: 'dad1', name: 'Papa', birthyear: 1984 }] })),
    wallet: vi.fn(async () => ({ ok: false, status: 503, data: null })),
    banks: (...a) => banksMock(...a),
    bank: vi.fn(async (id) => ({ ok: true, status: 200, data: { id, title: 'Caps', audience: 'assigned', items: [{ id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] }] } })),
    openSession: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 'ses_1' } })),
    answer: vi.fn(async () => ({ ok: true, status: 200, data: { correct: true, expected: 'Olympia', attemptId: 'att_1' } })),
    materials: (...a) => materialsMock(...a),
    learningCatalogs: (...a) => learningCatalogsMock(...a),
    learningLesson: (...a) => learningLessonMock(...a),
    recordProbeInteraction: vi.fn(async () => ({ ok: true, status: 201, data: {} })),
    materialUnits: (...a) => materialUnitsMock(...a),
    unitProgress: (...a) => unitProgressMock(...a),
    quizRequests: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    requestQuiz: vi.fn(async () => ({ ok: true, status: 200, data: { requested: true, duplicate: false } })),
    report: vi.fn(async () => ({ ok: true, status: 200, data: { learners: [{ id: 'kid1', name: 'Alpha', reports: [] }] } })),
    results: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    materialProgress: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    surfaceProfile: (...a) => surfaceProfileMock(...a),
    certification: (...a) => certificationMock(...a),
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
vi.mock('./Programs/SentenceLadder/languageApi.js', () => ({
  languageApi: {
    courses: (...a) => coursesMock(...a),
    day: vi.fn(async () => ({ ok: true, status: 200, data: null })),
    log: vi.fn(), roll: vi.fn(), pacing: vi.fn(), history: vi.fn(), recording: vi.fn(),
    audioUrl: () => '', recordingUrl: () => '',
  },
}));

// SchoolMaterialPlayer wraps the real, heavy shared Player (lazy-imported) —
// stub it the same way MediaApp.test.jsx does, so materials-flow tests never
// pay for (or depend on) real playback engine internals.
vi.mock('../Player/Player.jsx', () => ({
  default: ({ play }) => <div data-testid="player-stub">Player: {play?.contentId ?? 'none'}</div>,
}));

const EMPTY_CATALOG = { ok: true, status: 200, data: { sections: [], materials: [] } };

// Bill Nye is shelved under Science; Story Time carries no subject and is a
// listening item, so it lands in the Library.
const SAMPLE_CATALOG = {
  ok: true, status: 200,
  data: {
    sections: [{ category: 'course', label: 'Courses' }, { category: 'listening', label: 'Listening' }],
    materials: [
      { id: 'plex:1', title: 'Bill Nye', poster: null, source: 'media-series', medium: 'video', category: 'course', subject: 'science', durationMs: null, unitCount: 3 },
      { id: 'plex:2', title: 'Story Time', poster: null, source: 'media-album', medium: 'audio', category: 'listening', subject: null, durationMs: null, unitCount: 5 },
    ],
  },
};

beforeEach(() => {
  localStorage.clear();
  banksMock.mockReset().mockImplementation(async (audience) => ({
    ok: true, status: 200,
    data: audience === 'generic'
      ? [{ id: 'animals', title: 'Animals', audience: 'generic', subject: null, itemCount: 1 }]
      : [{ id: 'caps', title: 'Caps', audience: 'assigned', subject: null, itemCount: 1 }, { id: 'animals', title: 'Animals', audience: 'generic', subject: null, itemCount: 1 }],
  }));
  materialsMock.mockReset().mockResolvedValue(EMPTY_CATALOG);
  learningCatalogsMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { schema: 'school.catalog-index/v1', catalogs: [] } });
  learningLessonMock.mockReset();
  materialUnitsMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { material: {}, units: [] } });
  coursesMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: [] });
  // Benign defaults: this app mount's surface never resolves (no profile
  // authored for the test host), so catalog learning launches are gated off
  // by default. The one test that actually launches a catalog module
  // (below) overrides both with a resolved surface + a 'render' verdict.
  surfaceProfileMock.mockReset().mockResolvedValue({ ok: false, status: 404, data: { error: 'surface-profile-unresolved' } });
  certificationMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: [] });
  surfaceLogMock.mockReset();
});

describe('authored learning Catalog', () => {
  it('opens a generic Catalog hierarchy and asks who is studying before tracked work', async () => {
    learningCatalogsMock.mockResolvedValueOnce({ ok: true, status: 200, data: {
      schema: 'school.catalog-index/v1', catalogs: [{
        schema: 'school.catalog/v1', catalogId: 'core', title: 'Core', subjects: [{
          subjectId: 'quant', title: 'Quantitative', courses: [{ courseId: 'rates', title: 'Rates', units: [{
            unitId: 'intro', title: 'Introduction', lessons: [{ lessonId: 'unit-rate', title: 'Unit rates', modules: [{ moduleId: 'check', type: 'learning_probe' }] }],
          }] }],
        }],
      }],
    } });
    learningLessonMock.mockResolvedValueOnce({ ok: true, status: 200, data: {
      schema: 'school.learning-lesson/v1',
      context: { catalog: { catalogId: 'core' }, subject: { subjectId: 'quant' }, course: { courseId: 'rates' }, unit: { unitId: 'intro' } },
      lesson: { lessonId: 'unit-rate', title: 'Unit rates', modules: [{
        moduleId: 'check', type: 'learning_probe', title: 'Check it', bankId: 'rate-check',
        phase: 'check', difficulty: 2, conceptIds: ['unit-rate'],
        feedback: { timing: 'immediate', onIncorrect: 'explain_then_continue', maxAttemptsPerItem: 1 },
        bank: { id: 'rate-check', title: 'Rate check', items: [{ id: 'q1', type: 'multiple_choice', prompt: 'A unit rate?', choices: ['Yes', 'No'], answer: 'Yes', feedback: { explanation: 'One denominator unit.' } }] },
      }] },
    } });
    // This screen's surface DOES resolve, and the "check" module is
    // certified to render here — the gate in SchoolApp.startLearning must
    // let a fully-certified catalog launch through unchanged.
    surfaceProfileMock.mockResolvedValueOnce({ ok: true, status: 200, data: { surfaceId: 'screen-test', family: 'screen', title: 'Test Screen', liveness: 'live', capabilities: {}, limits: {} } });
    certificationMock.mockResolvedValueOnce({ ok: true, status: 200, data: [{
      address: 'core/quant/rates/intro/unit-rate', surfaceId: 'screen-test', verdict: 'full', reasons: [], warnings: [],
      moduleVerdicts: [{ moduleId: 'check', verdict: 'render', reasons: [], warnings: [] }],
    }] });
    render(<SchoolApp clear={() => {}} mode="open" />);
    fireEvent.click(await screen.findByRole('button', { name: /^catalog/i }));
    for (const label of ['Core', 'Quantitative', 'Rates', 'Introduction', 'Unit rates']) {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(label, 'i') }));
    }
    // The lesson header carries the row-level full/partial badge for this surface.
    expect(await screen.findByText('Full')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Check it/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Alpha'));
    expect(await screen.findByText('A unit rate?')).toBeInTheDocument();
  });

  it('a catalog module launch is refused (fail closed) when this surface never certified it', async () => {
    // Default beforeEach mocks: surfaceProfile ok:false -> no surfaceId ->
    // LearningCatalogBrowser never fetches certification -> an empty verdict
    // map -> moduleLaunchAllowed refuses every moduleId, including this one.
    learningCatalogsMock.mockResolvedValueOnce({ ok: true, status: 200, data: {
      schema: 'school.catalog-index/v1', catalogs: [{
        schema: 'school.catalog/v1', catalogId: 'core', title: 'Core', subjects: [{
          subjectId: 'quant', title: 'Quantitative', courses: [{ courseId: 'rates', title: 'Rates', units: [{
            unitId: 'intro', title: 'Introduction', lessons: [{ lessonId: 'unit-rate', title: 'Unit rates', modules: [{ moduleId: 'check', type: 'learning_probe' }] }],
          }] }],
        }],
      }],
    } });
    learningLessonMock.mockResolvedValueOnce({ ok: true, status: 200, data: {
      schema: 'school.learning-lesson/v1',
      context: { catalog: { catalogId: 'core' }, subject: { subjectId: 'quant' }, course: { courseId: 'rates' }, unit: { unitId: 'intro' } },
      lesson: { lessonId: 'unit-rate', title: 'Unit rates', modules: [{
        moduleId: 'check', type: 'learning_probe', title: 'Check it', bankId: 'rate-check',
        phase: 'check', difficulty: 2, conceptIds: ['unit-rate'],
        feedback: { timing: 'immediate', onIncorrect: 'explain_then_continue', maxAttemptsPerItem: 1 },
        bank: { id: 'rate-check', title: 'Rate check', items: [{ id: 'q1', type: 'multiple_choice', prompt: 'A unit rate?', choices: ['Yes', 'No'], answer: 'Yes', feedback: { explanation: 'One denominator unit.' } }] },
      }] },
    } });
    render(<SchoolApp clear={() => {}} mode="open" />);
    fireEvent.click(await screen.findByRole('button', { name: /^catalog/i }));
    for (const label of ['Core', 'Quantitative', 'Rates', 'Introduction', 'Unit rates']) {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(label, 'i') }));
    }
    expect(screen.queryByText('Full')).toBeNull();
    expect(screen.queryByText('Partial')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /Check it/ }));
    // Tracked module: still asks who's studying (identity gate is unaffected).
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Alpha'));
    // Refused: the learning_unsupported panel, not the probe question.
    expect(await screen.findByText(/needs a capability that is not installed/i)).toBeInTheDocument();
    expect(screen.queryByText('A unit rate?')).toBeNull();
    // F12: the refusal is logged with the moduleId that was refused.
    expect(surfaceLogMock).toHaveBeenCalledWith('launch-refused', expect.objectContaining({ moduleId: 'check' }));
  });

  // Task 16 (debt W7b): a failed catalog quiz offers a way back to the
  // Catalog (the real, reachable target -- AdaptiveTutorPanel needs a
  // pre-existing remediation sessionId this screen doesn't have yet).
  it('a failed catalog quiz module offers Review this lesson, which reopens the Catalog', async () => {
    // Not `...Once`: LearningCatalogBrowser unmounts while the quiz plays
    // (`section === 'catalog' && !active`) and re-fetches on remount after
    // Review this lesson is tapped, so both mounts need this same catalog.
    learningCatalogsMock.mockResolvedValue({ ok: true, status: 200, data: {
      schema: 'school.catalog-index/v1', catalogs: [{
        schema: 'school.catalog/v1', catalogId: 'core', title: 'Core', subjects: [{
          subjectId: 'quant', title: 'Quantitative', courses: [{ courseId: 'rates', title: 'Rates', units: [{
            unitId: 'intro', title: 'Introduction', lessons: [{ lessonId: 'unit-rate', title: 'Unit rates', modules: [{ moduleId: 'gate', type: 'quiz' }] }],
          }] }],
        }],
      }],
    } });
    learningLessonMock.mockResolvedValueOnce({ ok: true, status: 200, data: {
      schema: 'school.learning-lesson/v1',
      context: { catalog: { catalogId: 'core' }, subject: { subjectId: 'quant' }, course: { courseId: 'rates' }, unit: { unitId: 'intro' } },
      lesson: { lessonId: 'unit-rate', title: 'Unit rates', modules: [{
        moduleId: 'gate', type: 'quiz', title: 'Gate quiz', passingPercent: 80,
        bank: { id: 'rate-quiz', title: 'Rate quiz', items: [{ id: 'q1', type: 'multiple_choice', prompt: 'A unit rate?', choices: ['Yes', 'No'], answer: 'Yes' }] },
      }] },
    } });
    surfaceProfileMock.mockResolvedValueOnce({ ok: true, status: 200, data: { surfaceId: 'screen-test', family: 'screen', title: 'Test Screen', liveness: 'live', capabilities: {}, limits: {} } });
    certificationMock.mockResolvedValueOnce({ ok: true, status: 200, data: [{
      address: 'core/quant/rates/intro/unit-rate', surfaceId: 'screen-test', verdict: 'full', reasons: [], warnings: [],
      moduleVerdicts: [{ moduleId: 'gate', verdict: 'render', reasons: [], warnings: [] }],
    }] });
    render(<SchoolApp clear={() => {}} mode="open" />);
    fireEvent.click(await screen.findByRole('button', { name: /^catalog/i }));
    for (const label of ['Core', 'Quantitative', 'Rates', 'Introduction', 'Unit rates']) {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(label, 'i') }));
    }
    fireEvent.click(await screen.findByRole('button', { name: /Gate quiz/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Alpha'));
    // The shared `answer` mock always grades "correct" regardless of which
    // choice was tapped; override once so this run actually fails the bar.
    schoolApi.answer.mockResolvedValueOnce({ ok: true, status: 200, data: { correct: false, expected: 'Yes', attemptId: 'a1' } });
    fireEvent.click(await screen.findByRole('button', { name: 'No' })); // wrong answer -> fails the 80% bar
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    expect(await screen.findByTestId('quiz-passbar')).toHaveTextContent(/passing is 80%/);
    fireEvent.click(screen.getByTestId('review-lesson'));
    // Back at the Catalog root, quiz gone -- the same tile trail is walkable again.
    expect(screen.queryByTestId('quiz-summary')).toBeNull();
    expect(await screen.findByRole('button', { name: /^Core$/i })).toBeInTheDocument();
  });
});

// Untagged banks shelve into the Library's Practice group — every bank-flow
// test enters through the Library.
async function openLibrary() {
  fireEvent.click(await screen.findByRole('button', { name: /library/i }));
}

async function openSubject(name) {
  // A subject tile is greyed and DISABLED until the catalog resolves (the
  // registry convention — the wall shows the whole curriculum's shape, greyed,
  // before content loads). `findByRole` returns the tile the instant it exists,
  // which is while it is still disabled, and `fireEvent.click` on a disabled
  // button is a no-op — so clicking too early silently fails to navigate. Wait
  // for the tile to enable (catalog loaded) before tapping.
  const btn = await screen.findByRole('button', { name });
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
}

// Both bank cards render the title as an <h3>; find the card wrapper so we can
// scope a Quiz/Cards button lookup to the specific bank under test.
function cardFor(title) {
  return screen.getByText(title).closest('.school-browse__card');
}

// A material tile's poster-placeholder and its <h3> title both render the
// same text, so a plain findByText('Title') is ambiguous. Wait for at least
// one match, then tap the tile (the button ancestor of the first match).
async function tapMaterial(title) {
  await screen.findAllByText(title);
  fireEvent.click(screen.getAllByText(title)[0].closest('button'));
}

describe('SchoolApp home — the subject wall', () => {
  it('renders all nine subjects; empty shelves are greyed, not hidden', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    for (const label of ['English & Literature', 'Writing & Typing', 'Language & Culture', 'Math & Money', 'Science & Nature', 'Life & Skills', 'Civilization', 'Scripture & Gospel', 'Art & Music']) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    // Empty catalog: the shelf is disabled and says so in words (wave-7
    // advocacy) — a dead tap with no caption reads as "broken" to a child.
    const science = screen.getByText('Science & Nature').closest('button');
    expect(science).toBeDisabled();
    expect(within(science).getByText('Nothing here yet')).toBeInTheDocument();
    // Unclaimed: no header sign-in chip — the panel's face row is the claim
    // affordance (their face appears there instead). Kids only: adults claim
    // via the launch-prompt picker, not the panel.
    expect(screen.queryByText('Tap to sign in')).toBeNull();
    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Papa/ })).toBeNull();
  });

  it('a subject with shelved content is enabled and opens its page', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    render(<SchoolApp clear={() => {}} mode="open" />);
    const science = (await screen.findByText('Science & Nature')).closest('button');
    await waitFor(() => expect(science).not.toBeDisabled());
    fireEvent.click(science);
    expect((await screen.findAllByText('Bill Nye')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Story Time')).toBeNull(); // Library material, not Science
  });

  it('the Library holds untagged material and untagged practice banks', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    expect((await screen.findAllByText('Story Time')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Caps')).toBeInTheDocument();
    expect(screen.queryByText('Bill Nye')).toBeNull(); // shelved under Science
  });

  it('the apple home crumb returns from the Library to the subject wall', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    await screen.findByText('Caps');
    // In a section the home anchor is labelled "Home"; tapping it goes home.
    fireEvent.click(screen.getByRole('button', { name: /^home$/i }));
    expect(await screen.findByText('Civilization')).toBeInTheDocument();
    expect(screen.queryByText('Caps')).toBeNull();
  });

  it('the Library breadcrumb reads "apple › Library" while inside it', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    await screen.findByText('Caps');
    // The section crumb is the current (deepest) crumb; no back row exists.
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^home$/i })).toBeInTheDocument();
  });

  it('unclaimed, tapping a face in the student panel claims directly', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    expect(await screen.findByText(/who's learning\?/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }));
    // Claimed: the "who's learning?" prompt is gone and the header identity
    // chip now shows the name (the old "Hi <name>" title greeting is retired).
    await waitFor(() => expect(screen.queryByText(/who's learning\?/i)).toBeNull());
    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument(); // header chip
  });

  it('the apple home anchor exits (calls clear) at home only when a clear prop exists', async () => {
    const clear = vi.fn();
    const { unmount } = render(<SchoolApp clear={clear} mode="open" />);
    await screen.findByText('Civilization');
    // At home the anchor is labelled "School" and triggers the app exit.
    fireEvent.click(screen.getByRole('button', { name: /^school$/i }));
    expect(clear).toHaveBeenCalled();
    unmount();
    // No clear prop (the Portal): home IS the root, so the anchor becomes the
    // kiosk's only refresh affordance — there is no address bar behind it.
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, pathname: '/', reload });
    render(<SchoolApp mode="open" />);
    expect(await screen.findByText('Civilization')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }));
    expect(reload).toHaveBeenCalled();
  });
});

describe('language courses', () => {
  it('no ingested corpus leaves the Language shelf greyed — a tile never points at an absent endpoint', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    const language = (await screen.findByText('Language & Culture')).closest('button');
    await waitFor(() => expect(language).toBeDisabled());
    expect(screen.queryByText('Glossika Korean')).toBeNull();
  });

  it('an ingested Sentence Ladder corpus remains absent from general browse', async () => {
    coursesMock.mockResolvedValue({
      ok: true, status: 200,
      data: [{ id: 'glossika-korean', label: 'Glossika Korean', languages: { source: 'EN', target: 'KR' }, size: 3000 }],
    });
    render(<SchoolApp clear={() => {}} mode="open" />);
    const language = (await screen.findByText('Language & Culture')).closest('button');
    await waitFor(() => expect(coursesMock).toHaveBeenCalled());
    expect(language).toBeDisabled();
    expect(screen.queryByText('Glossika Korean')).toBeNull();
  });

  it('still builds the wall when the course listing fails', async () => {
    coursesMock.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<SchoolApp clear={() => {}} mode="open" />);
    expect(await screen.findByText('Civilization')).toBeInTheDocument();
  });
});

describe('SchoolApp bank flows (via the Library)', () => {
  it('unclaimed browser sees both an assigned and a generic bank (gate loosened)', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    expect(await screen.findByText('Caps')).toBeInTheDocument();
    expect(screen.getByText('Animals')).toBeInTheDocument();
  });

  it('unclaimed: launching an assigned bank opens the picker; picking a profile proceeds into the runner', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    await screen.findByText('Caps');
    fireEvent.click(within(cardFor('Caps')).getByRole('button', { name: /quiz/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument(); // ProfilePicker
    fireEvent.click(screen.getByText('Alpha'));
    expect(await screen.findByText('WA?')).toBeInTheDocument();
  });

  it('a claimed kid launching a generic bank never sees the picker', async () => {
    localStorage.setItem('school:user', 'kid1'); // pre-claimed, as if picked on a prior visit
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    await screen.findByText('Animals');
    fireEvent.click(within(cardFor('Animals')).getByRole('button', { name: /quiz/i }));
    expect(await screen.findByText('WA?')).toBeInTheDocument(); // straight into the runner
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a claimed kid launching an assigned bank never sees the picker', async () => {
    localStorage.setItem('school:user', 'kid1');
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    await screen.findByText('Caps');
    fireEvent.click(within(cardFor('Caps')).getByRole('button', { name: /quiz/i }));
    expect(await screen.findByText('WA?')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('unclaimed: launching an assigned bank then dismissing the picker CANCELS — no guest demotion, no notice, no runner', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    await screen.findByText('Caps');
    fireEvent.click(within(cardFor('Caps')).getByRole('button', { name: /quiz/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText(/close/i)); // ✕ -> cancel, not guest

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/sign in to take this one/i)).toBeNull();
    expect(screen.queryByText('WA?')).toBeNull();
    // Identity is untouched (still unclaimed) -- no guest chip appeared, and
    // the bank list still shows the assigned bank too (never narrowed).
    expect(screen.queryByRole('button', { name: /^guest$/i })).toBeNull();
    expect(screen.getByText('Caps')).toBeInTheDocument();
  });

  it('unclaimed: the picker guest button on an assigned bank refuses it with the sign-in notice, and narrows the list to generic', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    await screen.findByText('Caps');
    fireEvent.click(within(cardFor('Caps')).getByRole('button', { name: /quiz/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /just practicing/i })); // explicit guest

    expect(await screen.findByText(/sign in to take this one/i)).toBeInTheDocument();
    expect(screen.queryByText('WA?')).toBeNull();

    await waitFor(() => expect(banksMock).toHaveBeenLastCalledWith('generic'));
    expect(await screen.findByText('Animals')).toBeInTheDocument();
    expect(screen.queryByText('Caps')).toBeNull();
  });

  it('unclaimed: launching a generic bank then dismissing the picker CANCELS — stays put, no guest, no runner', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    await screen.findByText('Animals');
    fireEvent.click(within(cardFor('Animals')).getByRole('button', { name: /quiz/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText(/close/i)); // ✕ -> cancel, not guest

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('WA?')).toBeNull();
    expect(screen.queryByRole('button', { name: /^guest$/i })).toBeNull();
  });

  it('unclaimed: the picker guest button on a generic bank proceeds as guest into the runner', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    await screen.findByText('Animals');
    fireEvent.click(within(cardFor('Animals')).getByRole('button', { name: /quiz/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /just practicing/i })); // explicit guest, generic work proceeds

    expect(await screen.findByText('WA?')).toBeInTheDocument();
  });

  it('the apple mid-quiz arms a leave confirm — one stray tap never discards a run (M7)', async () => {
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    await screen.findByText('Animals');
    fireEvent.click(within(cardFor('Animals')).getByRole('button', { name: /quiz/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /just practicing/i })); // explicit guest into the runner
    await screen.findByText('WA?'); // in the runner

    fireEvent.click(screen.getByRole('button', { name: /^home$/i }));
    // First tap: still in the quiz, with the warning up.
    expect(screen.getByTestId('leave-confirm')).toBeInTheDocument();
    expect(screen.getByText('WA?')).toBeInTheDocument();
    // Second tap: actually leaves.
    fireEvent.click(screen.getByRole('button', { name: /^home$/i }));
    expect(await screen.findByText('Civilization')).toBeInTheDocument();
    expect(screen.queryByText('WA?')).toBeNull();
  });
});

describe('SchoolApp materials flows', () => {
  it('unclaimed: tapping a unit in a course material opens the picker; picking launches the pending unit', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: { material: SAMPLE_CATALOG.data.materials[0], units: [{ id: 'plex:10', index: 1, title: 'Air', durationMs: null, group: null, percent: 0, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null }] },
    });
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openSubject(/science/i);
    await tapMaterial('Bill Nye');
    fireEvent.click(await screen.findByText('Air'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Alpha'));
    expect(await screen.findByTestId('player-stub')).toHaveTextContent('plex:10');
  });

  it('unclaimed: dismissing the picker on a course unit CANCELS — no notice, no player, identity untouched', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: { material: SAMPLE_CATALOG.data.materials[0], units: [{ id: 'plex:10', index: 1, title: 'Air', durationMs: null, group: null, percent: 0, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null }] },
    });
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openSubject(/science/i);
    await tapMaterial('Bill Nye');
    fireEvent.click(await screen.findByText('Air'));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText(/close/i)); // ✕ -> cancel, not guest

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/sign in for courses/i)).toBeNull();
    expect(screen.queryByTestId('player-stub')).toBeNull();
    expect(screen.queryByRole('button', { name: /^guest$/i })).toBeNull();
  });

  it('unclaimed: the picker guest button on a course unit refuses it directly (course notice, no player)', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: { material: SAMPLE_CATALOG.data.materials[0], units: [{ id: 'plex:10', index: 1, title: 'Air', durationMs: null, group: null, percent: 0, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null }] },
    });
    render(<SchoolApp clear={() => {}} mode="open" />);
    // The header has no sign-in chip anymore: guesthood arises from the
    // picker's own explicit guest row (Task 18), not from waving it off.
    await openSubject(/science/i);
    await tapMaterial('Bill Nye');
    fireEvent.click(await screen.findByText('Air'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /just practicing/i }));
    // Explicit guest hits the course gate: the notice appears, the guest chip
    // shows, and the picker does not return.
    expect(await screen.findByText(/sign in for courses/i)).toBeInTheDocument();
    await screen.findByRole('button', { name: /^guest$/i });
    expect(screen.queryByRole('dialog')).toBeNull();

    // Now already-explicit-guest: tapping the same unit again hits the notice
    // directly, with no picker in between.
    fireEvent.click(await screen.findByText('Air'));
    expect(await screen.findByText(/sign in for courses/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('player-stub')).toBeNull();
  });

  it('a listening material unit in the Library plays without any identity gating', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: { material: SAMPLE_CATALOG.data.materials[1], units: [{ id: 'plex:20', index: 1, title: 'Chapter 1', durationMs: null, group: null, percent: 0, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null }] },
    });
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    await tapMaterial('Story Time');
    fireEvent.click(await screen.findByText('Chapter 1'));
    expect(await screen.findByTestId('player-stub')).toHaveTextContent('plex:20');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('exiting the player refetches the unit list (lock state may have changed)', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: { material: SAMPLE_CATALOG.data.materials[1], units: [{ id: 'plex:20', index: 1, title: 'Chapter 1', durationMs: null, group: null, percent: 0, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null }] },
    });
    render(<SchoolApp clear={() => {}} mode="open" />);
    await openLibrary();
    await tapMaterial('Story Time');
    await waitFor(() => expect(materialUnitsMock).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByText('Chapter 1'));
    await screen.findByTestId('player-stub');
    // The player fetches sibling units for its prev/next-chapter controls, so
    // the exact call count is incidental — capture it, then assert it rises.
    await waitFor(() => expect(materialUnitsMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    const before = materialUnitsMock.mock.calls.length;

    // Leaving mid-play via the header breadcrumb material crumb flows back to
    // the detail view AND forces a fresh units fetch (lock state may differ).
    fireEvent.click(screen.getByRole('button', { name: /Story Time/i }));
    expect(await screen.findByText('Chapter 1')).toBeInTheDocument();
    await waitFor(() => expect(materialUnitsMock.mock.calls.length).toBeGreaterThan(before));
  });
});
