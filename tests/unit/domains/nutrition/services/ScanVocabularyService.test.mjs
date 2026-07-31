import { describe, it, expect } from 'vitest';
import {
  parseScan,
  encodeDensity,
  encodeContainer,
  encodeControl,
  CONTROL_VERBS,
  RESET_CODE,
  MAX_DENSITY_CODE,
} from '#domains/nutrition';
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Printed density payloads, in KCAL PER 100 G — not ordinal rungs. The sheet
 * encodes the physical quantity so a scan needs no level->calories lookup, so
 * these are the values a real table produces (0.2 .. 8.5 kcal/g).
 */
const ALL_DENSITY_CODES = [20, 60, 100, 140, 190, 260, 380, 600, 850];

/** Printed tare payloads, in grams. */
const ALL_TARES = [0, 40, 160, 250, 620, 9999];

/**
 * The verb printed on the sheet is NOT always the kind the parser returns:
 * `clear` parses to `reset`. See the asymmetry note in ScanVocabularyService.
 */
const VERB_TO_KIND = { clear: 'reset', undo: 'undo', done: 'done' };

describe('parseScan', () => {
  describe('density codes', () => {
    // The payload is the QUANTITY, not the rung. `dl:140` is 1.4 kcal/g, which is
    // level 4 in the household table — but the parser neither knows nor needs that.
    it('parses a density code as kcal per 100 g', () => {
      expect(parseScan('dl:140')).toEqual({ kind: 'density', kcalPer100g: 140 });
    });

    it('parses every code a realistic table produces', () => {
      for (const kcalPer100g of ALL_DENSITY_CODES) {
        expect(parseScan(`dl:${kcalPer100g}`)).toEqual({ kind: 'density', kcalPer100g });
      }
    });

    // REGRESSION GUARD for the grammar change. Under the old scheme these were the
    // ONLY legal density codes and meant rungs 1-9; they are still well-formed, and
    // must now parse as the absurd-but-honest densities they name (0.01-0.09
    // kcal/g) rather than being quietly re-read as rungs. Nothing resolves them —
    // no table row carries 0.04 kcal/g — so `ApplyScanToComposition` refuses them.
    it('reads a legacy ordinal code as a tiny density, not as a rung', () => {
      expect(parseScan('dl:4')).toEqual({ kind: 'density', kcalPer100g: 4 });
    });

    it('rejects values outside the printable range', () => {
      expect(parseScan('dl:0')).toBeNull();
      expect(parseScan(`dl:${MAX_DENSITY_CODE + 1}`)).toBeNull();
      expect(parseScan('dl:x')).toBeNull();
    });

    // Decimals stay out of the payload: `dl:1.4` and `dl:140` would be two
    // spellings of one density, and only one of them is ever printed.
    it('rejects non-canonical numeric forms', () => {
      expect(parseScan('dl:0140')).toBeNull();
      expect(parseScan('dl:1.4')).toBeNull();
      expect(parseScan('dl:-140')).toBeNull();
    });
  });

  describe('container codes', () => {
    // Same rule as density: the payload is the tare in grams, so the subtraction
    // needs no id lookup and renaming a vessel cannot orphan a laminated code.
    it('parses a container code as a tare in grams', () => {
      expect(parseScan('ct:160')).toEqual({ kind: 'container', grams: 160 });
    });

    it('parses every tare a realistic table produces', () => {
      for (const grams of ALL_TARES) {
        expect(parseScan(`ct:${grams}`)).toEqual({ kind: 'container', grams });
      }
    });

    // A zero tare is legitimate — a weightless liner — and must not be confused
    // with "no container scanned", which is the absence of a code entirely.
    it('accepts a zero tare', () => {
      expect(parseScan('ct:0')).toEqual({ kind: 'container', grams: 0 });
    });

    it('rejects an empty tare', () => {
      expect(parseScan('ct:')).toBeNull();
    });

    // REGRESSION GUARD. Semantic ids were the old payload. They must now fail to
    // parse outright rather than resolving to some tare: a leftover `ct:dinner-bowl`
    // sticker is unreadable, which is the loud failure, whereas silently taring
    // zero would log the dish's weight as food.
    it('rejects a legacy semantic id', () => {
      expect(parseScan('ct:dinner-bowl')).toBeNull();
      expect(parseScan('ct:mug')).toBeNull();
    });

    it('rejects non-canonical numeric forms', () => {
      expect(parseScan('ct:0160')).toBeNull();
      expect(parseScan('ct:16.0')).toBeNull();
      expect(parseScan('ct:-160')).toBeNull();
    });
  });

  describe('control codes', () => {
    // REGRESSION GUARD. `ApplyScanToComposition` switches on
    // `parsed.kind === 'reset'`. The verb in the code string is `clear`, but
    // renaming the parsed kind to match it would silently stop the only control
    // code in the field from doing anything. Pin the asymmetry.
    it('parses rs:clear to kind "reset", NOT kind "clear"', () => {
      expect(parseScan('rs:clear')).toEqual({ kind: 'reset' });
    });

    it('parses rs:undo', () => {
      expect(parseScan('rs:undo')).toEqual({ kind: 'undo' });
    });

    it('parses rs:done', () => {
      expect(parseScan('rs:done')).toEqual({ kind: 'done' });
    });

    it('rejects an unknown control verb', () => {
      expect(parseScan('rs:something-else')).toBeNull();
      expect(parseScan('rs:bogus')).toBeNull();
    });

    // A control code is a bare verb. Anything decorated is a different string
    // and must fall through to content dispatch untouched.
    it('rejects an empty or decorated control payload', () => {
      expect(parseScan('rs:')).toBeNull();
      expect(parseScan('rs:clear:extra')).toBeNull();
      expect(parseScan('rs:undo+again')).toBeNull();
      expect(parseScan('rs: clear')).toBeNull();
    });

    it('declines rather than throwing on any unclaimed rs: payload', () => {
      for (const code of ['rs:', 'rs:bogus', 'rs:CLEAR', 'rs:clear:extra']) {
        expect(() => parseScan(code)).not.toThrow();
        expect(parseScan(code)).toBeNull();
      }
    });
  });

  describe('case sensitivity', () => {
    it('is case-sensitive on every prefix', () => {
      expect(parseScan('DL:4')).toBeNull();
      expect(parseScan('CT:mug')).toBeNull();
      expect(parseScan('RS:clear')).toBeNull();
    });

    // The encoders own the printed string, so nothing needs to be lenient about
    // the verb either. A hand-typed `rs:CLEAR` is not a code this sheet emits.
    it('is case-sensitive on control verbs', () => {
      expect(parseScan('rs:CLEAR')).toBeNull();
      expect(parseScan('rs:Undo')).toBeNull();
      expect(parseScan('rs:DONE')).toBeNull();
    });
  });

  describe('namespace isolation', () => {
    // The most important guarantee: a real product barcode must NOT be claimed
    // by this grammar, or the normal content/food pipeline never sees it.
    it('returns null for real UPC/EAN barcodes', () => {
      expect(parseScan('012000161155')).toBeNull();
      expect(parseScan('4006381333931')).toBeNull();
    });

    // Content barcodes share the colon grammar (see BarcodePayload.mjs).
    it('returns null for content-barcode commands', () => {
      expect(parseScan('screen:living-room')).toBeNull();
      expect(parseScan('volume:5')).toBeNull();
    });

    // Shapes BarcodePayload actually produces. The scanner is route: content,
    // so anything parseScan declines is handed onward to content dispatch —
    // these must not be half-claimed.
    it('returns null for multi-segment and option-suffixed payloads', () => {
      expect(parseScan('ct:mug:extra')).toBeNull();
      expect(parseScan('dl:4+shuffle')).toBeNull();
      expect(parseScan('office:dl:4')).toBeNull();
    });
  });

  describe('junk input', () => {
    it('returns null for empty, non-string, and malformed input', () => {
      expect(parseScan('')).toBeNull();
      expect(parseScan(null)).toBeNull();
      expect(parseScan(undefined)).toBeNull();
      expect(parseScan(42)).toBeNull();
      expect(parseScan(':4')).toBeNull();
      expect(parseScan('dl')).toBeNull();
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseScan('  dl:140 ')).toEqual({ kind: 'density', kcalPer100g: 140 });
    expect(parseScan('\tct:160\n')).toEqual({ kind: 'container', grams: 160 });
  });
});

describe('encodeDensity', () => {
  it('round-trips every code a realistic table produces', () => {
    for (const kcalPer100g of ALL_DENSITY_CODES) {
      expect(parseScan(encodeDensity(kcalPer100g))).toEqual({ kind: 'density', kcalPer100g });
    }
  });

  // An encoder that emits an unparseable code does not fail until the sheet has
  // been printed and laminated. Fail at generation time instead.
  it('throws rather than emitting a code the parser would reject', () => {
    expect(() => encodeDensity(0)).toThrow(ValidationError);
    expect(() => encodeDensity(MAX_DENSITY_CODE + 1)).toThrow(ValidationError);
    expect(() => encodeDensity(undefined)).toThrow(ValidationError);
    expect(() => encodeDensity(null)).toThrow(ValidationError);
    expect(() => encodeDensity('140')).toThrow(ValidationError);
  });

  // The caller is expected to round: `kcal_per_g * 100` on a float table yields
  // things like 140.00000000000003, and a fractional payload has no printable
  // spelling. Rejecting it here is what forces the rounding to happen once, in
  // the provider, rather than being improvised per call site.
  it('rejects a fractional value rather than rounding it silently', () => {
    expect(() => encodeDensity(140.5)).toThrow(ValidationError);
  });

  it('reports the offending value on the error', () => {
    // Capture outside the try so a removed guard fails on the assertion below
    // (caught === undefined) rather than on a sentinel throw caught by its own
    // catch, which would point the diagnostic at the wrong line.
    let caught;
    try {
      encodeDensity(MAX_DENSITY_CODE + 1);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught.code).toBe('INVALID_DENSITY_LEVEL');
    expect(caught.field).toBe('kcalPer100g');
    expect(caught.value).toBe(MAX_DENSITY_CODE + 1);
  });
});

describe('encodeContainer', () => {
  it('round-trips every tare a realistic table produces', () => {
    for (const grams of ALL_TARES) {
      expect(parseScan(encodeContainer(grams))).toEqual({ kind: 'container', grams });
    }
  });

  // REGRESSION GUARD for the grammar change: this encoder used to TAKE an id.
  // Handing it one now must throw rather than stringify into `ct:mug`, which the
  // parser would reject — an unreadable code discovered after lamination.
  it('rejects a container id, which is no longer what it encodes', () => {
    expect(() => encodeContainer('mug')).toThrow(ValidationError);
    expect(() => encodeContainer('dinner-bowl')).toThrow(ValidationError);
  });

  it('throws rather than emitting a code the parser would reject', () => {
    expect(() => encodeContainer(-1)).toThrow(ValidationError);
    expect(() => encodeContainer(10000)).toThrow(ValidationError);
    expect(() => encodeContainer(160.5)).toThrow(ValidationError);
    expect(() => encodeContainer('160')).toThrow(ValidationError);
    expect(() => encodeContainer(undefined)).toThrow(ValidationError);
    expect(() => encodeContainer(null)).toThrow(ValidationError);
    expect(() => encodeContainer(NaN)).toThrow(ValidationError);
  });

  it('reports the offending value on the error', () => {
    let caught;
    try {
      encodeContainer(-1);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught.code).toBe('INVALID_CONTAINER_ID');
    expect(caught.field).toBe('grams');
    expect(caught.value).toBe(-1);
  });
});

describe('encodeControl', () => {
  it('round-trips every verb through parseScan', () => {
    for (const verb of CONTROL_VERBS) {
      expect(parseScan(encodeControl(verb))).toEqual({ kind: VERB_TO_KIND[verb] });
    }
  });

  it('emits the documented code for each verb', () => {
    expect(encodeControl('clear')).toBe('rs:clear');
    expect(encodeControl('undo')).toBe('rs:undo');
    expect(encodeControl('done')).toBe('rs:done');
  });

  // Same invariant as encodeDensity/encodeContainer: an encoder that emits a
  // code parseScan declines becomes a dead button laminated to the fridge.
  it('throws rather than emitting a code the parser would reject', () => {
    expect(() => encodeControl('bogus')).toThrow(ValidationError);
    expect(() => encodeControl('reset')).toThrow(ValidationError); // the KIND, not a verb
    expect(() => encodeControl('CLEAR')).toThrow(ValidationError);
    expect(() => encodeControl('clear:extra')).toThrow(ValidationError);
    expect(() => encodeControl('')).toThrow(ValidationError);
    expect(() => encodeControl(undefined)).toThrow(ValidationError);
    expect(() => encodeControl(null)).toThrow(ValidationError);
    expect(() => encodeControl(42)).toThrow(ValidationError);
  });

  it('reports the offending value on the error', () => {
    let caught;
    try {
      encodeControl('bogus');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught.code).toBe('INVALID_CONTROL_VERB');
    expect(caught.field).toBe('verb');
    expect(caught.value).toBe('bogus');
  });
});

describe('CONTROL_VERBS', () => {
  it('is exactly the three punctuation verbs', () => {
    expect([...CONTROL_VERBS]).toEqual(['clear', 'undo', 'done']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CONTROL_VERBS)).toBe(true);
  });
});

describe('RESET_CODE', () => {
  // Still exported and still 'rs:clear': docs, plans, and the sheet config all
  // name it. It is now just the `clear` member of the control vocabulary.
  it('is the clear control code', () => {
    expect(RESET_CODE).toBe('rs:clear');
    expect(RESET_CODE).toBe(encodeControl('clear'));
  });

  it('round-trips through parseScan', () => {
    expect(parseScan(RESET_CODE)).toEqual({ kind: 'reset' });
  });
});

describe('MAX_DENSITY_CODE', () => {
  // Pins the bound on the PRINTED payload so it cannot drift silently. Note this
  // is a different number from MAX_DENSITY_LEVEL, which bounds the ordinal rung
  // in the config table — see the note on both constants.
  it('is pinned deliberately — 2000 kcal/100 g, well past pure fat', () => {
    expect(MAX_DENSITY_CODE).toBe(2000);
  });
});
