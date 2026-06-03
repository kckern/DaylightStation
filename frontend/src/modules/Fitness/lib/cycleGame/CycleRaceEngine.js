import { computeDistanceDelta, zoneMultiplierFor } from './distanceModel.js';

export class CycleRaceEngine {
  constructor({
    mode = 'simultaneous', winCondition = 'distance',
    goalM = 3000, timeCapS = 300, intervalMs = 5000,
    riders = [], zones = [], hrlessMultiplier = 1
  } = {}) {
    this.mode = mode;
    this.winCondition = winCondition;
    this.goalM = goalM;
    this.timeCapS = timeCapS;
    this.intervalSeconds = intervalMs / 1000;
    this.zones = zones;
    this.hrlessMultiplier = hrlessMultiplier;
    this.elapsedS = 0;
    this.finished = false;
    this.riders = new Map();
    for (const r of riders) {
      // A ghost rider replays a recorded cumulative-distance series instead of
      // converting live RPM. ghostSeries = recorded cumulative distances (m);
      // ghostIntervalS = the interval those samples were recorded at.
      const isGhost = Array.isArray(r.ghostSeries) && r.ghostSeries.length > 0;
      this.riders.set(r.userId, {
        userId: r.userId,
        displayName: r.displayName || r.userId,
        equipmentId: r.equipmentId || null,
        wheelCircumferenceM: Number.isFinite(r.wheelCircumferenceM) ? r.wheelCircumferenceM : 0,
        cumulativeDistanceM: 0,
        distanceSeries: [],
        hrSeries: [],
        heartRate: null,
        finishTimeS: null,
        isGhost,
        // Prepend an implicit (t=0 → 0m) sample so interpolation is exact.
        ghostArr: isGhost ? [0, ...r.ghostSeries.map((d) => Number(d) || 0)] : null,
        ghostHrArr: isGhost && Array.isArray(r.ghostHrSeries) ? r.ghostHrSeries.map((v) => (Number.isFinite(v) ? v : null)) : null,
        ghostIntervalS: Number.isFinite(r.ghostIntervalS) && r.ghostIntervalS > 0
          ? r.ghostIntervalS
          : this.intervalSeconds
      });
    }
  }

  // Interpolated ghost distance at an elapsed time (linear between samples).
  _ghostDistanceAt(rider, t) {
    const arr = rider.ghostArr;
    if (!arr || !arr.length) return 0;
    const pos = t / rider.ghostIntervalS;
    const j = Math.min(arr.length - 1, Math.max(0, Math.floor(pos)));
    const next = Math.min(arr.length - 1, j + 1);
    const frac = pos - j;
    return arr[j] + (arr[next] - arr[j]) * frac;
  }

  // Nearest-sample lookup for replayed step values (HR). Samples are at times
  // intervalS, 2*intervalS, ... so the value at elapsed t is index round(t/dt)-1.
  _ghostSampleAt(arr, t, intervalS) {
    if (!arr || !arr.length) return null;
    const idx = Math.min(arr.length - 1, Math.max(0, Math.round(t / intervalS) - 1));
    const v = arr[idx];
    return Number.isFinite(v) ? v : null;
  }

  tick(inputs = {}) {
    if (this.finished) return this.getState();
    this.elapsedS += this.intervalSeconds;
    for (const rider of this.riders.values()) {
      const input = inputs[rider.userId] || {};
      if (rider.isGhost) {
        rider.cumulativeDistanceM = this._ghostDistanceAt(rider, this.elapsedS);
      } else {
        const rpm = Number.isFinite(input.rpm) ? input.rpm : 0;
        const rotationsDelta = rpm > 0 ? (rpm / 60) * this.intervalSeconds : 0;
        const mult = zoneMultiplierFor(input.zoneId ?? null, this.zones, this.hrlessMultiplier);
        rider.cumulativeDistanceM += computeDistanceDelta(rotationsDelta, rider.wheelCircumferenceM, mult);
      }
      rider.distanceSeries.push(Math.round(rider.cumulativeDistanceM));
      const hr = rider.isGhost
        ? this._ghostSampleAt(rider.ghostHrArr, this.elapsedS, rider.ghostIntervalS)
        : (Number.isFinite(input.heartRate) ? input.heartRate : null);
      rider.heartRate = hr;
      rider.hrSeries.push(hr);
      if (this.winCondition === 'distance' && rider.finishTimeS == null && rider.cumulativeDistanceM >= this.goalM) {
        rider.finishTimeS = this.elapsedS;
      }
    }
    this.finished = this.winCondition === 'distance'
      ? [...this.riders.values()].every((r) => r.finishTimeS != null)
      : this.elapsedS >= this.timeCapS;
    return this.getState();
  }

  standings() {
    const riders = [...this.riders.values()];
    if (this.winCondition === 'distance') {
      return riders.slice().sort((a, b) => {
        if (a.finishTimeS != null && b.finishTimeS != null) return a.finishTimeS - b.finishTimeS;
        if (a.finishTimeS != null) return -1;
        if (b.finishTimeS != null) return 1;
        return b.cumulativeDistanceM - a.cumulativeDistanceM;
      }).map((r, i) => ({ userId: r.userId, placement: i + 1, finishTimeS: r.finishTimeS, distanceM: Math.round(r.cumulativeDistanceM) }));
    }
    return riders.slice().sort((a, b) => b.cumulativeDistanceM - a.cumulativeDistanceM)
      .map((r, i) => ({ userId: r.userId, placement: i + 1, finishTimeS: null, distanceM: Math.round(r.cumulativeDistanceM) }));
  }

  getState() {
    return {
      elapsedS: this.elapsedS,
      finished: this.finished,
      winCondition: this.winCondition,
      goalM: this.goalM,
      timeCapS: this.timeCapS,
      riders: Object.fromEntries([...this.riders.values()].map((r) => [r.userId, {
        userId: r.userId,
        displayName: r.displayName,
        equipmentId: r.equipmentId,
        cumulativeDistanceM: Math.round(r.cumulativeDistanceM),
        distanceSeries: r.distanceSeries.slice(),
        hrSeries: r.hrSeries.slice(),
        heartRate: r.heartRate ?? null,
        finishTimeS: r.finishTimeS,
        isGhost: !!r.isGhost
      }])),
      standings: this.standings()
    };
  }
}

export default CycleRaceEngine;
