import { describe, it, expect } from 'vitest';
import { createRecoveryIdentity } from './recoveryIdentity.js';

describe('owner recovery identity', () => {
  const owner = (ownerId = 'owner-a') => {
    let visit = 0;
    return createRecoveryIdentity({ ownerId, createVisitId: () => `visit-${++visit}` });
  };
  it('retains visit across quality replacement and rejects duplicate or stale renderer claims', () => {
    const identity = owner();
    const before = identity.getTarget();
    const afterQuality = identity.beginRenderer(before);
    expect(afterQuality.visitId).toBe(before.visitId);
    expect(afterQuality.rendererGeneration).toBeGreaterThan(before.rendererGeneration);
    expect(identity.beginRenderer(before)).toBeNull();
    identity.acceptUserIntent('pause');
    expect(identity.beginRenderer(afterQuality)).toBeNull();
  });
  it('mints a new visit for repeat-one even with the same queue entry', () => {
    const identity = owner();
    const before = identity.getTarget();
    const afterRepeat = identity.beginVisit();
    expect(afterRepeat.visitId).not.toBe(before.visitId);
    expect(afterRepeat.intentRevision).toBe(before.intentRevision + 1);
    expect(afterRepeat.rendererGeneration).toBe(before.rendererGeneration + 1);
  });
  it.each(['play', 'pause', 'stop', 'seek', 'manual-quality', 'Retry'])('invalidates pending recovery synchronously for accepted %s', (kind) => {
    const identity = owner();
    const before = identity.getTarget();
    const after = identity.acceptUserIntent(kind);
    expect(after.visitId).toBe(before.visitId);
    expect(after.intentRevision).toBe(before.intentRevision + 1);
    expect(after.rendererGeneration).toBeGreaterThan(before.rendererGeneration);
    expect(identity.beginRenderer(before)).toBeNull();
  });
  it('publishes immutable targets and retires disposed owners', () => {
    const identity = owner();
    const changes = [];
    const unsubscribe = identity.subscribe(target => changes.push(target));
    identity.invalidateRenderer();
    expect(changes).toHaveLength(1);
    expect(Object.isFrozen(changes[0])).toBe(true);
    unsubscribe();
    identity.dispose();
    expect(identity.beginRenderer()).toBeNull();
  });
});
