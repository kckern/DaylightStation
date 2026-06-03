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
    // Hot-start penalty: a rider already pedalling at the green light has their
    // RPM meter disabled for this many seconds (no jumping the gun). 0 = off.
    this.hotStartPenaltyS = Number.isFinite(config.hotStartPenaltyS) ? config.hotStartPenaltyS : 0;
    this._penalty = new Map(); // userId -> remaining penalty seconds
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

      // Hot-start penalty window: meter disabled (no distance) while it lasts.
      let penaltyLeft = this._penalty.get(userId) || 0;
      const penalized = penaltyLeft > 0;
      if (penalized) this._penalty.set(userId, Math.max(0, penaltyLeft - intervalS));

      const nextIdle = rpm > 0 ? 0 : (this._idle.get(userId) || 0) + intervalS;
      this._idle.set(userId, nextIdle);
      const finished = before.riders[userId].finishTimeS != null;
      if (!finished && nextIdle >= this.raceIdleDnfS) this.dnf.add(userId);

      filtered[userId] = (this.dnf.has(userId) || penalized)
        ? { rpm: 0, zoneId: input.zoneId ?? null }
        : input;
    }
    this.engine.tick(filtered);
    if (this._isFinished()) this.phase = 'finished';
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
    return {
      phase: this.phase,
      countdownRemaining: this.countdownRemaining,
      dnf: [...this.dnf],
      penalized: [...this._penalty.entries()].filter(([, s]) => s > 0).map(([id]) => id),
      engineState: this.engine ? this.engine.getState() : null
    };
  }
}

export default CycleRaceController;
