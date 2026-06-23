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
    renderApp('/piano/default');
    expect(await screen.findByText(/does not support Web MIDI/i)).toBeTruthy();
  });

  it('reveals the mode menu after continuing without a piano', async () => {
    renderApp('/piano/default');
    fireEvent.click(await screen.findByText(/Continue without piano/i));
    for (const label of ['Videos', 'Games', 'Lessons', 'Studio']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('routes directly to a mode (Studio) and mounts it', async () => {
    renderApp('/piano/default/studio');
    fireEvent.click(await screen.findByText(/Continue without piano/i));
    expect(screen.getByRole('heading', { name: 'Studio' })).toBeTruthy();
  });

  it('auto-enters the only piano from /piano', async () => {
    renderApp('/piano');
    // Single (default) piano → redirect into it → connect gate.
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
