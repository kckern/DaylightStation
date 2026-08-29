/**
 * Update the persisted watch state for a content item.
 *
 * The progress namespace returned by a content source is deliberately opaque:
 * it identifies a logical watch-state partition, not a filesystem location.
 */
export class UpdateContentProgress {
  constructor({ contentCatalog, mediaProgressMemory = null, nowTimestamp }) {
    this.contentCatalog = contentCatalog;
    this.mediaProgressMemory = mediaProgressMemory;
    this.nowTimestamp = nowTimestamp;
  }

  isConfigured() {
    return Boolean(this.mediaProgressMemory);
  }

  async execute({ source, localId, seconds, duration }) {
    const resolved = this.contentCatalog.resolveSource(source, localId);
    if (!resolved) return null;
    const resolvedLocalId = resolved.localId;

    const contentId = `${source}:${resolvedLocalId}`;
    const progressNamespace = await this.contentCatalog.progressNamespace(resolved, resolvedLocalId);
    const existing = await this.mediaProgressMemory.findProgress(contentId, progressNamespace);
    const state = createMediaProgressDTO({
      contentId,
      playhead: seconds,
      duration,
      playCount: (existing?.playCount || 0) + (seconds === 0 ? 1 : 0),
      lastPlayed: this.nowTimestamp(),
      watchTime: (existing?.watchTime || 0) + Math.max(0, seconds - (existing?.playhead || 0)),
    });

    await this.mediaProgressMemory.saveProgress(state, progressNamespace);

    return {
      contentId,
      playhead: state.playhead,
      duration: state.duration,
      percent: state.percent,
      watched: isWatched(state),
    };
  }
}

function createMediaProgressDTO(props) {
  const { contentId, playhead = 0, duration = 0, playCount = 0, lastPlayed = null, watchTime = 0 } = props;
  const percent = duration > 0 ? Math.round((playhead / duration) * 100) : 0;
  return {
    contentId,
    playhead,
    duration,
    percent,
    playCount,
    lastPlayed,
    watchTime,
    toJSON() {
      return {
        contentId: this.contentId,
        playhead: this.playhead,
        duration: this.duration,
        percent: this.percent,
        playCount: this.playCount,
        lastPlayed: this.lastPlayed,
        watchTime: this.watchTime,
      };
    },
  };
}

function isWatched(state) {
  if (!state || !state.duration) return false;
  const percent = state.percent ?? (state.playhead && state.duration > 0
    ? Math.round((state.playhead / state.duration) * 100)
    : 0);
  return percent >= 90;
}

export default UpdateContentProgress;
