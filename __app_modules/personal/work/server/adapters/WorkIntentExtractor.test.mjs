import { it, expect, vi } from 'vitest';
import { WorkIntentExtractor } from './WorkIntentExtractor.mjs';
import { item } from '../../../../../tests/_lib/work/stateHarness.mjs';
import { AS_OF } from '../../../../../tests/_lib/work/observations.mjs';
const entry = {
  username: 'sample',
  ref: 'journalist:msg:source',
  sourceHash: 'hash',
  content: 'I finished Contact Sample',
  at: AS_OF,
  verified: true,
  previewOnly: false,
  source: 'user'
};
const policy = {
  enabled: true,
  providers: {
    p: {
      type: 'todoist',
      accountId: 'personal'
    }
  },
  domains: {
    personal: {
      provider: 'p',
      containerId: 'sample-project',
      role: 'tasks'
    }
  }
};
function setup(configuration = policy) {
  const calls = vi.fn(async () => ({
    intents: [{
      operation: 'complete',
      domainId: 'personal',
      title: 'Contact Sample',
      quote: 'finished Contact Sample'
    }]
  }));
  const tags = [];
  const budget = {
    reserve: vi.fn(async () => ({
      allowed: true
    }))
  };
  const gateway = {
    scoped: meta => {
      tags.push(meta);
      return {
        chatStructured: calls
      };
    }
  };
  return {
    calls,
    tags,
    budget,
    extractor: new WorkIntentExtractor({
      gateway,
      budget,
      resolvePolicy: () => configuration,
      clock: () => AS_OF
    })
  };
}
it('uses deterministic known affirmative forms without spending a model call', async () => {
  const x = setup();
  expect((await x.extractor.extract({
    entry,
    context: {
      items: [item()]
    },
    asOf: AS_OF
  })).intents).toHaveLength(1);
  expect(x.calls).not.toHaveBeenCalled();
  expect(x.budget.reserve).not.toHaveBeenCalled();
});
it('uses one scoped structured attempt after reserving and rejects invented IDs or source spans', async () => {
  const x = setup();
  const source = {
    ...entry,
    content: 'Today I finished Contact Sample after lunch.'
  };
  await x.extractor.extract({
    entry: source,
    context: {
      items: [item()]
    },
    asOf: AS_OF
  });
  expect(x.calls).toHaveBeenCalledTimes(1);
  expect(x.tags).toContainEqual(expect.objectContaining({
    app: 'work',
    feature: 'journal-intent'
  }));
  expect(x.budget.reserve).toHaveBeenCalledWith(expect.objectContaining({
    scope: 'journal-intent',
    username: 'sample'
  }));
  x.calls.mockResolvedValue({
    intents: [{
      operation: 'complete',
      domainId: 'personal',
      title: 'Contact Sample',
      quote: 'not in the source',
      accountId: 'invented'
    }]
  });
  await expect(x.extractor.extract({
    entry: source,
    context: {
      items: [item()]
    },
    asOf: AS_OF
  })).rejects.toThrow();
});
it('does not call a model when budget is exhausted or evidence is unverified', async () => {
  const x = setup();
  x.budget.reserve.mockResolvedValue({
    allowed: false
  });
  expect(await x.extractor.extract({
    entry: {
      ...entry,
      content: 'I made progress on Contact Sample'
    },
    context: {
      items: [item()]
    },
    asOf: AS_OF
  })).toMatchObject({
    deferred: true
  });
  await expect(x.extractor.extract({
    entry: {
      ...entry,
      verified: false
    },
    context: {
      items: []
    },
    asOf: AS_OF
  })).rejects.toThrow();
  expect(x.calls).not.toHaveBeenCalled();
});
it('does not spend the shared budget on unrelated ordinary journal text', async () => {
  const x = setup();
  x.calls.mockResolvedValue({
    intents: []
  });
  expect((await x.extractor.extract({
    entry: {
      ...entry,
      content: 'We enjoyed a quiet sunset by the lake.'
    },
    context: {
      items: [item()]
    },
    asOf: AS_OF
  })).intents).toEqual([]);
  expect(x.budget.reserve).not.toHaveBeenCalled();
  expect(x.calls).not.toHaveBeenCalled();
});
it('recognizes board check-in as progress before a model can reinterpret it as acceptance', async () => {
  const board = {
    enabled: true,
    providers: {
      p: {
        type: 'clickup',
        accountId: 'delivery'
      }
    },
    domains: {
      software: {
        provider: 'p',
        containerId: 'sample-list',
        role: 'projects',
        transitions: {
          code_checked_in: 'review'
        }
      }
    }
  };
  const x = setup(board),
    text = 'I checked in Module X';
  x.calls.mockResolvedValue({
    intents: [{
      operation: 'complete',
      domainId: 'software',
      title: 'Module X',
      quote: text
    }]
  });
  const result = await x.extractor.extract({
    entry: {
      ...entry,
      content: text
    },
    context: {
      items: [item({
        title: 'Module X',
        ref: {
          provider: 'clickup',
          accountId: 'delivery',
          kind: 'task',
          id: 'module-x'
        },
        containerRef: {
          provider: 'clickup',
          accountId: 'delivery',
          kind: 'container',
          id: 'sample-list'
        }
      })]
    },
    asOf: AS_OF
  });
  expect(result.intents[0]).toMatchObject({
    operation: 'progress',
    transition: 'code_checked_in',
    domainId: 'software'
  });
  expect(x.calls).not.toHaveBeenCalled();
  expect(x.budget.reserve).not.toHaveBeenCalled();
});
it('accepts a grounded explicit task archive intent', async () => {
  const x = setup();
  x.calls.mockResolvedValue({
    intents: [{
      operation: 'archive_task',
      domainId: 'personal',
      title: 'Contact Sample',
      quote: 'Archive task Contact Sample'
    }]
  });
  const result = await x.extractor.extract({
    entry: {
      ...entry,
      content: 'Archive task Contact Sample'
    },
    context: {
      items: [item()]
    },
    asOf: AS_OF
  });
  expect(result.intents[0].operation).toBe('archive_task');
});
