import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Keep the games-config fetch hermetic (no real network).
vi.mock('../../../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({ parsed: { games: {} } })),
}));

import { PianoMidiProvider } from '../../PianoMidiContext.jsx';
import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { Games } from './Games.jsx';

const testConfig = {
  voices: [], videos: { plexCollection: null }, games: {},
  midi: { preferredInputName: null }, inactivityMinutes: 10, label: 'Test',
};

function renderGames() {
  return render(
    <MemoryRouter>
      <ActivePianoProvider pianoId="test" config={testConfig}>
        <PianoMidiProvider>
          <Games />
        </PianoMidiProvider>
      </ActivePianoProvider>
    </MemoryRouter>
  );
}

describe('Games mode', () => {
  it('renders a picker tile per registered game with friendly labels', () => {
    renderGames();
    for (const label of ['Space Invaders', 'Tetris', 'Flashcards', 'Note Hero', 'Side Scroller']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});
