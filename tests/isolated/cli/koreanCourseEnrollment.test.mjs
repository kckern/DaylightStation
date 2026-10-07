// @vitest-environment node
import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { assembleKoreanCourse } from '../../../cli/lib/korean-course.mjs';
import { preserveExistingEnrollments } from '../../../cli/lib/preserve-existing-enrollments.mjs';
import { createSchoolProgramEnrollmentValidators } from '../../../backend/src/3_applications/school/SchoolProgramEnrollmentValidators.mjs';
import { SetAssignments } from '../../../backend/src/3_applications/school/usecases/SetAssignments.mjs';

it('adds Korean lessons while preserving unrelated decks, linked courses and service-backed programs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korean-enrollment-'));
  const base = path.join(root, 'base'), out = path.join(root, 'out');
  const fixture = new URL('../../_fixtures/school/korean-3-2/', import.meta.url);
  const load = name => yaml.load(fs.readFileSync(new URL(name, fixture), 'utf8'));
  const lessonsDir = new URL('full-course/lessons/', fixture);
  const lessons = fs.readdirSync(lessonsDir).map(name => JSON.parse(fs.readFileSync(new URL(name, lessonsDir), 'utf8')));
  const course = assembleKoreanCourse({ baseLexicon: load('lexicon.yml'), baseUnit: load('korean-3-2.lesson-01.yml'), lessons });
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, yaml.dump(value)); };
  const old = { learnerId: 'kid', courses: [{ courseId: 'biology' }], units: ['other.work'], updatedAt: '2026-10-01T00:00:00Z', assignedBy: 'adult', programs: [
    { programId: 'flashcards', deckId: 'biology/cells', corpusId: 'biology/cells', linkedUnitId: 'biology.cells', title: 'Cell models', policy: { mode: 'card-ladder' } },
    { programId: 'language-reels', corpusId: 'korean-language-reels', daily: { selection: 'random_category' }, title: 'Reels', schedule: { daysOfWeek: [2] } },
    { programId: 'rubiks-cube', corpusId: 'cube-course', title: 'Cube practice' },
  ] };
  try {
    write(path.join(base, 'media/school/language/korean-3-2/lexicon.yml'), course.lexicon);
    for (const deck of course.decks) write(path.join(base, 'data/content/school/learning-catalog/flashcard-decks', `${deck.id}.yml`), deck);
    for (const unit of course.units) write(path.join(base, 'data/content/school/language/korean-3-2/units', `${unit.unitId}.yml`), unit);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ units: course.units.map(unit => ({ unitId: unit.unitId, deckId: unit.practice.deckId })) }));
    const planFile = path.join(base, 'data/household/school/plans/learners/kid.yml');
    write(planFile, old);
    write(path.join(base, 'data/users/adult/profile.yml'), { birthyear: 1980 });
    write(path.join(base, 'data/content/school/science/biology/units/biology.cells.yml'), { schema: 'school.unit/v1', unitId: 'biology.cells', courseId: 'biology', subject: 'science', practice: { deckId: 'biology/cells' } });
    const before = fs.readFileSync(planFile);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../../cli/korean-course.cli.mjs', import.meta.url)), 'enroll', '--base', base, '--out', out, '--learner', 'kid', '--assigned-by', 'adult'], { encoding: 'utf8', timeout: 30000 });
    expect(result.status, result.stderr).toBe(0);
    const proposed = yaml.load(fs.readFileSync(path.join(out, 'kid-enrollment-proposed.yml'), 'utf8'));
    expect(proposed.programs.slice(0, 3)).toEqual(old.programs);
    expect(proposed.programs).toHaveLength(19);
    expect(proposed.courses[0]).toEqual(old.courses[0]);
    expect(proposed.units).toEqual(old.units);
    expect(proposed.programs.slice(3).every(p => p.linkedUnitId && p.policy.mode === 'card-ladder')).toBe(true);
    expect(fs.readFileSync(planFile)).toEqual(before);
    // Preserving the enrollment does not excuse a changed/missing durable linkage.
    write(path.join(base, 'data/content/school/science/biology/units/biology.cells.yml'), { unitId: 'biology.cells', courseId: 'biology', subject: 'science', practice: { deckId: 'biology/different' } });
    const rejected = spawnSync(process.execPath, [fileURLToPath(new URL('../../../cli/korean-course.cli.mjs', import.meta.url)), 'enroll', '--base', base, '--out', out, '--learner', 'kid', '--assigned-by', 'adult'], { encoding: 'utf8', timeout: 30000 });
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('Invalid practice linkage: biology.cells');
    expect(fs.readFileSync(planFile)).toEqual(before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


it('rejects changed unrelated and new unknown programs through SetAssignments', async () => {
  const existing = { programId: 'language-reels', corpusId: 'korean-language-reels', daily: { selection: 'random_category' }, title: 'Keep this title' };
  const programs = [existing, { programId: 'flashcards', deckId: 'biology/cells', corpusId: 'biology/cells', policy: { mode: 'card-ladder' } }];
  const validators = createSchoolProgramEnrollmentValidators({ flashcardStudyService: { getDeck: async id => { if (id !== 'language/korean-3-2/lesson-01') throw new Error('Unknown deck'); return {}; } } });
  let written = false;
  const useCase = new SetAssignments({ assignments: { put: async () => { written = true; } }, grownUps: { assert() {} }, programValidators: preserveExistingEnrollments(validators, programs) });
  for (const changed of [
    { ...existing, title: 'Changed' },
    { ...programs[1], title: 'Changed' },
    { programId: 'unknown-program' },
  ]) await expect(useCase.execute({ learnerId: 'kid', programs: [changed], assignedBy: 'adult' })).rejects.toThrow(/cannot change|not found|unknown program/);
  expect(written).toBe(false);
});
