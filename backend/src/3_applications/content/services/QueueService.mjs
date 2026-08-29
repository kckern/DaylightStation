import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';
import { DefaultMediaProgressClassifier } from '#domains/content/services/DefaultMediaProgressClassifier.mjs';
import { QueueService as QueuePolicy } from '#domains/content/services/QueueService.mjs';
import { orderWatchedByRecency } from '#domains/content/utils/recencyOrder.mjs';

/** Application orchestration for media-progress-backed queue resolution. */
export class QueueService extends QueuePolicy {
  constructor({ mediaProgressMemory, classifier, random } = {}) {
    super();
    this.mediaProgressMemory = mediaProgressMemory;
    this.classifier = classifier || new DefaultMediaProgressClassifier();
    this.random = random;
  }

  async getNextPlayable(items, storagePath) {
    if (!items.length) return null;
    for (const item of items) {
      const state = await this.mediaProgressMemory.findProgress(item.id, storagePath);
      if (state?.isInProgress()) return this._withResumePosition(item, state);
    }
    for (const item of items) {
      const state = await this.mediaProgressMemory.findProgress(item.id, storagePath);
      if (!state || !state.isWatched()) return item;
    }
    return null;
  }

  async getAllPlayables(items) {
    return items;
  }

  async resolveQueue(playables, source, { shuffle = false } = {}) {
    if (playables.preserveOrder) {
      if (!this.mediaProgressMemory) return [...playables];
      const itemSources = new Set(playables.map(p => p.source).filter(Boolean));
      if (!itemSources.size) itemSources.add(source);
      const progressMap = new Map();
      for (const src of itemSources) {
        const progress = await this.mediaProgressMemory.listSourceProgress(src);
        for (const p of progress) progressMap.set(p.contentId, p);
      }
      return playables.map(item => {
        const progress = progressMap.get(item.id);
        return progress && item.resumable && progress.playhead
          ? this._withResumePosition(item, progress)
          : item;
      });
    }

    if (!this.mediaProgressMemory) {
      return shuffle ? QueuePolicy.shuffleArray([...playables], this.random) : playables;
    }

    const itemSources = new Set(playables.map(p => p.source).filter(Boolean));
    if (!itemSources.size) itemSources.add(source);
    const progressMap = new Map();
    for (const src of itemSources) {
      const progress = await this.mediaProgressMemory.listSourceProgress(src);
      for (const p of progress) progressMap.set(p.contentId, p);
    }

    const storagePaths = new Set(
      playables.map(p => p.storagePath).filter(sp => sp && !itemSources.has(sp))
    );
    for (const sp of storagePaths) {
      const progress = await this.mediaProgressMemory.listProgress(sp);
      for (const p of progress) {
        if (!progressMap.has(p.contentId)) progressMap.set(p.contentId, p);
      }
    }

    const enriched = playables.map(item => {
      const progress = progressMap.get(item.id);
      return progress && item.resumable && progress.playhead
        ? this._withResumePosition(item, progress)
        : item;
    });
    const { unwatched, watched } = QueuePolicy.partitionByWatchStatus(
      enriched, progressMap, this.classifier
    );
    const recencyMap = new Map();
    for (const [contentId, progress] of progressMap) {
      recencyMap.set(contentId, progress.lastPlayed);
    }
    const watchedOrdered = orderWatchedByRecency(watched, recencyMap, {
      shuffle,
      shuffleFn: (items) => QueuePolicy.shuffleArray(items, this.random)
    });
    return [
      ...(shuffle ? QueuePolicy.shuffleArray([...unwatched], this.random) : unwatched),
      ...watchedOrdered
    ];
  }

  _withResumePosition(item, state) {
    return new PlayableItem({
      id: item.id,
      source: item.source,
      localId: item.localId,
      title: item.title,
      mediaType: item.mediaType,
      mediaUrl: item.mediaUrl,
      duration: item.duration,
      resumable: item.resumable,
      resumePosition: state.playhead,
      playbackRate: item.playbackRate,
      thumbnail: item.thumbnail,
      description: item.description,
      metadata: item.metadata,
      storagePath: item.storagePath
    });
  }
}

export default QueueService;
