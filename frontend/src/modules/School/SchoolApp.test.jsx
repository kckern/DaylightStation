import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SchoolApp from './SchoolApp.jsx';

const banksMock = vi.fn();
const materialsMock = vi.fn();
const materialUnitsMock = vi.fn();
const unitProgressMock = vi.fn();
vi.mock('./schoolApi.js', () => ({
  schoolApi: {
    roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'kid1', name: 'Alpha' }] })),
    banks: (...a) => banksMock(...a),
    bank: vi.fn(async (id) => ({ ok: true, status: 200, data: { id, title: 'Caps', audience: 'assigned', items: [{ id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] }] } })),
    openSession: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 'ses_1' } })),
    answer: vi.fn(async () => ({ ok: true, status: 200, data: { correct: true, expected: 'Olympia', attemptId: 'att_1' } })),
    materials: (...a) => materialsMock(...a),
    materialUnits: (...a) => materialUnitsMock(...a),
    unitProgress: (...a) => unitProgressMock(...a),
  },
}));

const coursesMock = vi.fn();
vi.mock('./Programs/Glossika/languageApi.js', () => ({
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

const SAMPLE_CATALOG = {
  ok: true, status: 200,
  data: {
    sections: [{ category: 'course', label: 'Courses' }, { category: 'listening', label: 'Listening' }],
    materials: [
      { id: 'plex:1', title: 'Bill Nye', poster: null, source: 'plex-show', medium: 'video', category: 'course', durationMs: null, unitCount: 3 },
      { id: 'plex:2', title: 'Story Time', poster: null, source: 'plex-album', medium: 'audio', category: 'listening', durationMs: null, unitCount: 5 },
    ],
  },
};

beforeEach(() => {
  localStorage.clear();
  banksMock.mockReset().mockImplementation(async (audience) => ({
    ok: true, status: 200,
    data: audience === 'generic'
      ? [{ id: 'animals', title: 'Animals', audience: 'generic', itemCount: 1 }]
      : [{ id: 'caps', title: 'Caps', audience: 'assigned', itemCount: 1 }, { id: 'animals', title: 'Animals', audience: 'generic', itemCount: 1 }],
  }));
  materialsMock.mockReset().mockResolvedValue(EMPTY_CATALOG);
  materialUnitsMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { material: {}, units: [] } });
  coursesMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: [] });
});

describe('language courses on the home grid', () => {
  it('adds no tile when no corpus is ingested — a tile never points at an absent endpoint', async () => {
    render(<SchoolApp />);
    await screen.findByText('Quizzes & Flashcards');
    expect(screen.queryByText('Glossika Korean')).toBeNull();
  });

  it('adds one tile per course, labelled with its language pair', async () => {
    coursesMock.mockResolvedValue({
      ok: true, status: 200,
      data: [{ id: 'glossika-korean', label: 'Glossika Korean', languages: { source: 'EN', target: 'KR' }, size: 3000 }],
    });
    render(<SchoolApp />);
    expect(await screen.findByText('Glossika Korean')).toBeTruthy();
    expect(screen.getByText('EN → KR')).toBeTruthy();
  });

  it('still builds the grid when the course listing fails', async () => {
    coursesMock.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<SchoolApp />);
    expect(await screen.findByText('Quizzes & Flashcards')).toBeTruthy();
  });
});

// Both bank cards render the title as an <h3>; find the card wrapper so we can
// scope a Quiz/Cards button lookup to the specific bank under test (the grid
// otherwise has ambiguous duplicate "Quiz"/"Cards" buttons once both an
// assigned and a generic bank are visible at once).
function cardFor(title) {
  return screen.getByText(title).closest('.school-browse__card');
}

// The home grid is now the landing surface; every bank-flow test enters the
// banks section first.
async function openBanks() {
  fireEvent.click(await screen.findByRole('button', { name: /quizzes & flashcards/i }));
}

describe('SchoolApp home', () => {
  it('lands on the section grid and fetches no banks until the section opens', async () => {
    render(<SchoolApp clear={() => {}} />);
    expect(await screen.findByRole('button', { name: /quizzes & flashcards/i })).toBeInTheDocument();
    expect(banksMock).not.toHaveBeenCalled();
    await openBanks();
    expect(await screen.findByText('Caps')).toBeInTheDocument();
  });

  it('back from the bank list returns to the home grid', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    await screen.findByText('Caps');
    fireEvent.click(screen.getByRole('button', { name: /back to home/i }));
    expect(await screen.findByRole('button', { name: /quizzes & flashcards/i })).toBeInTheDocument();
    expect(screen.queryByText('Caps')).toBeNull();
  });

  it('home shows Exit school only when a clear prop exists', async () => {
    const { unmount } = render(<SchoolApp clear={() => {}} />);
    expect(await screen.findByRole('button', { name: /exit school/i })).toBeInTheDocument();
    unmount();
    render(<SchoolApp />);
    expect(await screen.findByRole('button', { name: /quizzes & flashcards/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /exit school/i })).toBeNull();
  });
});

describe('SchoolApp', () => {
  it('unclaimed browser sees both an assigned and a generic bank (gate loosened)', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    expect(await screen.findByText('Caps')).toBeInTheDocument();
    expect(screen.getByText('Animals')).toBeInTheDocument();
  });

  it('unclaimed: launching an assigned bank opens the picker; picking a profile proceeds into the runner', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    await screen.findByText('Caps');
    fireEvent.click(within(cardFor('Caps')).getByRole('button', { name: /quiz/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument(); // ProfilePicker
    fireEvent.click(screen.getByText('Alpha'));
    expect(await screen.findByText('WA?')).toBeInTheDocument();
  });

  it('unclaimed: launching an assigned bank then dismissing the picker refuses it, does not enter the runner, and narrows the list to generic', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    await screen.findByText('Caps');
    fireEvent.click(within(cardFor('Caps')).getByRole('button', { name: /quiz/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText(/close/i)); // dismiss picker -> guest

    expect(await screen.findByText(/sign in to take this one/i)).toBeInTheDocument();
    expect(screen.queryByText('WA?')).toBeNull();

    await waitFor(() => expect(banksMock).toHaveBeenLastCalledWith('generic'));
    expect(await screen.findByText('Animals')).toBeInTheDocument();
    expect(screen.queryByText('Caps')).toBeNull();
  });

  it('unclaimed: launching a generic bank then dismissing the picker proceeds as guest into the runner', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    await screen.findByText('Animals');
    fireEvent.click(within(cardFor('Animals')).getByRole('button', { name: /quiz/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText(/close/i)); // dismiss picker -> guest, but generic work proceeds

    expect(await screen.findByText('WA?')).toBeInTheDocument();
  });
});

async function openCourses() {
  fireEvent.click(await screen.findByRole('button', { name: /^courses/i }));
}

async function openListening() {
  fireEvent.click(await screen.findByRole('button', { name: /^listening/i }));
}

// A material tile's poster-placeholder and its <h3> title both render the
// same text, so a plain findByText('Title') is ambiguous. Wait for at least
// one match, then tap the tile (the button ancestor of the first match).
async function tapMaterial(title) {
  await screen.findAllByText(title);
  fireEvent.click(screen.getAllByText(title)[0].closest('button'));
}

describe('SchoolApp materials sections', () => {
  it('a fetched catalog adds category tiles after the built-in sections', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    render(<SchoolApp clear={() => {}} />);
    expect(await screen.findByRole('button', { name: /quizzes & flashcards/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^courses/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^listening/i })).toBeInTheDocument();
  });

  it('a catalog fetch failure leaves only the built-in sections', async () => {
    materialsMock.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<SchoolApp clear={() => {}} />);
    expect(await screen.findByRole('button', { name: /quizzes & flashcards/i })).toBeInTheDocument();
    // give the failed fetch a tick to resolve before asserting absence
    await screen.findByRole('button', { name: /quizzes & flashcards/i });
    expect(screen.queryByRole('button', { name: /^courses/i })).toBeNull();
  });

  it('entering a category section shows only that category\'s materials', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    render(<SchoolApp clear={() => {}} />);
    await openCourses();
    expect((await screen.findAllByText('Bill Nye')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Story Time')).toBeNull();
  });

  it('back from a category section returns to the home grid', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    render(<SchoolApp clear={() => {}} />);
    await openCourses();
    await screen.findAllByText('Bill Nye');
    fireEvent.click(screen.getByRole('button', { name: /back to home/i }));
    expect(await screen.findByRole('button', { name: /^courses/i })).toBeInTheDocument();
  });

  it('unclaimed: tapping a unit in a course material opens the picker; picking launches the pending unit', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: { material: SAMPLE_CATALOG.data.materials[0], units: [{ id: 'plex:10', index: 1, title: 'Air', durationMs: null, group: null, percent: 0, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null }] },
    });
    render(<SchoolApp clear={() => {}} />);
    await openCourses();
    await tapMaterial('Bill Nye');
    fireEvent.click(await screen.findByText('Air'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Alpha'));
    expect(await screen.findByTestId('player-stub')).toHaveTextContent('plex:10');
  });

  it('unclaimed: dismissing the picker on a course unit refuses it (notice, no player)', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: { material: SAMPLE_CATALOG.data.materials[0], units: [{ id: 'plex:10', index: 1, title: 'Air', durationMs: null, group: null, percent: 0, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null }] },
    });
    render(<SchoolApp clear={() => {}} />);
    await openCourses();
    await tapMaterial('Bill Nye');
    fireEvent.click(await screen.findByText('Air'));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(await screen.findByText(/sign in for courses/i)).toBeInTheDocument();
    expect(screen.queryByTestId('player-stub')).toBeNull();
  });

  it('explicit guest tapping a course unit gets the notice directly, no picker', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: { material: SAMPLE_CATALOG.data.materials[0], units: [{ id: 'plex:10', index: 1, title: 'Air', durationMs: null, group: null, percent: 0, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null }] },
    });
    render(<SchoolApp clear={() => {}} />);
    // Become an explicit guest first via the header chip's picker.
    fireEvent.click(await screen.findByRole('button', { name: /tap to sign in/i }));
    fireEvent.click(await screen.findByLabelText(/close/i));
    await screen.findByRole('button', { name: /guest/i });

    await openCourses();
    await tapMaterial('Bill Nye');
    fireEvent.click(await screen.findByText('Air'));
    expect(await screen.findByText(/sign in for courses/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a listening material unit plays without any identity gating', async () => {
    materialsMock.mockResolvedValue(SAMPLE_CATALOG);
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: { material: SAMPLE_CATALOG.data.materials[1], units: [{ id: 'plex:20', index: 1, title: 'Chapter 1', durationMs: null, group: null, percent: 0, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null }] },
    });
    render(<SchoolApp clear={() => {}} />);
    await openListening();
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
    render(<SchoolApp clear={() => {}} />);
    await openListening();
    await tapMaterial('Story Time');
    await waitFor(() => expect(materialUnitsMock).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByText('Chapter 1'));
    await screen.findByTestId('player-stub');

    // The material player's own exit row (its back button, carrying the
    // material title) is the "child leaves mid-play" affordance — it must
    // flow back to the detail view AND force a fresh units fetch.
    fireEvent.click(screen.getByRole('button', { name: /Story Time/i }));
    expect(await screen.findByText('Chapter 1')).toBeInTheDocument();
    await waitFor(() => expect(materialUnitsMock).toHaveBeenCalledTimes(2));
  });
});
