import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('#system/utils/FileIO.mjs', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, listFiles: vi.fn(orig.listFiles) };
});
import { listFiles } from '#system/utils/FileIO.mjs';
import { JsonLessonExpectationStore, lessonExpectationDirFor } from './JsonLessonExpectationStore.mjs';

const logger = () => { const calls = []; return { calls, warn: (e, d) => calls.push([e, d]), info() {}, debug() {} }; };
const rec = (plexId, extra = {}) => ({ plexId, source: 'ai', targetNpm: 13, level: 2, ...extra });

describe('JsonLessonExpectationStore', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexp-')); });

  it('a missing dir resolves to null', () => {
    const s = new JsonLessonExpectationStore({ dir: path.join(dir, 'nope'), logger: logger() });
    expect(s.get('plex:1')).toBeNull();
    expect(s.readMeasuredSeed()).toEqual([]);
  });

  it('write-then-get round-trips; finds lessons across two show files by bare or prefixed id', () => {
    const s = new JsonLessonExpectationStore({ dir, logger: logger() });
    s.writeLesson({ key: '10', title: 'Show A' }, rec('101'));
    s.writeLesson({ key: '20', title: 'Show B' }, rec('plex:201', { targetNpm: 5, level: 1 }));
    expect(s.get('plex:101')).toMatchObject({ plexId: '101', targetNpm: 13, showKey: '10' });
    expect(s.get('201')).toMatchObject({ plexId: '201', targetNpm: 5, showKey: '20' });
    expect(s.readShow('10').lessons['101'].source).toBe('ai');
    expect(s.all()).toHaveLength(2);
  });

  it('skips a corrupt file with one warning while the others still resolve', () => {
    const lg = logger();
    const s = new JsonLessonExpectationStore({ dir, logger: lg });
    s.writeLesson({ key: '10', title: 'A' }, rec('101'));
    fs.writeFileSync(path.join(dir, '30.json'), '{ not json');
    expect(s.get('101')).toMatchObject({ plexId: '101' });
    expect(s.get('999')).toBeNull();
    expect(lg.calls.filter(([e]) => e === 'piano.lesson-expectation.unreadable')).toHaveLength(1);
  });

  it('writeLessons writes a show\'s records in one write', () => {
    const s = new JsonLessonExpectationStore({ dir, logger: logger() });
    s.writeLessons({ key: '10', title: 'A' }, [rec('101'), rec('102'), rec('103', { source: 'default', targetNpm: 0 })]);
    expect(s.all()).toHaveLength(3);
    expect(s.get('103').targetNpm).toBe(0);
  });

  it('reads the measured seed', () => {
    fs.writeFileSync(path.join(dir, '_measured.json'), JSON.stringify([{ show: 'S', season: 1, episode: 2, n: 2, minNpm: 9 }]));
    const s = new JsonLessonExpectationStore({ dir, logger: logger() });
    expect(s.readMeasuredSeed()).toHaveLength(1);
    expect(s.get('x')).toBeNull();
  });

  it('dir helper', () => {
    expect(lessonExpectationDirFor('/d')).toBe(path.join('/d', 'content', 'piano', 'lesson-expectations'));
  });

  describe('refresh window', () => {
    it('100 get() calls inside one window list the directory once', () => {
      let t = 1000;
      const s = new JsonLessonExpectationStore({ dir, logger: logger(), refreshMs: 5000, now: () => t });
      s.writeLesson({ key: '10', title: 'A' }, rec('101'));
      listFiles.mockClear();
      for (let i = 0; i < 100; i += 1) { t += 10; expect(s.get('101')).not.toBeNull(); }
      expect(listFiles).toHaveBeenCalledTimes(1);
    });

    it('an outside edit is seen once the window has passed, not before', () => {
      let t = 1000;
      const s = new JsonLessonExpectationStore({ dir, logger: logger(), refreshMs: 5000, now: () => t });
      s.writeLesson({ key: '10', title: 'A' }, rec('101'));
      expect(s.get('101').targetNpm).toBe(13);
      const file = path.join(dir, '10.json');
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      doc.lessons['101'].targetNpm = 7;
      fs.writeFileSync(file, JSON.stringify(doc));
      fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
      t += 1000;
      expect(s.get('101').targetNpm).toBe(13);
      t += 5000;
      expect(s.get('101').targetNpm).toBe(7);
    });

    it('the store sees its own writes immediately, inside the window', () => {
      let t = 1000;
      const s = new JsonLessonExpectationStore({ dir, logger: logger(), refreshMs: 5000, now: () => t });
      expect(s.get('301')).toBeNull();
      t += 10;
      s.writeLessons({ key: '30', title: 'C' }, [rec('301')]);
      expect(s.get('301')).toMatchObject({ plexId: '301', showKey: '30' });
    });
  });
});
