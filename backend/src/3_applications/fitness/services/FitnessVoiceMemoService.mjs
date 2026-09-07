import {
  ARTIFACT_STATES, classifyTranscriptionFailure, applyFailure, MAX_ATTEMPTS,
} from '#domains/fitness/services/voiceMemoArtifactLifecycle.mjs';

/**
 * Coordinates the two durable stages of a fitness voice memo: the capture is
 * persisted, and only then is it transcribed.
 *
 * WHY THE ORDER MATTERS. This used to transcribe first and keep nothing until
 * the provider answered, so a provider outage was a permanent data-loss event
 * (2026-09-07: one upload took an HTTP 429 `insufficient_quota`, a second never
 * left the browser, and both recordings were gone). Now the bytes hit disk
 * before the first provider request, every attempt is a state transition on a
 * durable record, and a retryable failure schedules another attempt instead of
 * ending the memo's life.
 *
 * An attempt is "make this memo durable", not "call Whisper". It has two
 * steps — transcribe, then attach to the session — and either can be resumed
 * on its own: a record that already carries a transcript never pays for a
 * second one.
 */

/** How long to wait before re-checking a session that has not ended yet. */
const PERSIST_RETRY_DELAY_MS = 5 * 60_000;

/** Bounded wait for a session to end before the transcript is left staff-only. */
const MAX_PERSIST_ATTEMPTS = 60;

const NO_MEMO = '[No Memo]';

export class FitnessVoiceMemoService {
  constructor({ transcription, sessions = null, config = null, enrichment = null,
    artifacts = null, clock = { now: () => Date.now() }, logger = console } = {}) {
    this.transcription = transcription;
    this.sessions = sessions;
    this.config = config;
    this.enrichment = enrichment;
    this.artifacts = artifacts;
    this.clock = clock;
    this.logger = logger;
  }

  get available() { return Boolean(this.transcription); }

  /** Whether captures survive a provider outage. False = the old lossy behaviour. */
  get durable() { return Boolean(this.artifacts); }

  /** Largest capture the store will accept, for the route's pre-flight check. */
  get maxArtifactBytes() { return this.artifacts?.maxBytes ?? null; }

  /**
   * Lifecycle records for the staff view. State and diagnostics only — the
   * audio and the transcript never leave through this door.
   */
  listArtifacts({ householdId = null, sessionId, states, limit } = {}) {
    if (!this.artifacts) return [];
    return this.artifacts.list(householdId, { sessionId, states, limit }).map(publicView);
  }

  /**
   * Run an attempt now, ignoring the record's backoff.
   *
   * This is the recovery path for the classes the worker deliberately will not
   * schedule — a rejected key, audio the provider refused — where the fix is a
   * human action and the retry should follow it immediately. The retry budget
   * is reset with it: the previous attempts were spent against a cause that
   * has since been addressed.
   */
  async retryArtifact(householdId, ref) {
    if (!this.artifacts) return { kind: 'not_found' };
    const record = this.artifacts.get(householdId, ref);
    if (!record) return { kind: 'not_found' };
    if (record.state === ARTIFACT_STATES.PROCESSING) return { kind: 'busy', ref };

    const now = this.clock.now();
    this.artifacts.update(householdId, ref, {
      state: ARTIFACT_STATES.RETRYABLE, nextAttemptAt: now, attemptStartedAt: null,
      attempts: 0, givenUpReason: null, updatedAt: now,
    });
    this.logger.info?.('fitness.voice_memo.artifact.manual_retry', {
      ref, previousState: record.state, previousAttempts: record.attempts ?? 0,
      hasTranscript: Boolean(record.transcript?.clean || record.transcript?.raw),
    });
    return this.runAttempt(householdId, ref, { trigger: 'manual' });
  }

  /**
   * Handle an interactive capture: persist it, then try to transcribe it once
   * while the person is still looking at the overlay.
   *
   * @param {Object} input - { audioBuffer|audioBase64, mimeType, sessionId, startedAt, endedAt, context }
   * @param {string|null} defaultHouseholdId
   * @returns {Promise<Object>} one of:
   *   { kind: 'transcribed', memo }
   *   { kind: 'persist_failed', memo }              transcript exists, session write failed
   *   { kind: 'transcription_failed', artifact }    audio is safe, transcript is not
   */
  async transcribe(input, defaultHouseholdId = null) {
    const { sessionId, context: sessionContext = {}, mimeType = null,
      startedAt = null, endedAt = null } = input;
    const householdId = sessionContext.householdId || defaultHouseholdId;
    const buffer = resolveBuffer(input);

    if (!this.artifacts) {
      // No artifact store wired: preserve the pre-2026-09-07 behaviour rather
      // than pretend a capture is safe when nothing wrote it down.
      return this.#transcribeWithoutArtifact(input, householdId);
    }

    let record;
    try {
      record = await this.artifacts.create({
        buffer, mimeType, householdId, sessionId, startedAt, endedAt,
        context: this.#withHouseholdMembers(sessionContext, householdId),
      });
      this.logger.info?.('fitness.voice_memo.artifact.captured', {
        ref: record.ref, sessionId: sessionId || null, householdId: householdId || null,
        bytes: record.bytes, mimeType: record.mimeType, checksum: record.checksum,
      });
    } catch (error) {
      // Capture itself failed, so there is nothing to retry later. Transcribe
      // from memory anyway — a working provider still beats losing the memo.
      this.logger.error?.('fitness.voice_memo.artifact.capture_failed', {
        sessionId: sessionId || null, code: error?.code || null, error: error?.message,
      });
      return this.#transcribeWithoutArtifact(input, householdId);
    }

    return this.runAttempt(householdId, record.ref, { trigger: 'interactive', buffer });
  }

  /**
   * Advance one artifact: transcribe it if it has no transcript yet, then
   * attach it to its session. Used by both the interactive request and the
   * retry worker, so a memo recovered an hour later takes exactly the same
   * path as one transcribed on the spot.
   *
   * @param {string|null} householdId
   * @param {string} ref
   * @param {{trigger?: string, buffer?: Buffer}} [options]
   */
  async runAttempt(householdId, ref, { trigger = 'retry', buffer = null } = {}) {
    const claimed = this.artifacts.claim(householdId, ref, this.clock.now());
    if (!claimed) {
      // Someone else holds the lease, or the record is gone. Both mean "not
      // mine to advance"; neither is an error worth failing the request over.
      return { kind: 'busy', ref };
    }

    if (!claimed.transcript) {
      const transcribed = await this.#transcribeArtifact(householdId, claimed, { trigger, buffer });
      if (transcribed.kind !== 'ok') return transcribed;
      return this.#persistArtifact(householdId, transcribed.record, { trigger });
    }
    return this.#persistArtifact(householdId, claimed, { trigger });
  }

  /** Transcribe the stored audio and record the outcome. */
  async #transcribeArtifact(householdId, record, { trigger, buffer }) {
    const audio = buffer
      ? { buffer, mimeType: record.mimeType }
      : this.artifacts.readAudio(householdId, record.ref);

    if (!audio?.buffer?.length) {
      // The bytes are gone (purged, or a crash between the two writes). Say so
      // plainly rather than blaming the provider for an empty request.
      const now = this.clock.now();
      const failed = this.artifacts.update(householdId, record.ref, {
        state: ARTIFACT_STATES.PERMANENTLY_FAILED,
        givenUpReason: 'audio_missing', attemptStartedAt: null, nextAttemptAt: null, updatedAt: now,
      });
      this.logger.error?.('fitness.voice_memo.artifact.permanently_failed', {
        ref: record.ref, givenUpReason: 'audio_missing', attempts: record.attempts,
      });
      return { kind: 'transcription_failed', artifact: publicView(failed || record) };
    }

    const startedAt = this.clock.now();
    this.logger.info?.('fitness.voice_memo.attempt.started', {
      ref: record.ref, attempts: record.attempts, trigger, bytes: record.bytes,
    });

    let memo;
    try {
      memo = await this.transcription.transcribeVoiceMemo({
        audioBuffer: audio.buffer,
        mimeType: audio.mimeType || record.mimeType,
        sessionId: record.sessionId,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        context: record.context || {},
      });
    } catch (error) {
      const failure = classifyTranscriptionFailure(error);
      const now = this.clock.now();
      const patch = applyFailure(record, failure, now);
      const updated = this.artifacts.update(householdId, record.ref, patch);
      const level = failure.retryable ? 'warn' : 'error';
      this.logger[level]?.('fitness.voice_memo.attempt.failed', {
        ref: record.ref, trigger, attempts: patch.attempts, maxAttempts: MAX_ATTEMPTS,
        classification: failure.classification, retryable: failure.retryable,
        providerStatus: failure.providerStatus, providerCode: failure.providerCode,
        providerType: failure.providerType, networkCode: failure.networkCode,
        requestId: failure.requestId, state: patch.state,
        nextAttemptAt: patch.nextAttemptAt, durationMs: now - startedAt,
      });
      if (patch.state === ARTIFACT_STATES.PERMANENTLY_FAILED) {
        this.logger.error?.('fitness.voice_memo.artifact.permanently_failed', {
          ref: record.ref, givenUpReason: patch.givenUpReason,
          classification: failure.classification, attempts: patch.attempts,
        });
      }
      return { kind: 'transcription_failed', artifact: publicView(updated || { ...record, ...patch }) };
    }

    const now = this.clock.now();
    const transcript = {
      raw: memo?.transcriptRaw ?? null,
      clean: memo?.transcriptClean ?? memo?.transcriptRaw ?? null,
      durationSeconds: memo?.durationSeconds ?? null,
    };
    const updated = this.artifacts.update(householdId, record.ref, {
      transcript, transcribedAt: now, attempts: (record.attempts || 0) + 1,
      lastFailure: null, nextAttemptAt: null, updatedAt: now,
    });

    // The transcript exists, so the recording is redundant. Purge it here
    // rather than at retention: raw voice should outlive its purpose by zero
    // seconds. A failure to persist the memo below does NOT resurrect the need
    // for the audio — the transcript is already durable on the record.
    const removed = this.artifacts.purgeAudio(householdId, record.ref, now);
    this.logger.info?.('fitness.voice_memo.artifact.audio_purged', {
      ref: record.ref, reason: 'transcribed', removed,
    });
    this.logger.info?.('fitness.voice_memo.attempt.succeeded', {
      ref: record.ref, trigger, attempts: (record.attempts || 0) + 1,
      durationMs: now - startedAt, transcriptLength: transcript.clean?.length ?? 0,
    });

    return { kind: 'ok', record: { ...(updated || record), transcript, transcribedAt: now } };
  }

  /** Attach a transcribed artifact to its session and close out the record. */
  async #persistArtifact(householdId, record, { trigger }) {
    const memo = memoFromRecord(record);
    const meaningful = Boolean(record.sessionId && memo.transcriptClean && memo.transcriptClean !== NO_MEMO);

    if (!meaningful) {
      return this.#settleTranscribed(householdId, record, memo, { persisted: false, reason: 'nothing_to_attach' });
    }

    // The interactive path hands the memo straight back to the browser, which
    // writes it into the live session on its next tick. Only an ended session
    // (or any retry, where no browser is listening) is written from here.
    const attachment = await this.#sessionAttachment(record, householdId, trigger);

    if (attachment.kind === 'session_live' && trigger === 'interactive') {
      return this.#settleTranscribed(householdId, record, memo, { persisted: false, reason: 'frontend_owns_live_session' });
    }

    if (attachment.kind === 'session_live' || attachment.kind === 'session_missing') {
      return this.#deferPersist(householdId, record, memo, attachment.kind);
    }

    if (attachment.kind === 'failed') {
      if (trigger === 'interactive') {
        // Tell the caller the truth: the transcript exists but the session
        // write did not land. The record stays open so the worker retries it.
        this.#deferPersist(householdId, record, memo, 'append_failed');
        return { kind: 'persist_failed', memo };
      }
      return this.#deferPersist(householdId, record, memo, 'append_failed');
    }

    if (this.enrichment) {
      this.enrichment.reEnrichDescription(record.sessionId, memo).catch((error) => {
        this.logger.warn?.('strava.voice_memo_backfill.failed', {
          sessionId: record.sessionId, error: error?.message,
        });
      });
    }
    return this.#settleTranscribed(householdId, record, memo, { persisted: true, reason: 'appended' });
  }

  /** @returns {{kind: 'appended'|'session_live'|'session_missing'|'failed'}} */
  async #sessionAttachment(record, sweepHouseholdId, trigger) {
    if (!this.sessions?.appendVoiceMemo) return { kind: 'session_missing' };
    // The memo belongs to the household it was CAPTURED under. The sweep id is
    // only the folder the worker happened to be walking, and using it would
    // write a recovered memo into the wrong household's session.
    const householdId = record.householdId ?? sweepHouseholdId;
    try {
      const existing = await this.sessions.getSession(record.sessionId, householdId, { decodeTimeline: false });
      if (!existing) return { kind: 'session_missing' };
      const endMs = existing.endTime || (existing.session?.end ? Date.parse(existing.session.end) : null);
      if (!endMs || endMs >= this.clock.now()) return { kind: 'session_live' };

      const appended = await this.sessions.appendVoiceMemo(record.sessionId, householdId, memoFromRecord(record));
      if (!appended) {
        this.logger.error?.('fitness.voice_memo.retroactive_persist_dropped', {
          ref: record.ref, sessionId: record.sessionId, householdId, trigger,
        });
        return { kind: 'failed' };
      }
      this.logger.info?.('fitness.voice_memo.retroactive_persisted', {
        ref: record.ref, sessionId: record.sessionId, householdId, trigger,
      });
      return { kind: 'appended' };
    } catch (error) {
      this.logger.warn?.('fitness.voice_memo.retroactive_persist_failed', {
        ref: record.ref, sessionId: record.sessionId, error: error?.message,
      });
      return { kind: 'failed' };
    }
  }

  /**
   * Hold a transcribed memo open until its session can accept it. Costs no
   * provider credit — the transcript is already on the record — and is bounded
   * so a session that never ends leaves a staff-visible record rather than a
   * job that retries forever.
   */
  #deferPersist(householdId, record, memo, reason) {
    const now = this.clock.now();
    const persistAttempts = (record.persistAttempts || 0) + 1;

    if (persistAttempts >= MAX_PERSIST_ATTEMPTS) {
      const updated = this.artifacts.update(householdId, record.ref, {
        state: ARTIFACT_STATES.PERMANENTLY_FAILED, persistAttempts,
        givenUpReason: `persist_${reason}`, attemptStartedAt: null, nextAttemptAt: null, updatedAt: now,
      });
      this.logger.error?.('fitness.voice_memo.artifact.permanently_failed', {
        ref: record.ref, givenUpReason: `persist_${reason}`, persistAttempts,
      });
      return { kind: 'persist_failed', memo, artifact: publicView(updated || record) };
    }

    const updated = this.artifacts.update(householdId, record.ref, {
      state: ARTIFACT_STATES.RETRYABLE, persistAttempts,
      nextAttemptAt: now + PERSIST_RETRY_DELAY_MS, attemptStartedAt: null, updatedAt: now,
    });
    this.logger.info?.('fitness.voice_memo.artifact.persist_deferred', {
      ref: record.ref, sessionId: record.sessionId, reason, persistAttempts,
      nextAttemptAt: now + PERSIST_RETRY_DELAY_MS,
    });
    return { kind: 'transcribed', memo, artifact: publicView(updated || record) };
  }

  #settleTranscribed(householdId, record, memo, { persisted, reason }) {
    const now = this.clock.now();
    const updated = this.artifacts.update(householdId, record.ref, {
      state: ARTIFACT_STATES.TRANSCRIBED, attemptStartedAt: null, nextAttemptAt: null,
      persistedToSession: persisted, updatedAt: now,
    });
    this.logger.info?.('fitness.voice_memo.artifact.transcribed', {
      ref: record.ref, sessionId: record.sessionId || null, persisted, reason,
      attempts: record.attempts ?? null,
    });
    return { kind: 'transcribed', memo, artifact: publicView(updated || record) };
  }

  #withHouseholdMembers(sessionContext, householdId) {
    const householdMembers = this.config?.getHouseholdMemberNames?.(householdId) || [];
    return { ...sessionContext, householdMembers };
  }

  /**
   * The pre-durability path, kept for the two cases where no artifact exists:
   * no store is wired, or the capture write itself failed. It can still lose a
   * recording — that is precisely why it is the exception, not the default.
   */
  async #transcribeWithoutArtifact(input, householdId) {
    const { sessionId, context: sessionContext = {} } = input;
    const memo = await this.transcription.transcribeVoiceMemo({
      ...input,
      context: this.#withHouseholdMembers(sessionContext, householdId),
    });
    const meaningful = sessionId && memo?.transcriptClean && memo.transcriptClean !== NO_MEMO;

    if (meaningful && this.sessions?.appendVoiceMemo) {
      try {
        const existing = await this.sessions.getSession(sessionId, householdId, { decodeTimeline: false });
        const endMs = existing?.endTime || (existing?.session?.end ? Date.parse(existing.session.end) : null);
        if (Boolean(endMs) && endMs < this.clock.now()) {
          const appended = await this.sessions.appendVoiceMemo(sessionId, householdId, {
            transcriptClean: memo.transcriptClean, transcriptRaw: memo.transcriptRaw,
            durationSeconds: memo.durationSeconds, createdAt: memo.createdAt, memoId: memo.memoId,
          });
          this.logger.info?.('fitness.voice_memo.retroactive_persisted', { sessionId, householdId, success: Boolean(appended) });
          if (!appended) {
            this.logger.error?.('fitness.voice_memo.retroactive_persist_dropped', { sessionId, householdId });
            return { kind: 'persist_failed', memo };
          }
        }
      } catch (error) {
        this.logger.warn?.('fitness.voice_memo.retroactive_persist_failed', { sessionId, error: error?.message });
        return { kind: 'persist_failed', memo };
      }
    }

    if (meaningful && this.enrichment) {
      this.enrichment.reEnrichDescription(sessionId, memo).catch((error) => {
        this.logger.warn?.('strava.voice_memo_backfill.failed', { sessionId, error: error?.message });
      });
    }
    return { kind: 'transcribed', memo };
  }
}

/**
 * The memo the browser and the session file both see. `memoId` IS the artifact
 * ref, so a memo, its recording, and its retry history all answer to one id —
 * and a retry that appends a second time is caught by that id rather than
 * duplicating the memo.
 */
function memoFromRecord(record) {
  return {
    memoId: record.ref,
    artifactRef: record.ref,
    sessionId: record.sessionId || null,
    transcriptRaw: record.transcript?.raw ?? null,
    transcriptClean: record.transcript?.clean ?? null,
    durationSeconds: record.transcript?.durationSeconds ?? null,
    createdAt: record.transcribedAt || record.capturedAt,
    startedAt: record.startedAt || null,
    endedAt: record.endedAt || null,
  };
}

/** The artifact as an API/UI sees it: state and diagnostics, never audio or transcript. */
export function publicView(record) {
  if (!record) return null;
  return {
    ref: record.ref,
    state: record.state,
    sessionId: record.sessionId || null,
    bytes: record.bytes ?? null,
    mimeType: record.mimeType || null,
    capturedAt: record.capturedAt ?? null,
    updatedAt: record.updatedAt ?? null,
    attempts: record.attempts ?? 0,
    maxAttempts: MAX_ATTEMPTS,
    nextAttemptAt: record.nextAttemptAt ?? null,
    audioAvailable: record.audioPurgedAt == null,
    hasTranscript: Boolean(record.transcript?.clean || record.transcript?.raw),
    persistedToSession: record.persistedToSession ?? false,
    givenUpReason: record.givenUpReason || null,
    lastFailure: record.lastFailure
      ? {
        classification: record.lastFailure.classification,
        retryable: record.lastFailure.retryable,
        providerStatus: record.lastFailure.providerStatus ?? null,
        at: record.lastFailure.at ?? null,
      }
      : null,
  };
}

function resolveBuffer({ audioBuffer, audioBase64 }) {
  if (Buffer.isBuffer(audioBuffer)) return audioBuffer;
  if (typeof audioBase64 === 'string') {
    return Buffer.from(audioBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  }
  return Buffer.alloc(0);
}

export default FitnessVoiceMemoService;
