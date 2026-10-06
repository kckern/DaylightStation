import { describe, it, expect } from 'vitest';
import { tileMeta } from './HomeView.jsx';

describe('tileMeta', () => {
  it('a favourite names its next part', () => {
    expect(tileMeta('favourites', { continue: { contentId: 'plex:2', title: 'Keepy Uppy' } }, null, () => null)).toBe('Next: Keepy Uppy');
    expect(tileMeta('favourites', {}, null, () => null)).toBeNull();
  });
  it('differing spots give one line per spot, never "Stopped in N places"', () => {
    const entry = { spots: [
      { deviceId: 'a', playhead: 720, at: '2026-10-01T10:00:00Z' },
      { deviceId: 'b', playhead: 4800, at: '2026-10-02T10:00:00Z' },
    ] };
    const out = tileMeta('carry-on', { reason: 'in-progress' }, entry, (id) => `Screen ${id}`);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(2);
    expect(out.join(' ')).not.toMatch(/Stopped in/);
  });
});
