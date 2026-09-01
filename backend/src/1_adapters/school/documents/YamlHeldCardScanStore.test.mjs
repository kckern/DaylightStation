import { describe, expect, it } from 'vitest';
import { YamlHeldCardScanStore } from './YamlHeldCardScanStore.mjs';

function store() {
  let records = null;
  return new YamlHeldCardScanStore({
    directory: '/print',
    io: {
      load: () => structuredClone(records),
      save: (_file, value) => { records = structuredClone(value); },
    },
    now: () => '2026-08-31T12:00:00.000Z',
  });
}

describe('YamlHeldCardScanStore', () => {
  it('preserves shadow evidence while giving a later enforced hold its own resolvable id', async () => {
    const held = store();
    const fingerprint = 'a'.repeat(64);
    const shadow = await held.record({ fingerprint, state: 'shadow', evidence: { reason: 'shadow' } });
    const enforced = await held.record({ fingerprint, state: 'held', evidence: { reason: 'enforced' } });

    expect(shadow.record.heldScanId).not.toBe(enforced.record.heldScanId);
    expect((await held.get(shadow.record.heldScanId)).state).toBe('shadow');
    expect((await held.get(enforced.record.heldScanId)).state).toBe('held');
    expect((await held.findByFingerprint(fingerprint)).state).toBe('held');

    const duplicate = await held.record({ fingerprint, state: 'held', evidence: { reason: 'again' } });
    expect(duplicate).toMatchObject({ duplicate: true, record: { heldScanId: enforced.record.heldScanId } });
  });
});
