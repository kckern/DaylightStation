/**
 * Record a playback heartbeat and coordinate its application-level side effects.
 *
 * Content-source storage identifiers are opaque logical progress namespaces;
 * this use case never interprets them as filesystem paths.
 */
export class RecordPlaybackProgress {
  constructor({
    contentCatalog,
    mediaProgressMemory = null,
    progressSyncSources = new Set(),
    progressSyncService = null,
    playbackPublications = null,
    userVideoProgressStore = null,
    economyService = null,
    createMediaProgress = (props) => props,
    nowTimestamp,
    nowEpoch = () => Date.now(),
    nowIso = () => new Date().toISOString(),
    logger = console,
  }) {
    this.contentCatalog = contentCatalog;
    this.mediaProgressMemory = mediaProgressMemory;
    this.progressSyncSources = progressSyncSources;
    this.progressSyncService = progressSyncService;
    this.playbackPublications = playbackPublications;
    this.userVideoProgressStore = userVideoProgressStore;
    this.economyService = economyService;
    this.createMediaProgress = createMediaProgress;
    this.nowTimestamp = nowTimestamp;
    this.nowEpoch = nowEpoch;
    this.nowIso = nowIso;
    this.logger = logger;
  }

  async execute({ type, assetId, percent, seconds, title, watched_duration, listId, userId, engaged }) {
    let progressNamespace = type;
    let itemMetadata = null;
    const compoundId = assetId.includes(':') ? assetId : `${type}:${assetId}`;

    const resolved = this.contentCatalog.resolveSource(type, compoundId);
    if (resolved) {
      try {
        progressNamespace = await this.contentCatalog.progressNamespace(resolved, compoundId);
        const item = await this.contentCatalog.getItem(resolved, compoundId);
        itemMetadata = item?.metadata;
      } catch (error) {
        this.logger.warn?.('play.log.metadata_fetch_failed', { assetId, error: error.message });
      }
    }

    if (listId) {
      const namespace = await this.contentCatalog.listNamespace(listId);
      if (namespace) progressNamespace = namespace;
    }

    const existingState = this.mediaProgressMemory
      ? await this.mediaProgressMemory.findProgress(compoundId, progressNamespace)
      : null;
    const normalizedSeconds = parseInt(seconds, 10);
    const normalizedPercent = parseFloat(percent);
    const estimatedDuration = normalizedPercent > 0
      ? Math.round(normalizedSeconds / (normalizedPercent / 100))
      : (itemMetadata?.duration ? Math.round(itemMetadata.duration / 1000) : 0);
    const sessionWatchTime = Number.isFinite(watched_duration)
      ? parseFloat(watched_duration)
      : Math.max(0, normalizedSeconds - (existingState?.playhead || 0));
    const existingWatchTime = existingState?.watchTime ?? 0;
    const newWatchTime = existingWatchTime + sessionWatchTime;
    const statePercent = estimatedDuration > 0
      ? Math.round((normalizedSeconds / estimatedDuration) * 100)
      : 0;
    const completedAt = existingState?.completedAt
      || (statePercent >= 90 ? this.nowTimestamp() : null);
    const newState = this.createMediaProgress({
      contentId: compoundId,
      playhead: normalizedSeconds,
      duration: estimatedDuration,
      percent: statePercent,
      playCount: (existingState?.playCount ?? 0)
        + (!existingState || normalizedSeconds < (existingState.playhead || 0) ? 1 : 0),
      lastPlayed: this.nowTimestamp(),
      watchTime: newWatchTime > 0 ? Number(newWatchTime.toFixed(3)) : 0,
      completedAt,
    });

    if (this.mediaProgressMemory) {
      await this.mediaProgressMemory.saveProgress(newState, progressNamespace);
    }

    if (this.progressSyncSources?.has(type) && this.progressSyncService) {
      const localId = assetId.includes(':') ? assetId.split(':').slice(1).join(':') : assetId;
      this.progressSyncService.onProgressUpdate(compoundId, localId, {
        playhead: normalizedSeconds,
        duration: estimatedDuration,
        percent: statePercent,
        watchTime: sessionWatchTime,
      });
    }

    this.logger.info?.('play.log.updated', {
      assetId,
      type,
      percent: normalizedPercent,
      playhead: normalizedSeconds,
      storagePath: progressNamespace,
    });

    if (this.playbackPublications?.progressRecorded) {
      try {
        this.playbackPublications.progressRecorded({
          contentId: compoundId,
          type,
          assetId,
          percent: normalizedPercent,
          playhead: normalizedSeconds,
          storagePath: progressNamespace,
          timestamp: this.nowEpoch(),
        });
      } catch (error) {
        this.logger.warn?.('play.log.broadcast_failed', { error: error.message });
      }
    }

    let userProgress = null;
    if (userId && this.userVideoProgressStore) {
      try {
        userProgress = this.userVideoProgressStore.record({
          userId,
          plexId: assetId,
          percent: normalizedPercent,
          seconds: normalizedSeconds,
          duration: estimatedDuration,
          engaged: !!engaged,
        });
      } catch (error) {
        this.logger.warn?.('play.log.user_progress_failed', { userId, assetId, error: error.message });
      }
    }

    if (this.economyService && userProgress?.newlyCompleted) {
      const ref = `plex:${String(assetId).replace(/^plex:/, '')}`;
      this.economyService.earn(userId, { action: 'piano-lesson-complete', source: 'piano', ref })
        .catch((error) => this.logger.warn?.('play.log.economy_earn_failed', { userId, assetId, error: error?.message }));
    }

    if (this.playbackPublications?.pianoLessonCompleted && userProgress?.newlyCompleted) {
      try {
        this.playbackPublications.pianoLessonCompleted({
          userId,
          plexId: `plex:${String(assetId).replace(/^plex:/, '')}`,
          title: itemMetadata?.title || title || null,
          at: this.nowIso(),
        });
      } catch (error) {
        this.logger.warn?.('play.log.lesson_completed_publish_failed', { userId, assetId, error: error?.message });
      }
    }

    const userProgressPublic = userProgress
      ? (() => { const { newlyCompleted, ...rest } = userProgress; return rest; })()
      : undefined;

    return {
      response: {
        type,
        library: progressNamespace,
        title: itemMetadata?.title || title,
        contentId: newState.contentId,
        playhead: newState.playhead,
        duration: newState.duration,
        percent: newState.percent,
        playCount: newState.playCount,
        lastPlayed: newState.lastPlayed,
        watchTime: newState.watchTime,
        userProgress: userProgressPublic,
      },
    };
  }
}

export default RecordPlaybackProgress;
