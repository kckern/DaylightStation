import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FilesystemMenuMusicCatalog } from '#adapters/fitness/FilesystemMenuMusicCatalog.mjs';
import { IMenuMusicCatalog } from '#apps/fitness/ports/IMenuMusicCatalog.mjs';

const roots = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

test('lists supported tracks deterministically as public media resources', () => {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-music-'));
  roots.push(mediaDir);
  const musicDir = path.join(mediaDir, 'fitness', 'ux', 'menus');
  fs.mkdirSync(musicDir, { recursive: true });
  for (const name of ['z.ogg', 'ignore.txt', 'A.MP3', 'middle.m4a', 'voice.wav']) {
    fs.writeFileSync(path.join(musicDir, name), name);
  }
  const catalog = new FilesystemMenuMusicCatalog({ mediaDir });
  assert.ok(catalog instanceof IMenuMusicCatalog);
  assert.deepEqual(catalog.listTracks(), [
    'media/fitness/ux/menus/A.MP3',
    'media/fitness/ux/menus/middle.m4a',
    'media/fitness/ux/menus/voice.wav',
    'media/fitness/ux/menus/z.ogg',
  ]);
});

test('missing directory is an empty catalog with an actionable warning', () => {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-music-'));
  roots.push(mediaDir);
  const warnings = [];
  const catalog = new FilesystemMenuMusicCatalog({ mediaDir, logger: { warn: (...args) => warnings.push(args) } });
  assert.deepEqual(catalog.listTracks(), []);
  assert.equal(warnings[0][0], 'fitness.menu_music.dir_unreadable');
  assert.match(warnings[0][1].musicDir, /fitness[/\\]ux[/\\]menus$/);
});
