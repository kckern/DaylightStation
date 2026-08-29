import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlExerciseBank } from './YamlExerciseBank.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('YamlExerciseBank', () => {
  it('walks visible nested categories and resolves path-based seed ids', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'exercise-bank-'));
    roots.push(root);
    const music = path.join(root, 'music');
    await fs.mkdir(path.join(music, 'chords', 'triads'), { recursive: true });
    await fs.mkdir(path.join(music, '_archive'), { recursive: true });
    await fs.writeFile(path.join(music, 'index.yml'), 'title: Music\n');
    await fs.writeFile(path.join(music, 'chords', 'index.yml'), 'title: Chords\n');
    await fs.writeFile(path.join(music, 'chords', 'triads', 'c-major.yml'), 'id: c-major\n');

    const bank = new YamlExerciseBank({ contentDir: root });
    expect(bank.available()).toBe(true);
    expect(bank.listCategories()).toEqual(['chords', 'chords/triads']);
    expect(bank.listSeeds('chords/triads')).toEqual(['chords/triads/c-major']);
    expect(bank.getSeed('chords/triads/c-major')).toEqual({ id: 'c-major' });
    expect(bank.getSeed('../escape')).toBeNull();
  });
});
