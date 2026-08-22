import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlCurriculumDatastore } from './YamlCurriculumDatastore.mjs';
import { YamlSchoolDatastore } from './YamlSchoolDatastore.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';

const roots = [];

/**
 * Build a one-lesson v2 course package.
 *
 * `layout: 'root'` puts it on the subject shelf (`content/school/<subject>/…`),
 * which is where the reorganization lands every course. `layout: 'curriculum'`
 * uses the retired `content/school/curriculum/<subject>/…` nesting.
 */
const fixture = (layout = 'root') => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-v2-')); roots.push(root);
  const shelf = layout === 'curriculum'
    ? path.join(root, 'content/school/curriculum/civilization/atlas')
    : path.join(root, 'content/school/civilization/atlas');
  const lesson = path.join(shelf, 'units/10-northeast/lessons/maine');
  fs.mkdirSync(lesson, { recursive: true });
  fs.writeFileSync(path.join(shelf, '_index.yml'), 'schema: school.course/v2\nwork: atlas\ntitle: Atlas\nsubject: civilization\ncategory: course\nmedium: paper\nstructure: { shape: modules, module: region, items: { from: units, order: sequence } }\ngrading: { gate: omr, scope: item, pass_percent: 80, exit: Done }\nsource: { title: Atlas of the United States }\n');
  fs.writeFileSync(path.join(lesson, '_index.yml'), 'schema: school.unit/v1\nunitId: maine\ntitle: Maine\nsubject: civilization\ncourseId: atlas\nsequence: 1\ngrades: [lower, upper]\nobjectives: [Learn Maine]\nbank: civilization/atlas/maine/worksheet\npassing: { percent: 80 }\n');
  fs.writeFileSync(path.join(lesson, 'worksheet.yml'), 'schema: school.question-bank/v2\nid: civilization/atlas/maine/worksheet\ntitle: Maine worksheet\nitems: []\n');
  fs.writeFileSync(path.join(lesson, 'flashcards.yml'), 'schema: school.question-bank/v2\nid: civilization/atlas/maine/flashcards\ntitle: Maine flashcards\nitems: []\n');
  return { getDataDir: () => root };
};

const compactFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-v2-')); roots.push(root);
  const shelf = path.join(root, 'content/school/civilization/atlas');
  fs.mkdirSync(shelf, { recursive: true });
  fs.writeFileSync(path.join(shelf, '_index.yml'), 'schema: school.course/v2\nwork: atlas\ntitle: Atlas\nsubject: civilization\ncategory: course\nmedium: paper\nstructure: { shape: modules, module: region, items: { from: units, order: sequence } }\ngrading: { gate: omr, scope: item, pass_percent: 80, exit: Done }\nsource: { title: Atlas of the United States }\n');
  fs.writeFileSync(path.join(shelf, 'maine.yml'), 'schema: school.question-bank/v2\nid: civilization/atlas/maine/worksheet\ntitle: Maine worksheet\nlesson:\n  schema: school.unit/v1\n  unitId: maine\n  title: Maine\n  subject: civilization\n  courseId: atlas\n  sequence: 1\n  grades: [lower, upper]\n  objectives: [Learn Maine]\n  bank: civilization/atlas/maine/worksheet\n  passing: { percent: 80 }\n  provenance: { source: Atlas, reviewState: approved }\nitems:\n  - { id: q1, type: multiple_choice, prompt: Which state?, answer: Maine, decoys: [Texas, Ohio, Utah, Idaho] }\n');
  return { getDataDir: () => root };
};

const declaredIdFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-v2-')); roots.push(root);
  const shelf = path.join(root, 'content/school/civilization/atlas');
  fs.mkdirSync(path.join(shelf, 'regions'), { recursive: true });
  fs.writeFileSync(path.join(shelf, '_index.yml'), 'schema: school.course/v2\nwork: atlas\ntitle: Atlas\nsubject: civilization\ncategory: course\nmedium: paper\nstructure: { shape: modules, module: region, items: { from: units, order: sequence } }\ngrading: { gate: omr, scope: item, pass_percent: 80, exit: Done }\n');
  fs.writeFileSync(path.join(shelf, 'regions', 'maine.yml'), 'schema: school.question-bank/v2\nid: civilization/atlas/maine/worksheet\ntitle: Maine worksheet\nlesson:\n  schema: school.unit/v1\n  unitId: northeastern-maine\n  title: Maine\n  subject: civilization\n  courseId: atlas\n  sequence: 1\n  objectives: [Learn Maine]\n  bank: civilization/atlas/maine/worksheet\n  provenance: { source: Atlas, reviewState: approved }\nitems: []\n');
  return { getDataDir: () => root };
};

const courseManifestFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-v2-')); roots.push(root);
  const shelf = path.join(root, 'content/school/civilization/atlas');
  fs.mkdirSync(shelf, { recursive: true });
  fs.writeFileSync(path.join(shelf, 'course.yml'), 'schema: school.course/v2\nwork: atlas\ntitle: Atlas\nsubject: civilization\ncategory: course\nmedium: paper\nstructure: { shape: modules, module: region, items: { from: units, order: sequence } }\ngrading: { gate: omr, scope: item, pass_percent: 80, exit: Done }\n');
  fs.writeFileSync(path.join(shelf, 'maine.yml'), 'schema: school.question-bank/v2\nid: civilization/atlas/maine/worksheet\ntitle: Maine worksheet\nlesson:\n  schema: school.unit/v1\n  unitId: maine\n  title: Maine\n  subject: civilization\n  courseId: atlas\n  sequence: 1\n  grades: [lower, upper]\n  objectives: [Learn Maine]\n  bank: civilization/atlas/maine/worksheet\n  passing: { percent: 80 }\n  provenance: { reviewState: approved }\nitems:\n  - { id: q1, type: multiple_choice, prompt: Which state?, answer: Maine, decoys: [Texas, Ohio, Utah, Idaho] }\n');
  return { getDataDir: () => root };
};

afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('school.course/v2 package discovery', () => {
  it('ignores a package left under the retired curriculum/ nesting', async () => {
    const configService = fixture('curriculum');
    const curriculum = new YamlCurriculumDatastore({ configService });
    const school = new YamlSchoolDatastore({ configService });
    expect((await curriculum.listWorks()).items).toEqual([]);
    expect((await curriculum.listUnits()).items).toEqual([]);
    expect(school.listBankIds()).toEqual([]);
  });

  // The reorganization moves every course from curriculum/<subject>/<work> to
  // <subject>/<work>. Work ids are built from the shelf and the directory name
  // and bank ids carry no directory prefix, so BOTH must come out byte-identical
  // to the assertions in the test above — that is what makes the move safe for
  // assignments/<learner>.yml and for attempt history.
  it('discovers a course package on the subject shelf itself, with identical work and bank ids', async () => {
    const configService = fixture('root');
    const curriculum = new YamlCurriculumDatastore({ configService });
    const school = new YamlSchoolDatastore({ configService });
    expect((await curriculum.listWorks()).items.map((entry) => [entry.id, entry.work]))
      .toEqual([['civilization/atlas', 'atlas']]);
    expect((await curriculum.listUnits()).items.map((entry) => entry.id)).toEqual(['maine']);
    expect(await curriculum.getUnit('maine')).toMatchObject({ unitId: 'maine', sourceTitle: 'Atlas of the United States' });
    expect(school.listBankIds()).toEqual(['civilization/atlas/maine/flashcards', 'civilization/atlas/maine/worksheet']);
    expect(school.readBankRaw('civilization/atlas/maine/worksheet')).toMatchObject({ title: 'Maine worksheet' });
  });

  it('discovers a compact one-file lesson without units/ or lessons/ wrappers', async () => {
    const configService = compactFixture();
    const curriculum = new YamlCurriculumDatastore({ configService });
    const school = new YamlSchoolDatastore({ configService });
    expect((await curriculum.listUnits()).items.map((entry) => entry.id)).toEqual(['maine']);
    expect(await curriculum.getUnit('maine')).toMatchObject({ unitId: 'maine', bank: 'civilization/atlas/maine/worksheet' });
    expect(school.listBankIds()).toEqual(['civilization/atlas/maine/worksheet']);
    expect(school.readBankRaw('civilization/atlas/maine/worksheet')).toMatchObject({ lesson: { unitId: 'maine' } });
  });

  it('projects the course print citation through validation into a compact lesson', async () => {
    const catalog = new YamlCurriculumDatastore({ configService: compactFixture() });
    const curriculum = new CurriculumAccess({
      catalog,
      bankIds: () => ['civilization/atlas/maine/worksheet'],
    });
    await expect(curriculum.getUnit('maine')).resolves.toMatchObject({
      title: 'Maine', sourceTitle: 'Atlas of the United States',
    });
  });

  it('uses a compact lesson’s declared unitId rather than its nested filename', async () => {
    const curriculum = new YamlCurriculumDatastore({ configService: declaredIdFixture() });
    expect((await curriculum.listUnits()).items.map((entry) => entry.id)).toEqual(['northeastern-maine']);
    expect(await curriculum.getUnit('northeastern-maine')).toMatchObject({ unitId: 'northeastern-maine' });
  });

  it('continues to recognize an older course.yml manifest during migration', async () => {
    const configService = courseManifestFixture();
    const curriculum = new YamlCurriculumDatastore({ configService });
    const school = new YamlSchoolDatastore({ configService });
    expect((await curriculum.listWorks()).items).toHaveLength(1);
    expect((await curriculum.listUnits()).items.map((entry) => entry.id)).toEqual(['maine']);
    expect(school.listBankIds()).toEqual(['civilization/atlas/maine/worksheet']);
  });
});
