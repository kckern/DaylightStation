import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemLanguageAudioRepository } from './FilesystemLanguageAudioRepository.mjs';

let mediaDir;
beforeAll(() => {
  mediaDir = mkdtempSync(join(tmpdir(), 'ladder-cues-'));
  mkdirSync(join(mediaDir, 'school', '_ux'), { recursive: true });
  writeFileSync(join(mediaDir, 'school', '_ux', 'ding.mp3'), 'ding');
  writeFileSync(join(mediaDir, 'secret.mp3'), 'no');
});
afterAll(() => rmSync(mediaDir, { recursive: true, force: true }));

const repo = () => new FilesystemLanguageAudioRepository({ mediaDir, userExists: () => true });

describe('FilesystemLanguageAudioRepository cues', () => {
  it('finds a configured cue under school/_ux with its content type', async () => {
    const result = await repo().findCueAudio({ fileName: 'ding.mp3' });
    expect(result.kind).toBe('found');
    expect(result.resource.contentType).toBe('audio/mpeg');
    expect(result.resource.size).toBe(4);
  });

  it('refuses anything that is not a bare audio file name', async () => {
    for (const fileName of ['../secret.mp3', 'a/b.mp3', 'ding', 'ding.exe', '', undefined]) {
      expect((await repo().findCueAudio({ fileName })).kind).toBe('not-found');
    }
  });
});
