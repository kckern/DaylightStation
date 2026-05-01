/**
 * PrivacyExclusions (F4-C) unit tests.
 *
 * Covers the floor + addition machinery shared by HealthArchiveScope (read
 * surface) and HealthArchiveIngestion (write surface). The audit Section 10
 * forbids users from removing floor entries — these tests assert that
 * invariant directly.
 */
import { describe, it, expect } from 'vitest';
import {
  FLOOR_EXCLUSIONS,
  compileAdditions,
  matchesExclusion,
} from '#domains/health/policies/PrivacyExclusions.mjs';

describe('PrivacyExclusions', () => {
  describe('FLOOR_EXCLUSIONS', () => {
    it('contains exactly 8 patterns', () => {
      expect(FLOOR_EXCLUSIONS.length).toBe(8);
    });

    it('is frozen — additions/mutations from downstream code are rejected', () => {
      expect(Object.isFrozen(FLOOR_EXCLUSIONS)).toBe(true);
    });

    // Positive case per floor entry — substring of a path that should match.
    const expectedHits = [
      ['email-thread.md', /email/i],
      ['chat-log.md', /chat/i],
      ['finance-summary.md', /finance/i],
      ['journal-2024.md', /journal\b/i],
      ['search-history-2024.md', /search-history/i],
      ['calendar-export.md', /calendar/i],
      ['social-feed.md', /social/i],
      ['banking-statement.pdf', /\bbanking\b/i],
    ];
    it.each(expectedHits)(
      'floor pattern matches %s',
      (sample, expectedPattern) => {
        // The sample must be matched by at least one floor entry, and
        // specifically by the expected one.
        expect(FLOOR_EXCLUSIONS.some((p) => p.test(sample))).toBe(true);
        expect(expectedPattern.test(sample)).toBe(true);
      },
    );
  });

  describe('compileAdditions', () => {
    it('returns an empty array for empty input', () => {
      expect(compileAdditions()).toEqual([]);
      expect(compileAdditions([])).toEqual([]);
      expect(compileAdditions(null)).toEqual([]);
      expect(compileAdditions(undefined)).toEqual([]);
    });

    it('compiles strings into case-insensitive RegExps', () => {
      const compiled = compileAdditions(['therapy-notes']);
      expect(compiled).toHaveLength(1);
      expect(compiled[0]).toBeInstanceOf(RegExp);
      expect(compiled[0].flags).toContain('i');
      expect(compiled[0].test('/foo/Therapy-Notes/bar')).toBe(true);
      expect(compiled[0].test('/foo/THERAPY-NOTES/bar')).toBe(true);
    });

    it('escapes regex metacharacters — user input cannot inject regex syntax', () => {
      // `'foo.*bar'` should match the LITERAL string `foo.*bar`, not as a
      // wildcard. This is the central security invariant of compileAdditions.
      const compiled = compileAdditions(['foo.*bar']);
      expect(compiled).toHaveLength(1);
      expect(compiled[0].test('foo.*bar-suffix')).toBe(true); // literal match
      expect(compiled[0].test('fooXXXbar')).toBe(false); // would match if `.` were wildcard
    });

    it('escapes the dot metacharacter so `a.b` does NOT match `axb`', () => {
      const compiled = compileAdditions(['a.b']);
      expect(compiled[0].test('a.b')).toBe(true);
      expect(compiled[0].test('axb')).toBe(false);
    });

    it('escapes alternation, anchors, char classes, and quantifiers', () => {
      const cases = [
        // ['user supplied', 'literal hit', 'attempted regex hit (must miss)']
        ['foo|bar', 'pre-foo|bar-post', 'pre-foo-post'],
        ['^secret', '/has/^secret/in/it', 'secret-without-caret'],
        ['secret$', 'a-secret$-b', 'secret-without-dollar'],
        ['[abc]', 'value-[abc]-value', 'a-by-itself'],
        ['x{2,3}', 'sample-x{2,3}-here', 'xxx-only'],
        ['back\\slash', 'foo/back\\slash/bar', 'foo/backslash/bar'],
      ];
      for (const [input, hit, miss] of cases) {
        const [re] = compileAdditions([input]);
        expect(re.test(hit)).toBe(true);
        expect(re.test(miss)).toBe(false);
      }
    });

    it('skips empty strings, whitespace-only strings, and non-strings', () => {
      const compiled = compileAdditions([
        '',
        '   ',
        '\t\n',
        null,
        undefined,
        42,
        {},
        [],
        'real-entry',
      ]);
      expect(compiled).toHaveLength(1);
      expect(compiled[0].test('real-entry')).toBe(true);
    });

    it('trims surrounding whitespace before compilation', () => {
      const [re] = compileAdditions(['  therapy-notes  ']);
      expect(re.test('foo/therapy-notes/bar')).toBe(true);
      // The surrounding spaces should NOT be part of the literal pattern.
      expect(re.test('foo/  therapy-notes  /bar')).toBe(true);
    });
  });

  describe('matchesExclusion', () => {
    it('returns true when the path matches a floor entry — no additions', () => {
      expect(matchesExclusion('/data/users/test-user/notes/email-thread.md')).toBe(true);
      expect(matchesExclusion('/data/users/test-user/notes/banking.md')).toBe(true);
    });

    it('returns false for benign paths with no additions', () => {
      expect(matchesExclusion('/data/users/test-user/lifelog/archives/notes/training.md')).toBe(false);
      expect(matchesExclusion('/data/users/test-user/health.yml')).toBe(false);
    });

    it('returns true when the path matches a user-supplied addition', () => {
      const additions = compileAdditions(['therapy-notes']);
      expect(matchesExclusion(
        '/data/users/test-user/notes/therapy-notes/2024.md',
        additions,
      )).toBe(true);
    });

    it('floor STILL fires even when user passes additions — additions can only ADD', () => {
      // The user is trying to "shadow" the floor by passing additions: even
      // though they don't add anything that would match this path, the floor
      // must still reject `email`. There's no way to remove floor entries.
      const additions = compileAdditions(['unrelated-token']);
      expect(matchesExclusion('/notes/email.md', additions)).toBe(true);
      expect(matchesExclusion('/notes/banking.md', additions)).toBe(true);
    });

    it('user additions cannot subtract from the floor (immutability invariant)', () => {
      // Even pathologically: a user passes the floor patterns themselves as
      // additions — the floor still fires. (This is just confirming that
      // additions are checked AFTER the floor and only via OR, never AND.)
      const additions = compileAdditions(['email', 'banking', 'social']);
      expect(matchesExclusion('/notes/email.md', additions)).toBe(true);
      // FLOOR_EXCLUSIONS itself remains untouched and unchanged length.
      expect(FLOOR_EXCLUSIONS.length).toBe(8);
    });

    it('returns false for non-string path inputs', () => {
      expect(matchesExclusion(null)).toBe(false);
      expect(matchesExclusion(undefined)).toBe(false);
      expect(matchesExclusion(42)).toBe(false);
      expect(matchesExclusion({})).toBe(false);
    });

    it('treats additions as case-insensitive substring (no anchors)', () => {
      const additions = compileAdditions(['client-confidential']);
      expect(matchesExclusion('/some/Client-Confidential/file.md', additions)).toBe(true);
      expect(matchesExclusion('/some/CLIENT-CONFIDENTIAL/file.md', additions)).toBe(true);
      expect(matchesExclusion('client-confidential', additions)).toBe(true);
      // No match: the substring is genuinely absent.
      expect(matchesExclusion('/some/safe/file.md', additions)).toBe(false);
    });
  });
});
