import { describe, expect, it, vi } from 'vitest';
import { LanguageAudioResource } from './LanguageAudioResource.mjs';

const service = { getCorpusTargetLanguage: () => 'KR' };
const repo = () => ({
  findPromptAudio: vi.fn(), findRecordingAudio: vi.fn(),
  findCueAudio: vi.fn().mockResolvedValue({ kind: 'found', resource: {} }),
});

describe('LanguageAudioResource cues', () => {
  it('lists only the cues the household configured a file for', () => {
    const resource = new LanguageAudioResource({
      languageAudioRepository: repo(), languageStudyService: service,
      cues: { record: 'ding.mp3', done: '', bogus: null },
    });
    expect(resource.listCues()).toEqual(['record']);
  });

  it('resolves a role to its configured file and never guesses one', async () => {
    const languageAudioRepository = repo();
    const resource = new LanguageAudioResource({
      languageAudioRepository, languageStudyService: service, cues: { record: 'ding.mp3' },
    });
    expect((await resource.getCueAudio({ name: 'record' })).kind).toBe('found');
    expect(languageAudioRepository.findCueAudio).toHaveBeenCalledWith({ fileName: 'ding.mp3' });
    expect(await resource.getCueAudio({ name: 'done' })).toEqual({ kind: 'not-found' });
    expect(languageAudioRepository.findCueAudio).toHaveBeenCalledTimes(1);
  });

  it('is silent with no cue block at all', () => {
    const resource = new LanguageAudioResource({ languageAudioRepository: repo(), languageStudyService: service });
    expect(resource.listCues()).toEqual([]);
  });
});
