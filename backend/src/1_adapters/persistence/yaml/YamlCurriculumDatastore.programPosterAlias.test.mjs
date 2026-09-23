import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlCurriculumDatastore } from './YamlCurriculumDatastore.mjs';

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });
const JPEG = (tag) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(tag)]);

function datastore(files) {
  const media = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-alias-')); roots.push(media);
  for (const [rel, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(media, rel)), { recursive: true });
    fs.writeFileSync(path.join(media, rel), bytes);
  }
  return new YamlCurriculumDatastore({ configService: { getMediaDir: () => media, getDataDir: () => media } });
}

describe('getProgramPoster — the card ladder finds artwork filed under word-ladder', () => {
  it('falls back to programs/word-ladder/<package> when card-ladder has none', async () => {
    const store = datastore({ 'school/programs/word-ladder/korean-vocab/poster.jpg': JPEG('old') });
    expect((await store.getProgramPoster('card-ladder', 'korean-vocab')).toString('latin1')).toContain('old');
  });
  it('prefers the canonical directory when both exist', async () => {
    const store = datastore({
      'school/programs/word-ladder/korean-vocab/poster.jpg': JPEG('old'),
      'school/programs/card-ladder/korean-vocab/poster.jpg': JPEG('new'),
    });
    expect((await store.getProgramPoster('card-ladder', 'korean-vocab')).toString('latin1')).toContain('new');
  });
  it('still answers null when neither has a poster, and never aliases other programs', async () => {
    const store = datastore({ 'school/programs/word-ladder/poster.jpg': JPEG('old') });
    expect(await store.getProgramPoster('card-ladder', 'korean-vocab')).toBeNull();
    expect(await store.getProgramPoster('book-log')).toBeNull();
  });
});
