// @vitest-environment node
/**
 * JS-side validator parity test — mirrors the Python parity test in
 * `tests/playback-hub/test_validate_config_parity.py`.
 *
 * Both consume the SAME fixture set under `tests/fixtures/playback-hub/`:
 *   - `invalid/*.yml` — every fixture must be REJECTED by both validators
 *   - `valid/*.yml`   — every fixture must be ACCEPTED; the resulting
 *                       canonical form (HubConfig.toYaml here, Python's
 *                       passthrough json.dump there) must match the paired
 *                       `*.expected.json`.
 *
 * Adding a new rule = add a fixture in both invalid/ + valid/ AND update
 * BOTH validators. CI catches drift in both directions:
 *   - rejection-direction drift (one accepts what the other rejects)
 *   - normalization drift (one's canonical form differs from the other's)
 *
 * The Python validator file is `_extensions/playback-hub/validate_config.py`.
 * The JS validator lives inside `YamlHubConfigDatastore.#validate()`.
 */

import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { YamlHubConfigDatastore } from '../../backend/src/1_adapters/persistence/yaml/YamlHubConfigDatastore.mjs';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/playback-hub');

describe('YamlHubConfigDatastore vs validate_config.py — shared fixture parity', () => {
  it('rejects every invalid/*.yml (≥11 fixtures, one per rule)', async () => {
    const dir = path.join(FIXTURES, 'invalid');
    const files = (await readdir(dir)).filter(f => f.endsWith('.yml')).sort();
    expect(files.length, 'expected at least 11 invalid fixtures').toBeGreaterThanOrEqual(11);

    for (const fname of files) {
      const yamlPath = path.join(dir, fname);
      const store = new YamlHubConfigDatastore({ yamlPath });
      const err = await store.getConfig().then(() => null, e => e);
      expect(err, `fixture ${fname} should have been REJECTED but the datastore accepted it`).not.toBeNull();
    }
  });

  it('accepts every valid/*.yml and toYaml canonicalizes to the matching expected.json', async () => {
    const dir = path.join(FIXTURES, 'valid');
    const files = (await readdir(dir)).filter(f => f.endsWith('.yml')).sort();
    expect(files.length, 'expected at least 2 valid fixtures').toBeGreaterThanOrEqual(2);

    for (const fname of files) {
      const yamlPath = path.join(dir, fname);
      const expectedPath = yamlPath.replace(/\.yml$/, '.expected.json');
      const expectedRaw = await readFile(expectedPath, 'utf8').catch(() => null);
      expect(expectedRaw, `missing expected JSON for ${fname}`).not.toBeNull();
      const expected = JSON.parse(expectedRaw);

      const store = new YamlHubConfigDatastore({ yamlPath });
      const cfg = await store.getConfig();
      // JSON.parse(JSON.stringify(...)) drops `undefined` and unwraps
      // frozen structures into plain JSON-equivalent shapes — same
      // canonicalization the Python validator's json.dump performs.
      const actual = JSON.parse(JSON.stringify(cfg.toYaml()));
      expect(actual, `fixture ${fname} canonical-form drift between JS and expected.json`).toEqual(expected);
    }
  });
});
