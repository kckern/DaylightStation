const finiteNonNegative = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const positiveSeconds = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

/**
 * Session-scoped activity model for one pressure mat.
 *
 * Firmware counters are device-boot counters. This tracker rebases them into
 * workout totals, reconciles missed websocket edges from periodic readings,
 * and attributes recovered reps to the user currently claiming the equipment.
 */
export class PressureMatActivityTracker {
  constructor(equipmentId, matId, config = {}) {
    this.equipmentId = String(equipmentId);
    this.matId = String(matId);
    this.activeTimeoutMs = positiveSeconds(config.active_timeout_seconds, 10) * 1000;
    this.onlineTimeoutMs = positiveSeconds(config.online_timeout_seconds, 5) * 1000;
    this.spmWindowMs = positiveSeconds(config.spm_window_seconds, 15) * 1000;
    this.reset();
  }

  reset() {
    this.sessionSteps = 0;
    this.sessionStomps = 0;
    this.userTotals = new Map();
    this.stepTimestamps = [];
    this.lastSeenAt = null;
    this.lastStepAt = null;
    this.lastStompAt = null;
    this.lastDeviceSteps = null;
    this.lastDeviceStomps = null;
    this.lastBootCount = null;
    this.engaged = false;
    this.seenThisSession = false;
    this.latest = null;
  }

  disengage() {
    if (!this.engaged) return false;
    this.engaged = false;
    return true;
  }

  _attribute(userId, stepDelta, stompDelta) {
    if (!userId || (!stepDelta && !stompDelta)) return;
    const key = String(userId);
    const totals = this.userTotals.get(key) || { steps: 0, stomps: 0 };
    totals.steps += stepDelta;
    totals.stomps += stompDelta;
    this.userTotals.set(key, totals);
  }

  _recordSteps(count, timestamp) {
    for (let i = 0; i < count; i += 1) this.stepTimestamps.push(timestamp);
    if (count > 0) {
      this.lastStepAt = timestamp;
      this.engaged = true;
      this.seenThisSession = true;
    }
  }

  _rebaseIfRestarted(reading) {
    const bootCount = finiteNonNegative(reading.bootCount);
    const steps = finiteNonNegative(reading.steps);
    const stomps = finiteNonNegative(reading.stomps);
    const bootChanged = bootCount != null && this.lastBootCount != null && bootCount !== this.lastBootCount;
    const countersDecreased = (steps != null && this.lastDeviceSteps != null && steps < this.lastDeviceSteps)
      || (stomps != null && this.lastDeviceStomps != null && stomps < this.lastDeviceStomps);
    if (bootChanged || countersDecreased) {
      this.lastDeviceSteps = null;
      this.lastDeviceStomps = null;
    }
    if (bootCount != null) this.lastBootCount = bootCount;
  }

  /**
   * @param {object} reading normalized pressure-mat websocket payload
   * @param {{timestamp?:number, assignedUserId?:string|null, countSession?:boolean}} options
   */
  ingest(reading, { timestamp = Date.now(), assignedUserId = null, countSession = true } = {}) {
    if (!reading || String(reading.id || '') !== this.matId) return this.snapshot(timestamp);
    const now = Number.isFinite(timestamp) ? timestamp : Date.now();
    this.lastSeenAt = now;
    this.latest = { ...reading, receivedAt: now };
    this._rebaseIfRestarted(reading);

    const rawSteps = finiteNonNegative(reading.steps);
    const rawStomps = finiteNonNegative(reading.stomps);
    const isStepEdge = reading.type === 'presence' && reading.event === 'pressed';
    const isStompEdge = reading.type === 'presence' && reading.event === 'stomped';

    let stepDelta = 0;
    let stompDelta = 0;

    if (rawSteps != null) {
      if (this.lastDeviceSteps == null) stepDelta = isStepEdge || isStompEdge ? 1 : 0;
      else if (rawSteps > this.lastDeviceSteps) stepDelta = rawSteps - this.lastDeviceSteps;
      this.lastDeviceSteps = rawSteps;
    } else if (isStepEdge) {
      stepDelta = 1;
    }

    if (rawStomps != null) {
      if (this.lastDeviceStomps == null) stompDelta = isStompEdge ? 1 : 0;
      else if (rawStomps > this.lastDeviceStomps) stompDelta = rawStomps - this.lastDeviceStomps;
      this.lastDeviceStomps = rawStomps;
    } else if (isStompEdge) {
      stompDelta = 1;
    }

    // A stomp is one of the already-counted steps. If its pressed edge was
    // missed and the stomp is the first message we see, restore that step once.
    if (isStompEdge && stompDelta > 0 && stepDelta === 0 && rawSteps == null) stepDelta = stompDelta;

    if (countSession) {
      this.sessionSteps += stepDelta;
      this.sessionStomps += stompDelta;
      this._recordSteps(stepDelta, now);
      if (stompDelta > 0) {
        this.lastStompAt = now;
        this.seenThisSession = true;
      }
      this._attribute(assignedUserId, stepDelta, stompDelta);
    }

    this.tick(now);
    return this.snapshot(now);
  }

  tick(timestamp = Date.now()) {
    const cutoff = timestamp - this.spmWindowMs;
    while (this.stepTimestamps.length && this.stepTimestamps[0] < cutoff) {
      this.stepTimestamps.shift();
    }
  }

  snapshot(timestamp = Date.now()) {
    this.tick(timestamp);
    const online = this.lastSeenAt != null && timestamp - this.lastSeenAt <= this.onlineTimeoutMs;
    const active = this.lastStepAt != null && timestamp - this.lastStepAt <= this.activeTimeoutMs;
    const users = {};
    this.userTotals.forEach((totals, userId) => { users[userId] = { ...totals }; });
    return {
      equipmentId: this.equipmentId,
      matId: this.matId,
      online,
      active,
      engaged: this.engaged,
      seenThisSession: this.seenThisSession,
      occupied: Boolean(this.latest?.occupied),
      sessionSteps: this.sessionSteps,
      sessionStomps: this.sessionStomps,
      stepsPerMinute: this.stepTimestamps.length * (60000 / this.spmWindowMs),
      lastSeenAt: this.lastSeenAt,
      lastStepAt: this.lastStepAt,
      lastStompAt: this.lastStompAt,
      users,
      latest: this.latest ? { ...this.latest } : null,
    };
  }
}

export default PressureMatActivityTracker;
