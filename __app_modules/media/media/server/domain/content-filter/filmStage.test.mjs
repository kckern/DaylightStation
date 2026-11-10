import { describe, it, expect } from 'vitest';
import { filmStage, STAGES } from './filmStage.mjs';

const fresh = { ok: true, fresh: true };
describe('filmStage', () => {
  it('lists the stages in order', () => {
    expect(STAGES).toEqual(['rough', 'running', 'refined', 'scenes', 'audited', 'machine', 'parent']);
  });
  it.each([
    ['rough', {}],
    ['running', { hasRefined: true, job: { status: 'queued' } }],
    ['running', { job: { status: 'running' } }],
    ['refined', { hasRefined: true }],
    ['scenes', { hasRefined: true, hasScenesKey: true }],
    ['audited', { hasRefined: true, hasScenesKey: true, audit: { ok: false, fresh: true }, certificationLevel: 'machine' }],
    ['audited', { hasRefined: true, hasScenesKey: true, audit: { ok: true, fresh: false }, certificationLevel: 'machine' }],
    ['audited', { hasRefined: true, hasScenesKey: true, audit: fresh, certificationLevel: 'none' }],
    ['machine', { hasRefined: true, hasScenesKey: true, audit: fresh, certificationLevel: 'machine' }],
    ['parent', { hasRefined: true, hasScenesKey: true, audit: fresh, certificationLevel: 'parent' }],
  ])('%s', (stage, facts) => { expect(filmStage(facts)).toBe(stage); });
  it('a failed run keeps the real stage', () => {
    expect(filmStage({ hasRefined: true, job: { status: 'failed' } })).toBe('refined');
  });
});
