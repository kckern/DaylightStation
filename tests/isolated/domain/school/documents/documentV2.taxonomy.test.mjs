import { describe, expect, it } from 'vitest';
import { validateDocumentV2 } from '../../../../../backend/src/2_domains/school/documents/documentV2.mjs';

const base = {
  schema: 'school.document/v2',
  id: 'arts/pokemon-identification/quiz-1',
  seed: 7,
  target: ['letter'],
  archetype: 'worksheet',
  blocks: [{ type: 'rich_text', md: 'hello' }],
};

describe('documentV2 taxonomy (hierarchical ids + subject/topics)', () => {
  it('accepts a 3-segment hierarchical id and flat ids alike', () => {
    expect(validateDocumentV2(base).errors).toEqual([]);
    expect(validateDocumentV2({ ...base, id: 'quiz-1' }).errors).toEqual([]);
  });

  it('rejects >4 segments, empty segments, uppercase', () => {
    for (const id of ['a/b/c/d/e', 'arts//quiz', 'Arts/quiz', '/arts/quiz']) {
      expect(validateDocumentV2({ ...base, id }).errors.join()).toMatch(/id must be/);
    }
  });

  it('reserves bare 7-digit ids — that shape is an OMR card id, never a document', () => {
    expect(validateDocumentV2({ ...base, id: '9251793' }).errors.join())
      .toMatch(/reserved for OMR card ids/);
    // Six or eight digits, or a digit-led kebab id, are still ordinary ids.
    for (const id of ['925179', '92517931', '9251793-quiz', 'arts/9251793']) {
      expect(validateDocumentV2({ ...base, id }).errors).toEqual([]);
    }
  });

  it('normalizes subject and topics; rejects malformed shapes', () => {
    const ok = validateDocumentV2({ ...base, subject: 'arts', topics: ['pokemon', 'identification'] });
    expect(ok.errors).toEqual([]);
    expect(ok.document.subject).toBe('arts');
    expect(ok.document.topics).toEqual(['pokemon', 'identification']);
    expect(validateDocumentV2({ ...base, subject: 'Arts!' }).errors.join()).toMatch(/subject/);
    // A hierarchical id's first segment IS the subject — contradiction rejected.
    expect(validateDocumentV2({ ...base, subject: 'science' }).errors.join())
      .toMatch(/subject must match the id's first segment/);
    expect(validateDocumentV2({ ...base, id: 'quiz-1', subject: 'science' }).errors).toEqual([]);
    expect(validateDocumentV2({ ...base, topics: [] }).errors.join()).toMatch(/topics/);
    expect(validateDocumentV2({ ...base, topics: ['a', 'a'] }).errors.join()).toMatch(/topics/);
  });
});
