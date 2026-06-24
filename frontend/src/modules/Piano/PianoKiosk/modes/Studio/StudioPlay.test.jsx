import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mocks -----------------------------------------------------------------
const activeNotes = new Map();
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ activeNotes, noteHistory: [], pressNote: vi.fn(), releaseNote: vi.fn() }),
}));

let mockConfig = {};
vi.mock('../../PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({ config: mockConfig }),
}));

let prefsState = { loaded: true, prefs: {} };
const setPref = vi.fn((key, value) => { prefsState.prefs = { ...prefsState.prefs, [key]: value }; });
vi.mock('../../usePianoPreferences.js', () => ({
  usePianoPreferences: () => ({
    loaded: prefsState.loaded,
    prefs: prefsState.prefs,
    getPref: (k, d) => (k in prefsState.prefs ? prefsState.prefs[k] : d),
    setPref,
  }),
}));

// Heavy presentational children are irrelevant to the layout logic; stub them.
vi.mock('../../../components/NoteWaterfall.jsx', () => ({ NoteWaterfall: () => <div data-testid="waterfall" /> }));
vi.mock('../../../components/PianoKeyboard.jsx', () => ({ PianoKeyboard: () => <div data-testid="keys" /> }));
vi.mock('../../icons/Icon.jsx', () => ({ default: () => <span /> }));

import StudioPlay from './StudioPlay.jsx';

beforeEach(() => {
  mockConfig = {};
  prefsState = { loaded: true, prefs: {} };
  setPref.mockClear();
});

const props = { recording: false, elapsedMs: 0, onRecordToggle: vi.fn() };

describe('StudioPlay top-pane layout', () => {
  it('defaults to staff-only (no triptych) when no pref/config', () => {
    const { container } = render(<StudioPlay {...props} />);
    expect(container.querySelector('.piano-triptych')).toBeNull();
    expect(container.querySelector('.current-chord-staff-wrapper')).toBeTruthy();
    const toggle = container.querySelector('.piano-studio-play__layout-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent).toBe('Theory');
  });

  it('honours the piano.yml household default (studio.topPaneLayout: triptych)', () => {
    mockConfig = { studio: { topPaneLayout: 'triptych' } };
    const { container } = render(<StudioPlay {...props} />);
    expect(container.querySelector('.piano-triptych')).toBeTruthy();
  });

  it('user pref overrides the config default', () => {
    mockConfig = { studio: { topPaneLayout: 'triptych' } };
    prefsState.prefs = { topPaneLayout: 'staff' };
    const { container } = render(<StudioPlay {...props} />);
    expect(container.querySelector('.piano-triptych')).toBeNull();
  });

  it('tapping the toggle persists the opposite layout', () => {
    const { container } = render(<StudioPlay {...props} />);
    fireEvent.click(container.querySelector('.piano-studio-play__layout-toggle'));
    expect(setPref).toHaveBeenCalledWith('topPaneLayout', 'triptych');
  });

  it('renders the triptych when the pref is triptych', () => {
    prefsState.prefs = { topPaneLayout: 'triptych' };
    const { container } = render(<StudioPlay {...props} />);
    expect(container.querySelector('.piano-triptych')).toBeTruthy();
    expect(container.querySelector('.piano-circle-of-fifths')).toBeTruthy();
    expect(container.querySelector('.piano-chord-name')).toBeTruthy();
    const toggle = container.querySelector('.piano-studio-play__layout-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toBe('Staff');
  });
});
