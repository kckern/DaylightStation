import { YamlUserAppRecordStore } from "#system/persistence/YamlUserAppRecordStore.mjs";

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
 * 'material-progress' }. Installed composition deliberately supplies the same
 * Piano policy to that legacy School store, preserving its stored completion
 * fields and logging. School computes its own material completion separately.
 */
export class YamlUserVideoProgressStore {
  #configService;
  #logger;
  #records;

  constructor({ configService, logger = console, app = 'piano', filename = 'video-progress' }) {
    this.#configService = configService;
    this.#logger = logger;
    this.#records = new YamlUserAppRecordStore({ configService, app, filename });
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
    const records = this.#records.forUser(userId);
    if (!records) return null;

    const key = this.#keyFor(plexId);
    const threshold = this.#threshold();
    const progress = records.read() || {};
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
    records.write(progress);
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
   * userCompletedAt, userLastPlayedAt. If the user is unknown, items are
   * returned unchanged.
   */
  enrich(items, userId) {
    if (!Array.isArray(items)) return items;
    const records = this.#records.forUser(userId);
    if (!records) return items;

    const progress = records.read() || {};
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
        userLastPlayedAt: up.lastPlayed || null,
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
    const records = this.#records.forUser(userId);
    if (!records || total === 0) return { completed: 0, total, lastPlayedAt: null };

    const progress = records.read() || {};
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

  /** mtimeMs of the user's progress file — cache key material. 0 when absent. */
  progressFileMtime(userId) {
    const records = this.#records.forUser(userId);
    if (!records) return 0;
    return records.mtime();
  }

  // Convenience guard reused by routers.
  isKnownUser(userId) {
    return !!this.#records.forUser(userId);
  }
}

export default YamlUserVideoProgressStore;
