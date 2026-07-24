import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SchoolApp from './SchoolApp.jsx';

// Same mock shape as SchoolApp.test.jsx's harness, plus geoDecks — the
// geography section's own GeographyGrid fetch.
const banksMock = vi.fn();
const materialsMock = vi.fn();
const geoDecksMock = vi.fn();
vi.mock('./schoolApi.js', () => ({
  schoolApi: {
    roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'kid1', name: 'Alpha', birthyear: 2016 }] })),
    banks: (...a) => banksMock(...a),
    bank: vi.fn(async (id) => ({ ok: true, status: 200, data: { id, title: 'US Capitals', audience: 'generic', items: [{ id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] }] } })),
    openSession: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 'ses_1' } })),
    answer: vi.fn(async () => ({ ok: true, status: 200, data: { correct: true, expected: 'Olympia', attemptId: 'att_1' } })),
    materials: (...a) => materialsMock(...a),
    materialUnits: vi.fn(async () => ({ ok: true, status: 200, data: { material: {}, units: [] } })),
    unitProgress: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    quizRequests: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    requestQuiz: vi.fn(async () => ({ ok: true, status: 200, data: { requested: true, duplicate: false } })),
    report: vi.fn(async () => ({ ok: true, status: 200, data: { learners: [] } })),
    results: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    materialProgress: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    geoDecks: (...a) => geoDecksMock(...a),
  },
}));

vi.mock('./Programs/Glossika/languageApi.js', () => ({
  languageApi: {
    courses: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    day: vi.fn(async () => ({ ok: true, status: 200, data: null })),
    log: vi.fn(), roll: vi.fn(), pacing: vi.fn(), history: vi.fn(), recording: vi.fn(),
    audioUrl: () => '', recordingUrl: () => '',
  },
}));

// A material shelved under `history` so the "History & Geography" tile is
// enabled (subjectHasContent looks at the actual catalog, not the built-in
// SUBJECT_PROGRAMS entry) — mirrors SchoolApp.test.jsx's SAMPLE_CATALOG.
const HISTORY_CATALOG = {
  ok: true, status: 200,
  data: {
    sections: [{ category: 'course', label: 'Courses' }],
    materials: [
      { id: 'plex:9', title: 'World History', poster: null, source: 'plex-show', medium: 'video', category: 'course', subject: 'history', durationMs: null, unitCount: 2 },
    ],
  },
};

beforeEach(() => {
  localStorage.clear();
  banksMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: [] });
  materialsMock.mockReset().mockResolvedValue(HISTORY_CATALOG);
  geoDecksMock.mockReset().mockResolvedValue({
    ok: true, status: 200,
    data: { decks: [{ deckId: 'us-capitals', bankId: 'geo:us-capitals', title: 'US Capitals', available: true }] },
  });
});

async function openSubject(name) {
  const btn = await screen.findByRole('button', { name });
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
}

describe('SchoolApp geography wiring', () => {
  it('the History & Geography shelf shows a Geography tile that opens the geography section', async () => {
    render(<SchoolApp clear={() => {}} />);
    // Claim an identity first (mirrors "unclaimed, tapping a face … claims
    // directly" in SchoolApp.test.jsx) — the flow this task wires is meant
    // for a claimed learner.
    fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }));
    await waitFor(() => expect(screen.queryByText(/who's learning\?/i)).toBeNull());

    await openSubject(/history & geography/i);
    expect((await screen.findAllByText('World History')).length).toBeGreaterThan(0);

    const geoTile = await screen.findByRole('button', { name: /geography/i });
    fireEvent.click(geoTile);

    // The geography section is mounted: GeographyGrid fetches decks and
    // renders the topic grid (the deck tile from geoDecksMock).
    expect(await screen.findByText('US Capitals')).toBeInTheDocument();
    expect(screen.queryByText('World History')).toBeNull(); // subject shelf swapped out
  });
});
