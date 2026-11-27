import { PlayableItem } from "../../../../content-catalog/server/items.mjs";
import { DefaultMediaProgressClassifier } from "../../domain/services/DefaultMediaProgressClassifier.mjs";
import { isResumeWorthy } from "../../domain/services/isResumeWorthy.mjs";
import { QueueService as QueuePolicy } from "../../../../content-catalog/server/queue-policy.mjs";
import { orderWatchedByRecency, isOrderedWork, libraryKindMap } from "../../../../content-catalog/server/queue-policy.mjs";

const playedAt = (value) => {
  if (value == null || value === '') return null;
  const t = Date.parse(typeof value === 'string' && value.includes(' ') && !value.includes('T') ? value.replace(' ', 'T') : value);
  return Number.isFinite(t) ? t : null;
};

/** Application orchestration for media-progress-backed queue resolution. */
export class QueueService extends QueuePolicy {
  /**
   * @param {Object} deps
   * @param {() => Object|null} [deps.libraryKinds] - the household media config's
   *   `play_on_demand.library_kinds` (library title or section id → music|books|talks),
   *   read on every queue so a config reload applies. Without it nothing is an ordered work.
   */
  constructor({ mediaProgressMemory, classifier, random, libraryKinds = null } = {}) {
    super();
    this.mediaProgressMemory = mediaProgressMemory;
    this.classifier = classifier || new DefaultMediaProgressClassifier();
    this.random = random;
    this.libraryKinds = typeof libraryKinds === 'function' ? libraryKinds : () => null;
  }

  /** True when these playables are a book, talk series or course heard as audio (see orderedWork.mjs). */
  isOrderedWork(playables) {
    let config = null;
    try { config = this.libraryKinds(); } catch { config = null; }
    return isOrderedWork(playables, libraryKindMap(config));
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

  /**
   * Order a resolved container for playback.
   *
   * - `preserveOrder` (a program): the container's order, resume positions attached.
   * - An ordered work (a book, a talk series, a course heard as audio; `ordered`, or
   *   isOrderedWork): the container's order, never reordered or shuffled (`shuffle` is
   *   ignored), and the returned array carries `startIndex`, where to start. See #ordered.
   * - Anything else (a show, a music list): unwatched first in order, then watched by
   *   recency; `shuffle` shuffles both pools.
   *
   * @returns {Promise<Array & {startIndex?: number}>}
   */
  async resolveQueue(playables, source, { shuffle = false, ordered } = {}) {
    if (!playables.preserveOrder && (ordered ?? this.isOrderedWork(playables))) {
      return this.#ordered(playables, source);
    }
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
        return progress && item.resumable && progress.playhead && isResumeWorthy({ ...progress, duration: progress.duration || item.duration })
          ? this._withResumePosition(item, progress)
          : item;
      });
    }

    if (!this.mediaProgressMemory) {
      return shuffle ? QueuePolicy.shuffleArray([...playables], this.random) : playables;
    }

    const progressMap = await this.#progressFor(playables, source);
    const enriched = this.#enrich(playables, progressMap);
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

  /**
   * An ordered work keeps its own order; the answer says where to start.
   *
   * The start is where the listener is: the part heard last, at its place. When
   * that part is finished the start is the next part. When the last part is
   * finished (the whole book was heard) the start is part 1 from the beginning,
   * so a play of a finished book plays it again rather than ending at once.
   * With no listening times recorded, the start is the first part not finished.
   * With nothing heard, 0.
   */
  async #ordered(playables, source) {
    const items = [...playables];
    if (!this.mediaProgressMemory || !items.length) return Object.assign(items, { startIndex: 0 });
    const progressMap = await this.#progressFor(items, source);
    const enriched = this.#enrich(items, progressMap);
    const finished = (item) => this.#finished(progressMap.get(item.id), item);

    let startIndex = -1;
    let latest = null;
    enriched.forEach((item, index) => {
      const at = playedAt(progressMap.get(item.id)?.lastPlayed);
      if (at != null && (latest == null || at >= latest.at)) latest = { at, index };
    });
    if (latest) {
      startIndex = finished(enriched[latest.index]) ? latest.index + 1 : latest.index;
    } else {
      startIndex = enriched.findIndex((item) => !finished(item));
    }
    if (startIndex < 0 || startIndex >= enriched.length) {
      startIndex = 0;
      // Heard to the end: part 1 plays from its beginning, not from its last place.
      if (enriched[0].resumePosition) enriched[0] = this._withResumePosition(enriched[0], { playhead: null });
    }
    return Object.assign(enriched, { startIndex });
  }

  /** A part heard to its end: its place is at the end, or it has a play count and no place. */
  #finished(progress, item) {
    if (!progress) return false;
    if (!(progress.playhead > 0)) return (progress.playCount ?? 0) > 0;
    // The classifier calls anything once completed watched; a book re-heard from the
    // middle is at that place, so only the place decides here. `percent` is a getter on
    // MediaProgress, so it is copied by name (a spread drops it).
    return this.classifier.classify({ ...progress, playCount: 0, percent: progress.percent }, { duration: item.duration }) === 'watched';
  }

  async #progressFor(playables, source) {
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
    return progressMap;
  }

  #enrich(playables, progressMap) {
    return playables.map(item => {
      const progress = progressMap.get(item.id);
      return progress && item.resumable && progress.playhead && isResumeWorthy({ ...progress, duration: progress.duration || item.duration })
        ? this._withResumePosition(item, progress)
        : item;
    });
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
