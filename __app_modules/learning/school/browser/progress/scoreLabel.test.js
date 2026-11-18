import { describe, it, expect } from 'vitest';
import { learningSlugLabel, bankScoreLabel, recentScoreTitle } from './scoreLabel.js';

describe('learningSlugLabel', () => {
  it('drops week, day and page codes and keeps what the lesson is about', () => {
    expect(learningSlugLabel('cfm-w47-d3-hosea-10-11')).toBe('Hosea 10–11');
    expect(learningSlugLabel('cfm-w46-d3-daniel-3')).toBe('Daniel 3');
    expect(learningSlugLabel('atlas-us-p114-west-virginia')).toBe('West Virginia');
  });
  it('drops a leading course code and its numbers, but not a name that starts with one', () => {
    expect(learningSlugLabel('em23-03-04-mental-addition')).toBe('Mental Addition');
    expect(learningSlugLabel('em23-03-99-mastery')).toBe('Mastery');
    expect(learningSlugLabel('1-nephi-3')).toBe('1 Nephi 3');
  });
  it('only reads an ascending pair as a range', () => {
    expect(learningSlugLabel('korean-3-2')).toBe('Korean 3 2');
    expect(learningSlugLabel('em23-01-01-place-value-to-1-000')).toBe('Place Value To 1 000');
    expect(learningSlugLabel('elementary-math-2-3')).toBe('Elementary Math 2–3');
  });
  it('reads source-prefixed ids', () => {
    expect(learningSlugLabel('geo:world-flags')).toBe('World Flags');
    expect(learningSlugLabel('plex:675964')).toBe('Video lesson');
  });
  it('keeps acronyms and plain slugs readable', () => {
    expect(learningSlugLabel('come-follow-me-ot-2026')).toBe('Come Follow Me OT 2026');
    expect(learningSlugLabel('young-peoples-atlas-us')).toBe('Young Peoples Atlas US');
    expect(learningSlugLabel('fractions')).toBe('Fractions');
  });
});

describe('bankScoreLabel', () => {
  it('names the course for a printed worksheet session, never the session id', () => {
    expect(bankScoreLabel('scripture/come-follow-me-ot-2026/ws-ses-7jv9m9mrij@c8d452399'))
      .toBe('Come Follow Me OT 2026');
  });
  it('labels the last segment of any other path id', () => {
    expect(bankScoreLabel('science/cells/organelles')).toBe('Organelles');
  });
  it('labels a source-prefixed id', () => {
    expect(bankScoreLabel('geo:world-flags')).toBe('World Flags');
  });
  it('leaves a bare id alone', () => {
    expect(bankScoreLabel('mystery')).toBe('mystery');
  });
});

describe('recentScoreTitle', () => {
  const worksheet = 'scripture/come-follow-me-ot-2026/ws-ses-7jv9m9mrij@c8d452399';
  it('prefers the lesson, then the unit', () => {
    expect(recentScoreTitle({ activityId: worksheet, learning: { lessonId: 'fractions', unitId: 'cfm-w47-d3-hosea-10-11' } })).toBe('Fractions');
    expect(recentScoreTitle({ activityId: worksheet, learning: { unitId: 'cfm-w47-d3-hosea-10-11' } })).toBe('Hosea 10–11');
  });
  it('falls back to the course for a worksheet with no unit', () => {
    expect(recentScoreTitle({ activityId: worksheet, learning: {} })).toBe('Come Follow Me OT 2026');
  });
  it('uses the last segment of a lesson path', () => {
    expect(recentScoreTitle({ learning: { lessonId: 'history/i-survived/01-alone-in-the-creek' } })).toBe('01 Alone In The Creek');
  });
});
