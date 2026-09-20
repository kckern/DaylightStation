import { ArcadeGameSessionEndReason } from '#domains/gaming/entities/ArcadeGameSession.mjs';

/**
 * Settles durable sessions whose observer disappeared without sending unload.
 *
 * Browser tabs crash, televisions lose power and networks partition. In every
 * case the final observation may never arrive. Persisting the last known open
 * session is necessary for restart tolerance, but without an expiry owner that
 * same durability turns a vanished game into a permanent lie in `/open`, bus
 * replay and the fleet view.
 *
 * This monitor covers every persisted surface, not just externally-polled
 * devices. It never invents played time and never terminates a game: once a
 * session is older than the observation tolerance it settles only the time we
 * actually witnessed, with reason `lost`, and emits the normal ended event.
 */
export class OpenArcadeGameSessionMonitor {
  #sessions; #announcer; #scheduler; #now; #logger;
  #staleAfterMs; #intervalMs;
  #cancel = null; #running = false; #sweepPromise = null;
  #lastSweepAt = null; #lastErrorAt = null; #lastError = null; #lostCount = 0;

  constructor({
    sessions, announcer = null, scheduler, now, logger = console,
    staleAfterMs, intervalMs,
  }) {
    if (!sessions?.listOpen || !sessions?.findOpenForDevice || !sessions?.save) {
      throw new Error('OpenArcadeGameSessionMonitor requires a sessions repository');
    }
    if (typeof scheduler?.after !== 'function') {
      throw new Error('OpenArcadeGameSessionMonitor requires a scheduler with after()');
    }
    if (typeof now !== 'function') throw new Error('OpenArcadeGameSessionMonitor requires an injected now()');
    if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
      throw new Error('OpenArcadeGameSessionMonitor requires a positive staleAfterMs');
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('OpenArcadeGameSessionMonitor requires a positive intervalMs');
    }
    this.#sessions = sessions;
    this.#announcer = announcer;
    this.#scheduler = scheduler;
    this.#now = now;
    this.#logger = logger;
    this.#staleAfterMs = staleAfterMs;
    this.#intervalMs = intervalMs;
  }

  start() {
    if (this.#running) return this;
    this.#running = true;
    this.#schedule();
    return this;
  }

  stop() {
    this.#running = false;
    this.#cancel?.();
    this.#cancel = null;
    return this;
  }

  #schedule() {
    if (!this.#running) return;
    this.#cancel = this.#scheduler.after(this.#intervalMs, () => this.sweep()
      .catch((error) => this.#recordSweepFailure(error))
      .finally(() => this.#schedule()));
  }

  /** One non-overlapping pass, exposed for deterministic probes and tests. */
  sweep() {
    if (this.#sweepPromise) return this.#sweepPromise;
    this.#sweepPromise = this.#runSweep().finally(() => { this.#sweepPromise = null; });
    return this.#sweepPromise;
  }

  async #runSweep() {
    const observedNow = this.#now();
    const at = Date.parse(observedNow);
    const open = await this.#sessions.listOpen();
    const result = { checked: open.length, lost: [] };

    for (const candidate of open) {
      try {
        // Re-read immediately before settlement. An observation may have
        // refreshed the session while listOpen() was walking the datastore.
        const session = await this.#sessions.findOpenForDevice(candidate.deviceId);
        if (!session || session.id !== candidate.id) continue;
        const last = Date.parse(session.lastObservedAt || session.startedAt || '');
        const ageMs = Number.isFinite(last) ? at - last : null;
        if (ageMs !== null && ageMs <= this.#staleAfterMs) continue;

        session.end({ endedAt: observedNow, reason: ArcadeGameSessionEndReason.LOST });
        await this.#sessions.save(session);
        result.lost.push(session.id);
        this.#lostCount += 1;
        this.#logger.warn?.('arcade.session.lost', {
          sessionId: session.id,
          deviceId: session.deviceId,
          playedMs: session.playedMs,
          ageMs,
          reason: 'no observation within the runtime staleness tolerance',
        });
        await this.#announce(session);
      } catch (error) {
        this.#logger.warn?.('arcade.session.stale_settle_failed', {
          sessionId: candidate?.id ?? null,
          deviceId: candidate?.deviceId ?? null,
          error: error.message,
        });
      }
    }

    this.#lastSweepAt = observedNow;
    this.#lastError = null;
    return result;
  }

  #recordSweepFailure(error) {
    this.#lastError = error.message;
    this.#lastErrorAt = this.#now();
    this.#logger.error?.('arcade.session.monitor_failed', { error: error.message });
  }

  async #announce(session) {
    if (!this.#announcer?.ended) return;
    try {
      await this.#announcer.ended(session);
    } catch (error) {
      this.#logger.warn?.('arcade.session.announce_failed', {
        kind: 'ended', sessionId: session.id, error: error.message,
      });
    }
  }

  getHealth() {
    return {
      running: this.#running,
      staleAfterMs: this.#staleAfterMs,
      intervalMs: this.#intervalMs,
      lastSweepAt: this.#lastSweepAt,
      lastErrorAt: this.#lastErrorAt,
      lastError: this.#lastError,
      lostCount: this.#lostCount,
    };
  }
}

export default OpenArcadeGameSessionMonitor;
