import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The engraving itself is VexFlow's business; here we only count it and read what it
// was asked to draw.
const { renderChordStaff, sampled } = vi.hoisted(() => ({ renderChordStaff: vi.fn(), sampled: vi.fn() }));
vi.mock('../../../../../__capabilities/music-notation/browser/renderers/chordStaff.js', () => ({ renderChordStaff }));
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled };
  log.child = () => log;
  return { default: () => log, getLogger: () => log };
});

const { CurrentChordStaff } = await import('./CurrentChordStaff.jsx');

const surface = (...notes) => new Map(notes.map(([midi, timestamp]) => [midi, { timestamp }]));
const drawn = () => renderChordStaff.mock.calls.map(([, opts]) => opts.columns.map((c) => `${c.midis.join('.')}:${c.duration}`).join(' '));

describe('CurrentChordStaff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    renderChordStaff.mockClear();
    sampled.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('engraves once per onset, with the durations of that same flow (no lagging frame)', () => {
    const { rerender } = render(<CurrentChordStaff activeNotes={surface()} detectedKey="C" />);
    renderChordStaff.mockClear();

    act(() => { rerender(<CurrentChordStaff activeNotes={surface([60, 10_000])} detectedKey="C" />); });
    expect(drawn()).toEqual(['60:q']);

    act(() => { vi.setSystemTime(10_400); rerender(<CurrentChordStaff activeNotes={surface([62, 10_400])} detectedKey="C" />); });
    expect(drawn()).toEqual(['60:q', '60:q 62:q']);

    // E 160ms after D: D closes as an eighth against the 400ms baseline. Durations
    // computed a render late would first draw D with its old provisional quarter
    // ('60:q 62:q 64:q') and engrave a second time a moment later.
    act(() => { vi.setSystemTime(10_560); rerender(<CurrentChordStaff activeNotes={surface([64, 10_560])} detectedKey="C" />); });
    expect(drawn()).toEqual(['60:q', '60:q 62:q', '60:q 62:8 64:q']);
  });

  it('an idle tick re-renders nothing', () => {
    render(<CurrentChordStaff activeNotes={surface([60, 10_000])} detectedKey="C" />);
    const before = renderChordStaff.mock.calls.length;
    act(() => { vi.advanceTimersByTime(80 * 3); }); // well under the half-note promotion
    expect(renderChordStaff.mock.calls.length).toBe(before);
  });

  it('logs a legato split at debug once the tick settles it', () => {
    const { rerender } = render(<CurrentChordStaff activeNotes={surface()} detectedKey="C" />);
    act(() => { rerender(<CurrentChordStaff activeNotes={surface([60, 10_000])} detectedKey="C" />); });
    // D lands 100ms later while C is still down (joins C's column)...
    act(() => { vi.setSystemTime(10_100); rerender(<CurrentChordStaff activeNotes={surface([60, 10_000], [62, 10_100])} detectedKey="C" />); });
    // ...then C lets go and D stays down: a legato line, not a chord.
    act(() => { vi.setSystemTime(10_120); rerender(<CurrentChordStaff activeNotes={surface([62, 10_100])} detectedKey="C" />); });
    expect(drawn().at(-1)).toBe('60.62:q');
    act(() => { vi.advanceTimersByTime(80); });
    expect(drawn().at(-1)).toBe('60:8 62:q');
    const splits = sampled.mock.calls.filter(([event]) => event === 'chord-staff.legato-split');
    expect(splits).toHaveLength(1);
    expect(splits[0][1]).toMatchObject({ notes: [60], next: [62], stepMs: 100 });
    expect(splits[0][2]).toMatchObject({ level: 'debug', maxPerMinute: 20, aggregate: true });
  });

  it('logs column-closed at debug, not info', () => {
    const { rerender } = render(<CurrentChordStaff activeNotes={surface()} detectedKey="C" />);
    act(() => { rerender(<CurrentChordStaff activeNotes={surface([60, 10_000])} detectedKey="C" />); });
    act(() => { vi.setSystemTime(10_400); rerender(<CurrentChordStaff activeNotes={surface([64, 10_400])} detectedKey="C" />); });
    const closed = sampled.mock.calls.filter(([event]) => event === 'chord-staff.column-closed');
    expect(closed).toHaveLength(1);
    expect(closed[0][2]).toMatchObject({ level: 'debug' });
  });
});
