import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// Hermetic: config + mode lists fetch on mount. A single-piano household has no
// `pianos` map, so derivePianos synthesizes one default piano.
vi.mock('../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({ takes: [], items: [], parsed: {} })),
}));
import { DaylightAPI } from '../lib/api.mjs';
import PianoApp from './PianoApp.jsx';

// Surfaces the current location so a test can assert the URL never grew a
// /piano/default/... segment for the single piano.
let lastPath = null;
function LocationProbe() {
  lastPath = useLocation().pathname;
  return null;
}

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/piano/*" element={<><PianoApp /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  lastPath = null;
  DaylightAPI.mockReset();
  // No `pianos` map → single synthesized default piano.
  DaylightAPI.mockResolvedValue({ takes: [], items: [], parsed: {} });
});

describe('PianoApp single-piano routing', () => {
  it('serves the Videos mode at /piano/videos without a /default/ segment', async () => {
    renderApp('/piano/videos');
    // Past the connect gate (no Web MIDI in jsdom) into the active piano.
    fireEvent.click(await screen.findByText(/Continue without piano/i));
    // Videos mode mounted (the chrome shows the active mode label "Courses").
    expect(screen.getByText('Courses')).toBeTruthy();
    // The single piano must NOT redirect to /piano/default/...
    expect(lastPath).toBe('/piano/videos');
    expect(lastPath).not.toContain('/default/');
  });

  it('serves the menu at /piano (no pianoId segment, no picker)', async () => {
    renderApp('/piano');
    fireEvent.click(await screen.findByText(/Continue without piano/i));
    // Mode menu, not the "Which piano?" chooser.
    expect(screen.getByText('Courses')).toBeTruthy();
    expect(screen.queryByText('Which piano?')).toBeNull();
    expect(lastPath).toBe('/piano');
  });

  it('home button (single piano) navigates to /piano, not /piano/default', async () => {
    renderApp('/piano/videos');
    fireEvent.click(await screen.findByText(/Continue without piano/i));
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(lastPath).toBe('/piano');
  });

  it('does not render a "Switch piano" button for a single piano', async () => {
    renderApp('/piano');
    fireEvent.click(await screen.findByText(/Continue without piano/i));
    expect(screen.queryByTitle('Switch piano')).toBeNull();
  });
});

describe('PianoApp multi-piano routing (unchanged)', () => {
  it('shows the picker at /piano and routes to /piano/:pianoId', async () => {
    DaylightAPI.mockResolvedValue({
      parsed: { pianos: { 'living-room': { label: 'Living Room' }, studio: { label: 'Studio Upright' } } },
    });
    renderApp('/piano');
    expect(await screen.findByText('Which piano?')).toBeTruthy();
    fireEvent.click(screen.getByText('Living Room'));
    expect(lastPath).toBe('/piano/living-room');
  });
});
