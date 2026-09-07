import {
  ARTIFACT_STATES, isDue, isLeaseStale, retentionDecision,
  ATTEMPT_LEASE_MS, RAW_AUDIO_RETENTION_MS, RECORD_RETENTION_MS,
} from '#domains/fitness/services/voiceMemoArtifactLifecycle.mjs';

/**
 * VoiceMemoRetryWorker — turns a stored capture back into a memo after the
 * provider recovers, and makes sure nobody's voice outlives its retention.
 *
 * One tick does four things, in this order:
 *   1. Reclaim leases from attempts that died mid-flight (a crash, a redeploy).
 *   2. Run every artifact whose next attempt is due.
 *   3. Apply retention: purge audio, expire what ran out of time, drop records
 *      that have aged out.
 *   4. Remove orphan audio — bytes written just before a crash, with no record.
 *
 * Ticks never overlap: a slow provider must not stack workers on top of each
 * other, all racing for the same leases. The lease in the store is the second
 * line of defence for the multi-process case.
 */
export class VoiceMemoRetryWorker {
  #artifacts;
  #memos;
  #clock;
  #logger;
  #leaseMs;
  #policy;
  #batchSize;
  #ticking = false;

  constructor({ artifacts, memos, clock = { now: () => Date.now() }, logger = console,
    leaseMs = ATTEMPT_LEASE_MS, batchSize = 5,
    rawAudioRetentionMs = RAW_AUDIO_RETENTION_MS, recordRetentionMs = RECORD_RETENTION_MS } = {}) {
    this.#artifacts = artifacts;
    this.#memos = memos;
    this.#clock = clock;
    this.#logger = logger;
    this.#leaseMs = leaseMs;
    this.#batchSize = batchSize;
    this.#policy = { rawAudioRetentionMs, recordRetentionMs };
  }

  get enabled() { return Boolean(this.#artifacts && this.#memos?.available); }

  /**
   * Run one sweep across every household.
   * @returns {Promise<Object>} per-tick counters, also emitted as telemetry
   */
  async tick() {
    if (!this.enabled || this.#ticking) return null;
    this.#ticking = true;
    const stats = {
      reclaimed: 0, attempted: 0, transcribed: 0, failed: 0,
      expired: 0, purged: 0, deleted: 0, orphansRemoved: 0,
    };
    try {
      for (const householdId of this.#artifacts.householdIds()) {
        await this.#sweepHousehold(householdId, stats);
      }
      if (Object.values(stats).some((n) => n > 0)) {
        this.#logger.info?.('fitness.voice_memo.worker.tick', stats);
      }
      return stats;
    } catch (error) {
      this.#logger.error?.('fitness.voice_memo.worker.tick_failed', { error: error?.message });
      return stats;
    } finally {
      this.#ticking = false;
    }
  }

  async #sweepHousehold(householdId, stats) {
    const now = this.#clock.now();
    const records = this.#artifacts.list(householdId);

    // 1. Crash recovery. A `processing` record whose lease has gone stale is
    //    not being worked on by anyone — without this it would sit there
    //    forever and the recording would be as lost as before the store.
    for (const record of records) {
      if (!isLeaseStale(record, now, this.#leaseMs)) continue;
      this.#artifacts.update(householdId, record.ref, {
        state: ARTIFACT_STATES.RETRYABLE, attemptStartedAt: null, nextAttemptAt: now, updatedAt: now,
      });
      this.#logger.warn?.('fitness.voice_memo.artifact.lease_reclaimed', {
        ref: record.ref, attempts: record.attempts ?? 0,
        heldForMs: now - (record.attemptStartedAt ?? now),
      });
      stats.reclaimed += 1;
    }

    // 2. Due work. Bounded per tick so a backlog drains steadily instead of
    //    firing a hundred provider requests the moment credit is restored.
    const due = this.#artifacts.list(householdId)
      .filter((record) => isDue(record, now))
      .sort((a, b) => (a.nextAttemptAt ?? a.capturedAt ?? 0) - (b.nextAttemptAt ?? b.capturedAt ?? 0))
      .slice(0, this.#batchSize);

    for (const record of due) {
      stats.attempted += 1;
      const result = await this.#memos.runAttempt(householdId, record.ref, { trigger: 'retry' });
      if (result?.kind === 'transcribed') stats.transcribed += 1;
      else if (result?.kind === 'transcription_failed') stats.failed += 1;
    }

    // 3. Retention. Runs on a fresh listing so an artifact transcribed a moment
    //    ago is already settled when its retention is judged.
    for (const record of this.#artifacts.list(householdId)) {
      switch (retentionDecision(record, this.#clock.now(), this.#policy)) {
        case 'purge_audio': {
          const removed = this.#artifacts.purgeAudio(householdId, record.ref, this.#clock.now());
          if (removed) {
            this.#logger.info?.('fitness.voice_memo.artifact.audio_purged', {
              ref: record.ref, reason: `retention:${record.state}`, removed,
            });
            stats.purged += 1;
          }
          break;
        }
        case 'expire': {
          const now2 = this.#clock.now();
          this.#artifacts.purgeAudio(householdId, record.ref, now2);
          this.#artifacts.update(householdId, record.ref, {
            state: ARTIFACT_STATES.EXPIRED, attemptStartedAt: null, nextAttemptAt: null, updatedAt: now2,
          });
          // Error, not warn: a recording aged out without ever becoming a memo
          // is the exact outcome this system exists to prevent, and it should
          // be findable in the log store without knowing to look for it.
          this.#logger.error?.('fitness.voice_memo.artifact.expired', {
            ref: record.ref, sessionId: record.sessionId || null, attempts: record.attempts ?? 0,
            ageMs: now2 - (record.capturedAt ?? now2),
            lastClassification: record.lastFailure?.classification || null,
          });
          stats.expired += 1;
          break;
        }
        case 'delete_record': {
          this.#artifacts.deleteRecord(householdId, record.ref);
          this.#logger.info?.('fitness.voice_memo.artifact.record_deleted', {
            ref: record.ref, state: record.state,
          });
          stats.deleted += 1;
          break;
        }
        default:
          break;
      }
    }

    // 4. Orphan audio: bytes written, then a crash before the record. Nothing
    //    can ever claim them, and they are still somebody's voice.
    for (const orphan of this.#artifacts.listOrphanAudio(householdId)) {
      this.#artifacts.deleteRecord(householdId, orphan.ref);
      this.#logger.warn?.('fitness.voice_memo.artifact.orphan_removed', { ref: orphan.ref });
      stats.orphansRemoved += 1;
    }
  }
}

export default VoiceMemoRetryWorker;
