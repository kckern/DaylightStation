import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Keep the smoke test hermetic — config + modes fetch on mount.
vi.mock('../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({ takes: [], items: [], parsed: {} })),
}));
import { DaylightAPI } from '../lib/api.mjs';
import PianoApp from './PianoApp.jsx';

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/piano/*" element={<PianoApp />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  DaylightAPI.mockReset();
  DaylightAPI.mockResolvedValue({ takes: [], items: [], parsed: {} });
});

describe('PianoApp', () => {
  it('keeps the app visible when Web MIDI is unavailable', async () => {
    renderApp('/piano');
    expect(await screen.findByText('Courses')).toBeTruthy();
    expect(screen.queryByText(/Continue without piano/i)).toBeNull();
  });

  it('renders the mode menu immediately without a connection gate', async () => {
    renderApp('/piano');
    for (const label of ['Courses', 'Games', 'Exercises', 'Studio']) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
  });

  it('routes directly to a mode (Studio) and mounts it — no /default/ segment', async () => {
    renderApp('/piano/studio');
    // Routing lands on the Studio Play tab; assert its tab bar (a
    // Studio-specific control) to confirm the mode mounted. Not the Record
    // button itself: this smoke test never selects a roster player, so
    // currentUser stays null and Studio's guest gating (audit F1) hides
    // Record behind "Pick a player to record" — expected, not a regression.
    expect(await screen.findByText('Recordings')).toBeTruthy();
  });

  it('serves the only piano directly at /piano (no redirect into /piano/default)', async () => {
    renderApp('/piano');
    // Single (default) piano → served in place with its menu, no pianoId segment.
    expect(await screen.findByText('Courses')).toBeTruthy();
  });

  it('shows a picker when the household has multiple pianos', async () => {
    DaylightAPI.mockResolvedValue({
      parsed: { pianos: { 'living-room': { label: 'Living Room' }, studio: { label: 'Studio Upright' } } },
    });
    renderApp('/piano');
    await waitFor(() => expect(screen.getByText('Which piano?')).toBeTruthy());
    expect(screen.getByText('Living Room')).toBeTruthy();
    expect(screen.getByText('Studio Upright')).toBeTruthy();
  });
});
