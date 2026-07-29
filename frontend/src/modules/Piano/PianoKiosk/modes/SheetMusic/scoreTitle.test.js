import { describe, it, expect } from 'vitest';
import { prettyTitle, titleFromScoreId } from './scoreTitle.js';

describe('scoreTitle', () => {
  it('prettifies filename-derived titles', () => {
    expect(prettyTitle('fur-elise-super_easy.mxl')).toBe('Fur Elise Super Easy');
    expect(prettyTitle('')).toBe('Score');
  });
  it('derives a title from a full content id', () => {
    expect(titleFromScoreId('files:docs/sheet-music/video-games/super-mario-theme.mxl')).toBe('Super Mario Theme');
    expect(titleFromScoreId('')).toBe('Score');
  });
});
