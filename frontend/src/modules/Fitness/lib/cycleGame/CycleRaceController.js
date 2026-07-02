import { CycleRaceEngine } from './CycleRaceEngine.js';

/**
 * Lifecycle state machine for a cycle race. Wraps CycleRaceEngine and adds the
 * countdown, idle→DNF handling, and the mercy-kill/forced-finish→overtime
 * handling (a rider cut off by the clock/operator while still honestly riding
 * is `overtime`, not `dnf` — see `overtime` on getState()). Pure (caller drives
 * countdownTick/tick). Phases: staged → countdown → racing → finished → results;
 * cancelled (any).
 */
export class CycleRaceController {
  constructor(config = {}) {
    this.config = config;
    this.phase = 'staged';
    this.countdownRemaining = Number.isFinite(config.startCountdownS) ? config.startCountdownS : 3;
    this.raceIdleDnfS = Number.isFinite(config.raceIdleDnfS) ? config.raceIdleDnfS : 20;
    // Start-grace: a rider who has NOT yet registered any movement gets this
    // (more generous) window before a no-show DNF, instead of raceIdleDnfS. It
    // exists because magnetless cadence sensors (e.g. the COOSPO BK467 on the
    // tricycle) can take ~20s to lock onto rotation from a dead stop, reporting
    // rpm 0 the whole time even while the rider is pedalling. Once a rider has
    // registered movement once, the normal raceIdleDnfS clock takes over.
    this.raceStartGraceS = Number.isFinite(config.raceStartGraceS) ? config.raceStartGraceS : 30;
    this.engine = null;
    this.dnf = new Set();
    // Riders whose race was cut short by the CLOCK/OPERATOR (mercy-kill window
    // closing, or a forced finish) while they were still honestly riding — distinct
    // from `dnf` (idle-quit). They keep their real distance in the results, not the
    // "DNF" label (audit game-design #7 — mercy-kill must not brand an honest
    // finisher a failure).
    this.overtime = new Set();
    this._idle = new Map();
    this._started = new Set(); // riders that have registered rpm > 0 at least once
    // Hot-start penalty ("penalty box"): a rider already pedalling at the green
    // light has their meter disabled (no distance). They leave the box only once
    // BOTH the configured timer has elapsed AND they have returned to RPM 0 — so
    // someone who keeps pedalling stays boxed indefinitely. 0 = off.
    this.hotStartPenaltyS = Number.isFinite(config.hotStartPenaltyS) ? config.hotStartPenaltyS : 0;
    // Distance-race mercy-kill (issue 2): once the first rider crosses the line,
    // end the race this many seconds later, forfeiting (DNF) anyone still going —
    // a distance race otherwise waits forever for the slowest rider. 0 = off.
    // The product default lives at the container/config layer (race_mercy_after_winner_s);
    // the pure controller defaults OFF so existing race fixtures are unaffected.
    this.raceMercyAfterWinnerS = Number.isFinite(config.raceMercyAfterWinnerS) && config.raceMercyAfterWinnerS > 0
      ? config.raceMercyAfterWinnerS
      : 0;
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

      const moving = rpm > 0;
      if (moving) this._started.add(userId);
      const nextIdle = moving ? 0 : (this._idle.get(userId) || 0) + intervalS;
      this._idle.set(userId, nextIdle);
      const finished = before.riders[userId].finishTimeS != null;
      // Before a rider's first movement the (more generous) start-grace applies —
      // covering sensor lock-on lag; afterwards the normal idle clock governs.
      const dnfThreshold = this._started.has(userId) ? this.raceIdleDnfS : this.raceStartGraceS;
      if (!finished && nextIdle >= dnfThreshold) this.dnf.add(userId);

      filtered[userId] = (this.dnf.has(userId) || boxed)
        ? { rpm: 0, zoneId: input.zoneId ?? null }
        : input;
    }
    this.engine.tick(filtered);
    this._applyMercyKill();
    if (this._isFinished()) this.phase = 'finished';
    return this.getState();
  }

  // Distance-race mercy-kill: once the first rider has finished, close the race
  // for every still-racing non-ghost rider after raceMercyAfterWinnerS seconds —
  // they land in `overtime` (real distance kept), NOT `dnf`; an idle-quitter who
  // was already flagged `dnf` before the window closed stays `dnf` (they quit,
  // the clock didn't cut them off). The subsequent _isFinished() check then ends
  // the race. No-op when disabled, for time races, or before anyone has crossed
  // the line.
  _applyMercyKill() {
    if (this.raceMercyAfterWinnerS <= 0 || this.config.winCondition === 'time') return;
    const s = this.engine.getState();
    const finishTimes = Object.values(s.riders)
      .map((r) => r.finishTimeS)
      .filter((t) => t != null);
    if (!finishTimes.length) return;
    const firstFinish = Math.min(...finishTimes);
    if (s.elapsedS - firstFinish < this.raceMercyAfterWinnerS) return;
    Object.values(s.riders).forEach((r) => {
      if (this.ghosts.has(r.userId)) return;
      if (r.finishTimeS != null) return;
      if (this.dnf.has(r.userId)) return; // already forfeited (idle-quit) — stays DNF
      this.overtime.add(r.userId);
    });
  }

  // Operator-driven end: close the race for every non-ghost rider who hasn't
  // crossed the line — landing in `overtime` (real distance kept), same rule as
  // the mercy-kill above; an already-dnf idle-quitter stays `dnf`. Distinct from
  // cancel() — the race is finalized and saved, not discarded. No-op outside the
  // racing phase.
  finishNow() {
    if (this.phase !== 'racing' || !this.engine) return this.getState();
    const s = this.engine.getState();
    Object.values(s.riders).forEach((r) => {
      if (this.ghosts.has(r.userId)) return;
      if (r.finishTimeS != null) return;
      if (this.dnf.has(r.userId)) return; // already forfeited (idle-quit) — stays DNF
      this.overtime.add(r.userId);
    });
    this.phase = 'finished';
    return this.getState();
  }

  _isFinished() {
    const s = this.engine.getState();
    if (this.config.winCondition === 'time') return s.finished;
    return Object.values(s.riders).every(
      (r) => r.finishTimeS != null || this.dnf.has(r.userId) || this.overtime.has(r.userId)
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
      overtime: [...this.overtime],
      penalized: [...this._penalty.keys()],
      penaltyInfo,
      engineState: this.engine ? this.engine.getState() : null
    };
  }
}

export default CycleRaceController;
