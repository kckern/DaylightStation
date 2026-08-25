import { describe, expect, it } from 'vitest';
import { resolveScripturePlaylist } from './resolveScripturePlaylist.mjs';

describe('resolveScripturePlaylist', () => {
  it('preserves daily chapter order in a generic playlist', () => {
    const playlist = resolveScripturePlaylist('Psalms 70–72; 77');
    expect(playlist.parts.map((part) => part.title)).toEqual(['Psalms 70', 'Psalms 71', 'Psalms 72', 'Psalms 77']);
    expect(playlist.parts.every((part) => part.contentId.startsWith('readalong:scripture/ot/nirv/'))).toBe(true);
  });

  it('normalizes a partial reference to its chapter audio unit', () => {
    const playlist = resolveScripturePlaylist('Malachi 3:11–18');
    expect(playlist.parts).toHaveLength(1);
    expect(playlist.parts[0].title).toBe('Malachi 3');
    expect(playlist.parts[0].contentId).toBe('readalong:scripture/ot/nirv/23122');
  });
});
