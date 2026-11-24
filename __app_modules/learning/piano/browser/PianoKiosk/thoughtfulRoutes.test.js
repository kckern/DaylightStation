import { describe, it, expect } from 'vitest';
import { isThoughtfulRoute } from './thoughtfulRoutes.js';

describe('isThoughtfulRoute', () => {
  it('holds a score, a game, a drill and the composer under either base path', () => {
    for (const base of ['/piano', '/piano/office']) {
      expect(isThoughtfulRoute(`${base}/sheetmusic/view/files:a.mxl`, base)).toBe(true);
      expect(isThoughtfulRoute(`${base}/games/chess`, base)).toBe(true);
      expect(isThoughtfulRoute(`${base}/exercises`, base)).toBe(true);
      expect(isThoughtfulRoute(`${base}/composer/new`, base)).toBe(true);
    }
  });
  it('lets passive and free-play routes return on idle', () => {
    expect(isThoughtfulRoute('/piano', '/piano')).toBe(false);
    expect(isThoughtfulRoute('/piano/videos/1', '/piano')).toBe(false);
    expect(isThoughtfulRoute('/piano/studio', '/piano')).toBe(false);
    expect(isThoughtfulRoute('/piano/gamesx', '/piano')).toBe(false);
    expect(isThoughtfulRoute(null, '/piano')).toBe(false);
  });
});
