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
 * Storage: data/users/{userId}/apps/{app}/{filename}.yml, keyed by plex:{id}.
 * `app`/`filename` default to 'piano'/'video-progress' so Piano's behaviour is
 * unchanged. School consumers construct with { app: 'school', filename:
 * 'material-progress' } and must treat this store as a dumb playhead/percent/
 * duration store only — the threshold/engaged/completedAt machinery below is
 * Piano policy and stays INERT for School (spec §6); School completion is
 * computed entirely in 2_domains/school/materialPolicy.mjs.
 */
export class UserVideoProgressStore {
  #configService;
  #logger;
  #app;
  #filename;

  constructor({ configService, logger = console, app = 'piano', filename = 'video-progress' }) {
    this.#configService = configService;
    this.#logger = logger;
    this.#app = app;
    this.#filename = filename;
  }

  // Returns the user's app dir, or null if the user is unknown.
  #userDir(userId) {
    if (!userId || !this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', this.#app);
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
    const progress = loadYaml(path.join(dir, this.#filename)) || {};
    const existing = progress[key] || {};

    const wasCompleted = !!existing.completedAt;
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
    saveYaml(path.join(dir, this.#filename), progress);
    this.#logger.info?.('piano.video-progress.record', {
      userId, key, percent: normalizedPercent, engaged: nowEngaged, completed: !!completedAt,
    });
    // `newlyCompleted` is a RETURN-VALUE signal only (true iff completedAt went
    // absent→present in THIS call). It is deliberately NOT part of the persisted
    // `entry` above, so it never lands in video-progress.yml. Callers (the play
    // /log route) use it to fire the one-time economy earn on the transition.
    return { ...entry, newlyCompleted: !wasCompleted && !!completedAt };
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

    const progress = loadYaml(path.join(dir, this.#filename)) || {};
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

  /**
   * Aggregate one user's progress across a course's lecture `items`. Returns
   * `{ completed, total, lastPlayedAt }` using the same completion rule as
   * enrich (completedAt, or >= threshold AND engaged). `total` is items.length;
   * the caller excludes reference units before calling. Unknown user → zeros.
   */
  summarize(items, userId) {
    const total = Array.isArray(items) ? items.length : 0;
    const dir = this.#userDir(userId);
    if (!dir || total === 0) return { completed: 0, total, lastPlayedAt: null };

    const progress = loadYaml(path.join(dir, this.#filename)) || {};
    const threshold = this.#threshold();
    let completed = 0;
    let lastPlayedAt = null;

    for (const item of items) {
      const up = progress[this.#keyFor(item.plex || item.id)];
      if (!up) continue;
      const engaged = this.#wasEngaged(up);
      const done = !!up.completedAt || ((up.percent ?? 0) >= threshold && engaged);
      if (done) completed += 1;
      if (up.lastPlayed && (!lastPlayedAt || up.lastPlayed > lastPlayedAt)) lastPlayedAt = up.lastPlayed;
    }
    return { completed, total, lastPlayedAt };
  }

  // Convenience guard reused by routers.
  isKnownUser(userId) {
    return !!this.#userDir(userId);
  }
}

export default UserVideoProgressStore;
