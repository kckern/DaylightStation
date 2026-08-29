import { describe, expect, it, vi } from 'vitest';
import { LanguageAudioResource } from '#apps/school/LanguageAudioResource.mjs';

describe('LanguageAudioResource', () => {
  it('requires both application dependencies', () => {
    expect(() => new LanguageAudioResource()).toThrow('languageAudioRepository');
    expect(() => new LanguageAudioResource({ languageAudioRepository: {} }))
      .toThrow('languageStudyService');
  });

  it('delegates prompt lookup without exposing a storage locator', async () => {
    const result = { kind: 'not-found' };
    const languageAudioRepository = {
      findPromptAudio: vi.fn().mockResolvedValue(result),
    };
    const operation = new LanguageAudioResource({
      languageAudioRepository,
      languageStudyService: { getCorpusTargetLanguage: vi.fn() },
    });

    await expect(operation.getPromptAudio({ corpusId: 'korean', seq: '7', language: 'KR' }))
      .resolves.toBe(result);
    expect(languageAudioRepository.findPromptAudio).toHaveBeenCalledWith({
      corpusId: 'korean', seq: '7', language: 'KR',
    });
  });

  it('resolves the corpus target language and preserves recording extension order', async () => {
    const result = { kind: 'not-found' };
    const languageAudioRepository = {
      findRecordingAudio: vi.fn().mockResolvedValue(result),
    };
    const languageStudyService = {
      getCorpusTargetLanguage: vi.fn().mockReturnValue('KR'),
    };
    const operation = new LanguageAudioResource({
      languageAudioRepository,
      languageStudyService,
    });

    await expect(operation.getRecordingAudio({
      corpusId: 'korean', userId: 'learner3', seq: '7',
    })).resolves.toBe(result);
    expect(languageStudyService.getCorpusTargetLanguage).toHaveBeenCalledWith('korean');
    expect(languageAudioRepository.findRecordingAudio).toHaveBeenCalledWith({
      corpusId: 'korean',
      userId: 'learner3',
      seq: '7',
      language: 'KR',
      extensions: ['webm', 'mp3', 'ogg', 'm4a', 'wav'],
    });
  });
});
