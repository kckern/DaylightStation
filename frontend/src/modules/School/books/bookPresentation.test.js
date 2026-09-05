import { describe, expect, it } from 'vitest';
import { allAuthorsLabel, authorsLabel, cleanAuthors, cleanBookText, presentBook } from './bookPresentation.js';

describe('bookPresentation', () => {
  it('cleans catalogue/HTML debris and composes a meaningful subtitle', () => {
    expect(presentBook({
      title: '  The   Wild Robot [electronic resource] ',
      subtitle: '  Escapes&nbsp;again ',
      description: '<p>A robot &amp; her friends.</p>\n<div>Adventure.</div>',
    })).toMatchObject({
      title: 'The Wild Robot: Escapes again',
      description: 'A robot & her friends. Adventure.',
    });
  });

  it('removes repeated trailing retail bindings but preserves meaningful brackets', () => {
    expect(presentBook({ title: 'A Wrinkle in Time [Hardcover] (Large Print Edition)' }).title)
      .toBe('A Wrinkle in Time');
    expect(presentBook({ title: 'The Doll People (The Doll People, #1)' }).title)
      .toBe('The Doll People (The Doll People, #1)');
  });

  it('does not repeat a subtitle already carried by the title', () => {
    expect(presentBook({ title: 'Hatchet: A Novel', subtitle: 'A Novel' }).title).toBe('Hatchet: A Novel');
  });

  it('humanizes Last, First and de-duplicates punctuation variants', () => {
    const authors = cleanAuthors(['White, E. B.', 'E.B. White', ' Garth Williams ', 'Garth  Williams']);
    expect(authors).toEqual(['E. B. White', 'Garth Williams']);
    expect(authorsLabel(authors)).toBe('E. B. White & Garth Williams');
  });

  it('summarizes a many-author work without losing the full accessible label', () => {
    const authors = ['Ada A', 'Bea B', 'Cal C', 'Dee D'];
    expect(authorsLabel(authors)).toBe('Ada A, Bea B & 2 more');
    expect(allAuthorsLabel(authors)).toBe('Ada A, Bea B, Cal C & Dee D');
  });

  it('bounds hostile description text and provides an ISBN fallback title', () => {
    expect(presentBook({ isbn13: '9780064400558', description: 'x'.repeat(900) })).toMatchObject({
      title: 'Book 9780064400558',
      description: 'x'.repeat(600),
    });
    expect(cleanBookText('A&#160;B &#x26; C')).toBe('A B & C');
    expect(cleanBookText('A\u0000B\nC')).toBe('AB C');
  });
});
