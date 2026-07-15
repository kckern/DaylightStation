import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// --- mocks -----------------------------------------------------------------
// Ambient visualizer pulls its live surface + a stack of session/game hooks and
// heavy screen-framework deps. Stub them so we can assert the theory panel swap
// in isolation (no MIDI, no timers, no overlay context).
const activeNotes = new Map();
vi.mock('./useMidiSubscription', () => ({
  useMidiSubscription: () => ({ activeNotes, sustainPedal: false, sessionInfo: null, noteHistory: [] }),
}));
vi.mock('./usePianoConfig.js', () => ({ usePianoConfig: () => ({ gamesConfig: {} }) }));
vi.mock('./useGameActivation.js', () => ({
  useGameActivation: () => ({ activeGameId: null, deactivate: vi.fn() }),
}));
vi.mock('./useInactivityTimer.js', () => ({
  useInactivityTimer: () => ({ inactivityState: 'idle', countdownProgress: 0 }),
}));
vi.mock('./useSessionTracking.js', () => ({ useSessionTracking: () => ({ sessionDuration: 0 }) }));
vi.mock('./useSpamDetection.js', () => ({
  useSpamDetection: () => ({ spamState: 'normal', warningVisible: false, blackoutRemaining: 0, spamEventCount: 0 }),
}));
vi.mock('../../screen-framework/overlays/ScreenOverlayProvider.jsx', () => ({
  useScreenOverlay: () => ({ registerEscapeInterceptor: vi.fn(), unregisterEscapeInterceptor: vi.fn() }),
}));

// Heavy presentational children are irrelevant here; stub waterfall + keyboard.
// The keyboard mock records the props it received so we can assert it stays
// display-only (no onNoteOn/onNoteOff wiring).
let keyboardProps = null;
vi.mock('./components/NoteWaterfall', () => ({ NoteWaterfall: () => <div data-testid="waterfall" /> }));
vi.mock('./components/PianoKeyboard', () => ({
  PianoKeyboard: (props) => {
    keyboardProps = props;
    return <div data-testid="keys" />;
  },
}));

import { PianoVisualizer } from './PianoVisualizer.jsx';

describe('PianoVisualizer ambient view', () => {
  it('renders the full theory panel (circle · staff · chord) in the header', () => {
    const { container } = render(<PianoVisualizer />);
    const header = container.querySelector('.piano-header');
    expect(header).toBeTruthy();
    // Theory panel present: circle of fifths + staff + chord speller.
    expect(header.querySelector('.theory-panel--row')).toBeTruthy();
    expect(header.querySelector('.piano-circle-of-fifths')).toBeTruthy();
    expect(header.querySelector('.chord-staff')).toBeTruthy();
    expect(header.querySelector('.piano-chord-name')).toBeTruthy();
  });

  it('keeps the keyboard display-only (no touch input wiring)', () => {
    const { getByTestId } = render(<PianoVisualizer />);
    expect(getByTestId('keys')).toBeTruthy();
    expect(keyboardProps).toBeTruthy();
    expect(keyboardProps.onNoteOn).toBeUndefined();
    expect(keyboardProps.onNoteOff).toBeUndefined();
    expect(keyboardProps.showLabels).toBe(true);
  });
});
