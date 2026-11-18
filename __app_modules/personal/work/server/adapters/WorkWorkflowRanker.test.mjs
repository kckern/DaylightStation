import { it, expect, vi } from 'vitest';
import { WorkWorkflowRanker } from './WorkWorkflowRanker.mjs';
const eligible = Array.from({
  length: 8
}, (_, i) => ({
  id: 'offer-' + i,
  flowType: 'housekeeping',
  reason: 'legacy_review',
  domainId: 'personal',
  evidenceRefs: ['private-ref'],
  title: 'Eligible ' + i
}));
function setup() {
  const calls = vi.fn(async () => ({
      candidateId: 'offer-1',
      reason: 'recent relevance'
    })),
    reserve = vi.fn(async () => ({
      allowed: true
    })),
    scoped = vi.fn(() => ({
      chatStructured: calls
    }));
  return {
    calls,
    reserve,
    scoped,
    ranker: new WorkWorkflowRanker({
      gateway: {
        scoped
      },
      budget: {
        reserve
      },
      resolvePolicy: () => ({
        enabled: true,
        attention: {
          rankerEnabled: true
        }
      }),
      clock: () => 1
    })
  };
}
it('sends at most five eligible IDs through a scoped gateway after reserving one shared call', async () => {
  const x = setup(),
    result = await x.ranker.rank({
      eligible,
      context: {
        username: 'sample',
        rawJournal: 'excluded private content'
      },
      asOf: 1
    });
  expect(result.candidateId).toBe('offer-1');
  expect(x.reserve).toHaveBeenCalledWith(expect.objectContaining({
    scope: 'workflow-rank'
  }));
  const body = JSON.parse(x.calls.mock.calls[0][0][1].content);
  expect(body.candidates).toHaveLength(5);
  expect(JSON.stringify(body)).not.toContain('excluded private content');
  expect(x.scoped).toHaveBeenCalledWith({
    app: 'work',
    feature: 'workflow-rank'
  });
});
it.each([{
  candidateId: 'unlisted',
  reason: 'x'
}, {
  candidateId: 'offer-1',
  reason: 'x',
  action: 'delete'
}])('rejects unlisted IDs or executable extra fields', async answer => {
  const x = setup();
  x.calls.mockResolvedValue(answer);
  expect(await x.ranker.rank({
    eligible,
    context: {
      username: 'sample'
    },
    asOf: 1
  })).toBe(null);
});
it('uses no model for empty input, disabled ranking or exhausted shared calls', async () => {
  const x = setup();
  expect(await x.ranker.rank({
    eligible: [],
    context: {
      username: 'sample'
    },
    asOf: 1
  })).toBe(null);
  x.reserve.mockResolvedValue({
    allowed: false
  });
  expect(await x.ranker.rank({
    eligible,
    context: {
      username: 'sample'
    },
    asOf: 1
  })).toBe(null);
  expect(x.calls).not.toHaveBeenCalled();
});
it('keeps optional ranking disabled without a shared reservation or model attempt', async () => {
  const x = setup(),
    ranker = new WorkWorkflowRanker({
      gateway: {
        scoped: x.scoped
      },
      budget: {
        reserve: x.reserve
      },
      resolvePolicy: () => ({
        enabled: true,
        attention: {
          rankerEnabled: false
        }
      }),
      clock: () => 1
    });
  expect(await ranker.rank({
    eligible,
    context: {
      username: 'sample'
    },
    asOf: 1
  })).toBe(null);
  expect(x.reserve).not.toHaveBeenCalled();
  expect(x.calls).not.toHaveBeenCalled();
});
