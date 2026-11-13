// PianoVideoPlayer.ladder.test.jsx — the presence ladder's config reaches the
// gate: household tunables, preschool exemption, and guests stay on the note.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ activeNotes: new Map(), subscribe: () => () => {} }),
  usePianoMidiNotes: () => ({ activeNotes: new Map() }),
}));
vi.mock('../../usePianoPlayback.js', () => ({ usePianoPlayback: () => ({ setPlaying: vi.fn(), setVideoActive: vi.fn() }) }));
vi.mock('../../usePianoMix.js', () => ({ usePianoMix: () => ({ mediaLevel: 1, setMediaLevel: vi.fn() }) }));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));
const user = vi.hoisted(() => ({ currentUser: 'learner_1' }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => user }));
vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../../../../../__capabilities/playback/browser/player/Player.jsx', async () => {
  const { forwardRef } = await import('react');
  return { default: forwardRef(() => <div data-testid="player-stub" />) };
});
const gateArgs = vi.hoisted(() => ({ last: null }));
vi.mock('./useEngagementGate.js', () => ({
  useEngagementGate: (args) => { gateArgs.last = args; return { gateOpen: false, step: { kind: 'note', rung: 0 }, dismissGate: () => {} }; },
}));

import PianoVideoPlayer from './PianoVideoPlayer.jsx';

const lecture = (preschool = false) => ({ plex: '9', label: 'Lesson', expectation: { enforced: true, preschool } });
const show = (props = {}) => render(<PianoVideoPlayer lecture={lecture(props.preschool)} source="Course" onBack={vi.fn()} isSequential {...props} />);

beforeEach(() => { gateArgs.last = null; user.currentUser = 'learner_1'; });

describe('PianoVideoPlayer — presence ladder config', () => {
  it('the household block reaches the gate, capped at the idle timeout', async () => {
    show({ engagementTimeoutSeconds: 80, presenceLadder: { intervals_seconds: [90, 70, 50], practice_npm: 5 } });
    await screen.findByTestId('player-stub');
    expect(gateArgs.last.ladder).toMatchObject({ topRung: 4, practiceNpm: 5, intervalsSeconds: [80, 70, 50] });
    expect(gateArgs.last).not.toHaveProperty('timeoutSeconds');
  });

  it('a missing block gives the defaults', async () => {
    show();
    await screen.findByTestId('player-stub');
    expect(gateArgs.last.ladder).toMatchObject({ topRung: 4, intervalsSeconds: [90, 90, 75, 60], keepaliveDeadline: true });
  });

  it('a preschool course stays on the note', async () => {
    show({ preschool: true });
    await screen.findByTestId('player-stub');
    expect(gateArgs.last.ladder).toMatchObject({ topRung: 0, keepaliveDeadline: false });
  });

  it('a guest stays on the note (a scale check-in cannot complete without a saved profile)', async () => {
    user.currentUser = 'guest';
    show();
    await screen.findByTestId('player-stub');
    expect(gateArgs.last.ladder.topRung).toBe(0);
  });
});
