import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// jsdom lacks ResizeObserver, which FitnessShow uses for poster/season-bar sizing.
beforeAll(() => {
  if (!global.ResizeObserver) {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

// ── mocks ────────────────────────────────────────────────────────────────
const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpy })
}));

// Mantine pulls in heavy styling/portals we don't need; stub the bits used.
vi.mock('@mantine/core', () => ({
  LoadingOverlay: () => null,
  Alert: ({ children }) => <div>{children}</div>
}));

// FitnessContext supplies governance/locks config. Tests swap `mockCtx`.
let mockCtx;
vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitness: () => mockCtx
}));

// Image/URL helpers — return the input so <img src> stays simple.
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(),
  DaylightMediaPath: (p) => p,
  ContentDisplayUrl: (id) => `display:${id}`,
  normalizeImageUrl: (u) => u || ''
}));

// Control the unlock surface from each test (via the identity provider).
const registerUnlock = vi.fn();
const clearUnlock = vi.fn();
let unlockState = 'idle';
vi.mock('@/modules/Fitness/identity/IdentityProvider', () => ({
  __esModule: true,
  useIdentity: () => ({ registerUnlock, clearUnlock, unlockState, unlockedUser: null, activeLock: null }),
}));

import { DaylightAPI } from '@/lib/api.mjs';
import FitnessShow from './FitnessShow.jsx';

// ── fixtures ──────────────────────────────────────────────────────────────
// A governed show: it carries a governed scope-label ("kidsfun") AND its type
// ("show") is in the governed_types scope, so isGovernedShow === true. (Type
// alone no longer governs — the label is the trigger; see governedContent.js.)
const GOVERNED_SHOW = {
  info: { type: 'show', title: 'Governed Show', labels: ['kidsfun'], image: 'poster.jpg' },
  items: [
    { plex: '101', id: 'plex:101', label: 'Ep 1', parentId: 'p1', itemIndex: 1, image: 'e1.jpg', duration: 600, isWatched: true }
  ],
  parents: { p1: { index: 1, title: 'Season 1' } }
};

// A sequential show: label "sequential" is in sequential_labels. Ep1 unwatched
// closes the gate so Ep2 is locked.
const SEQUENTIAL_SHOW = {
  info: { type: 'show', title: 'Sequential Show', labels: ['sequential'], image: 'poster.jpg' },
  items: [
    { plex: '201', id: 'plex:201', label: 'Ep 1', parentId: 'p1', itemIndex: 1, image: 'e1.jpg', duration: 600, isWatched: false },
    { plex: '202', id: 'plex:202', label: 'Ep 2', parentId: 'p1', itemIndex: 2, image: 'e2.jpg', duration: 600, isWatched: false }
  ],
  parents: { p1: { index: 1, title: 'Season 1' } }
};

// Stable no-op context functions + stable array refs the component reads.
// (FitnessShow recomputes its fetch callback when nomusicLabels/plexConfig change
// identity; stable refs avoid a re-fetch loop in the test environment.)
const STABLE_NOMUSIC = [];
const CTX_FNS = {
  setMusicAutoEnabled: vi.fn(),
  setCurrentMedia: vi.fn(),
  nomusicLabels: STABLE_NOMUSIC
};

const GOVERNANCE_CTX = (locks = {}) => ({
  ...CTX_FNS,
  fitnessConfiguration: { locks },
  governedLabels: ['kidsfun'],   // the trigger
  governedTypes: ['show'],       // the scope
  plexConfig: {}
});

const SEQUENTIAL_CTX = (locks = {}) => ({
  ...CTX_FNS,
  fitnessConfiguration: { locks },
  governedTypes: [],
  plexConfig: { sequential_labels: ['sequential'] }
});

let setFitnessPlayQueue;
let onPlay;

async function renderShow(response, ctx) {
  mockCtx = ctx;
  DaylightAPI.mockResolvedValue(response);
  const utils = render(
    <FitnessShow
      showId="plex:9000"
      setFitnessPlayQueue={setFitnessPlayQueue}
      onPlay={onPlay}
      onBack={() => {}}
    />
  );
  // Wait for the async show fetch to settle and the title to render.
  await screen.findByText(response.info.title, {}, { timeout: 4000 });
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  unlockState = 'idle';
  setFitnessPlayQueue = vi.fn();
  onPlay = vi.fn();
  registerUnlock.mockResolvedValue({ matched: false, reason: 'denied' });
});

describe('FitnessShow — governed-show unlock affordance', () => {
  it('renders an Unlock button and opens the prompt (no bypass yet) when governance_bypass is configured', async () => {
    await renderShow(GOVERNED_SHOW, GOVERNANCE_CTX({ governance_bypass: ['test-user'] }));

    const unlockBtn = screen.getByLabelText('Unlock governed content');
    expect(unlockBtn).toBeTruthy();

    await act(async () => { fireEvent.pointerDown(unlockBtn); });

    expect(registerUnlock).toHaveBeenCalledWith('governance_bypass');
    expect(screen.getByRole('dialog', { name: /fingerprint unlock/i })).toBeTruthy();
    // Denied (default mock) → bypass NOT applied: still shows the locked button, no unlocked glyph.
    await waitFor(() => expect(screen.getByLabelText('Unlock governed content')).toBeTruthy());
    expect(screen.queryByLabelText('Governance unlocked')).toBeNull();
  });

  it('applies the governance bypass when the fingerprint matches', async () => {
    registerUnlock.mockResolvedValue({ matched: true, userId: 'test-user' });
    await renderShow(GOVERNED_SHOW, GOVERNANCE_CTX({ governance_bypass: ['test-user'] }));

    const unlockBtn = screen.getByLabelText('Unlock governed content');
    await act(async () => { fireEvent.pointerDown(unlockBtn); });

    // After a matched bypass, the affordance flips to the unlocked glyph and the
    // prompt closes (clearUnlock called). The bypass flag is now seamed into the
    // queue item (nogovern) for the next play.
    await waitFor(() => expect(screen.getByLabelText('Governance unlocked')).toBeTruthy());
    expect(clearUnlock).toHaveBeenCalled();
  });

  it('resets the bypass when navigating to a different show (no cross-show leak)', async () => {
    registerUnlock.mockResolvedValue({ matched: true, userId: 'test-user' });
    const utils = await renderShow(GOVERNED_SHOW, GOVERNANCE_CTX({ governance_bypass: ['test-user'] }));

    // Grant the bypass on show A → unlocked glyph appears.
    await act(async () => { fireEvent.pointerDown(screen.getByLabelText('Unlock governed content')); });
    await waitFor(() => expect(screen.getByLabelText('Governance unlocked')).toBeTruthy());

    // Navigate to a DIFFERENT governed show on the same (keyless) instance.
    const SHOW_B = { ...GOVERNED_SHOW, info: { ...GOVERNED_SHOW.info, title: 'Other Governed Show' } };
    DaylightAPI.mockResolvedValue(SHOW_B);
    await act(async () => {
      utils.rerender(
        <FitnessShow showId="plex:9001" setFitnessPlayQueue={setFitnessPlayQueue} onPlay={onPlay} onBack={() => {}} />
      );
    });
    await screen.findByText('Other Governed Show', {}, { timeout: 4000 });

    // Bypass must NOT leak: the unlocked glyph is gone; the locked affordance is back.
    expect(screen.queryByLabelText('Governance unlocked')).toBeNull();
    expect(screen.getByLabelText('Unlock governed content')).toBeTruthy();
  });

  it('keeps a purely-informational lock (no button) when governance_bypass is absent', async () => {
    await renderShow(GOVERNED_SHOW, GOVERNANCE_CTX({}));

    expect(screen.queryByLabelText('Unlock governed content')).toBeNull();
    // The informational lock icon is still present.
    expect(screen.getByLabelText('Governed content')).toBeTruthy();
    expect(registerUnlock).not.toHaveBeenCalled();
  });
});

describe('FitnessShow — sequential locked-episode unlock affordance', () => {
  it('exposes an unlock affordance on a locked episode and plays it on a match when skip_content is configured', async () => {
    registerUnlock.mockResolvedValue({ matched: true, userId: 'test-user' });
    await renderShow(SEQUENTIAL_SHOW, SEQUENTIAL_CTX({ skip_content: ['test-user'] }));

    // The locked episode (Ep 2) exposes an "Unlock episode" control.
    const unlockBtns = screen.getAllByLabelText('Unlock episode');
    expect(unlockBtns.length).toBeGreaterThan(0);

    await act(async () => { fireEvent.pointerDown(unlockBtns[0]); });

    expect(registerUnlock).toHaveBeenCalledWith('skip_content');
    // Matched → the normal play path runs for that episode (queue gets the item).
    await waitFor(() => expect(setFitnessPlayQueue).toHaveBeenCalled());
    const queued = setFitnessPlayQueue.mock.calls[0][0];
    expect(Array.isArray(queued)).toBe(true);
    expect(queued[0].plex).toBe('202');
  });

  it('opens the unlock prompt when the locked episode body (thumbnail) is tapped, not just the lock icon', async () => {
    registerUnlock.mockResolvedValue({ matched: true, userId: 'test-user' });
    const { container } = await renderShow(SEQUENTIAL_SHOW, SEQUENTIAL_CTX({ skip_content: ['test-user'] }));

    // Tap the locked episode's thumbnail (Ep 2 = plex 202) — the whole grayed-out
    // card is the unlock affordance now, not only the small lock glyph.
    const lockedThumb = container.querySelector('[data-plex-id="202"]');
    expect(lockedThumb).toBeTruthy();
    await act(async () => { fireEvent.pointerDown(lockedThumb); });

    expect(registerUnlock).toHaveBeenCalledWith('skip_content');
    // Matched → that episode plays via the normal launch path.
    await waitFor(() => expect(setFitnessPlayQueue).toHaveBeenCalled());
    expect(setFitnessPlayQueue.mock.calls[0][0][0].plex).toBe('202');
  });

  it('keeps the locked episode inert (no affordance, tapping does nothing) when skip_content is absent', async () => {
    const { container } = await renderShow(SEQUENTIAL_SHOW, SEQUENTIAL_CTX({}));

    expect(screen.queryByLabelText('Unlock episode')).toBeNull();

    // Tapping the locked episode body must do nothing without an authorized lock.
    const lockedThumb = container.querySelector('[data-plex-id="202"]');
    expect(lockedThumb).toBeTruthy();
    await act(async () => { fireEvent.pointerDown(lockedThumb); });

    expect(registerUnlock).not.toHaveBeenCalled();
    expect(setFitnessPlayQueue).not.toHaveBeenCalled();
  });
});
