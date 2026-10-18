import { describe, it, expect } from 'vitest';
import { normalizePlaybackBudgetPolicies, reconcileBudget, reserveBudget, settleBudget, budgetView } from './playbackBudget.mjs';
import { classifySupervision } from '../../../shared/supervision.mjs';
const [policy] = [{ id: 'unattended', match: 'governed', when: 'unattended', limit_minutes: 15 }];
const config = () => normalizePlaybackBudgetPolicies([policy])[0];
const facts = { localDate: '2026-10-18', nowMs: 100000, supervised: false };
const start = () => reconcileBudget(null, config(), facts);
describe('playback budget policy and durable grants', () => {
  it('normalizes 15 minutes and rejects invalid or duplicate policies', () => {
    expect(config()).toMatchObject({ id: 'unattended', limitMs: 900000 });
    for (const n of [0, -1, NaN, Infinity]) expect(() => normalizePlaybackBudgetPolicies([{ ...policy, limit_minutes: n }])).toThrow();
    expect(() => normalizePlaybackBudgetPolicies([policy, policy])).toThrow();
    expect(normalizePlaybackBudgetPolicies(undefined)).toEqual([]);
  });
  it('uses configured supervisor identities, not a HOT child or exemption', () => {
    expect(classifySupervision({ participantIds: ['child'], supervisorIds: ['parent'] }).supervised).toBe(false);
    expect(classifySupervision({ participantIds: [' PARENT '], supervisorIds: ['parent'] })).toEqual({ supervised: true, supervisorIds: ['parent'] });
  });
  it('persists reservations and expires after exactly 180 five-second grants', () => {
    let record = start();
    for (let i=0;i<180;i++) {
      const next=reserveBudget(record, config(), { id: String(i), streamId:'browser', nowMs:100000+i*5000, nextResetAtMs:1e9 });
      expect(next.grant.ms).toBe(5000); record=settleBudget(next.record, next.grant.id, 5000);
    }
    expect(budgetView(record, config())).toMatchObject({ spentMs:900000, remainingMs:0, expired:true });
    expect(reserveBudget(record, config(), { id:'no',streamId:'browser',nowMs:1e6,nextResetAtMs:1e9 }).grant).toBeNull();
  });
  it('returns unused paused time exactly once and fences old generations', () => {
    const first=reserveBudget(start(),config(),{id:'grant',streamId:'browser',nowMs:100000,nextResetAtMs:1e9});
    let record=settleBudget(first.record,'grant',1200);
    expect(record.spentMs).toBe(1200);
    expect(settleBudget(record,'grant',0).spentMs).toBe(1200);
    record=reconcileBudget(first.record,config(),{...facts,supervised:true});
    expect(record.generation).toBe(first.record.generation+1);
    expect(settleBudget(record,'grant',5000).spentMs).toBe(0);
  });
  it('resets only on local day change or supervisor arrival, not repeated presence or departure', () => {
    const old={...start(),spentMs:600000};
    expect(reconcileBudget(old,config(),facts).spentMs).toBe(600000);
    const joined=reconcileBudget(old,config(),{...facts,supervised:true});
    expect(joined.spentMs).toBe(0);
    expect(reconcileBudget(joined,config(),{...facts,supervised:true}).generation).toBe(joined.generation);
    expect(reconcileBudget(joined,config(),facts).spentMs).toBe(0);
    expect(reconcileBudget(old,config(),{...facts,localDate:'2026-10-19'}).spentMs).toBe(0);
  });
  it('truncates grants at the remaining allowance and local midnight', () => {
    expect(reserveBudget({...start(),spentMs:899999},config(),{id:'end',streamId:'b',nowMs:100000,nextResetAtMs:1e9}).grant.ms).toBe(1);
    expect(reserveBudget(start(),config(),{id:'day',streamId:'b',nowMs:100000,nextResetAtMs:100700}).grant.ms).toBe(700);
  });
});
