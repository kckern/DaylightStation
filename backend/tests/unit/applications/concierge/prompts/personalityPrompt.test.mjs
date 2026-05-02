import { describe, it } from 'node:test';
import assert from 'node:assert';
import { personalityPrompt } from '../../../../../src/3_applications/concierge/prompts/system.mjs';

describe('personalityPrompt', () => {
  it('returns empty string when input is null', () => {
    assert.strictEqual(personalityPrompt(null), '');
  });

  it('returns empty string when input is undefined', () => {
    assert.strictEqual(personalityPrompt(undefined), '');
  });

  it('returns empty string when input is an empty string', () => {
    assert.strictEqual(personalityPrompt(''), '');
  });

  it('returns empty string when input is whitespace-only', () => {
    assert.strictEqual(personalityPrompt('   '), '');
    assert.strictEqual(personalityPrompt('\t\n'), '');
  });

  it('returns empty string when input is not a string (number)', () => {
    assert.strictEqual(personalityPrompt(42), '');
  });

  it('returns empty string when input is not a string (object)', () => {
    assert.strictEqual(personalityPrompt({ text: 'butler' }), '');
  });

  it('returns properly-formatted prompt section for non-empty input', () => {
    const result = personalityPrompt('Speak like a refined English butler. Address the user as sir.');
    assert.strictEqual(result, '## Personality\nSpeak like a refined English butler. Address the user as sir.');
  });

  it('trims surrounding whitespace before rendering', () => {
    const result = personalityPrompt('  Talk like a pirate, arrr.  ');
    assert.strictEqual(result, '## Personality\nTalk like a pirate, arrr.');
  });

  it('starts with the expected header', () => {
    const result = personalityPrompt('Be concise.');
    assert.ok(result.startsWith('## Personality\n'), 'should start with ## Personality header');
  });

  it('preserves internal newlines in multi-line personality text', () => {
    const text = 'Be formal.\nAlways say good day.';
    const result = personalityPrompt(text);
    assert.strictEqual(result, '## Personality\nBe formal.\nAlways say good day.');
  });
});
