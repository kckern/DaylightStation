import { CycleRaceEngine } from './CycleRaceEngine.js';

/**
 * Lifecycle state machine for a cycle race. Wraps CycleRaceEngine and adds the
 * countdown and idle→DNF handling. Pure (caller drives countdownTick/tick).
 * Phases: staged → countdown → racing → finished → results; cancelled (any).
 */
export class CycleRaceController {
  constructor(config = {}) {
    this.config = config;
    this.phase = 'staged';
    this.countdownRemaining = Number.isFinite(config.startCountdownS) ? config.startCountdownS : 3;
    this.raceIdleDnfS = Number.isFinite(config.raceIdleDnfS) ? config.raceIdleDnfS : 20;
    this.engine = null;
    this.dnf = new Set();
    this._idle = new Map();
    // Hot-start penalty ("penalty box"): a rider already pedalling at the green
    // light has their meter disabled (no distance). They leave the box only once
    // BOTH the configured timer has elapsed AND they have returned to RPM 0 — so
    // someone who keeps pedalling stays boxed indefinitely. 0 = off.
    this.hotStartPenaltyS = Number.isFinite(config.hotStartPenaltyS) ? config.hotStartPenaltyS : 0;
    this._penalty = new Map(); // userId -> remaining penalty seconds (0 = time served, awaiting RPM 0)
    this._firstTick = true;
    // Ghost riders replay a recording — they are exempt from idle/DNF and the
    // hot-start penalty (neither applies to a replay).
    this.ghosts = new Set();
    (Array.isArray(config.riders) ? config.riders : []).forEach((r) => {
      if (r && r.userId && Array.isArray(r.ghostSeries) && r.ghostSeries.length > 0) {
        this.ghosts.add(r.userId);
      }
    });
  }

  startCountdown() {
    if (this.phase !== 'staged') return this.getState();
    if (this.countdownRemaining > 0) this.phase = 'countdown';
    else this._beginRacing();
    return this.getState();
  }

  countdownTick() {
    if (this.phase !== 'countdown') return this.getState();
    this.countdownRemaining -= 1;
    if (this.countdownRemaining <= 0) this._beginRacing();
    return this.getState();
  }

  _beginRacing() {
    this.engine = new CycleRaceEngine(this.config);
    this.phase = 'racing';
  }

  /**
   * Pre-set the false starters (riders who pedalled BEFORE the green light) and
   * skip the engine's own first-tick RPM check. The green light is the GO signal —
   * pedalling on/after green is allowed and counts — so the penalty is decided by
   * the caller during the countdown, not by RPM at the first racing tick.
   */
  markFalseStarters(userIds = []) {
    if (this.hotStartPenaltyS > 0) {
      for (const uid of userIds) this._penalty.set(uid, this.hotStartPenaltyS);
    }
    this._firstTick = false; // bypass the auto rpm>0 check — green pedalling is OK
  }

  tick(inputs = {}) {
    if (this.phase !== 'racing' || !this.engine) return this.getState();
    const intervalS = this.engine.intervalSeconds;
    const before = this.engine.getState();

    // Green-light check: penalize riders already pedalling at the first tick.
    if (this._firstTick) {
      if (this.hotStartPenaltyS > 0) {
        for (const uid of Object.keys(before.riders)) {
          const r = Number.isFinite(inputs[uid]?.rpm) ? inputs[uid].rpm : 0;
          if (r > 0) this._penalty.set(uid, this.hotStartPenaltyS);
        }
      }
      this._firstTick = false;
    }

    const filtered = {};
    for (const userId of Object.keys(before.riders)) {
      // Ghosts are driven by their recording — pass through untouched, no idle/
      // DNF or penalty bookkeeping.
      if (this.ghosts.has(userId)) {
        filtered[userId] = inputs[userId] || {};
        continue;
      }
      const input = inputs[userId] || {};
      const rpm = Number.isFinite(input.rpm) ? input.rpm : 0;

      // Penalty box: meter disabled (no distance) until BOTH the timer is served
      // AND the rider has returned to RPM 0. Keep pedalling → stay boxed. The
      // timer counts down every tick; once at 0 the gate is "are you at rest?".
      let boxed = this._penalty.has(userId);
      if (boxed) {
        const remaining = Math.max(0, (this._penalty.get(userId) || 0) - intervalS);
        if (remaining <= 0 && rpm === 0) {
          this._penalty.delete(userId); // time served + at rest → released this tick
          boxed = false;
        } else {
          this._penalty.set(userId, remaining);
        }
      }

      const nextIdle = rpm > 0 ? 0 : (this._idle.get(userId) || 0) + intervalS;
      this._idle.set(userId, nextIdle);
      const finished = before.riders[userId].finishTimeS != null;
      if (!finished && nextIdle >= this.raceIdleDnfS) this.dnf.add(userId);

      filtered[userId] = (this.dnf.has(userId) || boxed)
        ? { rpm: 0, zoneId: input.zoneId ?? null }
        : input;
    }
    this.engine.tick(filtered);
    if (this._isFinished()) this.phase = 'finished';
    return this.getState();
  }

  // Operator-driven end: mark every non-ghost rider who hasn't crossed the line
  // as a forfeit (DNF) and end the race. Distinct from cancel() — the race is
  // finalized and saved, not discarded. No-op outside the racing phase.
  finishNow() {
    if (this.phase !== 'racing' || !this.engine) return this.getState();
    const s = this.engine.getState();
    Object.values(s.riders).forEach((r) => {
      if (this.ghosts.has(r.userId)) return;
      if (r.finishTimeS == null) this.dnf.add(r.userId);
    });
    this.phase = 'finished';
    return this.getState();
  }

  _isFinished() {
    const s = this.engine.getState();
    if (this.config.winCondition === 'time') return s.finished;
    return Object.values(s.riders).every(
      (r) => r.finishTimeS != null || this.dnf.has(r.userId)
    );
  }

  showResults() {
    if (this.phase === 'finished') this.phase = 'results';
    return this.getState();
  }

  cancel() {
    this.phase = 'cancelled';
    return this.getState();
  }

  getState() {
    // Every rider still in the box is "penalized" — including those whose timer
    // is served but who are still pedalling (remaining 0, awaiting RPM 0).
    const penaltyInfo = {};
    for (const [id, remaining] of this._penalty.entries()) {
      penaltyInfo[id] = {
        remainingS: Math.max(0, remaining),
        totalS: this.hotStartPenaltyS,
        awaitingStop: remaining <= 0
      };
    }
    return {
      phase: this.phase,
      countdownRemaining: this.countdownRemaining,
      dnf: [...this.dnf],
      penalized: [...this._penalty.keys()],
      penaltyInfo,
      engineState: this.engine ? this.engine.getState() : null
    };
  }
}

export default CycleRaceController;
