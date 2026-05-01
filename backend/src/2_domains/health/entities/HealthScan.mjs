/**
 * HealthScan Value Object (PRD F-006)
 *
 * Represents a single body composition scan record from a clinical or consumer
 * device (DEXA, InBody, consumer BIA scale). Used as the canonical input to
 * downstream lean-mass / body-fat analytics and calibration.
 *
 * Shape (YAML on disk):
 *
 *   date: 2024-01-15
 *   source: bodyspec_dexa             # inbody | bodyspec_dexa | other
 *   device_type: DEXA                  # clinical_BIA | DEXA | consumer_BIA
 *   weight_lbs: 175.0
 *   body_fat_percent: 22.0
 *   lean_tissue_lbs: 130.0
 *   fat_tissue_lbs: 38.5
 *   bone_mineral_content_lbs: 6.5      # optional
 *   bmr_kcal: 1700                     # optional (requires bmr_method)
 *   bmr_method: katch_mcardle          # measured | katch_mcardle | estimated
 *   visceral_fat_lbs: 0.7              # optional
 *   bone_density_z_score: 1.1          # optional
 *   asymmetry: { left_arm_lean_lbs: 7.2, ... }   # optional, free-form object
 *   regional:  { trunk_fat_percent: 21.0, ... }  # optional, free-form object
 *   raw_image_path: /path/to/img.jpg   # optional
 *   raw_pdf_path:   /path/to/pdf.pdf   # optional
 *   notes: |                            # optional
 *     Free-form notes from the scan transcription.
 *
 * Validation:
 *   - All required numeric fields must be finite (rejects NaN/Infinity).
 *   - weight_lbs, lean_tissue_lbs, fat_tissue_lbs > 0.
 *   - body_fat_percent in [0, 60) — values >= 60 are measurement artifacts.
 *   - source / device_type / bmr_method are strict enums.
 *   - bmr_method is required when bmr_kcal is present.
 *   - Empty strings for notes / raw_image_path / raw_pdf_path are treated as absent.
 *
 * @module domains/health/entities
 */

const VALID_SOURCES = new Set(['inbody', 'bodyspec_dexa', 'other']);
const VALID_DEVICE_TYPES = new Set(['clinical_BIA', 'DEXA', 'consumer_BIA']);
const VALID_BMR_METHODS = new Set(['measured', 'katch_mcardle', 'estimated']);

const ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;

const REQUIRED_FIELDS = [
  'date',
  'source',
  'device_type',
  'weight_lbs',
  'body_fat_percent',
  'lean_tissue_lbs',
  'fat_tissue_lbs',
];

function assertPositiveFiniteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`HealthScan.${field} must be a positive finite number`);
  }
}

function assertFiniteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`HealthScan.${field} must be a finite number`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class HealthScan {
  /**
   * @param {Object} raw - Raw object as parsed from YAML.
   */
  constructor(raw) {
    if (!isPlainObject(raw)) {
      throw new TypeError('HealthScan expects an object');
    }

    // Required fields presence
    for (const field of REQUIRED_FIELDS) {
      if (raw[field] === undefined || raw[field] === null) {
        throw new Error(`HealthScan: missing required field "${field}"`);
      }
    }

    // date (ISO 8601 prefix)
    if (typeof raw.date !== 'string' || !ISO_DATE_PREFIX_RE.test(raw.date)) {
      throw new RangeError('HealthScan.date must be an ISO 8601 date string (YYYY-MM-DD...)');
    }

    // enums
    if (!VALID_SOURCES.has(raw.source)) {
      throw new RangeError(
        `HealthScan.source must be one of: ${[...VALID_SOURCES].join(', ')} (got "${raw.source}")`
      );
    }
    if (!VALID_DEVICE_TYPES.has(raw.device_type)) {
      throw new RangeError(
        `HealthScan.device_type must be one of: ${[...VALID_DEVICE_TYPES].join(', ')} (got "${raw.device_type}")`
      );
    }

    // required numerics
    assertPositiveFiniteNumber(raw.weight_lbs, 'weight_lbs');
    assertPositiveFiniteNumber(raw.lean_tissue_lbs, 'lean_tissue_lbs');

    // fat_tissue_lbs: finite >= 0 (allow 0 in theoretical edge case, must be finite)
    if (
      typeof raw.fat_tissue_lbs !== 'number' ||
      !Number.isFinite(raw.fat_tissue_lbs) ||
      raw.fat_tissue_lbs < 0
    ) {
      throw new RangeError('HealthScan.fat_tissue_lbs must be a non-negative finite number');
    }

    // body_fat_percent in [0, 60)
    if (
      typeof raw.body_fat_percent !== 'number' ||
      !Number.isFinite(raw.body_fat_percent) ||
      raw.body_fat_percent < 0 ||
      raw.body_fat_percent >= 60
    ) {
      throw new RangeError(
        'HealthScan.body_fat_percent must be a finite number in [0, 60)'
      );
    }

    this.date = raw.date;
    this.source = raw.source;
    this.deviceType = raw.device_type;
    this.weightLbs = raw.weight_lbs;
    this.bodyFatPercent = raw.body_fat_percent;
    this.leanTissueLbs = raw.lean_tissue_lbs;
    this.fatTissueLbs = raw.fat_tissue_lbs;

    // Optional numerics
    this.boneMineralContentLbs = this.#optionalFiniteNumber(
      raw.bone_mineral_content_lbs,
      'bone_mineral_content_lbs'
    );
    this.visceralFatLbs = this.#optionalFiniteNumber(raw.visceral_fat_lbs, 'visceral_fat_lbs');
    this.boneDensityZScore = this.#optionalFiniteNumber(
      raw.bone_density_z_score,
      'bone_density_z_score'
    );

    // bmr_kcal + bmr_method coupling
    if (raw.bmr_kcal !== undefined && raw.bmr_kcal !== null) {
      assertFiniteNumber(raw.bmr_kcal, 'bmr_kcal');
      if (!VALID_BMR_METHODS.has(raw.bmr_method)) {
        throw new RangeError(
          `HealthScan.bmr_method must be one of: ${[...VALID_BMR_METHODS].join(
            ', '
          )} when bmr_kcal is present (got "${raw.bmr_method}")`
        );
      }
      this.bmrKcal = raw.bmr_kcal;
      this.bmrMethod = raw.bmr_method;
    } else {
      this.bmrKcal = null;
      this.bmrMethod = null;
      // If bmr_method is provided without bmr_kcal, accept it silently as null
      // (not strictly forbidden by spec — only the reverse is constrained).
    }

    // Free-form objects
    this.asymmetry = this.#optionalObject(raw.asymmetry, 'asymmetry');
    this.regional = this.#optionalObject(raw.regional, 'regional');

    // Optional strings (empty string treated as absent)
    this.rawImagePath = this.#optionalNonEmptyString(raw.raw_image_path, 'raw_image_path');
    this.rawPdfPath = this.#optionalNonEmptyString(raw.raw_pdf_path, 'raw_pdf_path');
    this.notes = this.#optionalNonEmptyString(raw.notes, 'notes');
  }

  /**
   * Convert to a YAML-shaped plain object for persistence.
   * Optional fields that are null/undefined are omitted.
   * @returns {Object}
   */
  serialize() {
    const out = {
      date: this.date,
      source: this.source,
      device_type: this.deviceType,
      weight_lbs: this.weightLbs,
      body_fat_percent: this.bodyFatPercent,
      lean_tissue_lbs: this.leanTissueLbs,
      fat_tissue_lbs: this.fatTissueLbs,
    };
    if (this.boneMineralContentLbs !== null) out.bone_mineral_content_lbs = this.boneMineralContentLbs;
    if (this.bmrKcal !== null) {
      out.bmr_kcal = this.bmrKcal;
      out.bmr_method = this.bmrMethod;
    }
    if (this.visceralFatLbs !== null) out.visceral_fat_lbs = this.visceralFatLbs;
    if (this.boneDensityZScore !== null) out.bone_density_z_score = this.boneDensityZScore;
    if (this.asymmetry !== null) out.asymmetry = { ...this.asymmetry };
    if (this.regional !== null) out.regional = { ...this.regional };
    if (this.notes) out.notes = this.notes;
    if (this.rawPdfPath) out.raw_pdf_path = this.rawPdfPath;
    if (this.rawImagePath) out.raw_image_path = this.rawImagePath;
    return out;
  }

  #optionalFiniteNumber(value, field) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new RangeError(`HealthScan.${field} must be a finite number when present`);
    }
    return value;
  }

  #optionalObject(value, field) {
    if (value === undefined || value === null) return null;
    if (!isPlainObject(value)) {
      throw new TypeError(`HealthScan.${field} must be a plain object when present`);
    }
    return { ...value };
  }

  #optionalNonEmptyString(value, field) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      throw new TypeError(`HealthScan.${field} must be a string when present`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    return trimmed;
  }
}

export default HealthScan;
