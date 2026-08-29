import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderPianoChallengeGrammar } from './render-piano-challenge-grammar-doc.mjs';

describe('PianoChallenge grammar reference', () => {
  it('is the exact generated rendering of askSchema AXES and PRESETS', async () => {
    const doc = await readFile(new URL('../docs/reference/piano/challenge.md', import.meta.url), 'utf8');
    const generated = doc.match(/<!-- generated:start[^>]* -->[\s\S]*<!-- generated:end -->\n?/);
    expect(generated?.[0]).toBe(renderPianoChallengeGrammar());
  });
});
