import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  it('shows the connect gate when Web MIDI is unavailable', async () => {
    renderApp('/piano');
    expect(await screen.findByText(/does not support Web MIDI/i)).toBeTruthy();
  });

  it('reveals the mode menu after continuing without a piano', async () => {
    renderApp('/piano');
    fireEvent.click(await screen.findByText(/Continue without piano/i));
    for (const label of ['Courses', 'Games', 'Training', 'Studio']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('routes directly to a mode (Studio) and mounts it — no /default/ segment', async () => {
    renderApp('/piano/studio');
    fireEvent.click(await screen.findByText(/Continue without piano/i));
    // Routing lands on the Studio Play tab; assert its Record button (a
    // Studio-Play-specific control) to confirm the mode mounted.
    expect(await screen.findByRole('button', { name: /Start recording/i })).toBeTruthy();
  });

  it('serves the only piano directly at /piano (no redirect into /piano/default)', async () => {
    renderApp('/piano');
    // Single (default) piano → served in place → connect gate, no pianoId segment.
    expect(await screen.findByText(/Continue without piano/i)).toBeTruthy();
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
