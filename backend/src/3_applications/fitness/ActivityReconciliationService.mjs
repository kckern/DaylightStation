/**
 * ActivityReconciliationService
 *
 * Scans recent fitness sessions and reconciles them with an external activity
 * provider (via IActivityGateway; Strava is the current implementation):
 *   Pass 1 (Session → Provider): Re-enrich missed or stale activities
 *   Pass 2 (Provider → Session): Pull manually-entered provider descriptions
 *                                back as strava_notes, and keep the session's
 *                                copy of the activity title current
 *
 * Triggered non-blocking after each provider webhook enrichment.
 *
 * @module applications/fitness/ActivityReconciliationService
 */

import moment from 'moment-timezone';
import { buildActivityDescription, extractUserNotes } from '#domains/fitness/services/buildActivityDescription.mjs';
import { absorbOverlappingSlivers } from './sliverAbsorption.mjs';
import { buildStravaSessionTimeline, applyStravaTimeline } from '#domains/fitness/services/StravaSessionBuilder.mjs';
import { checkSessionIntegrity } from '#domains/fitness/services/sessionIntegrity.mjs';

const RECONCILE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const INTER_SESSION_DELAY_MS = 200;
// Cap on Pass 4 stream fetches per sweep; any backlog waits for the next hour.
const MAX_TIMELINE_REBUILDS_PER_SWEEP = 10;

export class ActivityReconciliationService {
  #activityGateway;
  #lookbackDays;
  #selectionConfig;
  #timezone;
  #logger;
  #historyRepository;
  #pause;
  #ensureAccess;
  #health;

  /**
   * @param {Object} config
   * @param {Object} config.activityGateway - IActivityGateway implementation (shared, already authenticated)
   * @param {number} config.lookbackDays - Days of session history to sweep
   * @param {Object} config.selectionConfig - Primary-media selection config (from buildSelectionConfig)
   * @param {string} config.timezone - IANA timezone for the date-range sweep
   * @param {{list: Function, save: Function, remove: Function}} config.historyRepository - Fitness session persistence
   * @param {Function} [config.ensureAccess] - Refresh provider auth before a sweep. The
   *   hourly sweep runs on its own schedule; without this it only worked in the
   *   hours after a webhook happened to refresh the token.
   * @param {{recordSweep: Function}} [config.health] - sync-health monitor (StravaSyncHealth)
   * @param {Object} [config.logger]
   */
  constructor({ activityGateway, lookbackDays, selectionConfig, timezone, historyRepository, pause = async () => {}, ensureAccess = async () => {}, health = null, logger = console }) {
    if (!historyRepository || typeof historyRepository.list !== 'function'
      || typeof historyRepository.save !== 'function' || typeof historyRepository.remove !== 'function') {
      throw new TypeError('ActivityReconciliationService requires historyRepository with list(), save(), and remove()');
    }
    this.#activityGateway = activityGateway;
    this.#lookbackDays = lookbackDays;
    this.#selectionConfig = selectionConfig;
    this.#timezone = timezone;
    this.#historyRepository = historyRepository;
    this.#logger = logger;
    this.#pause = pause;
    this.#ensureAccess = ensureAccess;
    this.#health = health;
  }

  /**
   * Run reconciliation across the lookback window.
   */
  async reconcile() {
    const lookbackDays = this.#lookbackDays;
    const tz = this.#timezone || 'America/Los_Angeles';
    const selectionConfig = this.#selectionConfig;

    const dates = this.#buildDateRange(lookbackDays, tz);
    this.#logger.info?.('strava.reconciliation.start', { lookbackDays, dates: dates.length });

    try {
      await this.#ensureAccess();
    } catch (err) {
      this.#logger.warn?.('strava.reconciliation.auth_failed', { error: err?.message });
      this.#health?.recordSweep?.({ ok: false, error: `sign-in failed: ${err?.message}` });
      return;
    }

    let sessionsProcessed = 0;
    let enriched = 0;
    let notesPulled = 0;
    let echoesDropped = 0;
    let titlesSynced = 0;
    let sessionErrors = 0;
    let lastError = null;
    let timelinesRebuilt = 0;
    let rebuildBudget = MAX_TIMELINE_REBUILDS_PER_SWEEP;
    const flagged = new Set();
    const unresolved = [];
    let sliversAbsorbed = 0;

    for (const date of dates) {
      const records = this.#historyRepository.list(date);
      for (const { id: sessionId, data: session } of records) {

        // Find strava activityId from session or participants
        const activityId = this.#extractActivityId(session);
        if (!activityId) continue;

        // Integrity is scanned for every Strava-only session, cooldown or not,
        // so the health monitor sees a stable list (no API call involved).
        const needsTimeline = session.session?.source === 'strava' && !checkSessionIntegrity(session).ok;
        if (needsTimeline) flagged.add(sessionId);

        // Staleness check: skip if reconciled within the last hour
        const lastReconciled = session.strava?.last_reconciled_at;
        if (lastReconciled) {
          const elapsed = Date.now() - new Date(lastReconciled).getTime();
          if (elapsed < RECONCILE_COOLDOWN_MS) continue;
        }

        try {
          const activity = await this.#activityGateway.getActivity(activityId);
          if (!activity) continue;

          // Pass 2 runs before pass 1: Strava → Session (pull notes). The
          // push then builds from notes that are already settled — an echo
          // dropped, a typed note recovered from a 📝 block — instead of
          // overwriting Strava with a description that lacks them.
          const notes = this.#pass2StravaToSession(session, activity);
          if (notes.pulled) notesPulled++;
          if (notes.dropped) echoesDropped++;
          const didPull = notes.pulled || notes.dropped;

          // Pass 1: Session → Strava (re-enrichment)
          const didEnrich = await this.#pass1SessionToStrava(session, activity, selectionConfig);
          if (didEnrich) enriched++;

          const didRetitle = this.#syncTitle(session, activity, didEnrich);
          if (didRetitle) titlesSynced++;

          // Pass 4: Strava-only timeline integrity (grow-only rebuild)
          let didRebuild = false;
          if (needsTimeline) {
            const outcome = rebuildBudget > 0
              ? await this.#pass4RebuildTimeline(sessionId, session, activityId)
              : { rebuilt: false, reason: 'budget' };
            if (outcome.rebuilt) {
              rebuildBudget--;
              timelinesRebuilt++;
              didRebuild = true;
              Object.assign(session, outcome.session);
              flagged.delete(sessionId);
            } else if (outcome.reason !== 'budget') {
              if (outcome.fetched) rebuildBudget--;
              unresolved.push({ sessionId, reason: outcome.reason });
            }
          }

          // Update staleness tracker
          if (!session.strava) session.strava = {};
          session.strava.last_reconciled_at = new Date().toISOString();

          // Save session if anything changed
          if (didEnrich || didPull || didRetitle || didRebuild || !lastReconciled) {
            this.#historyRepository.save(sessionId, session);
          }

          // Pass 3: Sliver absorption (only for Strava-only sessions).
          // If this session was the result of _createStravaOnlySession (or
          // an equivalent backfill), look for adjacent HR-only home slivers
          // in the same date dir and delete them. Catches the cases where
          // the original webhook either failed to absorb or never fired.
          if (session.session?.source === 'strava') {
            const result = absorbOverlappingSlivers(activity, records, {
              justCreatedSessionId: session.sessionId || session.session?.id,
              tz,
              logger: this.#logger,
              removeSession: id => this.#historyRepository.remove(id),
            });
            sliversAbsorbed += result.absorbed.length;
          }

          sessionsProcessed++;

          // Rate limit: small delay between sessions
          await this.#pause(INTER_SESSION_DELAY_MS);
        } catch (err) {
          sessionErrors++;
          lastError = err?.message || String(err);
          this.#logger.warn?.('strava.reconciliation.session_error', {
            activityId,
            sessionId: session.sessionId || session.session?.id,
            error: err?.message,
          });
        }
      }
    }

    this.#logger.info?.('strava.reconciliation.complete', {
      sessionsProcessed,
      enriched,
      notesPulled,
      echoesDropped,
      titlesSynced,
      timelinesRebuilt,
      sessionErrors,
      unresolved: unresolved.length,
      sliversAbsorbed,
    });

    const attempted = sessionsProcessed + sessionErrors;
    this.#health?.recordSweep?.({
      ok: attempted === 0 || sessionErrors * 2 <= attempted,
      processed: sessionsProcessed,
      errors: sessionErrors,
      error: lastError,
      flagged: [...flagged],
      unresolved,
    });
  }

  /**
   * Pass 1: Re-enrich Strava activities that were missed or have stale
   * title/description — including propagating LOCAL corrections (e.g. a
   * session split that changed the primary media) back to Strava.
   *
   * Provenance rule: a field is overwritten only if Strava still holds the
   * value we last pushed (`session.strava.pushed`), i.e. the user has not
   * manually edited it on Strava. For sessions enriched before provenance
   * tracking existed, fall back to the legacy heuristic — an em-dash title is
   * treated as ours (DaylightStation titles are always `Show—Episode`) and an
   * empty description is treated as fillable. This lets already-stale sessions
   * self-heal on the first reconcile after this ships.
   *
   * @returns {boolean} Whether an update was pushed to Strava
   */
  async #pass1SessionToStrava(session, activity, selectionConfig) {
    // Build what we would enrich with (pass {} so the builder never short-circuits)
    const enrichment = buildActivityDescription(session, {}, selectionConfig);
    if (!enrichment) return false;

    const pushed = session.strava?.pushed || {};
    const updatePayload = {};

    // --- Title ---
    // Overwrite only if the title changed AND Strava still holds what we last
    // pushed (provenance). Legacy fallback when no provenance recorded: an
    // em-dash title is ours, or the title is unset — so already-stale sessions
    // self-heal.
    if (enrichment.name && enrichment.name !== activity.name) {
      const titleIsOurs = pushed.name != null
        ? activity.name === pushed.name
        : (!activity.name?.trim() || activity.name.includes('—'));
      if (titleIsOurs) updatePayload.name = enrichment.name;
    }

    // --- Description ---
    // Same provenance rule. Legacy fallback: fill when empty, or refresh when
    // the title is ours (matches prior stale-description behavior).
    if (enrichment.description && enrichment.description !== activity.description) {
      const descIsOurs = pushed.description != null
        ? activity.description === pushed.description
        : (!activity.description?.trim() || activity.name?.includes('—'));
      if (descIsOurs) updatePayload.description = enrichment.description;
    }

    if (Object.keys(updatePayload).length === 0) return false;

    await this.#activityGateway.updateActivity(String(activity.id), updatePayload);

    // Record provenance so future manual edits on Strava are respected and not
    // clobbered by a later reconcile.
    if (!session.strava) session.strava = {};
    session.strava.pushed = {
      name: updatePayload.name ?? pushed.name ?? activity.name ?? null,
      description: updatePayload.description ?? pushed.description ?? activity.description ?? null,
      at: new Date().toISOString(),
    };

    this.#logger.info?.('strava.reconciliation.enriched', {
      activityId: activity.id,
      fields: Object.keys(updatePayload),
    });
    return true;
  }

  /**
   * Pass 2: Pull manually-entered Strava descriptions back into session YAML.
   *
   * Only text a person typed is pulled — every block we generated is stripped
   * by extractUserNotes. Pulling our own description back made the next push
   * nest it inside a 📝 block, duplicating the voice memo and media list.
   *
   * @returns {{pulled: boolean, dropped: boolean}} Whether typed notes were
   *   pulled, and whether stored notes were dropped as an echo
   */
  #pass2StravaToSession(session, activity) {
    const sessionId = session.sessionId || session.session?.id;
    const result = { pulled: false, dropped: false };

    // Never overwrite notes a person typed. Notes that are only an echo of
    // our own description are not notes: drop them so they stop feeding the
    // description and stop blocking a real pull. A notes object without text
    // is an unknown shape and is left alone.
    if (session.strava_notes) {
      const stored = session.strava_notes.text;
      if (typeof stored !== 'string' || extractUserNotes(stored)) return result;
      delete session.strava_notes;
      result.dropped = true;
      this.#logger.info?.('strava.reconciliation.echo_notes_dropped', {
        activityId: activity.id,
        sessionId,
        textLength: stored.length,
        preview: stored.slice(0, 120),
      });
    }

    const text = extractUserNotes(activity.description);
    if (!text) return result;

    session.strava_notes = {
      text,
      pulled_at: new Date().toISOString(),
      source: 'strava_description',
    };

    this.#logger.info?.('strava.reconciliation.notes_pulled', {
      activityId: activity.id,
      sessionId,
      textLength: text.length,
    });
    result.pulled = true;
    return result;
  }

  /**
   * Pass 4: rebuild a Strava-only session's timeline from the provider's
   * heartrate + time streams. Grow-only: the rebuild is written only when it
   * has more ticks than what is stored, so a provider stream that covers less
   * than we already have (a strap that died mid-activity) never overwrites
   * better data. The stored file is snapshotted first.
   * @returns {Promise<{rebuilt: boolean, fetched?: boolean, reason?: string, session?: Object}>}
   */
  async #pass4RebuildTimeline(sessionId, session, activityId) {
    const streams = await this.#activityGateway.getActivityStreams(activityId, ['heartrate', 'time']);
    const heartrate = streams?.heartrate?.data;
    const time = streams?.time?.data;
    if (!heartrate || !time || heartrate.length !== time.length) {
      return { rebuilt: false, fetched: true, reason: 'no-streams' };
    }
    const timeline = buildStravaSessionTimeline(heartrate, time);
    const before = session.timeline?.tick_count || 0;
    if (!timeline || timeline.hrSamples.length <= before) {
      this.#logger.info?.('strava.reconciliation.timeline_not_rebuilt', {
        activityId, sessionId, storedTicks: before, rebuiltTicks: timeline?.hrSamples.length ?? 0,
      });
      return { rebuilt: false, fetched: true, reason: 'would-shrink' };
    }
    const username = Object.keys(session.timeline?.series || {}).find(k => k.endsWith(':hr'))?.split(':')[0]
      || Object.keys(session.participants || {})[0];
    if (!username) return { rebuilt: false, fetched: true, reason: 'no-participant' };

    const backup = this.#historyRepository.snapshot?.(sessionId, 'timeline-rebuild') ?? null;
    const rebuilt = applyStravaTimeline(session, timeline, username);
    this.#logger.info?.('strava.reconciliation.timeline_rebuilt', {
      activityId, sessionId, fromTicks: before, toTicks: timeline.hrSamples.length,
      fromRings: session.treasureBox?.totalRings ?? null, toRings: timeline.totalRings, backup,
    });
    return { rebuilt: true, session: rebuilt };
  }

  /**
   * Apply a title from a provider rename webhook to the session(s) linked to
   * that activity within the lookback window.
   * @param {string} activityId
   * @param {string} title
   * @returns {number} Sessions updated
   */
  applyTitle(activityId, title) {
    const tz = this.#timezone || 'America/Los_Angeles';
    let updated = 0;
    for (const date of this.#buildDateRange(this.#lookbackDays, tz)) {
      for (const { id: sessionId, data: session } of this.#historyRepository.list(date)) {
        if (this.#extractActivityId(session) !== String(activityId)) continue;
        if (this.#syncTitle(session, { id: activityId, name: title }, false)) {
          this.#historyRepository.save(sessionId, session);
          updated++;
        }
      }
    }
    return updated;
  }

  /**
   * Keep `session.strava.name` equal to the title Strava holds now. It is
   * written once at session creation ("Morning Run") and would otherwise
   * never pick up a rename made on Strava afterwards.
   *
   * Only refreshes a name the session already carries. Home sessions keep a
   * `strava` block (activityId, provenance) without a name, and giving them
   * one would make the session list render them as Strava activities.
   * @param {boolean} justPushed - Pass 1 updated Strava this sweep; the
   *   fetched `activity` is stale and the pushed name is current.
   * @returns {boolean} Whether the session title changed
   */
  #syncTitle(session, activity, justPushed) {
    const current = justPushed ? session.strava?.pushed?.name : activity.name;
    if (!current?.trim() || !session.strava?.name || session.strava.name === current) return false;

    this.#logger.info?.('strava.reconciliation.title_synced', {
      activityId: activity.id,
      sessionId: session.sessionId || session.session?.id,
      from: session.strava.name ?? null,
      to: current,
    });
    session.strava.name = current;
    return true;
  }

  /**
   * Extract a Strava activityId from session data.
   */
  #extractActivityId(session) {
    // Check root-level strava
    if (session.strava?.activityId) return String(session.strava.activityId);

    // Check participants
    for (const participant of Object.values(session.participants || {})) {
      if (participant?.strava?.activityId) return String(participant.strava.activityId);
    }

    return null;
  }

  /**
   * Build array of date strings (YYYY-MM-DD) for the lookback window.
   */
  #buildDateRange(days, tz) {
    const dates = [];
    const today = moment().tz(tz);
    for (let i = 0; i < days; i++) {
      dates.push(today.clone().subtract(i, 'days').format('YYYY-MM-DD'));
    }
    return dates;
  }

}

export default ActivityReconciliationService;
