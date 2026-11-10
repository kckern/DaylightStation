import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeakerReadinessCheck } from './speakerReadiness.mjs';

const actions = (present) => ({ probeEndpoints: async () => ({ present }) });
const ha = (state) => ({ getState: async () => (state === undefined ? null : { state }) });

test('all links answering is no problems', async () => {
  const check = createSpeakerReadinessCheck({ actions: actions(true), haGateway: ha('on'), plugEntity: 'switch.p' });
  assert.deepEqual(await check(), []);
});

test('an older bridge payload is bridge-endpoints-missing', async () => {
  const check = createSpeakerReadinessCheck({ actions: actions(false), haGateway: ha('on'), plugEntity: 'switch.p' });
  assert.deepEqual(await check(), ['bridge-endpoints-missing']);
});

test('an unreachable bridge is not a readiness problem (the down episode owns it)', async () => {
  const check = createSpeakerReadinessCheck({ actions: actions(null), haGateway: ha('off'), plugEntity: 'switch.p' });
  assert.deepEqual(await check(), []);
});

test('plug unavailable, unknown or missing is plug-unavailable', async () => {
  for (const st of ['unavailable', 'unknown', undefined]) {
    const check = createSpeakerReadinessCheck({ actions: actions(true), haGateway: ha(st), plugEntity: 'switch.p' });
    assert.deepEqual(await check(), ['plug-unavailable'], String(st));
  }
});

test('no plug configured says so', async () => {
  const check = createSpeakerReadinessCheck({ actions: actions(true), haGateway: ha('on'), plugEntity: null });
  assert.deepEqual(await check(), ['no-plug-configured']);
});

test('no Home Assistant gateway means no plug rungs at all: no-plug-configured', async () => {
  const check = createSpeakerReadinessCheck({ actions: actions(true), haGateway: null, plugEntity: 'switch.p' });
  assert.deepEqual(await check(), ['no-plug-configured']);
});
