import test from 'node:test';
import assert from 'node:assert/strict';
import { gameExperienceManifest, validateGameExperienceManifest } from './contracts.mjs';

const manifest = {
  schema_version: 2,
  id: 'chess',
  version: 1,
  surfaces: [
    { id: 'piano', presenter: 'piano-chess', authority_modes: ['checkpointed-local'], inputs: ['midi', 'touch'] },
    { id: 'school', presenter: 'school-chess', authority_modes: ['ephemeral'], inputs: ['pointer', 'keyboard'] },
  ],
  lifecycle_capabilities: ['participants', 'turns'],
  result_schema: 'gaming-result/v1',
};

test('portable experience manifests declare compatible surfaces', () => {
  assert.deepEqual(gameExperienceManifest(manifest), manifest);
});

test('legacy single-surface manifests fail closed', () => {
  const validation = validateGameExperienceManifest({ id: 'chess', version: 1, native_surface_id: 'piano' });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('schema_version')));
  assert.ok(validation.errors.some((error) => error.includes('surfaces')));
});

test('optional presentation embeddings require a functional fallback', () => {
  const candidate = structuredClone(manifest);
  candidate.surfaces[0].renderer_embeddings = [{ id: 'presentation-v2', optional: true, projection: 'chess-scene' }];
  assert.ok(validateGameExperienceManifest(candidate).errors.some((error) => error.includes('fallback_presenter')));
  candidate.surfaces[0].renderer_embeddings = [{ id: 'presentation-v2', optional: true, fallback_presenter: 'piano-chess' }];
  assert.ok(validateGameExperienceManifest(candidate).errors.some((error) => error.includes('projection')));
});
