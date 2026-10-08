/**
 * MediaSourceHealer — "Plex can't read this file": find out, try to fix it,
 * and tell an adult if it stays broken.
 *
 * A player that hits a refused media file calls `check(contentId)` and keeps
 * calling it (with backoff) until the answer is `readable`. Each call walks a
 * short repair ladder, each rung rate-limited per file:
 *
 *   1. Ask Plex to re-check the file (`checkFiles=1`) — the cheapest signal, and
 *      it refreshes Plex's own idea of whether the part is accessible.
 *   2. Ask the host (restricted SSH forced command) what IT sees, and restore
 *      0777 when the NAS has zeroed the mode — the 2026-09-25 fix. It also
 *      restores zeroed siblings in the same folder, so the NEXT episode of the
 *      series does not fail the same way.
 *   3. Ask Plex again.
 *   4. Once a file has been unreadable for `alertAfterMs`, push one alert.
 *
 * Every rung logs `media.source.heal.step` with its result, and the episode
 * closes with `media.source.heal.resolved {resolvedBy}` — so after a few
 * incidents the logs say which rung actually fixes it.
 *
 * Concurrent checks for the same file share one in-flight run: two screens
 * waiting on the same video do not SSH twice.
 *
 * See docs/reference/player/media-source-healing.md.
 */

import {
  SOURCE_STATE,
  parsePlexRatingKey,
  composeSourceUnreadablePush,
} from '#domains/media/sourceHealth.mjs';

const DEFAULTS = Object.freeze({
  hostHealCooldownMs: 20_000,
  alertAfterMs: 120_000,
  // An episode nobody has asked about for this long is over (the screen moved on).
  episodeIdleMs: 10 * 60_000,
  // A refusal the PROXY saw refreshes the file on the host even when Plex says
  // it can read it; at most once per file per this long.
  proxyRefreshCooldownMs: 60_000,
});

export class MediaSourceHealer {
  #probe;
  #hostHealer;
  #notifier;
  #clock;
  #logger;
  #cfg;
  #episodes = new Map();
  #inflight = new Map();
  #proxyRefreshAt = new Map();

  /**
   * @param {Object} deps
   * @param {{ probe(ratingKey: string): Promise<Object> }} deps.sourceProbe
   * @param {{ heal(mediaPath: string): Promise<Object>, isConfigured?(): boolean }|null} [deps.hostHealer]
   * @param {{ send(msg: Object): Promise<any> }|null} [deps.notifier]
   * @param {() => number} [deps.clock]
   * @param {Object} [deps.logger]
   * @param {Object} [deps.config]
   */
  constructor({ sourceProbe, hostHealer = null, notifier = null, clock = () => Date.now(), logger = console, config = {} }) {
    if (!sourceProbe?.probe) throw new Error('MediaSourceHealer requires sourceProbe');
    this.#probe = sourceProbe;
    this.#hostHealer = hostHealer && (hostHealer.isConfigured?.() ?? true) ? hostHealer : null;
    this.#notifier = notifier;
    this.#clock = clock;
    this.#logger = logger;
    this.#cfg = { ...DEFAULTS, ...config };
  }

  /**
   * @param {string} contentId - e.g. `plex:696316`
   * @param {Object} [context] - `{ deviceId }`, for the log only
   * @returns {Promise<{state: string, contentId: string, unreadableSince?: number, unreadableMs?: number, steps: Object[]}>}
   */
  async check(contentId, context = {}) {
    const ratingKey = parsePlexRatingKey(contentId);
    if (!ratingKey) {
      return { state: SOURCE_STATE.unknown, contentId, reason: 'unsupported-source', steps: [] };
    }
    const running = this.#inflight.get(ratingKey);
    if (running) return running;
    const run = this.#run(ratingKey, contentId, context)
      .finally(() => this.#inflight.delete(ratingKey));
    this.#inflight.set(ratingKey, run);
    return run;
  }

  async #run(ratingKey, contentId, context) {
    this.#expireIdleEpisodes();
    const steps = [];
    let probe = await this.#step(steps, ratingKey, 'plex-check', () => this.#probe.probe(ratingKey));

    if (probe.reason === 'not-a-leaf') {
      this.#logger.warn?.('media.source.heal.not-a-leaf', {
        ratingKey, contentId, itemType: probe.itemType ?? null, title: probe.title ?? null,
        origin: context.origin ?? null, deviceId: context.deviceId ?? null,
      });
      return { ...this.#answer(contentId, probe, steps, null), reason: 'not-a-leaf', ...(probe.itemType ? { itemType: probe.itemType } : {}) };
    }

    if (probe.state === SOURCE_STATE.readable && context.origin === 'proxy') {
      const refreshed = await this.#proxyRefresh(steps, ratingKey, contentId, probe);
      if (refreshed) probe = refreshed;
    }

    if (probe.state !== SOURCE_STATE.unreadable) {
      // `unknown` (Plex itself unreachable, say) says nothing about the file, so
      // it neither opens nor closes an episode.
      if (probe.state !== SOURCE_STATE.unknown) this.#closeEpisode(ratingKey, probe.state, 'plex-check');
      return this.#answer(contentId, probe, steps, this.#episodes.get(ratingKey) ?? null);
    }

    const episode = this.#openEpisode(ratingKey, contentId, probe, context);

    const now = this.#clock();
    if (this.#hostHealer && probe.path && now - (episode.lastHostHealAt ?? -Infinity) >= this.#cfg.hostHealCooldownMs) {
      episode.lastHostHealAt = now;
      const host = await this.#step(steps, ratingKey, 'host-heal', () => this.#hostHealer.heal(probe.path));
      if (host.chmodApplied || (host.siblingsFixed ?? 0) > 0) episode.chmodCount += 1;
      if (host.ok !== false) {
        probe = await this.#step(steps, ratingKey, 'plex-recheck', () => this.#probe.probe(ratingKey));
        if (probe.state === SOURCE_STATE.readable || probe.state === SOURCE_STATE.missing) {
          this.#closeEpisode(ratingKey, probe.state, host.chmodApplied
            ? 'host-chmod'
            : (host.cacheRefreshed ? 'host-cache-refresh' : 'plex-recheck'));
          return this.#answer(contentId, probe, steps, null);
        }
      }
    }

    episode.lastCheckAt = this.#clock();
    await this.#maybeAlert(ratingKey, episode);
    return this.#answer(contentId, probe, steps, episode);
  }

  /**
   * Plex's probe says readable but the PROXY just watched it refuse the file —
   * a per-user access-cache ghost: the host (a different user) reads it fine and
   * Plex's stat passes. Re-applying the file's mode bumps its ctime, which is
   * the only thing that makes this host's NFS client re-trust it. Rate-limited
   * per file. Returns the re-check answer, or null when nothing ran.
   */
  async #proxyRefresh(steps, ratingKey, contentId, probe) {
    if (!this.#hostHealer || !probe.path) return null;
    const now = this.#clock();
    const last = this.#proxyRefreshAt.get(ratingKey);
    if (last !== undefined && now - last < this.#cfg.proxyRefreshCooldownMs) return null;
    if (this.#proxyRefreshAt.size >= 500) {
      // Drop only EXPIRED cooldowns. If the map is still full, refuse the
      // refresh: evicting a live cooldown would let a flood of ids reset them all.
      for (const [key, at] of this.#proxyRefreshAt) {
        if (now - at >= this.#cfg.proxyRefreshCooldownMs) this.#proxyRefreshAt.delete(key);
      }
      if (this.#proxyRefreshAt.size >= 500) return null;
    }
    this.#proxyRefreshAt.set(ratingKey, now);
    const host = await this.#step(steps, ratingKey, 'host-heal', () => this.#hostHealer.heal(probe.path));
    this.#logger.info?.('media.source.heal.proxy-refresh', {
      ratingKey, contentId, title: probe.title ?? null, ok: host.ok ?? null,
      chmodApplied: host.chmodApplied ?? null, cacheRefreshed: host.cacheRefreshed ?? null,
    });
    if (host.ok === false) return null;
    return this.#step(steps, ratingKey, 'plex-recheck', () => this.#probe.probe(ratingKey));
  }

  async #step(steps, ratingKey, name, fn) {
    const startedAt = this.#clock();
    let result;
    try {
      result = (await fn()) ?? {};
    } catch (error) {
      result = { ok: false, state: SOURCE_STATE.unknown, error: error.message };
    }
    const ms = this.#clock() - startedAt;
    const summary = {
      step: name,
      ms,
      state: result.state ?? null,
      ok: result.ok ?? null,
      mode: result.mode ?? null,
      chmodApplied: result.chmodApplied ?? null,
      cacheRefreshed: result.cacheRefreshed ?? null,
      siblingsFixed: result.siblingsFixed ?? null,
      readable: result.readable ?? null,
      error: result.error ?? null,
    };
    steps.push(summary);
    this.#logger.info?.('media.source.heal.step', { ratingKey, ...summary });
    return result;
  }

  #openEpisode(ratingKey, contentId, probe, context) {
    let episode = this.#episodes.get(ratingKey);
    if (!episode) {
      episode = {
        contentId,
        since: this.#clock(),
        lastCheckAt: this.#clock(),
        lastHostHealAt: null,
        alerted: false,
        chmodCount: 0,
        title: probe.title ?? null,
        showTitle: probe.showTitle ?? null,
      };
      this.#episodes.set(ratingKey, episode);
      this.#logger.warn?.('media.source.heal.opened', {
        ratingKey, contentId, title: episode.title, path: probe.path ?? null, deviceId: context.deviceId ?? null,
      });
    }
    return episode;
  }

  #closeEpisode(ratingKey, state, resolvedBy) {
    const episode = this.#episodes.get(ratingKey);
    if (!episode) return;
    this.#episodes.delete(ratingKey);
    this.#logger.info?.('media.source.heal.resolved', {
      ratingKey,
      contentId: episode.contentId,
      title: episode.title,
      state,
      resolvedBy,
      unreadableMs: this.#clock() - episode.since,
      chmodCount: episode.chmodCount,
      alerted: episode.alerted,
    });
  }

  #expireIdleEpisodes() {
    const now = this.#clock();
    for (const [ratingKey, episode] of this.#episodes) {
      if (now - episode.lastCheckAt >= this.#cfg.episodeIdleMs) {
        this.#episodes.delete(ratingKey);
        this.#logger.info?.('media.source.heal.abandoned', {
          ratingKey, contentId: episode.contentId, title: episode.title,
          unreadableMs: episode.lastCheckAt - episode.since,
        });
      }
    }
  }

  async #maybeAlert(ratingKey, episode) {
    const unreadableMs = this.#clock() - episode.since;
    if (episode.alerted || !this.#notifier || unreadableMs < this.#cfg.alertAfterMs) return;
    episode.alerted = true;
    const push = composeSourceUnreadablePush({ title: episode.title, showTitle: episode.showTitle, unreadableMs });
    try {
      await this.#notifier.send({
        ...push,
        category: 'system',
        urgency: 'high',
        dedupeKey: `media-source-unreadable:${ratingKey}:${episode.since}`,
      });
      this.#logger.warn?.('media.source.heal.alerted', { ratingKey, title: episode.title, unreadableMs });
    } catch (error) {
      this.#logger.warn?.('media.source.heal.alert-failed', { ratingKey, error: error.message });
    }
  }

  #answer(contentId, probe, steps, episode) {
    const now = this.#clock();
    return {
      state: probe.state ?? SOURCE_STATE.unknown,
      contentId,
      ...(probe.reason ? { reason: probe.reason } : {}),
      ...(episode ? { unreadableSince: episode.since, unreadableMs: now - episode.since } : {}),
      steps,
    };
  }
}

export default MediaSourceHealer;
