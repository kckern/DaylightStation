import { stampEpoch } from "../../domain/stampEpoch.mjs";
import { normalizeSpotDeviceId, recordSpot, seedLegacySpot, retireLegacySpot } from "../../domain/services/mediaSpots.mjs";
import { isWatchComplete, DEFAULT_RULE } from "#shared/contracts/media/watchCompletion.mjs";
import { observeHeartbeat } from "../../domain/services/skipInference.mjs";
import { accumulateListened } from "../../domain/services/listenedTime.mjs";

const TERMINAL_STATUSES = new Set(['completed', 'stopped', 'ended']);
// Screens tracked for skip inference; unknown ids can arrive, so the map is capped.
const MAX_SKIP_TRACKED_SCREENS = 200;

/**
 * Record a playback heartbeat and coordinate its application-level side effects.
 *
 * Content-source storage identifiers are opaque logical progress namespaces;
 * this use case never interprets them as filesystem paths.
 */
export class RecordPlaybackProgress {
  // spotDevice -> skipInference reducer state (last heartbeat + pending skips).
  #skipStateByScreen = new Map();

  constructor({
    contentCatalog,
    mediaProgressMemory = null,
    progressSyncSources = new Set(),
    progressSyncService = null,
    playbackPublications = null,
    userVideoProgressStore = null,
    economyService = null,
    // Reports this surface's playback to the media server as a real client.
    // Optional: absent in tests and wherever no media server is configured.
    reportPlaybackSession = null,
    // Per-screen play ledger (PlayLedgerRecorder): one row per playback start.
    // Optional and advisory, like reportPlaybackSession.
    playLedger = null,
    // (deviceId) => boolean. Composition answers from devices.yml for fleet
    // ids; absent = every well-formed id is accepted.
    isKnownSpotDevice = null,
    // { ruleFor(namespace, duration) } from household media config (watch_completion).
    // Absent = the default movie-mode rule for every library.
    completionRules = null,
    createMediaProgress = (props) => props,
    nowTimestamp,
    // (epochMs) => the same timestamp format as nowTimestamp: what lastPlayed is
    // stamped with when a report says when it was heard (observedAt). Absent =
    // observedAt is ignored and every report is stamped on arrival (as before).
    timestampAt = null,
    // The household zone: what a bare stored stamp ("YYYY-MM-DD HH:mm:ss") means.
    timeZone = 'UTC',
    nowEpoch = () => Date.now(),
    nowIso = () => new Date().toISOString(),
    logger = console,
  }) {
    this.contentCatalog = contentCatalog;
    this.mediaProgressMemory = mediaProgressMemory;
    this.progressSyncSources = progressSyncSources;
    this.progressSyncService = progressSyncService;
    this.playbackPublications = playbackPublications;
    this.userVideoProgressStore = userVideoProgressStore;
    this.economyService = economyService;
    this.reportPlaybackSession = reportPlaybackSession;
    this.playLedger = playLedger;
    this.isKnownSpotDevice = isKnownSpotDevice;
    this.completionRules = completionRules;
    this.createMediaProgress = createMediaProgress;
    this.nowTimestamp = nowTimestamp;
    this.timestampAt = typeof timestampAt === 'function' ? timestampAt : null;
    this.timeZone = timeZone;
    this.nowEpoch = nowEpoch;
    this.nowIso = nowIso;
    this.logger = logger;
  }

  /**
   * Feed this screen's heartbeat to the skip reducer and record any skip it
   * confirms on the skipped item. Advisory: a failure never reaches play/log.
   */
  async #inferSkips(screenId, beat) {
    const { state, skips } = observeHeartbeat(this.#skipStateByScreen.get(screenId) ?? null, beat);
    this.#skipStateByScreen.delete(screenId);
    this.#skipStateByScreen.set(screenId, state);
    if (this.#skipStateByScreen.size > MAX_SKIP_TRACKED_SCREENS) {
      this.#skipStateByScreen.delete(this.#skipStateByScreen.keys().next().value);
    }
    for (const skip of skips) {
      try {
        const previous = await this.mediaProgressMemory.findProgress(skip.assetId, skip.storagePath);
        if (!previous || previous.skipped || previous.completedAt) continue;
        await this.mediaProgressMemory.saveProgress(this.createMediaProgress({
          ...previous,
          percent: previous.percent,
          skipped: true,
          skippedAt: this.nowIso(),
        }), skip.storagePath);
        this.logger.info?.('play.skip.inferred', {
          assetId: skip.assetId, deviceId: screenId, percent: previous.percent, namespace: skip.storagePath,
        });
      } catch (error) {
        this.logger.warn?.('play.skip.record_failed', { assetId: skip.assetId, error: error.message });
      }
    }
  }

  /**
   * observedAt (epoch ms) when usable, else null. A time in the future (a phone clock
   * ahead) is now: it must not lock every later report out.
   */
  #observedMs(observedAt) {
    if (observedAt === null || observedAt === undefined || observedAt === '') return null;
    const ms = Number(observedAt);
    if (!Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1)) return null;
    return Math.min(ms, this.nowEpoch());
  }

  async execute({
    type, assetId, percent, seconds, title, watched_duration, listId, userId, engaged,
    // The piano kiosk's lesson-practice report; opaque here, judged by the store.
    practice = null,
    // `deviceId` names the surface (threaded from the request, not the body).
    // `naturalEnd`/`status` distinguish finishing from merely stopping — only a
    // natural end may be reported as watched.
    deviceId = null, naturalEnd = false, status = null,
    // `spotDeviceId` keys this screen's own spot (per-screen progress,
    // RQ-PLAY-09). Absent or unusable -> the legacy single-playhead write only.
    spotDeviceId = null,
    // How this playback started, when the caller knows: a structured
    // {kind:'device'|'routine', id, name} or legacy free text. The ledger
    // normalizes it (see #domains/media/playLedger normalizeLedgerOrigin).
    origin = null,
    // When the client heard this position (epoch ms): a phone sends progress it
    // kept while offline later. Such a report must never move the place backwards
    // or call itself the newest play (ops:docs/superpowers/plans/
    // 2026-11-26-phone-downloads-hardening.md §E).
    observedAt = null,
    // The player's session (a phone or web session id) and playback speed: they key
    // and scale the listened-time run (lookup spec §13). Both optional; absent = the
    // device is the session and the speed is 1.
    sessionId = null,
    rate = null,
  }) {
    let progressNamespace = type;
    let itemMetadata = null;
    let itemFacts = null;
    const compoundId = assetId.includes(':') ? assetId : `${type}:${assetId}`;

    const resolved = this.contentCatalog.resolveSource(type, compoundId);
    if (resolved) {
      try {
        progressNamespace = await this.contentCatalog.progressNamespace(resolved, compoundId);
        const item = await this.contentCatalog.getItem(resolved, compoundId);
        itemMetadata = item?.metadata;
        itemFacts = item ? { title: item.title ?? null, type: item.type ?? null } : null;
      } catch (error) {
        this.logger.warn?.('play.log.metadata_fetch_failed', { assetId, error: error.message });
      }
    }

    // A live channel has no playhead worth keeping: its "duration" is a sliding
    // window, so a percent of it would mark the channel watched or resumable.
    // It still shows in the screen's play ledger below.
    const live = itemMetadata?.live === true;
    // An ephemeral item (a video shared from the phone, played once from temp
    // storage and swept) keeps no playhead either: there is nothing to resume.
    const noPlayhead = live || itemMetadata?.ephemeral === true;

    if (listId) {
      const namespace = await this.contentCatalog.listNamespace(listId);
      if (namespace) progressNamespace = namespace;
    }

    const existingState = this.mediaProgressMemory
      ? await this.mediaProgressMemory.findProgress(compoundId, progressNamespace)
      : null;
    // When this position was heard (a phone replaying progress it kept offline). A
    // report heard before the stored last play is history, not the place: its
    // position is not written (lifecycle spec §3.4, "never moves a place backwards");
    // its listening still counts. Times compare as instants, never as text.
    const observedMs = this.#observedMs(observedAt);
    const observed = observedMs !== null && this.timestampAt ? this.timestampAt(observedMs) : null;
    const storedAt = existingState?.lastPlayed ? stampEpoch(existingState.lastPlayed, this.timeZone) : null;
    const stale = observedMs !== null && storedAt !== null && observedMs < storedAt;
    const atEpoch = observedMs ?? this.nowEpoch();
    const normalizedSeconds = parseInt(seconds, 10);
    const normalizedPercent = parseFloat(percent);
    const estimatedDuration = normalizedPercent > 0
      ? Math.round(normalizedSeconds / (normalizedPercent / 100))
      : (itemMetadata?.duration ? Math.round(itemMetadata.duration / 1000) : 0);
    let spotDevice = normalizeSpotDeviceId(spotDeviceId);
    if (spotDevice && typeof this.isKnownSpotDevice === 'function' && !this.isKnownSpotDevice(spotDevice)) {
      this.logger.warn?.('play.log.spot_device_unknown', { assetId, spotDeviceId: spotDevice });
      spotDevice = null;
    }
    // With two screens on one item the shared playhead jumps between them, so
    // the "how far did this report move" reference is this screen's own spot.
    const ownSpot = spotDevice ? existingState?.spots?.[spotDevice] : null;
    const referencePlayhead = ownSpot ? (Number(ownSpot.playhead) || 0) : (existingState?.playhead || 0);
    const sessionWatchTime = Number.isFinite(watched_duration)
      ? parseFloat(watched_duration)
      : Math.max(0, normalizedSeconds - referencePlayhead);
    const existingWatchTime = existingState?.watchTime ?? 0;
    const newWatchTime = existingWatchTime + sessionWatchTime;
    const statePercent = estimatedDuration > 0
      ? Math.round((normalizedSeconds / estimatedDuration) * 100)
      : 0;
    // The library's completion rule (watch_completion in household media config)
    // decides both the completedAt stamp and the media-server report below.
    const rule = this.completionRules?.ruleFor?.(progressNamespace, estimatedDuration) ?? DEFAULT_RULE;
    const watchComplete = naturalEnd === true || isWatchComplete({
      percent: statePercent, playhead: normalizedSeconds, duration: estimatedDuration, watchTime: newWatchTime,
    }, rule);
    const remainingSec = estimatedDuration > 0 ? estimatedDuration - normalizedSeconds : null;
    // Heartbeats on an already-finished item decide nothing; skip their line.
    const stillOpen = !existingState?.completedAt || status === 'completed' || naturalEnd === true;
    if (stillOpen && statePercent >= rule.minPercent) {
      this.logger.debug?.('play.log.completion_judged', {
        assetId: compoundId, namespace: progressNamespace, rule: rule.source ?? 'default', tier: rule.tier ?? 0,
        percent: statePercent, remainingSec, complete: watchComplete,
      });
    }
    if (status === 'completed' && !watchComplete) {
      this.logger.info?.('play.log.completed_claim_rejected', {
        assetId: compoundId, namespace: progressNamespace, rule: rule.source ?? 'default',
        percent: statePercent, remainingSec,
      });
    }
    // Listened time: real playback measured between consecutive reports of one
    // session. A record that already had progress with no measure is legacy: its
    // Continue entry is reviewed by a person, not guessed.
    const listenKey = (typeof sessionId === 'string' && sessionId) || spotDevice || deviceId || 'unknown';
    const listened = accumulateListened(existingState, {
      key: listenKey, position: normalizedSeconds, atMs: atEpoch, rate,
    });
    const listenLegacy = existingState?.listenLegacy === true
      || (existingState != null && !Number.isFinite(existingState.listenedSec)
        && ((Number(existingState.playhead) || 0) > 0 || (Number(existingState.watchTime) || 0) > 0));
    const listenFields = {
      listenedSec: listened.listenedSec,
      listenRun: listened.listenRun,
      ...(listenLegacy ? { listenLegacy: true } : {}),
    };
    const completedAt = existingState?.completedAt
      || (watchComplete && !stale ? (observed ?? this.nowTimestamp()) : null);
    const lastPlayed = observed ?? this.nowTimestamp();
    const spotFields = spotDevice
      ? {
        spots: retireLegacySpot(recordSpot(seedLegacySpot(existingState), spotDevice, {
          playhead: normalizedSeconds,
          duration: estimatedDuration,
          at: lastPlayed,
        }), normalizedSeconds),
        lastDevice: spotDevice,
      }
      : {};
    const newState = stale
      // History only: the stored place, last play and completion stand; the listening
      // time is added.
      ? this.createMediaProgress({
        ...existingState,
        percent: existingState.percent,
        contentId: compoundId,
        watchTime: newWatchTime > 0 ? Number(newWatchTime.toFixed(3)) : (existingState.watchTime ?? 0),
        ...listenFields,
      })
      : this.createMediaProgress({
        contentId: compoundId,
        playhead: normalizedSeconds,
        duration: estimatedDuration,
        percent: statePercent,
        playCount: (existingState?.playCount ?? 0)
          + (!existingState || normalizedSeconds < referencePlayhead ? 1 : 0),
        lastPlayed,
        watchTime: newWatchTime > 0 ? Number(newWatchTime.toFixed(3)) : 0,
        completedAt,
        ...spotFields,
        ...listenFields,
      });
    if (stale) {
      this.logger.info?.('play.log.stale_report', {
        assetId: compoundId, namespace: progressNamespace, observedAt: observed,
        storedLastPlayed: String(existingState.lastPlayed), playhead: normalizedSeconds,
        storedPlayhead: existingState.playhead ?? null, watchTimeAdded: Number(sessionWatchTime.toFixed?.(3) ?? sessionWatchTime),
      });
    }

    if (this.mediaProgressMemory && !noPlayhead && !(stale && !(sessionWatchTime > 0))) {
      await this.mediaProgressMemory.saveProgress(newState, progressNamespace);
      // Writing a fresh state drops a stored skip: the viewer came back to it.
      if (existingState?.skipped && !stale) {
        this.logger.info?.('play.skip.cleared', { assetId: compoundId, deviceId: spotDevice });
      }
      if (spotDevice && !stale) {
        await this.#inferSkips(spotDevice, {
          assetId: compoundId, storagePath: progressNamespace, complete: watchComplete, atEpoch,
        });
      }
    }

    // A stale report tells neither the remote store nor the media server where it is.
    if (!stale && !noPlayhead && this.progressSyncSources?.has(type) && this.progressSyncService) {
      const localId = assetId.includes(':') ? assetId.split(':').slice(1).join(':') : assetId;
      this.progressSyncService.onProgressUpdate(compoundId, localId, {
        playhead: normalizedSeconds,
        duration: estimatedDuration,
        percent: statePercent,
        watchTime: sessionWatchTime,
      });
    }

    // Present this playback to the media server as a real client session.
    //
    // ONE-WAY and strictly advisory: nothing it returns is read back, and a
    // failure must never surface here. A child watching a story does not lose
    // their progress because a dashboard missed a heartbeat.
    if (!stale && !noPlayhead && this.reportPlaybackSession && deviceId) {
      try {
        await this.reportPlaybackSession.execute({
          surfaceId: deviceId,
          contentId: compoundId,
          positionMs: Math.round(normalizedSeconds * 1000),
          durationMs: Math.round(estimatedDuration * 1000),
          // A client's `completed` status is a claim, not a verdict: it marks
          // the item watched on the media server and clears its resume point,
          // so it must pass the library's rule, as completedAt does.
          completed: naturalEnd === true || (status === 'completed' && watchComplete),
          at: this.nowEpoch(),
        });
      } catch (error) {
        this.logger.warn?.('play.log.session_report_failed', {
          assetId, deviceId, error: error.message,
        });
      }
    }

    const terminal = naturalEnd === true || TERMINAL_STATUSES.has(status);
    if (this.playLedger && spotDevice && terminal) {
      // A stop/finish report ends the screen's session; it is never a start.
      try {
        await this.playLedger.end?.({ deviceId: spotDevice, at: atEpoch });
      } catch (error) {
        this.logger.warn?.('play.log.ledger_failed', { assetId, error: error.message });
      }
    } else if (this.playLedger && spotDevice) {
      try {
        await this.playLedger.observe({
          deviceId: spotDevice,
          contentId: compoundId,
          atEpoch,
          startedAt: observedMs !== null ? new Date(observedMs).toISOString() : this.nowIso(),
          localTime: lastPlayed,
          metadata: {
            ...(itemMetadata || {}),
            title: itemFacts?.title || itemMetadata?.title || title || null,
            type: itemMetadata?.type || itemFacts?.type || null,
          },
          origin: typeof origin === 'string' || (origin && typeof origin === 'object') ? origin : null,
        });
      } catch (error) {
        this.logger.warn?.('play.log.ledger_failed', { assetId, error: error.message });
      }
    }

    this.logger.info?.('play.log.updated', {
      assetId,
      type,
      percent: normalizedPercent,
      playhead: normalizedSeconds,
      storagePath: progressNamespace,
      spotDevice,
      listenedSec: listened.listenedSec,
      listenedAdded: listened.addedSec,
      ...(live ? { live: true } : {}),
    });

    if (!stale && this.playbackPublications?.progressRecorded) {
      try {
        this.playbackPublications.progressRecorded({
          contentId: compoundId,
          type,
          assetId,
          percent: normalizedPercent,
          playhead: normalizedSeconds,
          storagePath: progressNamespace,
          timestamp: this.nowEpoch(),
        });
      } catch (error) {
        this.logger.warn?.('play.log.broadcast_failed', { error: error.message });
      }
    }

    let userProgress = null;
    if (!stale && userId && this.userVideoProgressStore) {
      // The piano store may judge the lesson sitting first (bounded by its own
      // deadline); a failure there never stops the record.
      if (practice && typeof practice === 'object' && typeof this.userVideoProgressStore.prepareCredit === 'function') {
        try {
          await this.userVideoProgressStore.prepareCredit({ userId, plexId: assetId, practice });
        } catch (error) {
          this.logger.warn?.('play.log.prepare_credit_failed', { userId, assetId, error: error.message });
        }
      }
      try {
        userProgress = this.userVideoProgressStore.record({
          userId,
          plexId: assetId,
          percent: normalizedPercent,
          seconds: normalizedSeconds,
          duration: estimatedDuration,
          engaged: !!engaged,
          practice: practice && typeof practice === 'object' ? practice : null,
          title: itemMetadata?.title || title || null,
        });
      } catch (error) {
        this.logger.warn?.('play.log.user_progress_failed', { userId, assetId, error: error.message });
      }
    }

    if (this.economyService && userProgress?.newlyCompleted) {
      const ref = `plex:${String(assetId).replace(/^plex:/, '')}`;
      this.economyService.earn(userId, { action: 'piano-lesson-complete', source: 'piano', ref })
        .catch((error) => this.logger.warn?.('play.log.economy_earn_failed', { userId, assetId, error: error?.message }));
    }

    if (this.playbackPublications?.pianoLessonCompleted && userProgress?.newlyCompleted) {
      try {
        this.playbackPublications.pianoLessonCompleted({
          userId,
          plexId: `plex:${String(assetId).replace(/^plex:/, '')}`,
          title: itemMetadata?.title || title || null,
          at: this.nowIso(),
        });
      } catch (error) {
        this.logger.warn?.('play.log.lesson_completed_publish_failed', { userId, assetId, error: error?.message });
      }
    }

    const userProgressPublic = userProgress
      ? (() => { const { newlyCompleted, ...rest } = userProgress; return rest; })()
      : undefined;

    return {
      response: {
        type,
        library: progressNamespace,
        title: itemMetadata?.title || title,
        contentId: newState.contentId,
        playhead: newState.playhead,
        duration: newState.duration,
        percent: newState.percent,
        playCount: newState.playCount,
        lastPlayed: newState.lastPlayed,
        watchTime: newState.watchTime,
        listenedSec: newState.listenedSec ?? null,
        ...(stale ? { stale: true } : {}),
        ...(spotDevice ? { deviceId: spotDevice } : {}),
        userProgress: userProgressPublic,
      },
    };
  }
}

export default RecordPlaybackProgress;
