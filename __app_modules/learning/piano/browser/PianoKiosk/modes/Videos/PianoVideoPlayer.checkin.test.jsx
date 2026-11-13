// PianoVideoPlayer.checkin.test.jsx — the scale check-in asks for the lesson's
// key when its title names one, else the configured drill roots, rotating by
// the ladder's scaleIndex.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const midiState = { activeNotes: new Map(), pressNote: vi.fn(), releaseNote: vi.fn() };
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => midiState,
  usePianoMidiNotes: () => midiState,
}));
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
const gateState = vi.hoisted(() => ({ step: { kind: 'scales', rung: 1, count: 1, hands: ['R'], scaleIndex: 2 } }));
vi.mock('./useEngagementGate.js', () => ({
  useEngagementGate: () => ({ gateOpen: true, step: gateState.step, dismissGate: () => {} }),
}));
const gateProps = vi.hoisted(() => ({ last: null }));
vi.mock('./EngagementGate.jsx', () => ({
  default: (props) => { gateProps.last = props; return <div data-testid="gate-stub" />; },
}));

import PianoVideoPlayer from './PianoVideoPlayer.jsx';

beforeEach(() => { gateProps.last = null; });

describe('PianoVideoPlayer — check-in scale roots', () => {
  it('a title naming a position asks for that key', async () => {
    render(<PianoVideoPlayer lecture={{ plex: '1', label: '05 Right Hand G Position', expectation: { enforced: true, preschool: false } }} source="Course" onBack={vi.fn()} isSequential />);
    await screen.findByTestId('gate-stub');
    expect(gateProps.last.roots).toEqual(['G']);
    expect(gateProps.last.rootsSource).toBe('title');
  });

  it('no key in the title: configured drill roots, rotated by scaleIndex', async () => {
    render(<PianoVideoPlayer lecture={{ plex: '2', label: 'Introduction', expectation: { enforced: true, preschool: false, drillRoots: ['D', 'A'] } }} source="Course" onBack={vi.fn()} isSequential />);
    await screen.findByTestId('gate-stub');
    expect(gateProps.last.roots).toEqual(['D', 'A']);
    expect(gateProps.last.rotation).toBe(2);
    expect(gateProps.last.rootsSource).toBe('config');
  });
});
