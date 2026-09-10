const RECORDING_EXTENSIONS = Object.freeze(['webm', 'mp3', 'ogg', 'm4a', 'wav']);

/** Endpoint-shaped application operation for Sentence Ladder audio resources. */
export class LanguageAudioResource {
  /** @type {import('./ports/ILanguageAudioRepository.mjs').ILanguageAudioRepository} */
  #repository;
  #languageStudyService;
  /** cue name → configured file name. Unset means silent, never a guessed file. */
  #cues;

  constructor({ languageAudioRepository, languageStudyService, cues = {} } = {}) {
    if (!languageAudioRepository) {
      throw new Error('LanguageAudioResource requires languageAudioRepository');
    }
    if (!languageStudyService?.getCorpusTargetLanguage) {
      throw new Error('LanguageAudioResource requires languageStudyService');
    }
    this.#repository = languageAudioRepository;
    this.#languageStudyService = languageStudyService;
    this.#cues = Object.freeze(Object.fromEntries(
      Object.entries(cues || {}).filter(([, file]) => typeof file === 'string' && file.trim()),
    ));
  }

  /**
   * The cues a client may ask for, by role — `record` is the ding that tells
   * the learner to start speaking. A role is listed only when the household
   * configured a file for it, so the client can leave an unconfigured cue out
   * of its sequence instead of fetching a 404 on every sentence.
   */
  listCues() {
    return Object.keys(this.#cues);
  }

  async getCueAudio({ name }) {
    const fileName = this.#cues[name];
    if (!fileName) return { kind: 'not-found' };
    return this.#repository.findCueAudio({ fileName });
  }

  async getPromptAudio({ corpusId, seq, language }) {
    return this.#repository.findPromptAudio({ corpusId, seq, language });
  }

  async getRecordingAudio({ corpusId, userId, seq }) {
    const language = this.#languageStudyService.getCorpusTargetLanguage(corpusId);
    return this.#repository.findRecordingAudio({
      corpusId,
      userId,
      seq,
      language,
      extensions: RECORDING_EXTENSIONS,
    });
  }
}

export default LanguageAudioResource;
