// What a scale observation's value may be, per kind.
//
// These rules are the last thing standing between a malformed signal and nutrition
// history, because a composition of weight + density finalises with no human in the loop.
// The cases below are the ones that reach that unattended commit as a WRONG NUMBER rather
// than as an error — `NaN` above all, which is not `null` and so reads as "complete".

import { describe, it, expect } from 'vitest';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { MAX_DENSITY_LEVEL } from './ScanVocabularyService.mjs';
import {
  validateObservationValue,
  validateWeightValue,
  validateWeightUnit,
  validateDensityValue,
  validateContainerValue,
  validateUpcValue,
} from './ObservationValue.mjs';

/** Assert a throw AND its code — a caller branching on `err.code` is the whole point. */
const refuses = (fn, code) => {
  let caught = null;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(ValidationError);
  expect(caught.code).toBe(code);
  return caught;
};

describe('weight values', () => {
  it('accepts a finite number, stored verbatim and unrounded', () => {
    expect(validateWeightValue(473)).toBe(473);
    expect(validateWeightValue(0)).toBe(0);
    expect(validateWeightValue(82.4)).toBe(82.4);
  });

  // A scale genuinely reads below zero after an item is lifted off, and `computeNet`
  // owns the clamp-and-flag. Refusing it here would pre-empt that.
  it('accepts a NEGATIVE weight rather than pre-empting the clamp downstream', () => {
    expect(validateWeightValue(-3)).toBe(-3);
  });

  // THE case. `NaN !== null`, so a stored NaN weight makes a composition read
  // `complete: true`, reach the unattended commit, and produce an entry whose grams are
  // NaN — which JSON-serialises to null with nothing flagged.
  it('refuses NaN, which would otherwise make a composition read complete', () => {
    refuses(() => validateWeightValue(NaN), 'INVALID_WEIGHT');
  });

  it('refuses Infinity', () => {
    refuses(() => validateWeightValue(Infinity), 'INVALID_WEIGHT');
    refuses(() => validateWeightValue(-Infinity), 'INVALID_WEIGHT');
  });

  // `typeof` is checked before `Number.isFinite` on purpose: a numeric string passes
  // `Number.isFinite(Number(x))` but is refused by ScanNutritionService downstream, so
  // accepting it here would claim a completeness the pipeline cannot deliver.
  it('refuses a numeric string rather than coercing it', () => {
    refuses(() => validateWeightValue('500'), 'INVALID_WEIGHT');
  });

  it('refuses null, undefined and non-numbers', () => {
    for (const bad of [null, undefined, {}, [], true, '']) {
      refuses(() => validateWeightValue(bad), 'INVALID_WEIGHT');
    }
  });

  it('names what actually arrived, since callers log the message alone', () => {
    let caught = null;
    try { validateWeightValue('500'); } catch (e) { caught = e; }
    expect(caught.message).toContain('"500"');
  });

  // `null` and `undefined` are different mistakes — "the slot was cleared" versus "the
  // field never arrived" — and the message is the only thing a person debugging at the
  // fridge sees, because callers log `err.message` and drop the structured payload.
  it('tells null, undefined, NaN and a wrong TYPE apart in the message', () => {
    const msg = (v) => { try { validateWeightValue(v); return ''; } catch (e) { return e.message; } };
    expect(msg(null)).toContain('null');
    expect(msg(null)).not.toContain('undefined');
    expect(msg(undefined)).toContain('undefined');
    expect(msg(NaN)).toContain('NaN');
    expect(msg({})).toContain('object');
    expect(msg([])).toContain('an array');
  });

  // The row's column IS `value`, so that is what the structured error names — not the
  // domain word for what the column happens to hold on this kind of row. Pinned so the
  // next person to change it does so on purpose.
  it('reports the ROW field, `value`, not the per-kind name', () => {
    expect(refuses(() => validateWeightValue(NaN), 'INVALID_WEIGHT').field).toBe('value');
    expect(refuses(() => validateDensityValue(99), 'INVALID_DENSITY_LEVEL').field).toBe('value');
    expect(refuses(() => validateContainerValue(''), 'INVALID_CONTAINER_ID').field).toBe('value');
    expect(refuses(() => validateUpcValue(42), 'INVALID_UPC_CODE').field).toBe('value');
    // `unit` is its own column and keeps its own name.
    expect(refuses(() => validateWeightUnit(42), 'INVALID_WEIGHT_UNIT').field).toBe('unit');
  });

  // ...while the MESSAGE still names what the value means to a person. `field` points at
  // the column; the message is what someone reading a log line actually sees.
  it('keeps the human label in the message even though the field is the column', () => {
    let caught = null;
    try { validateContainerValue(''); } catch (e) { caught = e; }
    expect(caught.message).toMatch(/^container must be a non-empty string/);
    expect(caught.field).toBe('value');
  });
});

describe('weight units', () => {
  it('reads an absent unit as grams by returning null, never a fabricated label', () => {
    expect(validateWeightUnit(undefined)).toBeNull();
    expect(validateWeightUnit(null)).toBeNull();
  });

  // A PRESENT but unusable unit is a malformed frame. Silently becoming 'g' would
  // mislabel a volumetric reading, which the commit path refuses precisely by unit.
  it('refuses a present-but-unusable unit rather than defaulting it to grams', () => {
    refuses(() => validateWeightUnit(''), 'INVALID_WEIGHT_UNIT');
    refuses(() => validateWeightUnit(42), 'INVALID_WEIGHT_UNIT');
  });

  it('carries a volumetric unit through faithfully', () => {
    expect(validateWeightUnit('ml')).toBe('ml');
  });
});

describe('density values', () => {
  // Against the CONSTANT, never a hardcoded 9. Raising `MAX_DENSITY_LEVEL` must move the
  // boundary these assert, not silently pass on both sides of an out-of-date literal.
  it('accepts every level the printed grammar can produce, up to MAX_DENSITY_LEVEL', () => {
    for (let level = 1; level <= MAX_DENSITY_LEVEL; level += 1) {
      expect(validateDensityValue(level)).toBe(level);
    }
    expect(validateDensityValue(MAX_DENSITY_LEVEL)).toBe(MAX_DENSITY_LEVEL);
  });

  // An out-of-range level sails through to computeNutrition, misses the config table and
  // surfaces as MALFORMED_DENSITY_LEVEL — "fix the YAML" — when the truth is "rescan".
  it('refuses the level ONE PAST the maximum — the boundary, not a distant number', () => {
    refuses(() => validateDensityValue(MAX_DENSITY_LEVEL + 1), 'INVALID_DENSITY_LEVEL');
  });

  it('refuses a level outside the grammar, so the diagnosis is not misattributed', () => {
    refuses(() => validateDensityValue(0), 'INVALID_DENSITY_LEVEL');
    refuses(() => validateDensityValue(99), 'INVALID_DENSITY_LEVEL');
    refuses(() => validateDensityValue(-1), 'INVALID_DENSITY_LEVEL');
  });

  it('refuses a fractional level', () => {
    refuses(() => validateDensityValue(2.5), 'INVALID_DENSITY_LEVEL');
  });

  it('refuses a numeric string, null and NaN', () => {
    for (const bad of ['4', null, undefined, NaN]) {
      refuses(() => validateDensityValue(bad), 'INVALID_DENSITY_LEVEL');
    }
  });
});

describe('container ids', () => {
  it('accepts a non-empty id', () => {
    expect(validateContainerValue('tupperware')).toBe('tupperware');
  });

  it('refuses an empty string and a number', () => {
    refuses(() => validateContainerValue(''), 'INVALID_CONTAINER_ID');
    refuses(() => validateContainerValue(42), 'INVALID_CONTAINER_ID');
    refuses(() => validateContainerValue(null), 'INVALID_CONTAINER_ID');
  });

  // Deliberate: ScanVocabularyService owns the printed id pattern and does not export it,
  // so restating the regex here would create the sheet-versus-parser drift it exists to
  // prevent. An unknown-but-well-formed id is caught by the container-table lookup in
  // ApplyScanToComposition, before it ever reaches storage.
  it('does NOT reject an unknown-but-well-formed id — that is the table lookup\'s job', () => {
    expect(validateContainerValue('a-container-nobody-owns')).toBe('a-container-nobody-owns');
  });
});

describe('upc values', () => {
  it('accepts a non-empty code and refuses anything else', () => {
    expect(validateUpcValue('012345678905')).toBe('012345678905');
    refuses(() => validateUpcValue(''), 'INVALID_UPC_CODE');
    refuses(() => validateUpcValue(12345), 'INVALID_UPC_CODE');
  });
});

describe('validateObservationValue — the dispatch the store calls', () => {
  it('returns the pair to persist for a weight, defaulting an absent unit to null', () => {
    expect(validateObservationValue({ kind: 'weight', value: 473, unit: 'g' }))
      .toEqual({ value: 473, unit: 'g' });
    expect(validateObservationValue({ kind: 'weight', value: 473 }))
      .toEqual({ value: 473, unit: null });
  });

  // A density/container/upc row has no unit, and a caller passing one must not get it
  // stored — the field means "the unit of a weight" and nothing else.
  it('nulls the unit on every kind that cannot carry one', () => {
    expect(validateObservationValue({ kind: 'density', value: 4, unit: 'g' }))
      .toEqual({ value: 4, unit: null });
    expect(validateObservationValue({ kind: 'container', value: 'mug', unit: 'g' }))
      .toEqual({ value: 'mug', unit: null });
    expect(validateObservationValue({ kind: 'upc', value: '0123', unit: 'g' }))
      .toEqual({ value: '0123', unit: null });
  });

  it('applies the rule the KIND implies, not one generic rule', () => {
    // 'mug' is a fine container and an impossible weight; 473 is the reverse.
    expect(validateObservationValue({ kind: 'container', value: 'mug' }).value).toBe('mug');
    refuses(() => validateObservationValue({ kind: 'weight', value: 'mug' }), 'INVALID_WEIGHT');
    refuses(() => validateObservationValue({ kind: 'container', value: 473 }), 'INVALID_CONTAINER_ID');
  });

  // A kind added to the storage layer without a rule here must not be able to write an
  // unvalidated value — refusing is the only safe default for a gap in this table.
  it('refuses a kind it has no rule for rather than letting the value through', () => {
    refuses(() => validateObservationValue({ kind: 'temperature', value: 20 }), 'INVALID_OBSERVATION_KIND');
    refuses(() => validateObservationValue({}), 'INVALID_OBSERVATION_KIND');
  });
});
