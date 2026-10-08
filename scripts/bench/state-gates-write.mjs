#!/usr/bin/env node
// Production-sized State Gates write cost, YAML (old) vs JSON (new). Not a
// test: wall-clock numbers flake under gate load. Run by hand:
//   node scripts/bench/state-gates-write.mjs
import yaml from 'js-yaml';

const now = Date.now();
const state = {
  schema: 'daylight.state-gates-state/v2',
  projection: {
    schemaVersion: 1, householdRevision: 6174,
    assertions: Array.from({ length: 131 }, (_, i) => ({ id: `fitness:weekly-rings:user${i}`, observedAt: now, sourceRevision: now, value: { rings: i % 5, minutes: i * 3, detail: 'x'.repeat(300) } })),
    evaluations: Array.from({ length: 258 }, (_, i) => ({ gateId: `gate${i}`, state: 'satisfied', reasons: ['CLAIM_PRESENT'], validFrom: now, validUntil: null, detail: 'y'.repeat(250) })),
    decisions: Array.from({ length: 131 }, (_, i) => ({ entitlementId: `ent${i}`, allowed: true, reasons: [], detail: 'z'.repeat(250) })),
  },
  journal: Array.from({ length: 497 }, (_, i) => ({ transitionId: `t${i}`, householdRevision: 5700 + i, ordinal: 0, occurredAt: now, kind: 'StateObservation', payload: { observationKind: 'gate', detail: 'w'.repeat(600) }, published: true })),
  compactedThrough: 5699, deliveryCheckpoint: 6174,
};
const time = (label, fn, runs = 20) => {
  const samples = [];
  for (let i = 0; i < runs; i += 1) { const t = performance.now(); fn(); samples.push(performance.now() - t); }
  samples.sort((a, b) => a - b);
  console.log(label.padEnd(8), 'median', samples[runs >> 1].toFixed(1), 'ms  max', samples.at(-1).toFixed(1), 'ms');
};
const json = JSON.stringify(state);
console.log('state size', (Buffer.byteLength(json) / 1024).toFixed(0), 'KB');
time('yaml', () => yaml.dump(state, { noRefs: true, sortKeys: true }));
time('json', () => JSON.stringify(state));
