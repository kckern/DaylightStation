/**
 * Media lookup port for Sentence Ladder prompt audio and learner recordings.
 * Implementations return opaque resources; callers never observe file paths.
 */
export class ILanguageAudioRepository {
  async findPromptAudio(_query) {
    throw new Error('ILanguageAudioRepository.findPromptAudio not implemented');
  }

  async findRecordingAudio(_query) {
    throw new Error('ILanguageAudioRepository.findRecordingAudio not implemented');
  }
}

export default ILanguageAudioRepository;
