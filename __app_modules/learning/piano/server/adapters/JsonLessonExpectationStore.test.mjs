import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

  it('reads the measured seed', () => {
    fs.writeFileSync(path.join(dir, '_measured.json'), JSON.stringify([{ show: 'S', season: 1, episode: 2, n: 2, minNpm: 9 }]));
    const s = new JsonLessonExpectationStore({ dir, logger: logger() });
    expect(s.readMeasuredSeed()).toHaveLength(1);
    expect(s.get('x')).toBeNull();
  });

  it('dir helper', () => {
    expect(lessonExpectationDirFor('/d')).toBe(path.join('/d', 'content', 'piano', 'lesson-expectations'));
  });
});
