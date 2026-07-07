/**
 * StravaReconciliationService
 *
 * Scans recent fitness sessions and reconciles them with Strava:
 *   Pass 1 (Session → Strava): Re-enrich missed or stale activities
 *   Pass 2 (Strava → Session): Pull manually-entered Strava descriptions back as strava_notes
 *
 * Triggered non-blocking after each Strava webhook enrichment.
 *
 * @module applications/fitness/StravaReconciliationService
 */

import path from 'path';
import moment from 'moment-timezone';
import { loadYamlSafe, listYamlFiles, dirExists, saveYaml } from '#system/utils/FileIO.mjs';
import { buildActivityDescription } from '#domains/fitness/services/buildActivityDescription.mjs';
import { buildSelectionConfig } from '#domains/fitness/services/selectPrimaryMedia.mjs';
import { absorbOverlappingSlivers } from './sliverAbsorption.mjs';

const RECONCILE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const INTER_SESSION_DELAY_MS = 200;
const DEFAULT_LOOKBACK_DAYS = 10;

export class StravaReconciliationService {
  #stravaClient;
  #configService;
  #fitnessHistoryDir;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.stravaClient - StravaClientAdapter instance (shared, already authenticated)
   * @param {Object} config.configService - ConfigService for reading fitness config + timezone
   * @param {string} config.fitnessHistoryDir - Path to fitness history directory
   * @param {Object} [config.logger]
   */
  constructor({ stravaClient, configService, fitnessHistoryDir, logger = console }) {
    this.#stravaClient = stravaClient;
    this.#configService = configService;
    this.#fitnessHistoryDir = fitnessHistoryDir;
    this.#logger = logger;
  }

  /**
   * Run reconciliation across the lookback window.
   */
  async reconcile() {
    const fitnessConfig = this.#configService.getAppConfig('fitness');
    const plex = fitnessConfig?.plex || {};
    const lookbackDays = plex.reconciliation_lookback_days ?? DEFAULT_LOOKBACK_DAYS;
    const tz = this.#configService?.getTimezone?.() || 'America/Los_Angeles';
    const selectionConfig = buildSelectionConfig(plex);

    const dates = this.#buildDateRange(lookbackDays, tz);
    this.#logger.info?.('strava.reconciliation.start', { lookbackDays, dates: dates.length });

    let sessionsProcessed = 0;
    let enriched = 0;
    let notesPulled = 0;
    let sliversAbsorbed = 0;

    for (const date of dates) {
      const dateDir = path.join(this.#fitnessHistoryDir, date);
      if (!dirExists(dateDir)) continue;

      const files = listYamlFiles(dateDir);
      for (const filename of files) {
        const filePath = path.join(dateDir, `${filename}.yml`);
        const session = loadYamlSafe(filePath);
        if (!session) continue;

        // Find strava activityId from session or participants
        const activityId = this.#extractActivityId(session);
        if (!activityId) continue;

        // Staleness check: skip if reconciled within the last hour
        const lastReconciled = session.strava?.last_reconciled_at;
        if (lastReconciled) {
          const elapsed = Date.now() - new Date(lastReconciled).getTime();
          if (elapsed < RECONCILE_COOLDOWN_MS) continue;
        }

        try {
          const activity = await this.#stravaClient.getActivity(activityId);
          if (!activity) continue;

          // Pass 1: Session → Strava (re-enrichment)
          const didEnrich = await this.#pass1SessionToStrava(session, activity, selectionConfig);
          if (didEnrich) enriched++;

          // Pass 2: Strava → Session (pull notes)
          const didPull = this.#pass2StravaToSession(session, activity);
          if (didPull) notesPulled++;

          // Update staleness tracker
          if (!session.strava) session.strava = {};
          session.strava.last_reconciled_at = new Date().toISOString();

          // Save session if anything changed
          if (didEnrich || didPull || !lastReconciled) {
            const savePath = filePath.replace(/\.yml$/, '');
            saveYaml(savePath, session);
          }

          // Pass 3: Sliver absorption (only for Strava-only sessions).
          // If this session was the result of _createStravaOnlySession (or
          // an equivalent backfill), look for adjacent HR-only home slivers
          // in the same date dir and delete them. Catches the cases where
          // the original webhook either failed to absorb or never fired.
          if (session.session?.source === 'strava') {
            const result = absorbOverlappingSlivers(activity, dateDir, {
              justCreatedSessionId: session.sessionId || session.session?.id,
              tz,
              logger: this.#logger,
            });
            sliversAbsorbed += result.absorbed.length;
          }

          sessionsProcessed++;

          // Rate limit: small delay between sessions
          await this.#delay(INTER_SESSION_DELAY_MS);
        } catch (err) {
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
      sliversAbsorbed,
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

    await this.#stravaClient.updateActivity(String(activity.id), updatePayload);

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
   * @returns {boolean} Whether strava_notes was written
   */
  #pass2StravaToSession(session, activity) {
    // Never overwrite existing strava_notes
    if (session.strava_notes) return false;

    const desc = activity.description?.trim();
    if (!desc) return false;

    session.strava_notes = {
      text: desc,
      pulled_at: new Date().toISOString(),
      source: 'strava_description',
    };

    this.#logger.info?.('strava.reconciliation.notes_pulled', {
      activityId: activity.id,
      sessionId: session.sessionId || session.session?.id,
      textLength: desc.length,
    });
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

  #delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default StravaReconciliationService;
