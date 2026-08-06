import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContentTreeManifest } from './ContentTreeManifest.mjs';

let root;
const silentEvents = [];
const logger = { info: (...a) => silentEvents.push(a) };

beforeEach(() => {
  silentEvents.length = 0;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'school-manifest-'));
  fs.mkdirSync(path.join(root, 'content', 'history', 'us-capitals', 'quizzes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'content', 'history', 'us-capitals', 'work.yml'), 'work: us-capitals\n');
  fs.writeFileSync(path.join(root, 'content', 'history', 'us-capitals', 'quizzes', 'caps.yml'), 'id: caps\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const make = () => new ContentTreeManifest({
  contentDir: path.join(root, 'content'),
  manifestFile: path.join(root, 'household', 'apps', 'school', 'content-manifest.yml'),
  logger,
});

describe('ContentTreeManifest (admin advocacy #20 — drift gets a diff)', () => {
  it('first run persists the manifest and reports firstRun with no diff noise', () => {
    const diff = make().run({ now: () => new Date('2026-08-06T03:50:00Z') });
    expect(diff).toEqual({ firstRun: true, added: [], removed: [], changed: [] });
    expect(fs.existsSync(path.join(root, 'household', 'apps', 'school', 'content-manifest.yml'))).toBe(true);
    expect(silentEvents).toEqual([]); // no drift log on first run
  });

  it('a later run names exactly what was added, removed, and changed', () => {
    const m = make();
    m.run({ now: () => new Date('2026-08-06T03:50:00Z') });
    fs.writeFileSync(path.join(root, 'content', 'history', 'us-capitals', 'quizzes', 'caps.yml'), 'id: caps\nanswer: fixed\n');
    fs.writeFileSync(path.join(root, 'content', 'history', 'us-capitals', 'quizzes', 'new-quiz.yml'), 'id: new\n');
    fs.unlinkSync(path.join(root, 'content', 'history', 'us-capitals', 'work.yml'));
    const diff = m.run({ now: () => new Date('2026-08-07T03:50:00Z') });
    expect(diff.firstRun).toBe(false);
    expect(diff.changed).toEqual([path.join('history', 'us-capitals', 'quizzes', 'caps.yml')]);
    expect(diff.added).toEqual([path.join('history', 'us-capitals', 'quizzes', 'new-quiz.yml')]);
    expect(diff.removed).toEqual([path.join('history', 'us-capitals', 'work.yml')]);
    expect(silentEvents[0][0]).toBe('school.content.drift');
  });

  it('a missing content dir yields an empty manifest, never a crash', () => {
    const m = new ContentTreeManifest({
      contentDir: path.join(root, 'nope'),
      manifestFile: path.join(root, 'household', 'apps', 'school', 'content-manifest.yml'),
      logger,
    });
    expect(m.run().firstRun).toBe(true);
  });
});
