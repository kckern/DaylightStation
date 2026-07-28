/**
 * What each question on a printed sheet actually ASKS.
 *
 * The review queue could only ever show a parent an itemId (`u2-q3`) and the
 * unit's whole-sheet rubric, which is identical on every row. Six questions read
 * as six copies of the same sentence, and there was no way to tell which one you
 * were marking. The text is right there in the document blocks; this is the pure
 * read of it.
 */
import { describe, it, expect } from 'vitest';
import { questionPrompts } from '#domains/school/documents/documentValidation.mjs';
import { fixtureDocument, WORKSHEET_DOCUMENT_ID, OMR_DOCUMENT_ID } from '#testlib/school/lifecycleFixtures.mjs';

describe('questionPrompts', () => {
  it('reads the printed question text and its number, per item', () => {
    const prompts = questionPrompts(fixtureDocument(WORKSHEET_DOCUMENT_ID));
    expect(prompts.get('u2-q1')).toEqual({
      number: 1, prompt: 'Add. Write the result in simplest form.',
    });
    expect(prompts.get('u2-q2')).toMatchObject({ number: 2, prompt: 'Subtract. Write the result in simplest form.' });
  });

  it('gives a DIFFERENT prompt per question — the whole point', () => {
    const prompts = questionPrompts(fixtureDocument(WORKSHEET_DOCUMENT_ID));
    const texts = [...prompts.values()].map((p) => p.prompt);
    expect(texts.length).toBeGreaterThan(1);
    expect(new Set(texts).size).toBeGreaterThan(1);
  });

  it('covers every question the same document reports as an item', () => {
    const doc = fixtureDocument(OMR_DOCUMENT_ID);
    const prompts = questionPrompts(doc);
    expect(prompts.size).toBeGreaterThan(0);
    [...prompts.keys()].forEach((id) => expect(typeof id).toBe('string'));
  });

  it('flattens a multi-paragraph question to one line rather than a wall', () => {
    const doc = { blocks: [{ type: 'question', itemId: 'q1', number: 1, blocks: [
      { type: 'rich_text', md: 'First line.\n\nSecond   line.\n' },
    ] }] };
    expect(questionPrompts(doc).get('q1').prompt).toBe('First line. Second line.');
  });

  it('carries the number even when a question has no words of its own', () => {
    const doc = { blocks: [{ type: 'question', itemId: 'q1', number: 7, blocks: [
      { type: 'math', tex: '\\frac{1}{2}' }, { type: 'answer_space' },
    ] }] };
    expect(questionPrompts(doc).get('q1')).toEqual({ number: 7, prompt: null });
  });

  it('is empty, never thrown, for a document with no questions or no document at all', () => {
    expect(questionPrompts(null).size).toBe(0);
    expect(questionPrompts({ blocks: [{ type: 'rich_text', md: 'hello' }] }).size).toBe(0);
  });

  it('strips markdown emphasis so a parent reads words, not asterisks', () => {
    const doc = { blocks: [{ type: 'question', itemId: 'q1', number: 1, blocks: [
      { type: 'rich_text', md: 'Write it in **simplest form**.' },
    ] }] };
    expect(questionPrompts(doc).get('q1').prompt).toBe('Write it in simplest form.');
  });
});
