/** Owns transport topic names for playback-domain publications. */
export class PlaybackPublications {
  #bus;
  constructor({ eventBus } = {}) { this.#bus = eventBus; }
  progressRecorded(payload) { return this.#bus?.publish?.('playback.log', payload); }
  pianoLessonCompleted(payload) { return this.#bus?.publish?.('piano.lesson.completed', payload); }
}

export default PlaybackPublications;
