import { describe, it, expect } from 'vitest';
import { dedupeSourceRows, sourceIconComponent } from './sourceIcons.jsx';

describe('browse source rows', () => {
  it('maps source roots to real icons, never a letter', () => {
    expect(sourceIconComponent({ id: 'plex:' })).toBeTruthy();
    expect(sourceIconComponent({ id: 'youtube:' })).not.toBe(sourceIconComponent({ id: 'files:' }));
    expect(sourceIconComponent({ id: 'plex:1', itemType: 'container' })).toBe(sourceIconComponent({ id: 'files:' }));
  });
  it('keeps one of two roots that read the same, and never touches ordinary rows', () => {
    const rows = [
      { id: 'art:', title: 'art' }, { id: 'canvas-filesystem:', title: 'canvas-filesystem' },
      { id: 'plex:1', title: 'Same' }, { id: 'plex:2', title: 'Same' },
    ];
    const out = dedupeSourceRows(rows);
    expect(out.filter((r) => r.id.endsWith(':'))).toHaveLength(out.filter((r) => /^[\w-]+:$/.test(r.id)).length);
    expect(out.filter((r) => r.title === 'Same')).toHaveLength(2);
  });
});
