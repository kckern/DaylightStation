/**
 * StravaEnrichmentService
 *
 * Orchestrates the enrichment of Strava activities with DaylightStation
 * fitness session data (media titles, voice memos, episode descriptions).
 *
 * Flow:
 * 1. Receive webhook event → check circuit breaker → write durable job
 * 2. Scan fitness history for matching strava activityId
 * 3. Build enrichment payload (title + description)
 * 4. PUT to Strava API
 * 5. Update job status
 *
 * Circuit breaker (3 layers):
 * - shouldEnrich() in adapter: only 'create' events
 * - Cooldown set: recently-enriched activityIds (1hr TTL)
 * - Job store: completed jobs are skipped
 *
 * @module applications/strava/StravaEnrichmentService
 */

import path from 'path';
import moment from 'moment-timezone';
import { loadYamlSafe, listYamlFiles, dirExists, saveYaml } from '#system/utils/FileIO.mjs';
import { buildStravaDescription } from './buildStravaDescription.mjs';

const MAX_RETRIES = 3;
const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_TTL_MS = 60 * 60 * 1000;  // 1 hour

export class StravaEnrichmentService {
  #stravaClient;
  #jobStore;
  #authStore;
  #configService;
  #fitnessHistoryDir;
  #logger;

  // Circuit breaker: in-memory cooldown of recently-enriched activity IDs
  #cooldown = new Map(); // activityId → expiry timestamp

  /**
   * @param {Object} config
   * @param {Object} config.stravaClient - StravaClientAdapter instance
   * @param {Object} config.jobStore - StravaWebhookJobStore instance
   * @param {Object} config.authStore - { loadUserAuth(provider, username) } for OAuth tokens
   * @param {Object} config.configService - ConfigService
   * @param {string} config.fitnessHistoryDir - Path to fitness history dir
   * @param {Object} [config.logger]
   */
  constructor({ stravaClient, jobStore, authStore, configService, fitnessHistoryDir, logger = console }) {
    this.#stravaClient = stravaClient;
    this.#jobStore = jobStore;
    this.#authStore = authStore;
    this.#configService = configService;
    this.#fitnessHistoryDir = fitnessHistoryDir;
    this.#logger = logger;
  }

  /**
   * Handle a parsed webhook event. Returns immediately after queuing.
   * @param {Object} event - FitnessProviderEvent from adapter
   * @returns {boolean} Whether enrichment was queued
   */
  handleEvent(event) {
    if (!event || event.objectType !== 'activity' || event.aspectType !== 'create') {
      this.#logger.info?.('strava.enrichment.event_rejected', {
        objectType: event?.objectType,
        aspectType: event?.aspectType,
        reason: 'not activity/create',
      });
      return false;
    }

    const activityId = String(event.objectId);
    this.#logger.info?.('strava.enrichment.event_accepted', {
      activityId,
      ownerId: event.ownerId,
      eventTime: event.eventTime,
    });

    // Circuit breaker: cooldown check
    if (this._isOnCooldown(activityId)) {
      this.#logger.info?.('strava.enrichment.cooldown_skip', { activityId });
      return false;
    }

    // Circuit breaker: already completed
    const existing = this.#jobStore.findById(activityId);
    if (existing?.status === 'completed') {
      this.#logger.info?.('strava.enrichment.already_completed', { activityId });
      return false;
    }

    // Write durable job (or reuse existing pending job)
    if (!existing) {
      this.#jobStore.create(event);
    }

    // Attempt enrichment immediately
    this._attemptEnrichment(activityId);

    return true;
  }

  /**
   * Startup recovery: re-queue any pending/unmatched jobs.
   */
  recoverPendingJobs() {
    const jobs = this.#jobStore.findActionable();
    if (jobs.length === 0) return;

    this.#logger.info?.('strava.enrichment.recovery', { count: jobs.length });

    for (const job of jobs) {
      this._attemptEnrichment(String(job.activityId));
    }
  }

  /**
   * @private
   * Attempt to enrich a Strava activity. Schedules retries on failure.
   */
  async _attemptEnrichment(activityId) {
    const job = this.#jobStore.findById(activityId);
    if (!job) return;

    // Circuit breaker: re-check cooldown (may have been set by concurrent attempt)
    if (this._isOnCooldown(activityId)) return;
    if (job.status === 'completed') return;

    const attempt = (job.attempts || 0) + 1;
    this.#logger.info?.('strava.enrichment.attempt_start', { activityId, attempt });

    this.#jobStore.update(activityId, {
      attempts: attempt,
      lastAttemptAt: new Date().toISOString(),
    });

    try {
      // Ensure we have a fresh access token (needed for getActivity)
      await this._ensureAuth();

      // Fetch activity from Strava (need start_date + duration for time matching)
      const currentActivity = await this.#stravaClient.getActivity(activityId);
      if (!currentActivity?.start_date) {
        this.#logger.warn?.('strava.enrichment.activity_fetch_failed', { activityId });
        if (attempt < MAX_RETRIES) {
          setTimeout(() => this._attemptEnrichment(activityId), RETRY_INTERVAL_MS);
        } else {
          this.#jobStore.update(activityId, { status: 'unmatched' });
        }
        return;
      }

      // Find matching home session (time-based)
      const match = this._findMatchingSession(currentActivity);
      if (!match) {
        this.#logger.info?.('strava.enrichment.no_match', { activityId, attempt });
        if (attempt < MAX_RETRIES) {
          setTimeout(() => this._attemptEnrichment(activityId), RETRY_INTERVAL_MS);
        } else {
          this.#jobStore.update(activityId, { status: 'unmatched' });
          this.#logger.warn?.('strava.enrichment.unmatched', { activityId, attempts: attempt });
        }
        return;
      }

      const session = match.data;

      // Write Strava data back to session YAML (if not already linked)
      const username = this.#configService.getHeadOfHousehold?.() || 'kckern';
      if (session.participants?.[username] && !session.participants[username]?.strava?.activityId) {
        session.participants[username].strava = {
          activityId: currentActivity.id,
          type: currentActivity.type || currentActivity.sport_type || null,
          sufferScore: currentActivity.suffer_score || null,
          deviceName: currentActivity.device_name || null,
        };

        const savePath = match.filePath.replace(/\.yml$/, '');
        saveYaml(savePath, session);

        this.#logger.info?.('strava.enrichment.session_writeback', {
          activityId,
          sessionId: session.sessionId || session.session?.id,
          filePath: match.filePath,
        });
      }

      // Build enrichment payload
      const enrichment = buildStravaDescription(session, currentActivity);
      if (!enrichment) {
        this.#logger.info?.('strava.enrichment.nothing_to_enrich', { activityId });
        this.#jobStore.update(activityId, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          matchedSessionId: session.sessionId || session.session?.id,
          note: 'no-enrichable-content',
        });
        this._addToCooldown(activityId);
        return;
      }

      // Push to Strava
      const updatePayload = {};
      if (enrichment.name) updatePayload.name = enrichment.name;
      if (enrichment.description) updatePayload.description = enrichment.description;

      await this.#stravaClient.updateActivity(activityId, updatePayload);

      // Mark complete + cooldown
      this.#jobStore.update(activityId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        matchedSessionId: session.sessionId || session.session?.id,
        enrichedFields: Object.keys(updatePayload),
      });
      this._addToCooldown(activityId);

      this.#logger.info?.('strava.enrichment.success', {
        activityId,
        sessionId: session.sessionId || session.session?.id,
        fields: Object.keys(updatePayload),
      });

    } catch (err) {
      this.#logger.error?.('strava.enrichment.error', {
        activityId,
        attempt,
        error: err?.message,
      });

      if (attempt < MAX_RETRIES) {
        setTimeout(() => this._attemptEnrichment(activityId), RETRY_INTERVAL_MS);
      } else {
        this.#jobStore.update(activityId, { status: 'unmatched' });
      }
    }
  }

  /**
   * @private
   * Find a home fitness session matching a Strava activity by time overlap.
   *
   * Two-pass approach:
   *  1. Fast path: check if any session already has this strava.activityId
   *  2. Time match: overlap the activity window against session windows (5-min buffer)
   *
   * @param {Object} activity - Strava activity object (from API: start_date, moving_time, elapsed_time, id)
   * @returns {{ data: Object, filePath: string }|null}
   */
  _findMatchingSession(activity) {
    const activityId = String(activity.id);

    if (!this.#fitnessHistoryDir || !dirExists(this.#fitnessHistoryDir)) {
      this.#logger.warn?.('strava.enrichment.session_scan.no_history_dir', {
        activityId,
        dir: this.#fitnessHistoryDir,
      });
      return null;
    }

    const BUFFER_MS = 5 * 60 * 1000;
    const MIN_SESSION_SECONDS = 120;

    const tz = this.#configService?.getTimezone?.() || 'America/Los_Angeles';

    const actStart = moment(activity.start_date).tz(tz);
    const actEnd = actStart.clone().add(activity.elapsed_time || activity.moving_time || 0, 'seconds');
    const actStartBuffered = actStart.clone().subtract(BUFFER_MS, 'ms');
    const actEndBuffered = actEnd.clone().add(BUFFER_MS, 'ms');

    const dates = this._resolveScanDates(actStart.unix());
    this.#logger.info?.('strava.enrichment.session_scan.start', {
      activityId,
      dates,
      activityStart: actStart.format(),
      activityEnd: actEnd.format(),
    });

    let filesScanned = 0;
    let bestMatch = null;
    let bestOverlap = 0;

    for (const date of dates) {
      const dateDir = path.join(this.#fitnessHistoryDir, date);
      if (!dirExists(dateDir)) continue;

      const files = listYamlFiles(dateDir);
      filesScanned += files.length;

      for (const filename of files) {
        const filePath = path.join(dateDir, `${filename}.yml`);
        const data = loadYamlSafe(filePath);
        if (!data?.session?.start || !data?.participants) continue;

        const durationSec = data.session.duration_seconds || 0;
        if (durationSec < MIN_SESSION_SECONDS) continue;

        // Fast path: already has this activityId
        for (const participant of Object.values(data.participants)) {
          if (String(participant?.strava?.activityId) === activityId) {
            this.#logger.info?.('strava.enrichment.session_scan.matched', {
              activityId, date, file: filename, matchType: 'activityId',
            });
            return { data, filePath };
          }
        }

        // Time-based matching
        const sessionTz = data.timezone || tz;
        const sessStart = moment.tz(data.session.start, sessionTz);
        const sessEnd = data.session.end
          ? moment.tz(data.session.end, sessionTz)
          : sessStart.clone().add(durationSec, 'seconds');

        const overlapStart = moment.max(actStartBuffered, sessStart);
        const overlapEnd = moment.min(actEndBuffered, sessEnd);
        const overlapMs = overlapEnd.diff(overlapStart);

        if (overlapMs > 0 && overlapMs > bestOverlap) {
          bestOverlap = overlapMs;
          bestMatch = { data, filePath, date, filename };
        }
      }
    }

    if (bestMatch) {
      this.#logger.info?.('strava.enrichment.session_scan.matched', {
        activityId,
        date: bestMatch.date,
        file: bestMatch.filename,
        matchType: 'time-overlap',
        overlapMs: bestOverlap,
      });
      return { data: bestMatch.data, filePath: bestMatch.filePath };
    }

    this.#logger.info?.('strava.enrichment.session_scan.miss', {
      activityId,
      dates,
      filesScanned,
    });
    return null;
  }

  /**
   * @private
   * Resolve which date directories to scan based on event time.
   * Checks today, yesterday, and the event date (if different).
   */
  _resolveScanDates(eventTime) {
    const dates = new Set();
    const now = new Date();

    // Today and yesterday (most common)
    dates.add(this._formatDate(now));
    dates.add(this._formatDate(new Date(now.getTime() - 86400000)));

    // Event date (if provided and different)
    if (eventTime) {
      dates.add(this._formatDate(new Date(eventTime * 1000)));
    }

    return [...dates];
  }

  /**
   * @private
   */
  _formatDate(date) {
    return date.toISOString().slice(0, 10);
  }

  /**
   * @private
   * Ensure the Strava client has a valid access token.
   */
  async _ensureAuth() {
    if (this.#stravaClient.hasAccessToken()) return;

    // Load user auth — default to head of household
    const username = this.#configService.getHeadOfHousehold?.() || 'kckern';
    const auth = this.#authStore?.loadUserAuth?.('strava', username);

    if (!auth?.refresh) {
      this.#logger.error?.('strava.enrichment.auth.no_refresh_token', { username });
      throw new Error(`No Strava refresh token for user: ${username}`);
    }

    this.#logger.info?.('strava.enrichment.auth.refreshing', { username });
    await this.#stravaClient.refreshToken(auth.refresh);
    this.#logger.info?.('strava.enrichment.auth.refreshed', { username });
  }

  /**
   * @private
   * Circuit breaker: check if activityId is on cooldown.
   */
  _isOnCooldown(activityId) {
    const expiry = this.#cooldown.get(String(activityId));
    if (!expiry) return false;
    if (Date.now() > expiry) {
      this.#cooldown.delete(String(activityId));
      return false;
    }
    return true;
  }

  /**
   * @private
   * Circuit breaker: add activityId to cooldown set.
   */
  _addToCooldown(activityId) {
    this.#cooldown.set(String(activityId), Date.now() + COOLDOWN_TTL_MS);
  }
}

export default StravaEnrichmentService;
