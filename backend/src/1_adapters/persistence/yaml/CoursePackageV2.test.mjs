import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlCurriculumDatastore } from './YamlCurriculumDatastore.mjs';
import { YamlSchoolDatastore } from './YamlSchoolDatastore.mjs';

const roots = [];
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-v2-')); roots.push(root);
  const lesson = path.join(root, 'content/school/curriculum/civilization/atlas/units/10-northeast/lessons/maine');
  fs.mkdirSync(lesson, { recursive: true });
  fs.writeFileSync(path.join(root, 'content/school/curriculum/civilization/atlas/index.yml'), 'schema: school.course/v2\nwork: atlas\ntitle: Atlas\nsubject: civilization\ncategory: course\nmedium: paper\nstructure: { shape: modules, module: region, items: { from: units, order: sequence } }\ngrading: { gate: omr, scope: item, pass_percent: 80, exit: Done }\n');
  fs.writeFileSync(path.join(lesson, 'index.yml'), 'schema: school.unit/v1\nunitId: maine\ntitle: Maine\nsubject: civilization\ncourseId: atlas\nsequence: 1\ngrades: [lower, upper]\nobjectives: [Learn Maine]\nbank: civilization/atlas/maine/worksheet\npassing: { percent: 80 }\n');
  fs.writeFileSync(path.join(lesson, 'worksheet.yml'), 'schema: school.question-bank/v2\nid: civilization/atlas/maine/worksheet\ntitle: Maine worksheet\nitems: []\n');
  fs.writeFileSync(path.join(lesson, 'flashcards.yml'), 'schema: school.question-bank/v2\nid: civilization/atlas/maine/flashcards\ntitle: Maine flashcards\nitems: []\n');
  return { getDataDir: () => root };
};

afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('school.course/v2 package discovery', () => {
  it('projects lesson indexes as units and discovers arbitrary typed YAML artifacts', async () => {
    const configService = fixture();
    const curriculum = new YamlCurriculumDatastore({ configService });
    const school = new YamlSchoolDatastore({ configService });
    expect((await curriculum.listWorks()).items[0].raw.schema).toBe('school.course/v2');
    expect((await curriculum.listUnits()).items.map((entry) => entry.id)).toEqual(['maine']);
    expect(await curriculum.getUnit('maine')).toMatchObject({ unitId: 'maine' });
    expect(school.listBankIds()).toEqual(['civilization/atlas/maine/flashcards', 'civilization/atlas/maine/worksheet']);
    expect(school.readBankRaw('civilization/atlas/maine/worksheet')).toMatchObject({ title: 'Maine worksheet' });
  });
});
