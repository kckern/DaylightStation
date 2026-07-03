import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PianoScreenControlProvider,
  useScreenOffCooldown,
  usePianoScreensaver,
} from './usePianoScreensaver.jsx';

// setScreen calls DaylightAPI(`api/v1/device/:id/screen/{on,off}`); capture it.
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({ ok: true }) }));
import { DaylightAPI } from '../../../lib/api.mjs';

function Harness({ notes }) {
  const begin = useScreenOffCooldown();
  usePianoScreensaver({
    deviceId: 'dev1', activeNotes: notes, noteHistory: [],
    timeoutMinutes: 3, offCooldownMinutes: 30,
  });
  return <button onClick={begin}>off</button>;
}

const wakeCalls = () =>
  DaylightAPI.mock.calls.map(([p]) => p).filter((p) => p.endsWith('/screen/on'));

describe('usePianoScreensaver MIDI-wake suppression', () => {
  beforeEach(() => { vi.useFakeTimers(); DaylightAPI.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('mutes MIDI wake after screen-off, then re-arms once idle past the cooldown', () => {
    const wrap = (notes) => (
      <PianoScreenControlProvider><Harness notes={notes} /></PianoScreenControlProvider>
    );
    const { getByText, rerender } = render(wrap(new Map()));

    act(() => { getByText('off').click(); }); // arm cooldown (screen now believed off)
    DaylightAPI.mockClear();

    // While suppressed, a fresh MIDI note (new activeNotes identity) must NOT wake.
    rerender(wrap(new Map([[60, {}]])));
    expect(wakeCalls()).toHaveLength(0);

    // After 30+ min of no input, the poll clears suppression; the next note wakes.
    act(() => { vi.advanceTimersByTime(31 * 60_000); });
    rerender(wrap(new Map([[62, {}]])));
    expect(wakeCalls().length).toBeGreaterThan(0);
  });
});
