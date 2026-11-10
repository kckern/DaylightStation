import { CycleRaceEngine } from "./CycleRaceEngine.js";

// Slack for comparing accumulated seconds against a threshold. The engine sums
// its interval in floating point, so ten 100 ms ticks read as 0.9999999999999999.
const EPSILON_S = 1e-6;

/**
 * Lifecycle state machine for a cycle race. Wraps CycleRaceEngine and adds the
 * countdown, parking, and the mercy-kill/forced-finish handling.
 *
 * Nobody is eliminated. A rider idle for `parkIdleS` is PARKED: they stay in
 * the race with the distance they have, and the first pedal stroke brings them
 * back. A rider still riding when the clock or the operator closes the race is
 * `overtime` and keeps their real distance. `parked`, `noSensor` and `overtime`
 * are mutually exclusive: a rider who is away is never also overtime.
 *
 * The race ends when:
 *  - distance: every live rider has finished or is in overtime; once somebody
 *    has crossed the line, parked and no-sensor riders stop holding it open
 *  - time: the cap is reached
 *  - either: every live unfinished rider has been away from the pedals for
 *    `allParkedEndS` of race time
 * A ghost (recording) never affects when a race closes: it neither holds a race
 * open nor starts the mercy window.
 *
 * Pure (caller drives countdownTick/tick). Phases: staged → countdown → racing
 * → finished → results; cancelled (any).
 */
export class CycleRaceController {
  constructor(config = {}) {
    this.config = config;
    this.phase = 'staged';
    this.countdownRemaining = Number.isFinite(config.startCountdownS) ? config.startCountdownS : 3;
    // Idle window before a rider is PARKED (not eliminated). `raceIdleDnfS` is
    // the legacy config key and is still honoured.
    this.parkIdleS = Number.isFinite(config.parkIdleS) ? config.parkIdleS
      : (Number.isFinite(config.raceIdleDnfS) ? config.raceIdleDnfS : 20);
    // Seconds every live rider must stay parked before the race closes itself.
    this.allParkedEndS = Number.isFinite(config.allParkedEndS) ? config.allParkedEndS : 15;
    // Race time (engine elapsedS) at which every live unfinished rider was first
    // away from the pedals; null while anybody is riding.
    this._allAwaySinceS = null;
    // True once the operator ended the race by hand (finishNow).
    this.endedEarly = false;
    // Start-grace: a rider who has NOT yet registered any movement gets this
    // (more generous) window before being parked, instead of parkIdleS. It
    // exists because magnetless cadence sensors (e.g. the COOSPO BK467 on the
    // tricycle) can take ~20s to lock onto rotation from a dead stop, reporting
    // rpm 0 the whole time even while the rider is pedalling. Once a rider has
    // registered movement once, the normal parkIdleS clock takes over.
    this.raceStartGraceS = Number.isFinite(config.raceStartGraceS) ? config.raceStartGraceS : 30;
    this.engine = null;
    // Riders who have stopped pedalling. They are still in the race and come
    // back on their next pedal stroke.
    this.parked = new Set();
    // Riders who were still riding when the CLOCK/OPERATOR closed the race
    // (mercy-kill window closing, or a forced finish). They keep their real
    // distance in the results (audit game-design #7 — mercy-kill must not brand
    // a rider who was still going a failure). Never a parked or no-sensor rider.
    this.overtime = new Set();
    // Riders whose SENSOR never reported, as distinct from riders who did not
    // pedal. Both look like rpm 0 from here, and blaming the rider for the first
    // told a child "Stopped pedaling for 30s" while he was pedalling — his
    // cadence sensor had been silent for four minutes. A rider who never had a
    // connected reading has not idled out; there is nothing to idle. They leave
    // this set the moment their sensor reports movement.
    this.noSensor = new Set();
    this._idle = new Map(); // userId -> consecutive idle TICKS (not summed seconds)
    this._started = new Set(); // riders that have registered rpm > 0 at least once
    // Riders that have had at least one CONNECTED sensor reading. Absent a
    // `connected` flag the input is treated as connected, so a caller that does
    // not report sensor state keeps exactly the behaviour it had.
    this._sensorSeen = new Set();
    // Distance-race mercy-kill (issue 2): once the first rider crosses the line,
    // end the race this many seconds later, putting anyone still going in overtime —
    // a distance race otherwise waits forever for the slowest rider. 0 = off.
    // The product default lives at the container/config layer (race_mercy_after_winner_s);
    // the pure controller defaults OFF so existing race fixtures are unaffected.
    this.raceMercyAfterWinnerS = Number.isFinite(config.raceMercyAfterWinnerS) && config.raceMercyAfterWinnerS > 0
      ? config.raceMercyAfterWinnerS
      : 0;
    // Ghost riders replay a recording — they are never parked and never hold a
    // race open.
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

  tick(inputs = {}) {
    if (this.phase !== 'racing' || !this.engine) return this.getState();
    const intervalS = this.engine.intervalSeconds;
    const before = this.engine.getState();

    const filtered = {};
    for (const userId of Object.keys(before.riders)) {
      // Ghosts are driven by their recording — pass through untouched.
      if (this.ghosts.has(userId)) { filtered[userId] = inputs[userId] || {}; continue; }
      const input = inputs[userId] || {};
      const rpm = Number.isFinite(input.rpm) ? input.rpm : 0;
      // A reading counts as connected unless the caller explicitly says it is
      // not — see `_sensorSeen`.
      if (input.connected !== false) this._sensorSeen.add(userId);

      const moving = rpm > 0;
      if (moving) {
        this._started.add(userId);
        // Pedalling always brings a rider back. Nobody is out for good.
        this.parked.delete(userId);
        this.noSensor.delete(userId);
      }
      const idleTicks = moving ? 0 : (this._idle.get(userId) || 0) + 1;
      this._idle.set(userId, idleTicks);
      const finished = before.riders[userId].finishTimeS != null;
      // Before a rider's first movement the (more generous) start-grace applies —
      // covering sensor lock-on lag; afterwards the normal idle clock governs.
      const threshold = this._started.has(userId) ? this.parkIdleS : this.raceStartGraceS;
      if (!finished && !moving && idleTicks * intervalS + EPSILON_S >= threshold) {
        // Never a connected reading and never a revolution: the sensor did not
        // show up, and the rider is not the one who stopped. A rider who HAS
        // ridden keeps the idle clock even if their sensor drops later — they
        // demonstrably had one, so the plain reading of a still bike is that
        // they stopped.
        // A rider is in one set or the other, never both.
        if (!this._sensorSeen.has(userId) && !this._started.has(userId)) {
          this.noSensor.add(userId);
          this.parked.delete(userId);
        } else {
          this.parked.add(userId);
          this.noSensor.delete(userId);
        }
      }
      filtered[userId] = input;
    }
    this.engine.tick(filtered);
    this._trackAllAway();
    this._applyMercyKill();
    if (this._isFinished()) this.phase = 'finished';
    return this.getState();
  }

  _away(userId) { return this.parked.has(userId) || this.noSensor.has(userId); }

  // Remembers the race time at which EVERY live, unfinished rider was first away
  // from the pedals. Anybody riding clears it.
  _trackAllAway() {
    const s = this.engine.getState();
    const open = Object.values(s.riders)
      .filter((r) => !this.ghosts.has(r.userId) && r.finishTimeS == null);
    const allAway = open.length > 0 && open.every((r) => this._away(r.userId));
    if (!allAway) this._allAwaySinceS = null;
    else if (this._allAwaySinceS == null) this._allAwaySinceS = s.elapsedS;
  }

  // Distance-race mercy-kill: once the first LIVE rider has finished, close the
  // race raceMercyAfterWinnerS seconds later. Every non-ghost rider still riding
  // lands in `overtime` (real distance kept); a parked or no-sensor rider stays
  // where they are. The subsequent _isFinished() check then ends the race. A
  // recording crossing the line does not start the window (a ghost-only field,
  // which has no live rider to wait for, uses the ghosts' times). No-op when
  // disabled, for time races, or before anyone has crossed the line.
  _applyMercyKill() {
    if (this.raceMercyAfterWinnerS <= 0 || this.config.winCondition === 'time') return;
    const s = this.engine.getState();
    const riders = Object.values(s.riders);
    const live = riders.filter((r) => !this.ghosts.has(r.userId));
    const finishTimes = (live.length ? live : riders)
      .map((r) => r.finishTimeS)
      .filter((t) => t != null);
    if (!finishTimes.length) return;
    const firstFinish = Math.min(...finishTimes);
    if (s.elapsedS - firstFinish + EPSILON_S < this.raceMercyAfterWinnerS) return;
    riders.forEach((r) => {
      if (this.ghosts.has(r.userId)) return;
      if (r.finishTimeS != null) return;
      if (this._away(r.userId)) return; // parked / no-sensor: not riding, not overtime
      this.overtime.add(r.userId);
    });
  }

  // Operator-driven end: close the race for every non-ghost rider who is still
  // riding — landing in `overtime` (real distance kept), same rule as
  // the mercy-kill above — and mark the race `endedEarly`. Distinct from
  // cancel() — the race is finalized and saved, not discarded. No-op outside the
  // racing phase.
  finishNow() {
    if (this.phase !== 'racing' || !this.engine) return this.getState();
    const s = this.engine.getState();
    Object.values(s.riders).forEach((r) => {
      if (this.ghosts.has(r.userId)) return;
      if (r.finishTimeS != null) return;
      if (this._away(r.userId)) return; // parked / no-sensor: not riding, not overtime
      this.overtime.add(r.userId);
    });
    this.endedEarly = true;
    this.phase = 'finished';
    return this.getState();
  }

  _isFinished() {
    const s = this.engine.getState();
    const riders = Object.values(s.riders);
    const live = riders.filter((r) => !this.ghosts.has(r.userId));
    // Everyone walked away and stayed away: close the race in either mode.
    if (live.length && this._allAwaySinceS != null
      && s.elapsedS - this._allAwaySinceS + EPSILON_S >= this.allParkedEndS) return true;
    if (this.config.winCondition === 'time') return s.finished;
    const field = live.length ? live : riders;
    const done = (r) => r.finishTimeS != null || this.overtime.has(r.userId);
    // Once somebody has crossed the line, parked riders no longer hold it open.
    const anyDone = field.some(done);
    return field.every((r) => done(r) || (anyDone && this._away(r.userId)));
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
    return {
      phase: this.phase,
      countdownRemaining: this.countdownRemaining,
      parked: [...this.parked],
      noSensor: [...this.noSensor],
      overtime: [...this.overtime],
      endedEarly: this.endedEarly,
      // Legacy keys, always empty. Removed with their last consumers in Task 6/8.
      dnf: [],
      penalized: [],
      penaltyInfo: {},
      engineState: this.engine ? this.engine.getState() : null
    };
  }
}

export default CycleRaceController;
