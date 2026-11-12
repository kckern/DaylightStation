// PianoVideoPlayer.classifier.test.jsx — one human-note classifier per lesson
// player: the presence gate and the practice tally read the same verdicts.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const counter = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../humanNoteClassifier.js', async (importOriginal) => {
  const m = await importOriginal();
  const counted = (...a) => { counter.n += 1; return m.createHumanNoteClassifier(...a); };
  return { ...m, createHumanNoteClassifier: counted, default: counted };
});
const midiState = { activeNotes: new Map(), pressNote: vi.fn(), releaseNote: vi.fn(), subscribe: () => () => {} };
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => midiState, usePianoMidiNotes: () => midiState }));
vi.mock('../../usePianoPlayback.js', () => ({
  usePianoPlayback: () => ({ setPlaying: vi.fn(), setVideoActive: vi.fn(), playing: false, videoActive: false }),
}));
vi.mock('../../usePianoMix.js', () => ({ usePianoMix: () => ({ mediaLevel: 1, setMediaLevel: vi.fn() }) }));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'user_1' }) }));
vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../../../../../__capabilities/playback/browser/player/Player.jsx', async () => {
  const { forwardRef } = await import('react');
  return { default: forwardRef(() => <div data-testid="player-stub" />) };
});

import PianoVideoPlayer from './PianoVideoPlayer.jsx';

describe('PianoVideoPlayer — note classification', () => {
  it('mounting a lesson creates exactly one classifier', async () => {
    counter.n = 0;
    render(<PianoVideoPlayer lecture={{ plex: '1', label: 'Lecture 1', expectation: { enforced: true, preschool: false } }} source="Course" onBack={vi.fn()} isSequential />);
    await screen.findByTestId('player-stub');
    expect(counter.n).toBe(1);
  });
});
