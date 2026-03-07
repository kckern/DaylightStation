// tests/unit/suite/fitness/fitnessQueueItem-source.test.mjs
import { describe, it, expect } from '@jest/globals';

/**
 * Reproduces the type resolution logic from FitnessPlayer.jsx line 846:
 *   type: currentItem.source || (currentItem.plex ? 'plex' : null) || currentItem.type || 'files'
 */
function resolvePlayLogType(item) {
  return item.source || (item.plex ? 'plex' : null) || item.type || 'files';
}

describe('play.log type resolution', () => {
  it('resolves to "plex" when source is set to "plex"', () => {
    const item = { source: 'plex', plex: '600174', type: 'episode' };
    expect(resolvePlayLogType(item)).toBe('plex');
  });

  it('resolves to "plex" via plex field fallback', () => {
    const item = { plex: '600174', type: 'episode' };
    expect(resolvePlayLogType(item)).toBe('plex');
  });

  it('falls through to "episode" when plex is null and no source', () => {
    const item = { plex: null, type: 'episode' };
    expect(resolvePlayLogType(item)).toBe('episode');
  });

  it('falls through to "files" when nothing is set', () => {
    const item = {};
    expect(resolvePlayLogType(item)).toBe('files');
  });
});
