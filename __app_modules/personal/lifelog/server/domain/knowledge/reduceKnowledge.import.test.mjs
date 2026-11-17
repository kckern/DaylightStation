import { describe, it, expect } from 'vitest';
import { reduceKnowledge } from './reduceKnowledge.mjs';
import { evidence, proposal, loop, snapshot, AS_OF, TZ } from './fixtures.testHelpers.mjs';
const source = () => evidence({
  verified: false,
  previewOnly: true,
  origin: 'historical_import'
});
const run = (over = {}) => reduceKnowledge({
  snapshot: snapshot(),
  proposals: [proposal()],
  evidence: [source()],
  asOf: AS_OF,
  timezone: TZ,
  mode: 'import',
  allowedImportRefs: [source().ref],
  importJobId: 'job-1',
  ...over
});
describe('quiet authorized historical reduction', () => {
  it('requires a separately authorized ref and never weakens live commit verification', () => {
    expect(run({
      allowedImportRefs: []
    }).rejected[0].reason).toBe('unverified_evidence');
    expect(run({
      mode: 'commit'
    }).rejected[0].reason).toBe('unverified_evidence');
    expect(run({
      allowedImportRefs: [],
      evidence: [evidence()]
    }).rejected[0].reason).toBe('unverified_evidence');
    expect(run({
      evidence: [source(), {
        ...source(),
        content: 'conflicting'
      }]
    }).rejected[0].reason).toBe('ambiguous_evidence');
  });
  it('preserves source dates and pins user-initiated policy without advancing sweep or asks', () => {
    const result = run();
    expect(result.rejected).toEqual([]);
    const object = result.batch.upserts[0];
    expect(object.created.at).toBe(source().at);
    expect(object.touched).toBe(source().localDate);
    expect(object.ask_policy).toBe('user_initiated');
    expect(object.pinned).toContain('ask_policy');
    expect(result.batch.events[0]).toMatchObject({
      at: AS_OF,
      importJobId: 'job-1'
    });
    expect(result.batch.statePatch).not.toHaveProperty('lastSweepAt');
    expect(result.batch.statePatch).not.toHaveProperty('asks');
    expect(result.batch.previewOnly).toBe(false);
  });
  it('retains edited titles/policies and closes using the historical completion instant', () => {
    const original = loop({
      created: {
        at: source().at - 86400000,
        sourceAt: source().at - 86400000
      },
      title: 'My edited title',
      ask_policy: 'never',
      pinned: ['title', 'ask_policy']
    });
    const result = run({
      snapshot: snapshot({
        [original.id]: original
      }),
      proposals: [proposal({
        op: 'close_loop',
        fields: {
          status: 'answered'
        }
      })]
    });
    expect(result.rejected).toEqual([]);
    expect(result.batch.upserts[0]).toMatchObject({
      title: 'My edited title',
      ask_policy: 'never',
      closedOn: source().localDate,
      loop: {
        answer: {
          at: source().at
        }
      }
    });
  });
  it('does not let an old touch reopen a stale imported or user-retired loop', () => {
    const original = loop({
      status: 'stale',
      created: {
        at: source().at - 86400000,
        sourceAt: source().at - 86400000
      }
    });
    const result = run({
      snapshot: snapshot({
        [original.id]: original
      }),
      proposals: [proposal({
        op: 'touch',
        fields: {}
      })]
    });
    expect(result.batch.upserts[0].status).toBe('stale');
  });
  it('accepts only verbatim grounded purpose, resource references and work domains', () => {
    const content = 'I will finish the family story for our reunion. Notes: /archive/story. Domain: family-history.';
    const context = {
      purpose: 'for our reunion',
      resourceRefs: ['/archive/story'],
      workDomain: 'family-history'
    };
    const input = {
      evidence: [{
        ...source(),
        content
      }],
      proposals: [proposal({
        quote: content,
        fields: {
          title: 'Finish the story',
          context
        }
      })]
    };
    expect(run(input).batch.upserts[0].context).toEqual(context);
    const wrong = {
      ...input,
      proposals: [proposal({
        quote: content,
        fields: {
          title: 'Finish the story',
          context: {
            purpose: 'win an award'
          }
        }
      })]
    };
    expect(run(wrong).rejected[0].reason).toBe('context_not_grounded');
  });
});
