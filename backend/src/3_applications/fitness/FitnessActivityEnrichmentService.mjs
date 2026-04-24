/**
 * FitnessActivityEnrichmentService
 *
 * Orchestrates the enrichment of fitness provider activities with DaylightStation
 * session data (media titles, voice memos, episode descriptions).
 *
 * Flow:
 * 1. Receive webhook event → check circuit breaker → write durable job
 * 2. Scan fitness history for matching activityId
 * 3. Build enrichment payload (title + description)
 * 4. PUT to provider API via stravaClient port
 * 5. Update job status
 *
 * Circuit breaker (3 layers):
 * - shouldEnrich() in adapter: only 'create' events
 * - Cooldown set: recently-enriched activityIds (1hr TTL)
 * - Job store: completed jobs are skipped
 *
 * @module applications/fitness/FitnessActivityEnrichmentService
 */

import path from 'path';
import moment from 'moment-timezone';
import { loadYamlSafe, listYamlFiles, dirExists, saveYaml } from '#system/utils/FileIO.mjs';
import { buildStravaDescription } from '../../1_adapters/fitness/buildStravaDescription.mjs';
import { buildSelectionConfig } from '../../1_adapters/fitness/selectPrimaryMedia.mjs';
import { userService } from '#system/config/index.mjs';
import { buildStravaSessionTimeline } from '../../2_domains/fitness/services/StravaSessionBuilder.mjs';
import { encodeSingleSeries } from '../../2_domains/fitness/services/TimelineService.mjs';

const MAX_RETRIES = 3;
const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_TTL_MS = 60 * 60 * 1000;  // 1 hour

export class FitnessActivityEnrichmentService {
  #stravaClient;
  #jobStore;
  #authStore;
  #configService;
  #fitnessHistoryDir;
  #reconciliationService;
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
   * @param {Object} [config.reconciliationService] - StravaReconciliationService instance
   * @param {Object} [config.logger]
   */
  constructor({ stravaClient, jobStore, authStore, configService, fitnessHistoryDir, reconciliationService, logger = console }) {
    this.#stravaClient = stravaClient;
    this.#jobStore = jobStore;
    this.#authStore = authStore;
    this.#configService = configService;
    this.#fitnessHistoryDir = fitnessHistoryDir;
    this.#reconciliationService = reconciliationService || null;
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
   * Attempt to enrich a provider activity. Schedules retries on failure.
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

      // Fetch activity from provider (need start_date + duration for time matching)
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
        if (attempt < MAX_RETRIES) {
          this.#logger.info?.('strava.enrichment.no_match', { activityId, attempt });
          setTimeout(() => this._attemptEnrichment(activityId), RETRY_INTERVAL_MS);
          return;
        }

        // No matching home session after retries — create a Strava-only session
        this.#logger.info?.('strava.enrichment.creating_strava_session', {
          activityId,
          activityName: currentActivity.name,
          activityType: currentActivity.type,
        });

        const created = await this._createStravaOnlySession(currentActivity, this.#stravaClient);
        this.#jobStore.update(activityId, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          matchedSessionId: created?.sessionId || null,
          note: 'created-strava-session',
        });
        this._addToCooldown(activityId);
        return;
      }

      const session = match.data;

      // Write provider data back to session YAML (if not already linked)
      const username = this.#configService.getHeadOfHousehold?.() || 'kckern';
      if (session.participants?.[username] && !session.participants[username]?.strava?.activityId) {
        session.participants[username].strava = {
          activityId: currentActivity.id,
          type: currentActivity.type || currentActivity.sport_type || null,
          sufferScore: currentActivity.suffer_score || null,
          deviceName: currentActivity.device_name || null,
          calories: currentActivity.calories || null,
          avgHeartrate: currentActivity.average_heartrate || null,
          maxHeartrate: currentActivity.max_heartrate || null,
        };

        const savePath = match.filePath.replace(/\.yml$/, '');
        saveYaml(savePath, session);

        this.#logger.info?.('strava.enrichment.session_writeback', {
          activityId,
          sessionId: session.sessionId || session.session?.id,
          filePath: match.filePath,
        });
      }

      // Build selection config for primary media selection
      const selectionConfig = buildSelectionConfig(this.#configService.getAppConfig('fitness')?.plex);

      // Build enrichment payload
      const enrichment = buildStravaDescription(session, currentActivity, selectionConfig);
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

      // Push to provider
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

      // Non-blocking background reconciliation
      this.#reconciliationService?.reconcile().catch(err => {
        this.#logger.warn?.('strava.reconciliation.error', { error: err?.message });
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
   * Find a home fitness session matching a provider activity by time overlap.
   *
   * Two-pass approach:
   *  1. Fast path: check if any session already has this strava.activityId
   *  2. Time match: overlap the activity window against session windows (5-min buffer)
   *
   * @param {Object} activity - Provider activity object (start_date, moving_time, elapsed_time, id)
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
   * Ensure the provider client has a valid access token.
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
   * Create a new session YAML for a Strava activity that has no matching home session.
   * @param {Object} activity - Strava activity object from API
   * @returns {{ sessionId: string, filePath: string }}
   */
  async _createStravaOnlySession(activity, stravaClient = null) {
    const tz = this.#configService?.getTimezone?.() || 'America/Los_Angeles';
    const username = this.#configService.getHeadOfHousehold?.() || 'kckern';
    const startLocal = moment(activity.start_date).tz(tz);
    const sessionId = startLocal.format('YYYYMMDDHHmmss');
    const date = startLocal.format('YYYY-MM-DD');
    const durationSeconds = activity.elapsed_time || activity.moving_time || 0;
    const endLocal = startLocal.clone().add(durationSeconds, 'seconds');

    // Fetch HR data and build timeline
    let timelineData = null;
    const hrPerSecond = await this._fetchHRData(activity, stravaClient);
    if (hrPerSecond) {
      timelineData = buildStravaSessionTimeline(hrPerSecond);
    }

    const timelineSeries = {};
    let totalCoins = 0;
    let buckets = { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 };
    let participantSummary = {};

    if (timelineData) {
      timelineSeries[`${username}:hr`] = encodeSingleSeries(timelineData.hrSamples);
      timelineSeries[`${username}:zone`] = encodeSingleSeries(timelineData.zoneSeries);
      timelineSeries[`${username}:coins`] = encodeSingleSeries(timelineData.coinsSeries);
      timelineSeries['global:coins'] = encodeSingleSeries(timelineData.coinsSeries);
      totalCoins = timelineData.totalCoins;
      buckets = timelineData.buckets;
      participantSummary = {
        coins: timelineData.totalCoins,
        hr_avg: timelineData.hrStats.hrAvg,
        hr_max: timelineData.hrStats.hrMax,
        hr_min: timelineData.hrStats.hrMin,
        zone_minutes: timelineData.zoneMinutes,
      };
    }

    // Build map data if GPS exists
    let mapData = null;
    if (activity.map?.summary_polyline) {
      mapData = {
        polyline: activity.map.summary_polyline,
        startLatLng: activity.start_latlng || [],
        endLatLng: activity.end_latlng || [],
      };
    }

    const sessionData = {
      version: 3,
      sessionId,
      session: {
        id: sessionId,
        date,
        start: startLocal.format('YYYY-MM-DD HH:mm:ss'),
        end: endLocal.format('YYYY-MM-DD HH:mm:ss'),
        duration_seconds: durationSeconds,
        source: 'strava',
      },
      timezone: tz,
      participants: {
        [username]: {
          display_name: userService.resolveDisplayName(username),
          is_primary: true,
          strava: {
            activityId: activity.id,
            type: activity.type || activity.sport_type || null,
            sufferScore: activity.suffer_score || null,
            deviceName: activity.device_name || null,
            calories: activity.calories || null,
            avgHeartrate: activity.average_heartrate || null,
            maxHeartrate: activity.max_heartrate || null,
          },
        },
      },
      strava: {
        activityId: activity.id,
        name: activity.name || null,
        type: activity.type || null,
        sportType: activity.sport_type || null,
        movingTime: activity.moving_time || 0,
        distance: activity.distance || 0,
        totalElevationGain: activity.total_elevation_gain || 0,
        trainer: activity.trainer ?? true,
        avgHeartrate: activity.average_heartrate || null,
        maxHeartrate: activity.max_heartrate || null,
        ...(mapData ? { map: mapData } : {}),
      },
      timeline: {
        series: timelineSeries,
        events: [],
        interval_seconds: 5,
        tick_count: timelineData ? timelineData.hrSamples.length : Math.ceil(durationSeconds / 5),
        encoding: 'rle',
      },
      treasureBox: { coinTimeUnitMs: 5000, totalCoins, buckets },
      summary: {
        participants: participantSummary.coins != null ? { [username]: participantSummary } : {},
        media: [],
        coins: { total: totalCoins, buckets },
        challenges: { total: 0, succeeded: 0, failed: 0 },
        voiceMemos: [],
      },
    };

    // Write to fitness history
    const sessionDir = path.join(this.#fitnessHistoryDir, date);
    if (!dirExists(sessionDir)) {
      const { mkdirSync } = await import('fs');
      mkdirSync(sessionDir, { recursive: true });
    }
    const filePath = path.join(sessionDir, `${sessionId}.yml`);
    saveYaml(filePath.replace(/\.yml$/, ''), sessionData);

    this.#logger.info?.('strava.enrichment.strava_session_created', {
      sessionId,
      activityId: activity.id,
      name: activity.name,
      type: activity.type,
      filePath,
    });

    return { sessionId, filePath };
  }

  /**
   * @private
   * Fetch per-second heart rate data from Strava activity streams.
   * @param {Object} activity - Strava activity object
   * @param {Object} stravaClient - StravaClientAdapter instance
   * @returns {number[]|null} Per-second HR array, or null
   */
  async _fetchHRData(activity, stravaClient) {
    if (!stravaClient || !activity.has_heartrate) return null;

    try {
      const streams = await stravaClient.getActivityStreams(activity.id, ['heartrate']);
      if (streams?.heartrate?.data?.length > 1) {
        this.#logger.info?.('strava.enrichment.hr_from_api', {
          activityId: activity.id,
          samples: streams.heartrate.data.length,
        });
        return streams.heartrate.data;
      }
    } catch (err) {
      this.#logger.warn?.('strava.enrichment.hr_fetch_failed', {
        activityId: activity.id,
        error: err?.message,
      });
    }

    return null;
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

  /**
   * Re-enrich a Strava activity description after a voice memo is added.
   * Loads the session from disk, injects the new memo into timeline events,
   * rebuilds the description, and pushes to Strava if it changed.
   *
   * Fire-and-forget — callers should .catch() errors.
   *
   * @param {string} sessionId - Session ID (YYYYMMDDHHmmss format)
   * @param {Object} newMemo - Transcribed memo object from VoiceMemoTranscriptionService
   * @param {string} newMemo.transcriptClean - Cleaned transcript text
   * @param {number} [newMemo.startedAt] - Memo start timestamp (epoch ms)
   * @param {number} [newMemo.durationSeconds] - Memo duration
   */
  async reEnrichDescription(sessionId, newMemo) {
    if (!sessionId || !newMemo?.transcriptClean) return;

    // Derive date directory from sessionId (first 8 chars = YYYYMMDD)
    const dateStr = `${sessionId.slice(0, 4)}-${sessionId.slice(4, 6)}-${sessionId.slice(6, 8)}`;
    const filePath = path.join(this.#fitnessHistoryDir, dateStr, `${sessionId}.yml`);
    const session = loadYamlSafe(filePath);

    if (!session) {
      this.#logger.debug?.('strava.voice_memo_backfill.no_session', { sessionId, filePath });
      return;
    }

    // Extract activityId from session
    const activityId = this.#extractActivityId(session);
    if (!activityId) {
      this.#logger.debug?.('strava.voice_memo_backfill.no_activity_id', { sessionId });
      return;
    }

    // Inject the new memo into a copy of timeline events (session on disk doesn't have it yet)
    const augmentedSession = {
      ...session,
      timeline: {
        ...session.timeline,
        events: [
          ...(session.timeline?.events || []),
          {
            timestamp: newMemo.startedAt || Date.now(),
            type: 'voice_memo',
            data: {
              transcript: newMemo.transcriptClean,
              duration_seconds: newMemo.durationSeconds || 0,
            },
          },
        ],
      },
    };

    // Build selection config for primary media selection
    const selectionConfig = buildSelectionConfig(this.#configService.getAppConfig('fitness')?.plex);

    // Build fresh description with the new memo included
    const enrichment = buildStravaDescription(augmentedSession, {}, selectionConfig);
    if (!enrichment?.description) {
      this.#logger.debug?.('strava.voice_memo_backfill.no_description', { sessionId, activityId });
      return;
    }

    // Ensure auth
    await this._ensureAuth();

    // Fetch current Strava activity to compare
    const currentActivity = await this.#stravaClient.getActivity(activityId);
    if (currentActivity?.description?.trim() === enrichment.description.trim()) {
      this.#logger.debug?.('strava.voice_memo_backfill.unchanged', { sessionId, activityId });
      return;
    }

    // Push description only
    await this.#stravaClient.updateActivity(activityId, { description: enrichment.description });

    this.#logger.info?.('strava.voice_memo_backfill.pushed', {
      sessionId,
      activityId,
      descriptionLength: enrichment.description.length,
    });
  }

  /**
   * Extract a Strava activityId from session data.
   * @private
   */
  #extractActivityId(session) {
    if (session.strava?.activityId) return String(session.strava.activityId);
    for (const participant of Object.values(session.participants || {})) {
      if (participant?.strava?.activityId) return String(participant.strava.activityId);
    }
    return null;
  }
}

export default FitnessActivityEnrichmentService;
