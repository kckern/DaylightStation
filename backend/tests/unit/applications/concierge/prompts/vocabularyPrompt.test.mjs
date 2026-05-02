import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AliasMap } from '../../../../../src/2_domains/common/AliasMap.mjs';
import { vocabularyPrompt } from '../../../../../src/3_applications/concierge/prompts/system.mjs';

describe('vocabularyPrompt', () => {
  it('returns empty string when vocab is null', () => {
    assert.strictEqual(vocabularyPrompt(null), '');
  });

  it('returns empty string when vocab is an empty AliasMap', () => {
    assert.strictEqual(vocabularyPrompt(new AliasMap(null)), '');
  });

  it('returns a properly-formatted prompt section for non-empty vocab', () => {
    const vocab = new AliasMap({
      'FHE': 'Family Home Evening (Mondays at 7pm)',
      'the kids': 'Soren, Alan, Milo',
      'big room': 'the living room',
    });
    const result = vocabularyPrompt(vocab);
    assert.ok(result.startsWith('## Household vocabulary\n'), 'should start with header');
    assert.ok(result.includes('- FHE = Family Home Evening (Mondays at 7pm)'), 'should include FHE entry');
    assert.ok(result.includes('- the kids = Soren, Alan, Milo'), 'should include kids entry');
    assert.ok(result.includes('- big room = the living room'), 'should include big room entry');
    const lines = result.split('\n');
    assert.strictEqual(lines[0], '## Household vocabulary');
    assert.ok(lines.length === 4, 'header + 3 entries, no trailing newline');
  });
});
