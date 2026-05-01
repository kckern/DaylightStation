/**
 * CalibrationConstants (F-007)
 *
 * Domain service that aligns consumer-BIA body-composition readings to the
 * truth-anchor of a clinical DEXA scan. Given the latest DEXA record and the
 * adjacent (±7 days) consumer-BIA scale readings, it computes scalar offsets
 * (lean lbs, body-fat %) that callers can additively apply to raw BIA values
 * to correct toward DEXA truth.
 *
 *   correctedLean = rawBIA + leanLbsOffset
 *   correctedBF   = rawBIA + bodyFatPctOffset
 *
 * The model is intentionally simple: a single static offset captured at the
 * time of the most recent DEXA. We rely on the "DEXA staleness" flag elsewhere
 * to nudge users to re-scan when the offset drifts. No regression, no decay —
 * if there's no DEXA, corrections fall back to identity (raw value passes
 * through). If there's a DEXA but no adjacent BIA readings to anchor against,
 * we still record the calibration date but leave offsets at zero (so callers
 * can see we tried; staleness reflects the actual scan recency).
 *
 * `flagIfStale(thresholdDays)` distinguishes "stale calibration" from
 * "no calibration at all". An uncalibrated user is NOT flagged as stale —
 * that's a separate, more severe state (handle via a dedicated CTA if needed).
 *
 * Stateful by design: instances are loaded once per request and re-queried
 * via the synchronous `getCorrected*` accessors. `load()` is idempotent.
 *
 * @module domains/health/services/CalibrationConstants
 */

const ADJACENCY_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class CalibrationConstants {
  #leanOffset = 0;
  #bfOffset = 0;
  #calibrationDate = null;
  #calibrated = false;
  #healthScanStore;
  #weightStore;
  #logger;

  /**
   * @param {object} opts
   * @param {{ getLatestScan: (userId: string) => Promise<object|null> }} opts.healthScanStore
   * @param {{ loadWeightData: (userId: string) => Promise<Record<string, object>> }} opts.weightStore
   * @param {object} [opts.logger] structured logger; falls back to console
   */
  constructor({ healthScanStore, weightStore, logger } = {}) {
    if (!healthScanStore) throw new Error('CalibrationConstants requires healthScanStore');
    if (!weightStore) throw new Error('CalibrationConstants requires weightStore');
    this.#healthScanStore = healthScanStore;
    this.#weightStore = weightStore;
    this.#logger = logger || console;
  }

  /**
   * Recompute calibration offsets from the latest DEXA scan and adjacent BIA
   * readings. Idempotent — calling twice yields the same offsets (assuming
   * the underlying stores haven't changed).
   *
   * Failures are swallowed with a warn; a failed calibration falls back to
   * identity corrections rather than blocking the caller.
   *
   * @param {string} userId
   * @returns {Promise<void>}
   */
  async load(userId) {
    // Reset state up-front so re-loads are deterministic.
    this.#leanOffset = 0;
    this.#bfOffset = 0;
    this.#calibrationDate = null;
    this.#calibrated = false;

    let latestDexa = null;
    try {
      const latest = await this.#healthScanStore.getLatestScan(userId);
      // Accept either the canonical entity (deviceType) or a YAML-shaped raw
      // object (device_type). We only care about DEXA scans here.
      if (latest && isDexaScan(latest)) {
        latestDexa = latest;
      }
    } catch (err) {
      this.#logger.warn?.('calibration.load_failed', { stage: 'getLatestScan', error: err?.message });
      return;
    }

    if (!latestDexa) {
      // No DEXA → uncalibrated state. Identity corrections; not stale.
      return;
    }

    const dexaDate = readScanDate(latestDexa);
    if (!dexaDate) {
      this.#logger.warn?.('calibration.load_failed', { stage: 'invalid_dexa_date' });
      return;
    }
    this.#calibrationDate = dexaDate;

    let weightData = {};
    try {
      weightData = (await this.#weightStore.loadWeightData(userId)) || {};
    } catch (err) {
      this.#logger.warn?.('calibration.load_failed', { stage: 'loadWeightData', error: err?.message });
      // Mark as calibrated so staleness still works; offsets remain 0.
      this.#calibrated = true;
      return;
    }

    const dexaLean = readLean(latestDexa);
    const dexaBf = readBodyFat(latestDexa);

    if (!Number.isFinite(dexaLean) || !Number.isFinite(dexaBf)) {
      this.#logger.warn?.('calibration.load_failed', { stage: 'dexa_missing_fields' });
      this.#calibrated = true; // we have a date; leave offsets at 0
      return;
    }

    const adjacent = collectAdjacentBiaReadings(weightData, dexaDate, ADJACENCY_WINDOW_DAYS);

    if (adjacent.length === 0) {
      this.#logger.warn?.('calibration.no_adjacent_bia', {
        userId,
        dexaDate,
        windowDays: ADJACENCY_WINDOW_DAYS,
      });
      this.#calibrated = true;
      return;
    }

    const meanBiaLean = mean(adjacent.map((r) => r.lbs_lean));
    const meanBiaBf = mean(adjacent.map((r) => r.fat_percent));

    this.#leanOffset = dexaLean - meanBiaLean;
    this.#bfOffset = dexaBf - meanBiaBf;
    this.#calibrated = true;

    this.#logger.debug?.('calibration.loaded', {
      userId,
      dexaDate,
      adjacentReadings: adjacent.length,
      leanLbsOffset: this.#leanOffset,
      bodyFatPctOffset: this.#bfOffset,
    });
  }

  /**
   * Apply the lean-mass offset to a raw BIA reading.
   * Returns the input unchanged when uncalibrated.
   * @param {number} rawBIA
   * @returns {number}
   */
  getCorrectedLean(rawBIA) {
    return this.#calibrated ? rawBIA + this.#leanOffset : rawBIA;
  }

  /**
   * Apply the body-fat-% offset to a raw BIA reading.
   * Returns the input unchanged when uncalibrated.
   * @param {number} rawBIA
   * @returns {number}
   */
  getCorrectedBodyFat(rawBIA) {
    return this.#calibrated ? rawBIA + this.#bfOffset : rawBIA;
  }

  /**
   * @returns {string|null} ISO date of the DEXA scan that calibrated this
   *   instance, or null if no DEXA was found.
   */
  getCalibrationDate() {
    return this.#calibrationDate;
  }

  /**
   * Days since the calibration was anchored. Returns Infinity when there is
   * no calibration at all (so range checks naturally exclude this case).
   * @returns {number}
   */
  getStaleness() {
    if (!this.#calibrationDate) return Infinity;
    const dexaMs = Date.parse(this.#calibrationDate);
    if (!Number.isFinite(dexaMs)) return Infinity;
    const nowMs = Date.now();
    return Math.floor((nowMs - dexaMs) / MS_PER_DAY);
  }

  /**
   * Returns true only when calibration EXISTS and exceeds the staleness
   * threshold. An uncalibrated state is NOT considered stale (it's a different
   * problem worth a separate flag).
   * @param {number} thresholdDays
   * @returns {boolean}
   */
  flagIfStale(thresholdDays) {
    if (!this.#calibrated || !this.#calibrationDate) return false;
    return this.getStaleness() > thresholdDays;
  }

  /**
   * @returns {{ leanLbsOffset: number, bodyFatPctOffset: number }} raw computed
   *   offsets, for inspection / logging. Always returns numbers (zero when
   *   uncalibrated).
   */
  getOffsets() {
    return {
      leanLbsOffset: this.#leanOffset,
      bodyFatPctOffset: this.#bfOffset,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers (private to this module)
// ---------------------------------------------------------------------------

function isDexaScan(scan) {
  if (!scan) return false;
  // Support both HealthScan instance (deviceType) and raw YAML shape (device_type).
  const dt = scan.deviceType ?? scan.device_type;
  return dt === 'DEXA';
}

function readScanDate(scan) {
  return scan?.date ?? null;
}

function readLean(scan) {
  if (typeof scan?.leanTissueLbs === 'number') return scan.leanTissueLbs;
  if (typeof scan?.lean_tissue_lbs === 'number') return scan.lean_tissue_lbs;
  return NaN;
}

function readBodyFat(scan) {
  if (typeof scan?.bodyFatPercent === 'number') return scan.bodyFatPercent;
  if (typeof scan?.body_fat_percent === 'number') return scan.body_fat_percent;
  return NaN;
}

/**
 * Filter date-keyed weight data to entries within ±windowDays of dexaDate that
 * include both `lbs_lean` and `fat_percent` (i.e., are BIA scans, not just
 * scale weight). Boundary days are inclusive.
 */
function collectAdjacentBiaReadings(weightData, dexaDate, windowDays) {
  const dexaMs = Date.parse(dexaDate);
  if (!Number.isFinite(dexaMs)) return [];
  const out = [];
  for (const [date, entry] of Object.entries(weightData || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const lean = Number(entry.lbs_lean);
    const bf = Number(entry.fat_percent);
    if (!Number.isFinite(lean) || !Number.isFinite(bf)) continue;
    const ms = Date.parse(date);
    if (!Number.isFinite(ms)) continue;
    const dayDiff = Math.abs(ms - dexaMs) / MS_PER_DAY;
    if (dayDiff > windowDays) continue;
    out.push({ date, lbs_lean: lean, fat_percent: bf });
  }
  return out;
}

function mean(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export default CalibrationConstants;
