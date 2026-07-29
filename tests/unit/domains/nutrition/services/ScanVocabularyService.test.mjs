import { describe, it, expect } from 'vitest';
import {
  parseScan,
  encodeDensity,
  encodeContainer,
  encodeControl,
  CONTROL_VERBS,
  RESET_CODE,
  MAX_DENSITY_LEVEL,
} from '#domains/nutrition';
import { ValidationError } from '#domains/core/errors/index.mjs';

const ALL_LEVELS = Array.from({ length: MAX_DENSITY_LEVEL }, (_, i) => i + 1);

/**
 * The verb printed on the sheet is NOT always the kind the parser returns:
 * `clear` parses to `reset`. See the asymmetry note in ScanVocabularyService.
 */
const VERB_TO_KIND = { clear: 'reset', undo: 'undo', done: 'done' };

describe('parseScan', () => {
  describe('density codes', () => {
    it('parses a density level', () => {
      expect(parseScan('dl:4')).toEqual({ kind: 'density', level: 4 });
    });

    it('parses every level in range', () => {
      for (const level of ALL_LEVELS) {
        expect(parseScan(`dl:${level}`)).toEqual({ kind: 'density', level });
      }
    });

    it('rejects levels outside the range', () => {
      expect(parseScan('dl:0')).toBeNull();
      expect(parseScan(`dl:${MAX_DENSITY_LEVEL + 1}`)).toBeNull();
      expect(parseScan('dl:x')).toBeNull();
    });

    it('rejects non-canonical numeric forms', () => {
      expect(parseScan('dl:04')).toBeNull();
      expect(parseScan('dl:4.0')).toBeNull();
      expect(parseScan('dl:-4')).toBeNull();
    });
  });

  describe('container codes', () => {
    it('parses a container id', () => {
      expect(parseScan('ct:dinner-bowl')).toEqual({ kind: 'container', id: 'dinner-bowl' });
    });

    it('rejects an empty container id', () => {
      expect(parseScan('ct:')).toBeNull();
    });

    // A mixed-case id would not match its lowercase `containers.items` key, so
    // accepting it would silently resolve no tare and yield a plausible but
    // wrong calorie number. Reject at the grammar instead.
    it('rejects mixed-case ids rather than passing them through', () => {
      expect(parseScan('ct:Mug')).toBeNull();
      expect(parseScan('ct:Dinner-Bowl')).toBeNull();
    });

    it('rejects ids with underscores or spaces', () => {
      expect(parseScan('ct:bento_box')).toBeNull();
      expect(parseScan('ct:dinner bowl')).toBeNull();
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
    expect(parseScan('  dl:4 ')).toEqual({ kind: 'density', level: 4 });
    expect(parseScan('\tct:mug\n')).toEqual({ kind: 'container', id: 'mug' });
  });
});

describe('encodeDensity', () => {
  it('round-trips every level through parseScan', () => {
    for (const level of ALL_LEVELS) {
      expect(parseScan(encodeDensity(level))).toEqual({ kind: 'density', level });
    }
  });

  // An encoder that emits an unparseable code does not fail until the sheet has
  // been printed and laminated. Fail at generation time instead.
  it('throws rather than emitting a code the parser would reject', () => {
    expect(() => encodeDensity(0)).toThrow(ValidationError);
    expect(() => encodeDensity(MAX_DENSITY_LEVEL + 1)).toThrow(ValidationError);
    expect(() => encodeDensity(undefined)).toThrow(ValidationError);
    expect(() => encodeDensity(null)).toThrow(ValidationError);
    expect(() => encodeDensity(4.5)).toThrow(ValidationError);
    expect(() => encodeDensity('4')).toThrow(ValidationError);
  });

  it('reports the offending value on the error', () => {
    // Capture outside the try so a removed guard fails on the assertion below
    // (caught === undefined) rather than on a sentinel throw caught by its own
    // catch, which would point the diagnostic at the wrong line.
    let caught;
    try {
      encodeDensity(MAX_DENSITY_LEVEL + 1);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught.code).toBe('INVALID_DENSITY_LEVEL');
    expect(caught.field).toBe('level');
    expect(caught.value).toBe(MAX_DENSITY_LEVEL + 1);
  });
});

describe('encodeContainer', () => {
  it('round-trips valid ids through parseScan', () => {
    for (const id of ['mug', 'dinner-bowl', '9x13-pan', 'jar2']) {
      expect(parseScan(encodeContainer(id))).toEqual({ kind: 'container', id });
    }
  });

  // 'bento_box' is exactly the shape a human adds next to containers.items.
  it('throws rather than emitting a code the parser would reject', () => {
    expect(() => encodeContainer('bento_box')).toThrow(ValidationError);
    expect(() => encodeContainer('dinner bowl')).toThrow(ValidationError);
    expect(() => encodeContainer('9x13 pan')).toThrow(ValidationError);
    expect(() => encodeContainer('Mug')).toThrow(ValidationError);
    expect(() => encodeContainer('-leading-hyphen')).toThrow(ValidationError);
    expect(() => encodeContainer('mug:extra')).toThrow(ValidationError);
    expect(() => encodeContainer('')).toThrow(ValidationError);
    expect(() => encodeContainer(undefined)).toThrow(ValidationError);
    expect(() => encodeContainer(42)).toThrow(ValidationError);
  });

  it('reports the offending value on the error', () => {
    let caught;
    try {
      encodeContainer('bento_box');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught.code).toBe('INVALID_CONTAINER_ID');
    expect(caught.field).toBe('id');
    expect(caught.value).toBe('bento_box');
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

describe('MAX_DENSITY_LEVEL', () => {
  // This does NOT read config.example.yml — it only pins the constant so the
  // bound cannot drift silently. Task 4 adds the real config-coupling check.
  it('is pinned deliberately — update config.example.yml in the same commit', () => {
    expect(MAX_DENSITY_LEVEL).toBe(9);
  });
});
