export const PRESSURE_MAT_STARTUP_WINDOW_MS = 10_000;

const finiteNonNegative = (value) => {
  if (value == null || value === '') return null;
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
    this.configure(config);
    this.reset();
  }

  // Updating presentation/rate settings must not reset physical activity.
  configure(config = {}) {
    this.activeTimeoutMs = positiveSeconds(config.active_timeout_seconds, 10) * 1000;
    this.onlineTimeoutMs = positiveSeconds(config.online_timeout_seconds, 5) * 1000;
    this.spmWindowMs = positiveSeconds(config.spm_window_seconds, 15) * 1000;
    // Silence gate, mirroring DeviceManager's rpmZero for cadence: a rate is a
    // claim about NOW, so it must fall to zero once the footfalls stop rather
    // than decaying over the whole averaging window. Sized for stepping, not
    // pedaling — at 40 SPM footfalls are 1.5s apart, so cadence's 1.2s would
    // flicker to zero between every step. 4s holds cleanly down to ~15 SPM.
    this.spmZeroMs = positiveSeconds(config.spm_zero_seconds, 4) * 1000;
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
    this.lastDeviceTs = null;
    this.engaged = false;
    this.seenThisSession = false;
    this.latest = null;
    this._startupActivity = [];
  }

  // Keep the live device epoch/baseline at session start. Resetting it would
  // either drop the first pending step or mistake a duplicate for a new one.
  beginSession(timestamp, { retainStartup = false } = {}) {
    const pending = retainStartup ? this._startupActivity.filter((sample) =>
      timestamp >= sample.timestamp && timestamp - sample.timestamp <= PRESSURE_MAT_STARTUP_WINDOW_MS) : [];
    this.sessionSteps = this.sessionStomps = 0;
    this.userTotals.clear();
    this.stepTimestamps = [];
    this.lastStepAt = this.lastStompAt = null;
    this.engaged = this.seenThisSession = false;
    this._startupActivity = [];
    for (const sample of pending) this._countActivity(sample);
    return this.snapshot(timestamp);
  }

  _countActivity({ stepDelta, stompDelta, timestamp, assignedUserId }) {
    this.sessionSteps += stepDelta;
    this.sessionStomps += stompDelta;
    this._recordSteps(stepDelta, timestamp);
    if (stompDelta > 0) {
      this.lastStompAt = timestamp;
      this.seenThisSession = true;
    }
    this._attribute(assignedUserId, stepDelta, stompDelta);
  }

  /** Durable workout state only: never replay device-boot counters across a browser gap. */
  checkpoint() {
    return {
      equipmentId: this.equipmentId,
      matId: this.matId,
      sessionSteps: this.sessionSteps,
      sessionStomps: this.sessionStomps,
      users: Object.fromEntries([...this.userTotals].map(([id, totals]) => [id, { ...totals }])),
      engaged: this.engaged,
      seenThisSession: this.seenThisSession,
    };
  }

  restore(state = {}, { preserveLive = false } = {}) {
    const live = preserveLive ? this.checkpoint() : null;
    if (!preserveLive) this.reset();
    this.sessionSteps = (finiteNonNegative(state.sessionSteps) ?? 0) + (live?.sessionSteps || 0);
    this.sessionStomps = (finiteNonNegative(state.sessionStomps) ?? 0) + (live?.sessionStomps || 0);
    this.userTotals.clear();
    Object.entries(state.users || {}).forEach(([id, totals]) => {
      this.userTotals.set(id, {
        steps: finiteNonNegative(totals?.steps) ?? 0,
        stomps: finiteNonNegative(totals?.stomps) ?? 0,
      });
    });
    Object.entries(live?.users || {}).forEach(([id, totals]) => this._attribute(id, totals.steps, totals.stomps));
    this.seenThisSession = Boolean(state.seenThisSession || this.sessionSteps || this.sessionStomps);
    this.engaged = Boolean(live?.engaged || (state.engaged ?? this.seenThisSession));
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

  _acceptCounterEpoch(reading) {
    const bootCount = finiteNonNegative(reading.bootCount);
    const deviceTs = finiteNonNegative(reading.deviceTs);
    const steps = finiteNonNegative(reading.steps);
    const stomps = finiteNonNegative(reading.stomps);
    const comparableBoot = bootCount != null && this.lastBootCount != null;
    // Old frames must not resurrect a previous device boot.
    if (comparableBoot && bootCount < this.lastBootCount) return false;
    const bootChanged = comparableBoot && bootCount > this.lastBootCount;
    const countersDecreased = (steps != null && this.lastDeviceSteps != null && steps < this.lastDeviceSteps)
      || (stomps != null && this.lastDeviceStomps != null && stomps < this.lastDeviceStomps);
    const clockRewound = deviceTs != null && this.lastDeviceTs != null && deviceTs < this.lastDeviceTs;
    // Legacy firmware without boot/clock identity can only signal reset by its
    // counters. With identity available, a regressing reading is stale, not a
    // new boot; wait for an authoritative hello/new boot instead of overcounting.
    const legacyRestart = !comparableBoot && countersDecreased
      && (reading.type === 'hello' || (deviceTs == null && this.lastDeviceTs == null));
    if (!bootChanged && !legacyRestart && (clockRewound || countersDecreased)) return false;
    if (bootChanged || legacyRestart) {
      this.lastDeviceSteps = null;
      this.lastDeviceStomps = null;
      this.lastDeviceTs = null;
    }
    if (bootCount != null) this.lastBootCount = bootCount;
    if (deviceTs != null) this.lastDeviceTs = deviceTs;
    return true;
  }

  /**
   * @param {object} reading normalized pressure-mat websocket payload
   * @param {{timestamp?:number, assignedUserId?:string|null, countSession?:boolean, retainStartup?:boolean}} options
   */
  ingest(reading, { timestamp = Date.now(), assignedUserId = null, countSession = true, retainStartup = false } = {}) {
    if (!reading || String(reading.id || '') !== this.matId) return this.snapshot(timestamp);
    const now = Number.isFinite(timestamp) ? timestamp : Date.now();
    if (!this._acceptCounterEpoch(reading)) return this.snapshot(now);
    const previousSeenAt = this.lastSeenAt;
    this.lastSeenAt = now;
    this.latest = { ...reading, receivedAt: now };

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

    const activity = { stepDelta, stompDelta, timestamp: now, assignedUserId };
    this._startupActivity = this._startupActivity.filter((sample) => now - sample.timestamp <= PRESSURE_MAT_STARTUP_WINDOW_MS);
    if (countSession) {
      this._countActivity(activity);
    } else if (retainStartup && (stepDelta || stompDelta)) {
      // Do not import an unobserved idle interval just because HR has now
      // arrived. With no recent baseline, retain only an explicit new edge.
      if (previousSeenAt == null || now - previousSeenAt > PRESSURE_MAT_STARTUP_WINDOW_MS) {
        activity.stepDelta = isStepEdge || isStompEdge ? Math.min(1, stepDelta) : 0;
        activity.stompDelta = isStompEdge ? Math.min(1, stompDelta) : 0;
      }
      this._startupActivity.push(activity);
      this._startupActivity = this._startupActivity.slice(-256);
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

  /**
   * Live step rate, or 0 once the mat has gone quiet.
   *
   * The sliding window alone cannot express "stopped": one step inside a 15s
   * window still reads 4 SPM for a further 15 seconds. So the window supplies
   * the VALUE and `lastStepAt` supplies the LIVENESS, exactly as cadence pairs
   * its reading with `lastSignificantActivity` under DeviceManager's rpmZero.
   *
   * An offline mat needs no separate branch: steps only arrive as messages, so
   * `lastStepAt <= lastSeenAt` and any mat stale enough to be offline is
   * already past this gate. The card reports the reason for a dead sensor
   * through `online`/`status`, not through a held rate.
   */
  _stepsPerMinute(timestamp) {
    if (this.lastStepAt == null || timestamp - this.lastStepAt > this.spmZeroMs) return 0;
    return this.stepTimestamps.length * (60000 / this.spmWindowMs);
  }

  snapshot(timestamp = Date.now()) {
    this.tick(timestamp);
    const online = this.lastSeenAt != null && timestamp - this.lastSeenAt <= this.onlineTimeoutMs;
    const active = this.lastStepAt != null && timestamp - this.lastStepAt <= this.activeTimeoutMs;
    const users = {};
    this.userTotals.forEach((totals, userId) => { users[userId] = { ...totals }; });
    return {
      stepsPerMinute: this._stepsPerMinute(timestamp),
      equipmentId: this.equipmentId,
      matId: this.matId,
      online,
      active,
      engaged: this.engaged,
      seenThisSession: this.seenThisSession,
      occupied: Boolean(this.latest?.occupied),
      sessionSteps: this.sessionSteps,
      sessionStomps: this.sessionStomps,
      lastSeenAt: this.lastSeenAt,
      lastStepAt: this.lastStepAt,
      lastStompAt: this.lastStompAt,
      users,
      latest: this.latest ? { ...this.latest } : null,
    };
  }
}

export default PressureMatActivityTracker;
