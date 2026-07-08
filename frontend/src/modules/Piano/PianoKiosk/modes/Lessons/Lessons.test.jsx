import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const api = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

// Stub the notation renderer so a drill's ABC engraving doesn't pull abcjs here —
// we only assert the drill's content (title/metadata) reaches the view. Keep the
// real expander/sequence helpers (pure) so the drill computes its follow targets.
vi.mock('../../../../MusicNotation/index.js', async (orig) => {
  const actual = await orig();
  return { ...actual, AbcRenderer: () => <div data-testid="abc" />, generateMelodyAbc: () => 'X:1' };
});

// The drill view subscribes to MIDI and renders a keyboard; stub both so the
// test stays focused on routing + content (no Web MIDI in jsdom).
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ subscribe: () => () => {}, pressNote: () => {}, releaseNote: () => {} }),
  usePianoMidiNotes: () => ({ activeNotes: new Map(), noteHistory: [], sustainPedal: false, isPlaying: false }),
}));
vi.mock('../../../components/PianoKeyboard.jsx', () => ({ PianoKeyboard: () => <div data-testid="keyboard" /> }));

import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { __clearPianoListCache } from '../../usePianoList.js';
import { Lessons } from './Lessons.jsx';

// Lessons renders its own <Routes>, so mount it under a "lessons/*" route inside a
// MemoryRouter — mirroring how PianoShell mounts it. The drill id lives in the URL.
const renderLessons = (lessons, initialEntry = '/lessons') => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <ActivePianoProvider
      pianoId="test"
      config={{ videos: { plexCollection: null }, music: {}, lessons, voices: [], midi: {}, inactivityMinutes: 10 }}
    >
      <Routes>
        <Route path="lessons/*" element={<Lessons />} />
      </Routes>
    </ActivePianoProvider>
  </MemoryRouter>
);

const INDEX = {
  title: 'The Virtuoso Pianist',
  subtitle: 'Hanon',
  sections: [
    { label: 'Part I', items: [
      { number: 1, title: 'Exercise 1', id: 'ex-1' },
      { number: 2, title: 'Exercise 2', id: 'ex-2' },
    ] },
  ],
};

beforeEach(() => { api.mockReset(); __clearPianoListCache(); });

describe('Lessons mode (content-driven drills)', () => {
  it('lists drills from the configured collection index', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/piano/lessons/hannon') return Promise.resolve(INDEX);
      return Promise.resolve({});
    });

    renderLessons({ collection: 'hannon' });
    expect(await screen.findByText('The Virtuoso Pianist')).toBeTruthy();
    expect(screen.getByText('Part I')).toBeTruthy();
    expect(screen.getByText('Exercise 1')).toBeTruthy();
    expect(screen.getByText('Exercise 2')).toBeTruthy();
  });

  it('shows an empty-state when no collection is configured', async () => {
    renderLessons({ collection: null });
    expect(await screen.findByText('No lesson collection has been set up yet.')).toBeTruthy();
  });

  it('opens a drill, fetching its module from the collection', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/piano/lessons/hannon') return Promise.resolve(INDEX);
      if (path === 'api/v1/piano/lessons/hannon/ex-1') {
        return Promise.resolve({ title: 'Exercise 1', key: 'C', meter: '2/4' });
      }
      return Promise.resolve({});
    });

    renderLessons({ collection: 'hannon' });
    fireEvent.click(await screen.findByText('Exercise 1'));

    // Now on the drill view — it fetched the module and rendered its facts.
    expect(await screen.findByText('Meter')).toBeTruthy();
    expect(screen.getByText('2/4')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/piano/lessons/hannon/ex-1');
  });

  it('renders a drill directly from a deep-link', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/piano/lessons/hannon/ex-2') {
        return Promise.resolve({ title: 'Exercise 2', key: 'G' });
      }
      return Promise.resolve({});
    });

    renderLessons({ collection: 'hannon' }, '/lessons/ex-2');
    expect(await screen.findByText('Exercise 2')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/piano/lessons/hannon/ex-2');
  });
});
