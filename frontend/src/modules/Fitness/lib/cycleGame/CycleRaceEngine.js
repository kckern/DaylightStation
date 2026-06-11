import { computeDistanceDelta, zoneMultiplierFor } from './distanceModel.js';
import { kmh } from './speed.js';

// Display speed is averaged over this many ticks. Recorded/replayed distance
// series hold integer metres, so a 1-tick delta jitters by ±1 m (±3.6 km/h at
// 1 s ticks); a 5-tick window bounds that error to under 1 km/h.
const SPEED_WINDOW_TICKS = 5;

export class CycleRaceEngine {
  constructor({
    mode = 'simultaneous', winCondition = 'distance',
    goalM = 3000, timeCapS = 300, intervalMs = 5000,
    riders = [], zones = [], hrlessMultiplier = 1, lapLengthM = 0
  } = {}) {
    this.mode = mode;
    this.winCondition = winCondition;
    this.goalM = goalM;
    this.timeCapS = timeCapS;
    this.intervalSeconds = intervalMs / 1000;
    this.zones = zones;
    this.hrlessMultiplier = hrlessMultiplier;
    this.lapLengthM = Number.isFinite(lapLengthM) && lapLengthM > 0 ? lapLengthM : 0;
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
        lapSplits: [],
        hrSeries: [],
        rpmSeries: [],
        zoneSeries: [],
        // Unrounded cumulative distances for the display-speed window — kept
        // separate from distanceSeries, whose Math.round quantizes 1-tick deltas.
        recentDist: [0],
        heartRate: null,
        rpm: 0,
        zoneId: null,
        finishTimeS: null,
        isGhost,
        // Prepend an implicit (t=0 → 0m) sample so interpolation is exact.
        ghostArr: isGhost ? [0, ...r.ghostSeries.map((d) => Number(d) || 0)] : null,
        // Step-replayed metrics (HR / RPM / zone): same cadence as recording,
        // sampled nearest. Zone values are strings, so no numeric coercion here.
        ghostHrArr: isGhost && Array.isArray(r.ghostHrSeries) ? r.ghostHrSeries.slice() : null,
        ghostRpmArr: isGhost && Array.isArray(r.ghostRpmSeries) ? r.ghostRpmSeries.map((v) => (Number.isFinite(v) ? v : 0)) : null,
        ghostZoneArr: isGhost && Array.isArray(r.ghostZoneSeries) ? r.ghostZoneSeries.slice() : null,
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

  // Nearest-sample lookup for replayed step values (HR / RPM / zone). Samples
  // are at times intervalS, 2*intervalS, ... so the value at elapsed t is index
  // round(t/dt)-1. Returns the raw value (number OR string zone id) or null.
  _ghostSampleAt(arr, t, intervalS) {
    if (!arr || !arr.length) return null;
    const idx = Math.min(arr.length - 1, Math.max(0, Math.round(t / intervalS) - 1));
    const v = arr[idx];
    return v === undefined ? null : v;
  }

  // Display speed over the trailing window. A rider parked at the finish line
  // of a distance race reads 0 immediately — including the tick they cross.
  _speedKmh(rider) {
    if (this.winCondition === 'distance' && rider.finishTimeS != null) return 0;
    const ring = rider.recentDist;
    if (!ring || ring.length < 2) return 0;
    return kmh(ring[ring.length - 1] - ring[0], (ring.length - 1) * this.intervalSeconds);
  }

  tick(inputs = {}) {
    if (this.finished) return this.getState();
    this.elapsedS += this.intervalSeconds;
    for (const rider of this.riders.values()) {
      const input = inputs[rider.userId] || {};
      const lapD0 = rider.cumulativeDistanceM; // distance at start of this tick
      // A rider who already crossed the line in a distance race is parked at the
      // line: no more progress counts, and the gauge reads idle (rpm 0 / no zone).
      const alreadyFinished = this.winCondition === 'distance' && rider.finishTimeS != null;
      if (alreadyFinished) {
        rider.cumulativeDistanceM = this.goalM;
        rider.rpm = 0;
        rider.zoneId = null;
      } else if (rider.isGhost) {
        rider.cumulativeDistanceM = this._ghostDistanceAt(rider, this.elapsedS);
        const grpm = this._ghostSampleAt(rider.ghostRpmArr, this.elapsedS, rider.ghostIntervalS);
        rider.rpm = Number.isFinite(grpm) ? grpm : 0;
        const gzone = this._ghostSampleAt(rider.ghostZoneArr, this.elapsedS, rider.ghostIntervalS);
        rider.zoneId = gzone == null ? null : gzone;
      } else {
        const rpm = Number.isFinite(input.rpm) ? input.rpm : 0;
        const rotationsDelta = rpm > 0 ? (rpm / 60) * this.intervalSeconds : 0;
        const mult = zoneMultiplierFor(input.zoneId ?? null, this.zones, this.hrlessMultiplier);
        rider.cumulativeDistanceM += computeDistanceDelta(rotationsDelta, rider.wheelCircumferenceM, mult);
        rider.rpm = rpm;
        rider.zoneId = input.zoneId ?? null;
      }
      // Finish detection + clamp at the line (both live and ghost riders).
      if (this.winCondition === 'distance' && rider.finishTimeS == null && rider.cumulativeDistanceM >= this.goalM) {
        rider.finishTimeS = this.elapsedS;
        rider.cumulativeDistanceM = this.goalM;
      }
      if (this.lapLengthM > 0) {
        const d1 = rider.cumulativeDistanceM;
        const t0 = this.elapsedS - this.intervalSeconds;
        let lap = Math.floor(lapD0 / this.lapLengthM) + 1;
        while (lap * this.lapLengthM <= d1) {
          const boundary = lap * this.lapLengthM;
          const frac = d1 > lapD0 ? (boundary - lapD0) / (d1 - lapD0) : 0;
          rider.lapSplits.push(Math.round((t0 + frac * this.intervalSeconds) * 100) / 100);
          lap += 1;
        }
      }
      rider.distanceSeries.push(Math.round(rider.cumulativeDistanceM));
      rider.rpmSeries.push(Math.round(Number.isFinite(rider.rpm) ? rider.rpm : 0));
      rider.zoneSeries.push(rider.zoneId ?? null);
      const hrRaw = rider.isGhost
        ? this._ghostSampleAt(rider.ghostHrArr, this.elapsedS, rider.ghostIntervalS)
        : input.heartRate;
      const hr = Number.isFinite(hrRaw) ? hrRaw : null;
      rider.heartRate = hr;
      rider.hrSeries.push(hr);
      rider.recentDist.push(rider.cumulativeDistanceM);
      if (rider.recentDist.length > SPEED_WINDOW_TICKS + 1) rider.recentDist.shift();
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
        lapSplits: r.lapSplits.slice(),
        hrSeries: r.hrSeries.slice(),
        rpmSeries: r.rpmSeries.slice(),
        zoneSeries: r.zoneSeries.slice(),
        heartRate: r.heartRate ?? null,
        rpm: Number.isFinite(r.rpm) ? r.rpm : 0,
        zoneId: r.zoneId ?? null,
        finishTimeS: r.finishTimeS,
        isGhost: !!r.isGhost,
        speedKmh: this._speedKmh(r),
        // False only for ghosts whose source record predates rpm_series — the
        // view can synthesize a display cadence instead of parking the needle.
        hasRpmData: r.isGhost ? !!(r.ghostRpmArr && r.ghostRpmArr.length) : true
      }])),
      standings: this.standings()
    };
  }
}

export default CycleRaceEngine;
