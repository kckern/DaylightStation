import { describe, it, expect } from 'vitest';
import { groupScenes } from './sceneGroups.mjs';

const v = (id, a, b, cat = 'sex_any/sexual_activity') => ({ id, type: 'skip', category: cat, in: a, out: b });

describe('groupScenes', () => {
  it('joins visual tags less than the gap apart and keeps runs that are long or busy', () => {
    const cues = [v('a', 100, 104), v('b', 110, 112), v('c', 125, 130), v('d', 400, 401), { id: 'w', type: 'mute', in: 105, out: 105 }];
    const g = groupScenes(cues);
    expect(g).toEqual([{ in: 100, out: 130, cues: ['a', 'b', 'c'], categories: ['sex_any/sexual_activity'] }]);
  });
  it('keeps a single long tag', () => {
    expect(groupScenes([v('x', 10, 40)])).toHaveLength(1);
  });
  it('drops short isolated tags', () => {
    expect(groupScenes([v('x', 10, 12), v('y', 100, 103)])).toEqual([]);
  });
  it('ignores credits', () => {
    expect(groupScenes([v('x', 10, 400, 'credits/closing_credits')])).toEqual([]);
  });
});
