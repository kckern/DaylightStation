import { describe, expect, it } from 'vitest';
import { activityFor, programRequestForSection, sectionForProgramReport, validateActivityTarget } from './activityManifest.js';
import { schoolPathFor } from '../schoolPathModel.js';

describe('school activity navigation and authority', () => {
  it.each([
    ['language', 'glossika-korean', 'program:sentence-ladder:glossika-korean'],
    ['sentence-ladder', 'two/parts', 'program:sentence-ladder:two%2Fparts'],
    ['materials', 'course', 'library'],
    ['typing', null, 'typing'],
    ['quizzes', null, 'banks'],
    ['gratitude', null, 'program:gratitude:'],
    ['school-debrief', null, 'program:school-debrief:'],
    ['card-ladder', 'science/cells', 'program:card-ladder:science%2Fcells'],
  ])('resolves %s reports through a supported view or server launch request', (program, instanceId, want) => {
    expect(sectionForProgramReport({ program, instanceId })).toBe(want);
  });
  it('opens assigned programs through grant minting rather than reconstructing a grant from a path', () => {
    expect(programRequestForSection('program:sentence-ladder:two%2Fparts')).toEqual({ programId: 'sentence-ladder', instanceId: 'two/parts' });
    expect(schoolPathFor('/school', 'program:sentence-ladder:two%2Fparts')).toBe('/school/program/sentence-ladder/two%2Fparts');
    expect(programRequestForSection('program:writing:')).toBe(null);
    expect(sectionForProgramReport({ program: 'unknown' })).toBe(null);
  });
  it('rejects mismatched learner authority and missing grants before mounting', () => {
    expect(validateActivityTarget({ kind: 'program', program: 'gratitude', learnerId: 'other', gratitudeGrant: 'grant' }, 'child')).toMatchObject({ ok: false });
    expect(validateActivityTarget({ kind: 'program', program: 'language', corpusId: 'korean' }, 'child')).toMatchObject({ ok: false });
    expect(validateActivityTarget({ kind: 'program', program: 'language', corpusId: 'korean', studyGrant: 'grant' }, 'child')).toMatchObject({ ok: true, activityId: 'sentence-ladder' });
  });
  it.each(['quiz', 'problems', 'flashcard', 'flashcards', 'card-ladder', 'learning-probe', 'learning-reader', 'remediation', 'lesson-companion', 'sentence-ladder', 'language-reels', 'gratitude', 'school-debrief', 'rubiks-cube', 'book-log', 'economy-bank', 'typing', 'chess', 'reading-session', 'media-lesson', 'agenda', 'rewards'])('declares layout/capability metadata for %s', id => {
    const entry = activityFor(id);
    expect(entry?.layout).toMatch(/^(workspace|focus|split|media|board)$/);
    expect(entry?.label).toEqual(expect.any(String));
    expect(entry?.capabilities).toEqual(expect.any(Array));
  });
});
