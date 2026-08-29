import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FilesystemLanguageAudioRepository } from '#adapters/media/FilesystemLanguageAudioRepository.mjs';
import { ILanguageAudioRepository } from '#apps/school/ports/ILanguageAudioRepository.mjs';

async function readResource(resource) {
  const chunks = [];
  for await (const chunk of resource.open()) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe('FilesystemLanguageAudioRepository', () => {
  let mediaDir;

  afterEach(() => {
    if (mediaDir) rmSync(mediaDir, { recursive: true, force: true });
    mediaDir = null;
  });

  function repository(userExists = () => true) {
    mediaDir = mkdtempSync(path.join(tmpdir(), 'language-audio-'));
    return new FilesystemLanguageAudioRepository({ mediaDir, userExists });
  }

  it('extends its application port and returns an opaque prompt resource', async () => {
    const repo = repository();
    const directory = path.join(mediaDir, 'school', 'language', 'korean');
    mkdirSync(directory, { recursive: true });
    const bytes = Buffer.from('prompt');
    writeFileSync(path.join(directory, '0007-KR.mp3'), bytes);

    const result = await repo.findPromptAudio({ corpusId: 'korean', seq: 7, language: 'kr' });

    expect(repo).toBeInstanceOf(ILanguageAudioRepository);
    expect(result.kind).toBe('found');
    expect(result.resource).toMatchObject({ size: bytes.length, contentType: 'audio/mpeg' });
    expect(result.resource).not.toHaveProperty('path');
    expect(await readResource(result.resource)).toEqual(bytes);
  });

  it('selects the first existing recording in the supplied extension order', async () => {
    const repo = repository((userId) => userId === 'learner3');
    const directory = path.join(
      mediaDir, 'school', 'language', 'korean', 'recordings', 'learner3',
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, '0007-KR.ogg'), Buffer.from('ogg'));
    writeFileSync(path.join(directory, '0007-KR.mp3'), Buffer.from('mp3'));

    const result = await repo.findRecordingAudio({
      corpusId: 'korean',
      userId: 'learner3',
      seq: 7,
      language: 'KR',
      extensions: ['webm', 'mp3', 'ogg', 'm4a', 'wav'],
    });

    expect(result.kind).toBe('found');
    expect(result.resource.contentType).toBe('audio/mpeg');
    expect(await readResource(result.resource)).toEqual(Buffer.from('mp3'));
  });

  it('returns not-found for unknown users and invalid media addresses', async () => {
    const repo = repository(() => false);

    await expect(repo.findPromptAudio({ corpusId: '../escape', seq: 7, language: 'KR' }))
      .resolves.toEqual({ kind: 'not-found' });
    await expect(repo.findRecordingAudio({
      corpusId: 'korean', userId: 'unknown', seq: 7, language: 'KR', extensions: ['webm'],
    })).resolves.toEqual({ kind: 'not-found' });
  });
});
