import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dump } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import {
  formatSchoolCalcPublicationReport,
  main,
  resolveSchoolCalcContentPaths,
  runSchoolCalcPublicationValidation,
} from './schoolcalc-catalog.cli.mjs';

describe('schoolcalc-catalog CLI', () => {
  it('resolves default and explicit mounted-content paths without a household graph', () => {
    expect(resolveSchoolCalcContentPaths({
      flags: {
        'content-root': 'published/calc',
        'catalog-directories': 'packs/one,/external/two',
      },
      env: { DAYLIGHT_BASE_PATH: '/srv/daylight' },
    })).toEqual({
      dataDir: '/srv/daylight/data',
      contentRoot: '/srv/daylight/data/published/calc',
      catalogDirectories: ['/srv/daylight/data/packs/one', '/external/two'],
      documentDirectories: ['/srv/daylight/data/published/calc/documents'],
      bankDirectories: ['/srv/daylight/data/published/calc/question-banks'],
    });
  });

  it('formats promotion failures by stable Catalog and lesson identity', () => {
    const text = formatSchoolCalcPublicationReport({
      ok: false,
      capabilities: ['quiz@1'],
      summary: {
        catalogs: 1, validCatalogs: 1, lessons: 2, validLessons: 1, modules: 3, resolvedModules: 2,
      },
      catalogErrors: {},
      lessonErrors: { 'main/subject/course/unit/lesson': ['bank not found'] },
    }, { contentRoot: '/data/content/school/learning-catalog' });

    expect(text).toContain('lessons   2 (1 valid)');
    expect(text).toContain('main/subject/course/unit/lesson');
    expect(text).toContain('FAILED — School Catalog is not promotable');
  });

  it('rejects unknown or valueless options as usage errors before touching mounts', async () => {
    const io = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
    await expect(main(['validate', '--wat'], io)).resolves.toBe(2);
    await expect(main(['validate', '--data-dir'], io)).resolves.toBe(2);
    expect(io.stderr.write).toHaveBeenCalledWith('Unknown option: --wat\n');
    expect(io.stderr.write).toHaveBeenCalledWith('ERROR: --data-dir needs a path\n');
  });

  it('walks real mounted YAML and fails when a referenced bank is absent', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'schoolcalc-publication-'));
    const paths = {
      catalogDirectories: [path.join(root, 'catalogs')],
      documentDirectories: [path.join(root, 'documents')],
      bankDirectories: [path.join(root, 'question-banks')],
    };
    await Promise.all(Object.values(paths).flat().map((directory) => mkdir(directory, { recursive: true })));
    const catalog = {
      schema: 'school.catalog/v1', catalogId: 'main', title: 'Main',
      subjects: [{
        subjectId: 'general', title: 'General', courses: [{
          courseId: 'foundations', title: 'Foundations', units: [{
            unitId: 'first', title: 'First', lessons: [{
              lessonId: 'welcome', title: 'Welcome', modules: [
                { moduleId: 'notes', type: 'lecture_notes', documentId: 'welcome-notes' },
                { moduleId: 'check', type: 'quiz', bankId: 'general:welcome-check' },
              ],
            }],
          }],
        }],
      }],
    };
    const document = {
      schema: 'school.learning-document/v1', documentId: 'welcome-notes', title: 'Welcome',
      blocks: [{ blockId: 'intro', type: 'prose', text: 'Welcome to the course.' }],
    };
    const bank = {
      id: 'general:welcome-check', title: 'Welcome check', audience: 'assigned',
      items: [{
        id: 'q1', type: 'multiple_choice', prompt: 'Ready?', choices: ['Yes', 'No'], answer: 'Yes',
      }],
    };

    try {
      await Promise.all([
        writeFile(path.join(paths.catalogDirectories[0], 'main.yml'), dump(catalog)),
        writeFile(path.join(paths.documentDirectories[0], 'welcome.yml'), dump(document)),
        writeFile(path.join(paths.bankDirectories[0], 'welcome.yml'), dump(bank)),
      ]);
      await expect(runSchoolCalcPublicationValidation(paths)).resolves.toMatchObject({
        ok: true,
        summary: { catalogs: 1, validCatalogs: 1, lessons: 1, validLessons: 1, modules: 2 },
      });

      await rm(path.join(paths.bankDirectories[0], 'welcome.yml'));
      const failed = await runSchoolCalcPublicationValidation(paths);
      expect(failed.ok).toBe(false);
      expect(failed.lessonErrors['main/general/foundations/first/welcome'][0])
        .toMatch(/question bank 'general:welcome-check' was not found/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
