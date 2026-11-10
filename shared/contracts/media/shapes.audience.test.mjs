// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { validateAudience, validateSessionSnapshot, createIdleSessionSnapshot } from './shapes.mjs';

const ok = { activity: 'workout', people: [{ id: 'rider-a', name: 'Rider A', role: 'rider', guest: false }] };

describe('snapshot.audience', () => {
  it('accepts the standard shape and an absent field', () => {
    expect(validateAudience(ok).valid).toBe(true);
    const snap = createIdleSessionSnapshot({ sessionId: 's', ownerId: 'dev' });
    expect(validateSessionSnapshot(snap).valid).toBe(true);
    expect(validateSessionSnapshot({ ...snap, audience: ok }).valid).toBe(true);
    expect(validateSessionSnapshot({ ...snap, audience: null }).valid).toBe(true);
  });

  it('rejects malformed people, roles and activities', () => {
    expect(validateAudience({ activity: 'workout', people: 'x' }).valid).toBe(false);
    expect(validateAudience({ activity: 'workout', people: [{ name: 'no id', role: 'rider' }] }).valid).toBe(false);
    expect(validateAudience({ activity: 'workout', people: [{ id: 'a', role: 'boss' }] }).valid).toBe(false);
    expect(validateAudience({ activity: 'karaoke', people: [] }).valid).toBe(false);
    const snap = createIdleSessionSnapshot({ sessionId: 's', ownerId: 'dev' });
    const r = validateSessionSnapshot({ ...snap, audience: { activity: 'workout', people: [{}] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/audience/);
  });
});
