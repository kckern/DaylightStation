import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mocks -----------------------------------------------------------------
const activeNotes = new Map();
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ activeNotes, noteHistory: [], pressNote: vi.fn(), releaseNote: vi.fn() }),
}));

// Heavy presentational children are irrelevant here; stub the waterfall/keys/icon.
vi.mock('../../../components/NoteWaterfall.jsx', () => ({ NoteWaterfall: () => <div data-testid="waterfall" /> }));
vi.mock('../../../components/PianoKeyboard.jsx', () => ({ PianoKeyboard: () => <div data-testid="keys" /> }));
vi.mock('../../icons/Icon.jsx', () => ({ default: () => <span /> }));

import StudioPlay from './StudioPlay.jsx';

beforeEach(() => {});

const props = { recording: false, elapsedMs: 0, onRecordToggle: vi.fn() };

describe('StudioPlay top pane', () => {
  it('always renders the theory triptych (circle · staff · chord) — no layout toggle', () => {
    const { container } = render(<StudioPlay {...props} />);
    expect(container.querySelector('.piano-triptych')).toBeTruthy();
    expect(container.querySelector('.piano-circle-of-fifths')).toBeTruthy();
    expect(container.querySelector('.current-chord-staff-wrapper')).toBeTruthy();
    expect(container.querySelector('.piano-chord-name')).toBeTruthy();
    // The staff/theory toggle was removed — the triptych is the default.
    expect(container.querySelector('.piano-studio-play__layout-toggle')).toBeNull();
  });
});
