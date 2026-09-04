/**
 * A LOCKED PANEL SHOWING A PREVIEW HAS ONE WAY OUT.
 *
 * `/school/launch-preview/<payload>` is a section as far as the router is
 * concerned, and lock mode draws a floating "Done" over any mounted section
 * because a program has no header to fall back on. On a preview that produced a
 * live, full-strength button on a screen whose own banner says nothing here is
 * live — and a THIRD exit, after "Leave preview" and the card's own "Go back".
 *
 * ⚠️ jsdom sees structure, not layout. This says nothing about where that
 * button sat; it says whether it exists.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SchoolApp from './SchoolApp.jsx';

const PREVIEW_CARD = {
  schema: 'school.self-service-card/v2',
  ok: true,
  preview: true,
  context: {
    learner: { id: 'learner3', displayName: 'Learner3', avatar: { kind: 'learner', id: 'learner3' } },
    taxonomy: {
      subject: { id: 'arts', label: 'Arts & Culture' },
      course: { id: 'plex:675689', title: 'Hoffman Academy', artwork: { kind: 'course-poster', courseId: 'plex:675689' } },
      module: { id: 'unit-2', title: 'Unit 2 · Chords & the Grand Staff', position: 2 },
      lesson: { id: 'plex:676040', title: 'Rhythm Improvisation with Chords' },
    },
    trail: [
      { kind: 'subject', id: 'arts', label: 'Arts & Culture' },
      { kind: 'course', id: 'plex:675689', label: 'Hoffman Academy' },
    ],
    progress: [],
  },
  presentation: { status: 'ready', message: null, preview: true },
  actions: [
    { kind: 'program', label: 'Open Hoffman Academy', target: 'piano-course', role: 'primary', inert: true },
    { kind: 'exit', label: 'Go back', role: 'secondary', inert: true },
  ],
};

vi.mock('./schoolApi.js', () => ({
  schoolApi: {
    roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'learner3', name: 'Learner3', birthyear: 2016 }] })),
    wallet: vi.fn(async () => ({ ok: false, status: 503, data: null })),
    surfaceProfile: vi.fn(async () => ({ ok: true, status: 200, data: { surfaceId: 'screen-browser' } })),
    materials: vi.fn(async () => ({ ok: true, status: 200, data: { materials: [] } })),
    banks: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    agendaPreview: vi.fn(async () => ({ ok: true, status: 200, data: { sections: [] } })),
    teacherDay: vi.fn(async () => ({ ok: true, status: 200, data: { learners: [] } })),
    selfServicePreview: vi.fn(async () => ({ ok: true, status: 200, data: PREVIEW_CARD })),
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
const { schoolApi } = await import('./schoolApi.js');

describe('a launch-card preview on a locked panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ presence: { devices: [] } }) }));
    window.history.replaceState({}, '', '/school/launch-preview/cGF5bG9hZA');
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.unstubAllGlobals();
  });

  it('draws no locked-shell exit over it — the band above the card is the way out', async () => {
    render(<SchoolApp mode="locked" />);

    await waitFor(() => expect(screen.getByTestId('selfservice-preview-banner')).toBeInTheDocument());
    expect(screen.queryByTestId('selfservice-section-exit')).toBeNull();
    expect(screen.getByTestId('selfservice-preview-leave')).toBeEnabled();
    // And nothing inside the card can be pressed, which was always true and
    // was exactly what the floating button contradicted.
    expect(screen.getByTestId('selfservice-action-program')).toBeDisabled();
    expect(screen.getByTestId('selfservice-action-exit')).toBeDisabled();
  });

  it('accepts the five-minute signed token from /school?preview= without showing the keypad', async () => {
    window.history.replaceState({}, '', '/school?preview=header.signature');
    render(<SchoolApp mode="locked" />);

    await waitFor(() => expect(screen.getByText('Teacher preview')).toBeInTheDocument());
    expect(schoolApi.selfServicePreview).toHaveBeenCalledWith('header.signature');
    expect(screen.queryByText(/enter your code/i)).not.toBeInTheDocument();
  });

  it('leaves the locked-shell exit in place for a real mounted section', async () => {
    window.history.replaceState({}, '', '/school/typing');
    render(<SchoolApp mode="locked" />);

    await waitFor(() => expect(screen.getByTestId('selfservice-section-exit')).toBeInTheDocument());
  });
});
