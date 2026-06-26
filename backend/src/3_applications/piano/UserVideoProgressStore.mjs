import path from 'path';
import { loadYaml, saveYaml } from '#system/utils/FileIO.mjs';

/**
 * UserVideoProgressStore — per-user video course progress for the piano kiosk.
 *
 * Single source of truth for the completion rule: a lecture is complete when
 * the user has watched >= threshold percent AND engaged (played along) at least
 * once. `engaged` is a sticky boolean on the stored entry — once true it stays
 * true for the session's lifetime of that entry. completedAt is stamped once
 * and never cleared (a later rewatch from the start can't revert completion).
 *
 * Storage: data/users/{userId}/apps/piano/video-progress.yml, keyed by plex:{id}.
 */
export class UserVideoProgressStore {
  #configService;
  #logger;

  constructor({ configService, logger = console }) {
    this.#configService = configService;
    this.#logger = logger;
  }

  // Returns the user's piano dir, or null if the user is unknown.
  #userDir(userId) {
    if (!userId || !this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'piano');
  }

  #threshold() {
    const cfg = this.#configService.getHouseholdAppConfig?.(null, 'piano') || {};
    return cfg.videos?.completion_threshold_percent ?? 90;
  }

  #keyFor(plexId) {
    const raw = String(plexId).replace(/^plex:/, '');
    return `plex:${raw}`;
  }

  // Legacy tolerance: older entries used engagementCount instead of a boolean.
  #wasEngaged(entry) {
    return !!entry?.engaged || (entry?.engagementCount ?? 0) > 0;
  }

  /**
   * Record a progress update. Returns the updated entry, or null for unknown user.
   * @param {{userId:string, plexId:string, percent:number, seconds?:number, duration?:number, engaged?:boolean}}
   */
  record({ userId, plexId, percent, seconds, duration, engaged }) {
    const dir = this.#userDir(userId);
    if (!dir) return null;

    const key = this.#keyFor(plexId);
    const threshold = this.#threshold();
    const progress = loadYaml(path.join(dir, 'video-progress')) || {};
    const existing = progress[key] || {};

    const nowEngaged = this.#wasEngaged(existing) || !!engaged;
    const normalizedPercent = Math.round(parseFloat(percent) || 0);
    const completedAt = existing.completedAt ||
      (normalizedPercent >= threshold && nowEngaged ? new Date().toISOString() : null);

    const entry = {
      ...existing,
      playhead: Math.round(parseFloat(seconds) || 0),
      percent: normalizedPercent,
      duration: Math.round(parseFloat(duration) || 0),
      lastPlayed: new Date().toISOString(),
      engaged: nowEngaged,
      completedAt,
    };
    // Drop any legacy counter field so entries converge on the boolean.
    delete entry.engagementCount;

    progress[key] = entry;
    saveYaml(path.join(dir, 'video-progress'), progress);
    this.#logger.info?.('piano.video-progress.record', {
      userId, key, percent: normalizedPercent, engaged: nowEngaged, completed: !!completedAt,
    });
    return entry;
  }

  /**
   * Enrich playable items with this user's progress fields. Items are matched by
   * their plex/id. Adds userPercent, userPlayhead, userWatched, userEngaged,
   * userCompletedAt. If the user is unknown, items are returned unchanged.
   */
  enrich(items, userId) {
    if (!Array.isArray(items)) return items;
    const dir = this.#userDir(userId);
    if (!dir) return items;

    const progress = loadYaml(path.join(dir, 'video-progress')) || {};
    const threshold = this.#threshold();

    return items.map((item) => {
      const key = this.#keyFor(item.plex || item.id);
      const up = progress[key] || {};
      const engaged = this.#wasEngaged(up);
      const userWatched = !!up.completedAt || ((up.percent ?? 0) >= threshold && engaged);
      return {
        ...item,
        userPercent: up.percent ?? null,
        userPlayhead: up.playhead ?? null,
        userWatched,
        userEngaged: engaged,
        userCompletedAt: up.completedAt || null,
      };
    });
  }

  // Convenience guard reused by routers.
  isKnownUser(userId) {
    return !!this.#userDir(userId);
  }
}

export default UserVideoProgressStore;
