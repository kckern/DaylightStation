import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Keep the games-config fetch hermetic (no real network).
vi.mock('../../../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({ parsed: { games: {} } })),
}));

import { PianoMidiProvider } from '../../PianoMidiContext.jsx';
import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { Lessons } from './Lessons.jsx';

const testConfig = {
  voices: [], videos: { plexCollection: null }, games: {},
  midi: { preferredInputName: null }, inactivityMinutes: 10, label: 'Test',
};

function renderLessons() {
  return render(
    <MemoryRouter initialEntries={['/lessons']}>
      <ActivePianoProvider pianoId="test" config={testConfig}>
        <PianoMidiProvider>
          <Routes>
            <Route path="lessons/*" element={<Lessons />} />
          </Routes>
        </PianoMidiProvider>
      </ActivePianoProvider>
    </MemoryRouter>
  );
}

describe('Lessons mode', () => {
  it('hosts Note Hero fullscreen (not the old coming-soon placeholder)', () => {
    const { container } = renderLessons();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    // The hero game mounts lazily inside the fullscreen host (Suspense fallback in test).
    expect(container.querySelector('.piano-game-fullscreen')).toBeTruthy();
  });
});
