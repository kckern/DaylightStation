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
 * 4. PUT to provider API via activityGateway port (IActivityGateway)
 * 5. Update job status
 *
 * Circuit breaker (3 layers):
 * - shouldEnrich() in adapter: only 'create' events
 * - Cooldown set: recently-enriched activityIds (1hr TTL)
 * - Job store: completed jobs are skipped
 *
 * @module applications/fitness/FitnessActivityEnrichmentService
 */

import moment from 'moment-timezone';
import { buildActivityDescription } from '#domains/fitness/services/buildActivityDescription.mjs';
import { evaluateActivitySessionMatch } from '#domains/fitness/services/activitySessionMatch.mjs';
import { absorbOverlappingSlivers } from './sliverAbsorption.mjs';
import { buildStravaSessionTimeline } from '../../2_domains/fitness/services/StravaSessionBuilder.mjs';

const MAX_RETRIES = 3;
const MAX_TOTAL_ATTEMPTS = 10;            // hard cap before abandoning
const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_TTL_MS = 60 * 60 * 1000;  // 1 hour
// Match guards (venue, membership, presence, overlap) live in
// #domains/fitness/services/activitySessionMatch.mjs so this path and the
// harvester's cannot drift apart again.

export class FitnessActivityEnrichmentService {
  #activityGateway;
  #jobStore;
  #userContext;
  #ensureActivityAccess;
  #selectionConfig;
  #resolveDisplayName;
  #reconciliationService;
  #logger;
  #historyRepository;
  #scheduleRetry;

  // Circuit breaker: in-memory cooldown of recently-enriched activity IDs
  #cooldown = new Map(); // activityId → expiry timestamp

  /**
   * @param {Object} config
   * @param {Object} config.activityGateway - IActivityGateway implementation (external activity provider)
   * @param {Object} config.jobStore - Webhook job store instance
   * @param {Object} config.userContext - Default athlete and timezone projection
   * @param {Function} config.ensureActivityAccess - Ensure provider access is ready
   * @param {Object} config.selectionConfig - Primary-media selection config (from buildSelectionConfig)
   * @param {Function} [config.resolveDisplayName] - (userId) => display name; defaults to identity
   * @param {string} config.fitnessHistoryDir - Path to fitness history dir
   * @param {Object} [config.reconciliationService] - ActivityReconciliationService instance
   * @param {Object} [config.logger]
   */
  constructor({ activityGateway, jobStore, userContext, ensureActivityAccess, scheduleRetry, selectionConfig, resolveDisplayName, historyRepository, reconciliationService, logger = console }) {
    this.#activityGateway = activityGateway;
    this.#jobStore = jobStore;
    this.#userContext = userContext || { defaultUserId: () => 'user_1', timezone: () => 'America/Los_Angeles' };
    this.#ensureActivityAccess = ensureActivityAccess || (async () => {});
    this.#scheduleRetry = scheduleRetry || (() => { throw new Error('FitnessActivityEnrichmentService requires scheduleRetry'); });
    this.#selectionConfig = selectionConfig;
    this.#resolveDisplayName = resolveDisplayName || ((userId) => userId);
    this.#historyRepository = historyRepository;
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
    if (job.status === 'abandoned') return;

    if ((job.attempts || 0) >= MAX_TOTAL_ATTEMPTS) {
      this.#logger.warn?.('strava.enrichment.abandoned', {
        activityId,
        attempts: job.attempts,
      });
      this.#jobStore.update(activityId, {
        status: 'abandoned',
        abandonedAt: new Date().toISOString(),
      });
      return;
    }

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
      const currentActivity = await this.#activityGateway.getActivity(activityId);
      if (!currentActivity?.start_date) {
        this.#logger.warn?.('strava.enrichment.activity_fetch_failed', { activityId });
        if (attempt < MAX_RETRIES) {
          this.#scheduleRetry(() => this._attemptEnrichment(activityId), RETRY_INTERVAL_MS);
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
          this.#scheduleRetry(() => this._attemptEnrichment(activityId), RETRY_INTERVAL_MS);
          return;
        }

        // No matching home session after retries — create a Strava-only session
        this.#logger.info?.('strava.enrichment.creating_strava_session', {
          activityId,
          activityName: currentActivity.name,
          activityType: currentActivity.type,
        });

        const created = await this._createStravaOnlySession(currentActivity, this.#activityGateway);
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
      const username = this.#userContext.defaultUserId?.() || 'user_1';
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

        this.#historyRepository.save(match.sessionId, session);

        this.#logger.info?.('strava.enrichment.session_writeback', {
          activityId,
          sessionId: match.sessionId,
        });
      }

      // Build selection config for primary media selection
      const selectionConfig = this.#selectionConfig;

      // Build enrichment payload
      const enrichment = buildActivityDescription(session, currentActivity, selectionConfig);
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

      await this.#activityGateway.updateActivity(activityId, updatePayload);

      // Record provenance of what we pushed so reconciliation can later tell
      // our pushes apart from manual Strava edits (and propagate local
      // corrections without clobbering the user's hand edits).
      if (!session.strava) session.strava = {};
      session.strava.pushed = {
        name: updatePayload.name ?? session.strava.pushed?.name ?? currentActivity.name ?? null,
        description: updatePayload.description ?? session.strava.pushed?.description ?? currentActivity.description ?? null,
        at: new Date().toISOString(),
      };
      this.#historyRepository.save(match.sessionId, session);

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
        this.#scheduleRetry(() => this._attemptEnrichment(activityId), RETRY_INTERVAL_MS);
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

    if (!this.#historyRepository?.isAvailable()) {
      this.#logger.warn?.('strava.enrichment.session_scan.no_history_dir', {
        activityId,
      });
      return null;
    }

    const MIN_SESSION_SECONDS = 120;

    const tz = this.#userContext.timezone?.() || 'America/Los_Angeles';
    // The athlete whose activity this is — the guards need to know whose
    // presence in the session to measure.
    const matchUsername = this.#userContext.defaultUserId?.() || 'user_1';

    const actStart = moment(activity.start_date).tz(tz);
    const actEnd = actStart.clone().add(activity.elapsed_time || activity.moving_time || 0, 'seconds');

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
      const records = this.#historyRepository.list(date);
      filesScanned += records.length;

      for (const { id: filename, data } of records) {
        if (!data?.session?.start || !data?.participants) continue;

        const durationSec = data.session.duration_seconds || 0;
        if (durationSec < MIN_SESSION_SECONDS) continue;

        // Fast path: already has this activityId
        for (const participant of Object.values(data.participants)) {
          if (String(participant?.strava?.activityId) === activityId) {
            this.#logger.info?.('strava.enrichment.session_scan.matched', {
              activityId, date, file: filename, matchType: 'activityId',
            });
            return { data, sessionId: filename };
          }
        }

        // Membership, venue, overlap and presence guards — shared with the
        // harvester. An outdoor activity cannot be a garage session, and a
        // strap that drifts through range is not a participant who did the
        // work (see the 2026-07-25 incident in the domain module's header).
        const verdict = evaluateActivitySessionMatch({
          activity,
          session: data,
          username: matchUsername,
          tz,
        });

        if (!verdict.ok) {
          this.#logger.info?.('strava.enrichment.session_scan.rejected', {
            activityId,
            file: filename,
            reason: verdict.reason,
            venue: verdict.venue,
            overlapFraction: verdict.overlapFraction,
            presenceMeasured: verdict.presenceMeasured,
            presenceSeconds: verdict.presenceSeconds,
          });
          continue;
        }

        if (verdict.overlapMs > bestOverlap) {
          bestOverlap = verdict.overlapMs;
          bestMatch = { data, sessionId: filename, date, filename };
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
      return { data: bestMatch.data, sessionId: bestMatch.sessionId };
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
    await this.#ensureActivityAccess(this.#userContext.defaultUserId?.() || 'user_1');
  }

  /**
   * @private
   * Create a new session YAML for a Strava activity that has no matching home session.
   * @param {Object} activity - Strava activity object from API
   * @returns {{ sessionId: string, filePath: string }}
   */
  async _createStravaOnlySession(activity, activityGateway = null) {
    const tz = this.#userContext.timezone?.() || 'America/Los_Angeles';
    const username = this.#userContext.defaultUserId?.() || 'user_1';
    const startLocal = moment(activity.start_date).tz(tz);
    const sessionId = startLocal.format('YYYYMMDDHHmmss');
    const date = startLocal.format('YYYY-MM-DD');
    const durationSeconds = activity.elapsed_time || activity.moving_time || 0;
    const endLocal = startLocal.clone().add(durationSeconds, 'seconds');

    // Fetch HR data and build timeline
    let timelineData = null;
    const hrPerSecond = await this._fetchHRData(activity, activityGateway);
    if (hrPerSecond) {
      timelineData = buildStravaSessionTimeline(hrPerSecond);
    }

    const timelineSeries = {};
    let totalRings = 0;
    let buckets = { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 };
    let participantSummary = {};

    if (timelineData) {
      timelineSeries[`${username}:hr`] = timelineData.hrSamples;
      timelineSeries[`${username}:zone`] = timelineData.zoneSeries;
      timelineSeries[`${username}:rings`] = timelineData.ringsSeries;
      timelineSeries['global:rings'] = timelineData.ringsSeries;
      totalRings = timelineData.totalRings;
      buckets = timelineData.buckets;
      participantSummary = {
        rings: timelineData.totalRings,
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
          display_name: this.#resolveDisplayName(username),
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
      treasureBox: { ringTimeUnitMs: 5000, totalRings, buckets },
      summary: {
        participants: participantSummary.rings != null ? { [username]: participantSummary } : {},
        media: [],
        rings: { total: totalRings, buckets },
        challenges: { total: 0, succeeded: 0, failed: 0 },
        voiceMemos: [],
      },
    };

    // Write to fitness history
    const stored = this.#historyRepository.save(sessionId, sessionData);
    const filePath = stored?.locator ?? null;

    this.#logger.info?.('strava.enrichment.strava_session_created', {
      sessionId,
      activityId: activity.id,
      name: activity.name,
      type: activity.type,
      filePath,
    });

    // Absorb any HR-only cooldown/passing-through slivers in this date dir
    // that overlap the activity window. Strava is the source of truth for
    // the real workout; standalone HR slivers caught at home during cooldown
    // are redundant and would otherwise show up as phantom sessions.
    absorbOverlappingSlivers(activity, this.#historyRepository.list(date), {
      justCreatedSessionId: sessionId,
      tz,
      logger: this.#logger,
      removeSession: id => this.#historyRepository.remove(id),
    });

    return { sessionId, filePath };
  }

  /**
   * @private
   * Fetch per-second heart rate data from Strava activity streams.
   * @param {Object} activity - Strava activity object
   * @param {Object} activityGateway - IActivityGateway implementation
   * @returns {number[]|null} Per-second HR array, or null
   */
  async _fetchHRData(activity, activityGateway) {
    if (!activityGateway || !activity.has_heartrate) return null;

    try {
      const streams = await activityGateway.getActivityStreams(activity.id, ['heartrate']);
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
    const session = this.#historyRepository.find(sessionId)?.data;

    if (!session) {
      this.#logger.debug?.('strava.voice_memo_backfill.no_session', { sessionId });
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
    const selectionConfig = this.#selectionConfig;

    // Build fresh description with the new memo included
    const enrichment = buildActivityDescription(augmentedSession, {}, selectionConfig);
    if (!enrichment?.description) {
      this.#logger.debug?.('strava.voice_memo_backfill.no_description', { sessionId, activityId });
      return;
    }

    // Ensure auth
    await this._ensureAuth();

    // Fetch current Strava activity to compare
    const currentActivity = await this.#activityGateway.getActivity(activityId);
    if (currentActivity?.description?.trim() === enrichment.description.trim()) {
      this.#logger.debug?.('strava.voice_memo_backfill.unchanged', { sessionId, activityId });
      return;
    }

    // Push description only
    await this.#activityGateway.updateActivity(activityId, { description: enrichment.description });

    // Record provenance of the pushed description so a later reconcile treats
    // it as ours rather than a manual edit.
    if (!session.strava) session.strava = {};
    session.strava.pushed = {
      name: session.strava.pushed?.name ?? currentActivity?.name ?? null,
      description: enrichment.description,
      at: new Date().toISOString(),
    };
    this.#historyRepository.save(sessionId, session);

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
