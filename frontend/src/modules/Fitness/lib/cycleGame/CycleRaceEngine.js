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
      this.riders.set(r.userId, {
        userId: r.userId,
        displayName: r.displayName || r.userId,
        equipmentId: r.equipmentId || null,
        wheelCircumferenceM: Number.isFinite(r.wheelCircumferenceM) ? r.wheelCircumferenceM : 0,
        cumulativeDistanceM: 0,
        distanceSeries: [],
        finishTimeS: null
      });
    }
  }

  tick(inputs = {}) {
    if (this.finished) return this.getState();
    this.elapsedS += this.intervalSeconds;
    for (const rider of this.riders.values()) {
      const input = inputs[rider.userId] || {};
      const rpm = Number.isFinite(input.rpm) ? input.rpm : 0;
      const rotationsDelta = rpm > 0 ? (rpm / 60) * this.intervalSeconds : 0;
      const mult = zoneMultiplierFor(input.zoneId ?? null, this.zones, this.hrlessMultiplier);
      rider.cumulativeDistanceM += computeDistanceDelta(rotationsDelta, rider.wheelCircumferenceM, mult);
      rider.distanceSeries.push(Math.round(rider.cumulativeDistanceM));
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
        finishTimeS: r.finishTimeS
      }])),
      standings: this.standings()
    };
  }
}

export default CycleRaceEngine;
