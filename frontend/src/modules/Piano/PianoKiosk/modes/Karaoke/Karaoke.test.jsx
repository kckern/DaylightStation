// Karaoke.test.jsx — speaker gate coverage (Task 5). Karaoke is reused by
// Singalong and Playalong (different showId/startFresh props), so these two
// component paths cover all three modes:
//   - KaraokePlayerRoute must exit (navigate back) the instant the BT speaker
//     link drops, same as Videos' LecturePlayerRoute (Videos.policy.test.jsx).
//   - KaraokeBrowser must make song cards non-clickable while disconnected.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { KaraokePlayerRoute, KaraokeBrowser } from './Karaoke.jsx';

const state = { speakerConnected: true };
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => ({ speakerConnected: state.speakerConnected }) }));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));

// SingalongPlayer pulls in the real Player + a long hook chain (watch-log,
// key control, screensaver, session binding...) — stub it so this file tests
// only the speaker-gate wiring, not the player internals.
vi.mock('../Singalong/SingalongPlayer.jsx', () => ({
  default: ({ lecture }) => <div data-testid="singalong-player">{lecture.label}</div>,
}));

beforeEach(() => { state.speakerConnected = true; });

describe('KaraokePlayerRoute — speaker gate', () => {
  const playable = { items: [{ plex: '100', title: 'My Way (Sinatra)', label: 'My Way' }] };

  const renderAt = (path, startFresh = true) => render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/karaoke" element={<div data-testid="karaoke-browse" />} />
        <Route
          path="/karaoke/:songId"
          element={<KaraokePlayerRoute playable={playable} startFresh={startFresh} />}
        />
      </Routes>
    </MemoryRouter>,
  );

  it('plays normally when the speaker is connected', () => {
    renderAt('/karaoke/plex:100');
    expect(screen.getByTestId('singalong-player')).toBeTruthy();
    expect(screen.queryByTestId('karaoke-browse')).toBeNull();
  });

  it('navigates back immediately when speakerConnected is false', () => {
    state.speakerConnected = false;
    renderAt('/karaoke/plex:100');
    expect(screen.getByTestId('karaoke-browse')).toBeTruthy();
    expect(screen.queryByTestId('singalong-player')).toBeNull();
  });
});

describe('KaraokeBrowser — speaker gate', () => {
  const playable = {
    items: [{ id: 's1', title: 'My Way (Sinatra)' }],
    parents: {},
  };

  it('song cards are clickable and select normally when the speaker is connected', () => {
    const onSelect = vi.fn();
    render(<KaraokeBrowser playable={playable} onSelect={onSelect} speakerDisabled={false} />);
    fireEvent.click(screen.getByText('My Way').closest('button'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('disables song card clicks and dims the grid when speakerDisabled is true', () => {
    const onSelect = vi.fn();
    render(<KaraokeBrowser playable={playable} onSelect={onSelect} speakerDisabled />);
    const section = document.querySelector('.piano-karaoke');
    expect(section.className).toContain('piano-karaoke--speaker-disabled');
    const card = screen.getByText('My Way').closest('button');
    fireEvent.click(card);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
