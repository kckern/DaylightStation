import { describe, expect, it } from 'vitest';
import { DRILL_STEPS, drillSteps, matchBoard, tilesFor } from './drill.mjs';

describe('drill', () => {
  const ready = { ready: true };
  it('full path with mic and audio, for a word ready for sign-off', () => {
    expect(drillSteps({ audio: true }, { microphone: true }, ready)).toEqual(DRILL_STEPS);
  });
  it('no mic drops the speaking steps; no audio drops say-after and dictation', () => {
    expect(drillSteps({ audio: true }, { microphone: false }, ready)).toEqual(['look', 'copy', 'match', 'tiles', 'dictation', 'type']);
    expect(drillSteps({ audio: false }, { microphone: true }, ready)).toEqual(['look', 'copy', 'match', 'read-aloud', 'tiles', 'say-from-cue', 'type']);
  });
  it('a word not ready for sign-off never types from memory: copy and tiles are the ceiling', () => {
    expect(drillSteps({ audio: true }, { microphone: true })).toEqual(['look', 'copy', 'say-after', 'match', 'read-aloud', 'tiles', 'say-from-cue']);
    expect(drillSteps({ audio: true }, { microphone: false })).toEqual(['look', 'copy', 'match', 'tiles']);
  });
  it('tiles are the answer syllables plus two decoys from other deck words', () => {
    const tiles = tilesFor({ term: '이름이 뭐예요?' }, ['이름', '가위', '책'], 's');
    expect(tiles).toHaveLength(8);
    expect(tiles).toEqual(expect.arrayContaining(['이', '름', '이', '뭐', '예', '요']));
    expect(tiles.filter((t) => ['가', '위', '책'].includes(t))).toHaveLength(2);
  });
  it('match board uses pictures only when every word has one', () => {
    const e = (id, term, gloss) => ({ id, term, gloss });
    const words = [e('a', '가위', 'Scissors'), e('b', '책', 'Book')];
    expect(matchBoard(words, { a: { image: true }, b: { image: true } }, 's').pairs.every((p) => p.right.type === 'image')).toBe(true);
    expect(matchBoard(words, { a: { image: true }, b: { image: false } }, 's').pairs.map((p) => p.right)).toEqual(
      expect.arrayContaining([{ type: 'text', text: 'Scissors' }, { type: 'text', text: 'Book' }]),
    );
  });
});
