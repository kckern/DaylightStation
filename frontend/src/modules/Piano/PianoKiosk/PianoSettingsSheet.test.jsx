import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const turnOffScreen = vi.fn();

vi.mock('./PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ connected: false, inputName: null, status: 'no-input', connect: vi.fn() }),
}));
vi.mock('./PianoSoundContext.jsx', () => ({
  usePianoSound: () => ({
    sources: [], activeId: null, active: null, select: vi.fn(),
    gainDb: 0, reverbMix: 0, setGain: vi.fn(), setReverb: vi.fn(),
    hasInstruments: false, bridgeLink: null, device: null,
  }),
}));
vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({ config: { bluetooth: null }, pianoId: 'default' }),
}));
vi.mock('./useScreenControl.js', () => ({ useScreenControl: () => ({ turnOffScreen }) }));
vi.mock('../../../lib/fkb.js', () => ({ launchAndroidTarget: vi.fn() }));
vi.mock('./PianoMidiMonitor.jsx', () => ({ default: () => null }));
vi.mock('./PianoKeyboardPanel.jsx', () => ({ default: () => null }));
vi.mock('@/modules/Feedback/FeedbackOverlay.jsx', () => ({ default: () => null }));
vi.mock('./icons/Icon.jsx', () => ({ default: () => null }));

import PianoSettingsSheet from './PianoSettingsSheet.jsx';

function openMidiTab() {
  render(<PianoSettingsSheet open onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: 'MIDI' }));
}

beforeEach(() => { turnOffScreen.mockReset(); vi.useFakeTimers(); });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe('PianoSettingsSheet — screen-off action', () => {
  it('shows a turn-off-screen action under the MIDI tab', () => {
    openMidiTab();
    expect(screen.getByRole('button', { name: /Turn off screen/i })).toBeTruthy();
  });

  it('arms on first tap and fires on confirm (2-tap)', () => {
    openMidiTab();
    const btn = screen.getByRole('button', { name: /Turn off screen/i });
    fireEvent.click(btn);
    // Armed — label changes, not yet fired.
    expect(screen.getByRole('button', { name: /Tap again to confirm/i })).toBeTruthy();
    expect(turnOffScreen).not.toHaveBeenCalled();
    // Second tap fires and disarms.
    fireEvent.click(screen.getByRole('button', { name: /Tap again to confirm/i }));
    expect(turnOffScreen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Turn off screen/i })).toBeTruthy();
  });

  it('disarms after 3s without a confirming tap', () => {
    openMidiTab();
    fireEvent.click(screen.getByRole('button', { name: /Turn off screen/i }));
    expect(screen.getByRole('button', { name: /Tap again to confirm/i })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByRole('button', { name: /Turn off screen/i })).toBeTruthy();
    expect(turnOffScreen).not.toHaveBeenCalled();
  });
});
