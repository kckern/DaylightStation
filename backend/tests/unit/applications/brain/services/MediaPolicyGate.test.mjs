import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MediaPolicyGate } from '../../../../../src/3_applications/brain/services/MediaPolicyGate.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function item({ id, lib, labels = [], parentLabels = null, grandparentLabels = null }) {
  // We attach ancestor labels as test fixtures the labelLookup can read.
  return {
    id,
    source: 'test-source',
    librarySectionID: lib,
    labels,
    _ancestorLabels: [...(parentLabels ?? []), ...(grandparentLabels ?? [])],
  };
}

function lookup(itemArg, opts) {
  return Promise.resolve(opts?.includeAncestors ? (itemArg._ancestorLabels ?? []) : []);
}

function satWith(media_policy) {
  return { id: 's', media_policy };
}

describe('MediaPolicyGate — pass-through', () => {
  it('returns items unchanged when satellite has no media_policy', async () => {
    const gate = new MediaPolicyGate({ logger: silentLogger });
    const items = [item({ id: 'a', lib: 5 }), item({ id: 'b', lib: 9 })];
    const out = await gate.apply(items, { id: 's' });
    assert.deepStrictEqual(out.map(i => i.id), ['a', 'b']);
  });
});

describe('MediaPolicyGate — auto-approved libraries', () => {
  it('allows items in auto_approved_libraries without label check', async () => {
    const gate = new MediaPolicyGate({ logger: silentLogger });
    const sat = satWith({ auto_approved_libraries: [10, 11] });
    const items = [
      item({ id: 'kids-music', lib: 10 }),
      item({ id: 'adult-music', lib: 5 }),
    ];
    const out = await gate.apply(items, sat);
    assert.deepStrictEqual(out.map(i => i.id), ['kids-music']);
  });

  it('coerces library IDs (numeric vs string)', async () => {
    const gate = new MediaPolicyGate({ logger: silentLogger });
    const sat = satWith({ auto_approved_libraries: ['10'] });
    const items = [item({ id: 'a', lib: 10 })];   // numeric librarySectionID
    const out = await gate.apply(items, sat);
    assert.strictEqual(out.length, 1);
  });
});

describe('MediaPolicyGate — label_gated libraries', () => {
  it('allows when item has a required label', async () => {
    const gate = new MediaPolicyGate({ logger: silentLogger });
    const sat = satWith({
      label_gated: { libraries: [5], required_labels: ['family'], check_ancestors: false },
    });
    const ok = item({ id: 'ok', lib: 5, labels: ['family'] });
    const no = item({ id: 'no', lib: 5, labels: [] });
    const out = await gate.apply([ok, no], sat);
    assert.deepStrictEqual(out.map(i => i.id), ['ok']);
  });

  it('denies when item lacks label and check_ancestors is false', async () => {
    const gate = new MediaPolicyGate({ labelLookup: lookup, logger: silentLogger });
    const sat = satWith({
      label_gated: { libraries: [5], required_labels: ['family'], check_ancestors: false },
    });
    const it = item({ id: 'no', lib: 5, labels: [], parentLabels: ['family'] });
    const out = await gate.apply([it], sat);
    assert.strictEqual(out.length, 0);
  });

  it('allows when ancestor has required label and check_ancestors is true', async () => {
    const gate = new MediaPolicyGate({ labelLookup: lookup, logger: silentLogger });
    const sat = satWith({
      label_gated: { libraries: [5], required_labels: ['family'], check_ancestors: true },
    });
    const it = item({ id: 'ok', lib: 5, labels: [], parentLabels: ['family'] });
    const out = await gate.apply([it], sat);
    assert.strictEqual(out.length, 1);
  });

  it('denies when neither item nor ancestors have a required label', async () => {
    const gate = new MediaPolicyGate({ labelLookup: lookup, logger: silentLogger });
    const sat = satWith({
      label_gated: { libraries: [5], required_labels: ['family'] },
    });
    const it = item({ id: 'no', lib: 5, labels: ['adult'], parentLabels: ['adult'] });
    const out = await gate.apply([it], sat);
    assert.strictEqual(out.length, 0);
  });

  it('label match is case-insensitive', async () => {
    const gate = new MediaPolicyGate({ logger: silentLogger });
    const sat = satWith({
      label_gated: { libraries: [5], required_labels: ['Family'] },
    });
    const it = item({ id: 'ok', lib: 5, labels: ['FAMILY'] });
    const out = await gate.apply([it], sat);
    assert.strictEqual(out.length, 1);
  });
});

describe('MediaPolicyGate — default-deny on unlisted libraries', () => {
  it('drops items in libraries not in any list', async () => {
    const gate = new MediaPolicyGate({ logger: silentLogger });
    const sat = satWith({
      auto_approved_libraries: [10],
      label_gated: { libraries: [5], required_labels: ['family'] },
    });
    const out = await gate.apply([item({ id: 'orphan', lib: 99 })], sat);
    assert.strictEqual(out.length, 0);
  });

  it('drops items with no library ID at all', async () => {
    const gate = new MediaPolicyGate({ logger: silentLogger });
    const sat = satWith({ auto_approved_libraries: [10] });
    const out = await gate.apply([{ id: 'noplib' }], sat);
    assert.strictEqual(out.length, 0);
  });
});

describe('MediaPolicyGate — labelLookup fail-safe', () => {
  it('treats labelLookup throw as no-ancestors (denies if no item label)', async () => {
    const gate = new MediaPolicyGate({
      labelLookup: () => { throw new Error('boom'); },
      logger: silentLogger,
    });
    const sat = satWith({
      label_gated: { libraries: [5], required_labels: ['family'] },
    });
    const it = item({ id: 'x', lib: 5, labels: [] });
    const out = await gate.apply([it], sat);
    assert.strictEqual(out.length, 0);
  });

  it('caches ancestor label lookups across items in the same .apply() call', async () => {
    let calls = 0;
    const tracking = (i, opts) => {
      calls++;
      return Promise.resolve(opts?.includeAncestors ? ['family'] : []);
    };
    const gate = new MediaPolicyGate({ labelLookup: tracking, logger: silentLogger });
    const sat = satWith({
      label_gated: { libraries: [5], required_labels: ['family'] },
    });
    // Two items with the SAME id (same cache key) — should hit lookup once
    const it = item({ id: 'a', lib: 5 });
    await gate.apply([it, it, it], sat);
    assert.strictEqual(calls, 1);
  });
});
