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
import { loadYamlSafe, listYamlFiles, dirExists } from '#system/utils/FileIO.mjs';
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
      return false;
    }

    const activityId = String(event.objectId);

    // Circuit breaker: cooldown check
    if (this._isOnCooldown(activityId)) {
      this.#logger.debug?.('strava.enrichment.cooldown_skip', { activityId });
      return false;
    }

    // Circuit breaker: already completed
    const existing = this.#jobStore.findById(activityId);
    if (existing?.status === 'completed') {
      this.#logger.debug?.('strava.enrichment.already_completed', { activityId });
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
    this.#jobStore.update(activityId, {
      attempts: attempt,
      lastAttemptAt: new Date().toISOString(),
    });

    try {
      // Find matching home session
      const session = this._findMatchingSession(activityId, job.eventTime);
      if (!session) {
        this.#logger.debug?.('strava.enrichment.no_match', { activityId, attempt });
        if (attempt < MAX_RETRIES) {
          setTimeout(() => this._attemptEnrichment(activityId), RETRY_INTERVAL_MS);
        } else {
          this.#jobStore.update(activityId, { status: 'unmatched' });
          this.#logger.warn?.('strava.enrichment.unmatched', { activityId, attempts: attempt });
        }
        return;
      }

      // Ensure we have a fresh access token
      await this._ensureAuth();

      // Get current activity state (for skip logic)
      const currentActivity = await this.#stravaClient.getActivity(activityId);

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
   * Scan fitness history for a session matching a Strava activityId.
   * @param {string} activityId
   * @param {number} [eventTime] - Unix timestamp from webhook (for date hint)
   * @returns {Object|null} Parsed session YAML data
   */
  _findMatchingSession(activityId, eventTime) {
    if (!this.#fitnessHistoryDir || !dirExists(this.#fitnessHistoryDir)) return null;

    // Determine which dates to scan
    const dates = this._resolveScanDates(eventTime);

    for (const date of dates) {
      const dateDir = path.join(this.#fitnessHistoryDir, date);
      if (!dirExists(dateDir)) continue;

      const files = listYamlFiles(dateDir);
      for (const filename of files) {
        const filePath = path.join(dateDir, `${filename}.yml`);
        const data = loadYamlSafe(filePath);
        if (!data?.participants) continue;

        // Check each participant for matching strava.activityId
        for (const participant of Object.values(data.participants)) {
          if (String(participant?.strava?.activityId) === String(activityId)) {
            return data;
          }
        }
      }
    }

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
      throw new Error(`No Strava refresh token for user: ${username}`);
    }

    await this.#stravaClient.refreshToken(auth.refresh);
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
