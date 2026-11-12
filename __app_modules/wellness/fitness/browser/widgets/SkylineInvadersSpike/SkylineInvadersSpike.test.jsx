import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';

const listeners = new Map();
vi.mock('../../context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({
    pressureMatState: {},
    subscribeToAppEvent: (type, cb) => { listeners.set(type, cb); return () => listeners.delete(type); },
  }),
}));
vi.mock('../../components/FitnessWebcam.jsx', () => ({ default: () => null }));

import SkylineInvadersSpike from './SkylineInvadersSpike.jsx';

describe('SkylineInvadersSpike script', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('starts on the framing step, ignores OS-bound digits and advances on another key', async () => {
    render(<SkylineInvadersSpike />);
    expect(screen.getByText('Framing check')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1000); });
    await act(async () => { fireEvent.keyDown(window, { key: '3', code: 'Digit3' }); });
    expect(screen.getByText('Framing check')).toBeTruthy();
    await act(async () => { fireEvent.keyDown(window, { key: ' ', code: 'Space' }); });
    expect(screen.getByText('Test 1 of 3: pose speed')).toBeTruthy();
  });

  it('runs a timed step through lead and measure, counts mat presses, and auto-advances', async () => {
    render(<SkylineInvadersSpike />);
    await act(async () => { vi.advanceTimersByTime(1000); });
    await act(async () => { fireEvent.keyDown(window, { key: 'a', code: 'KeyA' }); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    await act(async () => { fireEvent.keyDown(window, { key: 'a', code: 'KeyA' }); });
    expect(screen.getByText('Pose speed: full model')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(3500); });
    expect(screen.getByText('measuring')).toBeTruthy();
    await act(async () => {
      listeners.get('pressure-mat:step')({ source: 'mat-1', timestamp: Date.now(), payload: { id: 'mat-1', deviceTs: 1234, receivedAt: new Date().toISOString() } });
      vi.advanceTimersByTime(61000);
    });
    expect(screen.getByText('Pose speed: full model + game load')).toBeTruthy();
    // Escape restarts the running timed step.
    await act(async () => { vi.advanceTimersByTime(1000); fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' }); });
    expect(screen.getByText('Pose speed: full model + game load')).toBeTruthy();
    expect(screen.getByText('get ready')).toBeTruthy();
  });
});
