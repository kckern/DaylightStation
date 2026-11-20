import { describe, it, expect } from 'vitest';
import { resolveTriagePolicy } from './triagePolicy.mjs';

const base = { enabled: true, defaults: { mode: 'dryRun', inboxWindowDays: 14, inboxMax: 200, autoArchiveConfidence: 0.92, overdueDays: 60, schedule: '0 5 * * *' }, users: { sample: {} } };

describe('resolveTriagePolicy', () => {
  it('is not enrolled when triage.enabled is false', () => {
    const p = resolveTriagePolicy({ configuration: { triage: { ...base, enabled: false } }, username: 'sample' });
    expect(p.enrolled).toBe(false);
    expect(p.mode).toBe('off');
  });
  it('is not enrolled for a user missing from triage.users', () => {
    expect(resolveTriagePolicy({ configuration: { triage: base }, username: 'ghost' }).enrolled).toBe(false);
  });
  it('is not enrolled with no configuration at all', () => {
    expect(resolveTriagePolicy({ configuration: undefined, username: 'sample' }).enrolled).toBe(false);
  });
  it('enrolls an opted-in user with defaults', () => {
    const p = resolveTriagePolicy({ configuration: { triage: base }, username: 'sample' });
    expect(p).toMatchObject({ enrolled: true, mode: 'dryRun', inboxWindowDays: 14, inboxMax: 200, overdueDays: 60, schedule: '0 5 * * *' });
  });
  it('defaults taskDomain to personal and accepts an override', () => {
    expect(resolveTriagePolicy({ configuration: { triage: base }, username: 'sample' }).taskDomain).toBe('personal');
    const cfg = { triage: { ...base, users: { sample: { taskDomain: 'home' } } } };
    expect(resolveTriagePolicy({ configuration: cfg, username: 'sample' }).taskDomain).toBe('home');
    const bad = { triage: { ...base, users: { sample: { taskDomain: '' } } } };
    expect(resolveTriagePolicy({ configuration: bad, username: 'sample' }).enrolled).toBe(false);
  });
  it('merges per-user scalars over defaults', () => {
    const p = resolveTriagePolicy({ configuration: { triage: { ...base, users: { sample: { mode: 'live' } } } }, username: 'sample' });
    expect(p.enrolled).toBe(true);
    expect(p.mode).toBe('live');
    expect(p.autoArchiveConfidence).toBe(0.92);
  });
  it('rejects autoArchiveConfidence below 0.8 by disabling the user', () => {
    const p = resolveTriagePolicy({ configuration: { triage: { ...base, users: { sample: { autoArchiveConfidence: 0.5 } } } }, username: 'sample' });
    expect(p.enrolled).toBe(false);
    expect(p.mode).toBe('off');
  });
  it('disables only the invalid user', () => {
    const cfg = { triage: { ...base, users: { sample: { mode: 'bogus' }, other: {} } } };
    expect(resolveTriagePolicy({ configuration: cfg, username: 'sample' }).enrolled).toBe(false);
    expect(resolveTriagePolicy({ configuration: cfg, username: 'other' }).enrolled).toBe(true);
  });
});
