import { describe, it } from 'node:test';
import assert from 'node:assert';
import { matchesScope, validateGlob } from '../../../../../src/3_applications/concierge/services/scopeMatcher.mjs';

describe('matchesScope', () => {
  it('exact match returns true', () => {
    assert.strictEqual(matchesScope('data:fitness:strava.yml', 'data:fitness:strava.yml'), true);
  });

  it('* matches a single segment only', () => {
    assert.strictEqual(matchesScope('data:fitness:strava.yml', 'data:fitness:*'), true);
    assert.strictEqual(matchesScope('data:fitness:cardio:peloton.yml', 'data:fitness:*'), false);
    assert.strictEqual(matchesScope('data:weather:today.yml', 'data:fitness:*'), false);
  });

  it('** matches one or more segments', () => {
    assert.strictEqual(matchesScope('data:fitness:strava.yml', 'data:fitness:**'), true);
    assert.strictEqual(matchesScope('data:fitness:cardio:peloton.yml', 'data:fitness:**'), true);
    assert.strictEqual(matchesScope('data:fitness', 'data:fitness:**'), false);
    assert.strictEqual(matchesScope('data:weather:today.yml', 'data:fitness:**'), false);
  });

  it('mixed wildcards combine', () => {
    assert.strictEqual(matchesScope('ha:office:lights:turn_on', 'ha:*:lights:**'), true);
    assert.strictEqual(matchesScope('ha:kitchen:lights:turn_on:bright', 'ha:*:lights:**'), true);
    assert.strictEqual(matchesScope('ha:office:scripts:vent', 'ha:*:lights:**'), false);
  });

  it('case-sensitive', () => {
    assert.strictEqual(matchesScope('data:Fitness:x', 'data:fitness:*'), false);
  });

  it('returns false for non-string inputs', () => {
    assert.strictEqual(matchesScope(null, 'data:*'), false);
    assert.strictEqual(matchesScope('data:x', null), false);
    assert.strictEqual(matchesScope(undefined, undefined), false);
  });

  it('empty scope and empty pattern', () => {
    assert.strictEqual(matchesScope('', ''), true);
    assert.strictEqual(matchesScope('', '*'), true);
    assert.strictEqual(matchesScope('a', ''), false);
  });
});

describe('validateGlob', () => {
  it('accepts simple patterns', () => {
    assert.doesNotThrow(() => validateGlob('data:fitness:*'));
    assert.doesNotThrow(() => validateGlob('data:fitness:**'));
    assert.doesNotThrow(() => validateGlob('memory:*'));
    assert.doesNotThrow(() => validateGlob('exact:scope'));
  });

  it('rejects regex/character-class artifacts', () => {
    assert.throws(() => validateGlob('data:[fitness]:*'), /invalid scope/i);
    assert.throws(() => validateGlob('data:fitness:?'), /invalid scope/i);
    assert.throws(() => validateGlob('data:fitness:.*'), /invalid scope/i);
  });

  it('rejects non-string', () => {
    assert.throws(() => validateGlob(null), /string/i);
    assert.throws(() => validateGlob(42), /string/i);
  });

  it('rejects empty string', () => {
    assert.throws(() => validateGlob(''), /empty/i);
  });
});
