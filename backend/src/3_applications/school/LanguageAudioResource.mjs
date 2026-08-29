const RECORDING_EXTENSIONS = Object.freeze(['webm', 'mp3', 'ogg', 'm4a', 'wav']);

/** Endpoint-shaped application operation for Sentence Ladder audio resources. */
export class LanguageAudioResource {
  /** @type {import('./ports/ILanguageAudioRepository.mjs').ILanguageAudioRepository} */
  #repository;
  #languageStudyService;

  constructor({ languageAudioRepository, languageStudyService } = {}) {
    if (!languageAudioRepository) {
      throw new Error('LanguageAudioResource requires languageAudioRepository');
    }
    if (!languageStudyService?.getCorpusTargetLanguage) {
      throw new Error('LanguageAudioResource requires languageStudyService');
    }
    this.#repository = languageAudioRepository;
    this.#languageStudyService = languageStudyService;
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
