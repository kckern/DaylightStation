import { describe, it, expect } from 'vitest';
import { LANGUAGE_GROUPS, LANGUAGE_DEFAULTS, groupOfTerm, languageGroupOf, languageWordOf } from './languageGroups.mjs';

describe('languageGroups', () => {
  it('maps every VidAngel and word-list name onto five groups', () => {
    const table = {
      profanity: 'profanity', profanity_captions: 'profanity',
      blasphemy: 'blasphemy',
      language_sexual: 'sexual', vulgarity: 'sexual', other_sexual: 'sexual',
      language_racial: 'slurs', racial: 'slurs', other_racial: 'slurs',
      language_childish: 'childish', childish: 'childish', other_childish: 'childish',
    };
    for (const [term, group] of Object.entries(table)) expect(groupOfTerm(term)).toBe(group);
    expect(new Set(Object.values(table))).toEqual(new Set(LANGUAGE_GROUPS));
  });

  it('finds the group of a cue category', () => {
    expect(languageGroupOf('language/profanity/fuck')).toBe('profanity');
    expect(languageGroupOf('language/profanity_captions/x')).toBe('profanity');
    expect(languageGroupOf('language/blasphemy/god')).toBe('blasphemy');
    expect(languageGroupOf('language/language_sexual/other_sexual')).toBe('sexual');
    expect(languageGroupOf('language/vulgarity/ass')).toBe('sexual');
    expect(languageGroupOf('language/racial/nigger')).toBe('slurs');
    expect(languageGroupOf('language/language_racial/other_racial')).toBe('slurs');
    expect(languageGroupOf('language/childish/jerk')).toBe('childish');
    expect(languageGroupOf('language/other_childish')).toBe('childish');
  });

  it('puts an unrecognised language category in profanity and leaves other categories alone', () => {
    expect(languageGroupOf('language')).toBe('profanity');
    expect(languageGroupOf('language/x')).toBe('profanity');
    expect(languageGroupOf('violence/x')).toBeNull();
    expect(languageGroupOf(undefined)).toBeNull();
  });

  it('defaults: childish off, the rest mute', () => {
    expect(LANGUAGE_DEFAULTS).toEqual({ profanity: 'mute', blasphemy: 'mute', sexual: 'mute', slurs: 'mute', childish: 'off' });
  });

  it('takes the word from the leaf, else a clean label', () => {
    expect(languageWordOf({ category: 'language/profanity/Damn', label: 'x y' })).toBe('damn');
    expect(languageWordOf({ category: 'language/childish/jerk' })).toBe('jerk');
    expect(languageWordOf({ category: 'language/other_childish', label: 'butthead' })).toBe('butthead');
    expect(languageWordOf({ category: 'language/language_sexual/other_sexual', label: 'damn' })).toBe('damn');
    expect(languageWordOf({ category: 'language/blasphemy/god', label: 'G*d' })).toBe('god');
    expect(languageWordOf({ category: 'language/racial/other', label: 'p*ck*rw**d' })).toBeNull();
    expect(languageWordOf({ category: 'language/language_sexual/other_sexual', label: 'A billboard shows a crude word' })).toBeNull();
  });
});
