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
      const input = inputs[userId] || {};
      const rpm = Number.isFinite(input.rpm) ? input.rpm : 0;
      const nextIdle = rpm > 0 ? 0 : (this._idle.get(userId) || 0) + intervalS;
      this._idle.set(userId, nextIdle);
      const finished = before.riders[userId].finishTimeS != null;
      if (!finished && nextIdle >= this.raceIdleDnfS) this.dnf.add(userId);
      filtered[userId] = this.dnf.has(userId) ? { rpm: 0, zoneId: input.zoneId ?? null } : input;
    }
    this.engine.tick(filtered);
    if (this._isFinished()) this.phase = 'finished';
    return this.getState();
  }

  _isFinished() {
    const s = this.engine.getState();
    if (this.config.winCondition === 'time') return s.finished;
    return Object.values(s.riders).every((r) => r.finishTimeS != null || this.dnf.has(r.userId));
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
      engineState: this.engine ? this.engine.getState() : null
    };
  }
}

export default CycleRaceController;
