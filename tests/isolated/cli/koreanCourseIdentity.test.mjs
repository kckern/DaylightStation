// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { assembleKoreanCourse } from "../../../__app_modules/learning/school/cli/lib/korean-course.mjs";
import { renderKoreanCourseGuide, baseUnitRow } from "../../../__app_modules/learning/school/cli/lib/korean-course-guide.mjs";
import { syntheticLessons } from "../../_fixtures/school/sample-course/syntheticCourse.mjs";

const fixture = new URL('../../_fixtures/school/sample-course/', import.meta.url);
const load = (name) => yaml.load(fs.readFileSync(new URL(name, fixture), 'utf8'));

describe('course identity comes from the course data, not code', () => {
  it('derives id, title and source book from the base unit and lexicon', () => {
    const baseLexicon = load('lexicon.yml'); const baseUnit = load('korean-3-2.lesson-01.yml');
    baseLexicon.program.title = 'Invented Reader · Lesson 1';
    Object.assign(baseUnit, { courseId: 'invented-reader', sourceTitle: 'The Invented Reader, Book Two' });
    const result = assembleKoreanCourse({ baseLexicon, baseUnit, lessons: syntheticLessons() });
    const unit = result.units[1];
    expect(unit.courseId).toBe('invented-reader');
    expect(unit.unitId).toBe('invented-reader.lesson-02');
    expect(unit.sourceTitle).toBe('The Invented Reader, Book Two');
    expect(unit.title).toMatch(/^Invented Reader · Lesson 2:/u);
    expect(result.lexicon.program.title).toBe('Invented Reader');
    expect(result.decks[1].id).toBe('language/invented-reader/lesson-02');
    expect(result.documents[0].id).toBe('invented-reader-lesson-02-a');
    expect(JSON.stringify([result.units.slice(1), result.decks.slice(1), result.documents])).not.toMatch(/Korean 3-2|korean-3-2|재외동포/u);
  });

  it('fills the teacher guide from a template carried with the course source', () => {
    const baseUnit = load('korean-3-2.lesson-01.yml');
    const template = fs.readFileSync(new URL('teacher-guide.template.md', fixture), 'utf8');
    const row = baseUnitRow(baseUnit);
    expect(row).toMatchObject({ lesson: 1, textbookPages: [1, 2], workbookPages: [1, 2] });
    const guide = renderKoreanCourseGuide({
      cards: 12, questions: 7, baseRow: row,
      inventory: [{ lesson: 2, title: 'Second $& topic', kind: 'new', cards: 6, questions: 6, textbookPages: [3, 4], workbookPages: [5, 6],
        patterns: [{ label: '-x', explanation: 'Does x.', source: { book: 'textbook', page: 3 } }] }],
    }, template);
    expect(guide).toContain('There are 12 cards and 7 cumulative targets.');
    expect(guide).toContain('| 2 | Second $& topic | new | 6 | 6 | 3–4 | 5–6 |');
    expect(guide).toContain('### Unit 2: Second $& topic');
    expect(guide).not.toContain('{{');
  });

  it('refuses a guide template missing a placeholder', () => {
    expect(() => renderKoreanCourseGuide({ cards: 1, questions: 1, inventory: [] }, 'no placeholders')).toThrow(/template must contain/u);
  });
});
