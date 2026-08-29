/** Persist an intentionally session-independent debug audio capture. */
export class SaveDebugVoiceMemo {
  constructor({ debugAudioStore, logger = console } = {}) {
    this.debugAudioStore = debugAudioStore;
    this.logger = logger;
  }

  async execute(audioBytes) {
    const saved = await this.debugAudioStore.save(audioBytes);
    this.logger.debug?.('fitness.debug_voice_memo.saved', {
      filename: saved.filename,
      size: saved.size,
    });
    return saved;
  }
}

export default SaveDebugVoiceMemo;
