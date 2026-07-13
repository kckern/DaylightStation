import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FitnessConfigService } from './FitnessConfigService.mjs';

function makeService(raw) {
  const configService = {
    getDefaultHouseholdId: () => 'h',
    getHouseholdAppConfig: () => raw
  };
  return new FitnessConfigService({ configService, userDataService: {}, logger: { debug() {}, warn() {} } });
}

test('timelapse defaults applied when block is absent', () => {
  const svc = makeService({ content_source: 'plex' });
  const { timelapse } = svc.getNormalizedConfig('h');
  assert.equal(timelapse.enabled, true);
  assert.equal(timelapse.speedup, 10);
  assert.equal(timelapse.output_fps, 10);
  assert.equal(timelapse.capture_interval_ms, 1000);
  assert.equal(timelapse.crf, 26);
  assert.deepEqual(timelapse.resolution, [1920, 1080]);
  assert.equal(timelapse.pip.enabled, true);
  assert.equal(timelapse.archive_frames, false);
});

test('raw timelapse values override defaults (deep merge for pip)', () => {
  const svc = makeService({ timelapse: { speedup: 6, archive_frames: true, pip: { size: [320, 180] } } });
  const { timelapse } = svc.getNormalizedConfig('h');
  assert.equal(timelapse.speedup, 6);
  assert.equal(timelapse.archive_frames, true);
  assert.equal(timelapse.output_fps, 10); // default kept
  assert.equal(timelapse.pip.enabled, true); // default kept
  assert.deepEqual(timelapse.pip.size, [320, 180]); // overridden
});
