// backend/tests/unit/domains/ambient/normalizeWindows.test.mjs
import { normalizeWindows } from '#domains/ambient/normalizeWindows.mjs';

describe('normalizeWindows', () => {
  it('normalizes a valid window with default device', () => {
    const { windows, warnings } = normalizeWindows(
      [{ name: 'am', days: ['mon', 'fri'], start: '07:00', end: '09:00', preset: 'impressionism' }],
      { defaultDevice: 'livingroom-tv' },
    );
    expect(warnings).toEqual([]);
    expect(windows).toEqual([{
      key: 'am', name: 'am', days: [1, 5], startMin: 420, endMin: 540,
      preset: 'impressionism', device: 'livingroom-tv',
    }]);
  });

  it('derives a stable key from device|start|end|preset when unnamed', () => {
    const { windows } = normalizeWindows(
      [{ days: ['sun'], start: '08:00', end: '11:00', preset: 'religious' }],
      { defaultDevice: 'livingroom-tv' },
    );
    expect(windows[0].key).toBe('livingroom-tv|08:00|11:00|religious');
    expect(windows[0].name).toBeNull();
  });

  it('honors a per-window device override', () => {
    const { windows } = normalizeWindows(
      [{ days: ['mon'], start: '07:00', end: '08:00', preset: 'x', device: 'office-tv' }],
      { defaultDevice: 'livingroom-tv' },
    );
    expect(windows[0].device).toBe('office-tv');
  });

  it('collects warnings and drops malformed windows', () => {
    const { windows, warnings } = normalizeWindows([
      { days: ['mon'], start: 'bad', end: '09:00', preset: 'x' },        // bad start
      { days: [], start: '07:00', end: '09:00', preset: 'x' },           // no days
      { days: ['mon'], start: '07:00', end: '09:00' },                   // no preset
      { days: ['mon'], start: '09:00', end: '07:00', preset: 'x' },      // end <= start
    ], { defaultDevice: 'd' });
    expect(windows).toEqual([]);
    expect(warnings).toHaveLength(4);
    expect(warnings.map((w) => w.reason)).toEqual([
      'invalid-window', 'invalid-window', 'invalid-window', 'end-not-after-start',
    ]);
  });

  it('returns empty for a missing/non-array schedule', () => {
    expect(normalizeWindows(undefined, {})).toEqual({ windows: [], warnings: [] });
  });
});
