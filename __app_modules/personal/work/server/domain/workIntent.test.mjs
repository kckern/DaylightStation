import { it, expect } from 'vitest';
import { matchWorkIntent } from './workIntent.mjs';
import { item, ref } from '../../../../../tests/_lib/work/stateHarness.mjs';
const policy = {
  enabled: true,
  providers: {
    p: {
      type: 'todoist',
      accountId: 'personal',
      operations: ['read', 'complete']
    }
  },
  domains: {
    personal: {
      provider: 'p',
      containerId: 'sample-project',
      role: 'tasks',
      autoComplete: 'linked_explicit'
    }
  }
};
const link = {
  username: 'sample',
  workRef: ref,
  relation: 'same_commitment',
  confirmedAt: 1
};
const intent = {
  username: 'sample',
  operation: 'complete',
  title: 'Contact Sample',
  domainId: 'personal',
  quote: 'I finished Contact Sample',
  statement: 'I finished Contact Sample',
  verified: true,
  current: true,
  authored: true,
  edited: false
};
const match = (patch = {}) => matchWorkIntent({
  intent,
  items: [item()],
  links: [link],
  policy,
  ...patch
});
it('auto-matches only one confirmed scoped exact affirmative completion', () => {
  expect(match()).toMatchObject({
    mode: 'auto',
    matches: [item()]
  });
  expect(match({
    links: []
  })).toMatchObject({
    mode: 'clarify'
  });
  expect(match({
    links: [{
      ...link,
      relation: 'action_for'
    }]
  }).mode).toBe('clarify');
});
it.each(["I haven't finished Contact Sample", 'I might finish Contact Sample', 'I will finish Contact Sample', 'Sample said they finished Contact Sample', '"I finished Contact Sample"'])('never auto-completes %s', statement => {
  expect(match({
    intent: {
      ...intent,
      statement,
      quote: statement
    }
  }).mode).toBe('none');
});
it('requires a choice for duplicate titles, edits and unavailable verification', () => {
  expect(match({
    items: [item(), item({
      ref: {
        ...ref,
        id: 'other-task'
      }
    })]
  }).mode).toBe('clarify');
  expect(match({
    intent: {
      ...intent,
      edited: true
    }
  }).mode).not.toBe('auto');
  expect(match({
    intent: {
      ...intent,
      verified: false
    }
  }).mode).toBe('none');
});
it('excludes another account and scopes board progress to native transition policy', () => {
  expect(match({
    items: [item({
      ref: {
        ...ref,
        accountId: 'other'
      }
    })]
  }).matches).toEqual([]);
  const p = structuredClone(policy);
  p.domains.personal.role = 'projects';
  p.domains.personal.autoComplete = 'never';
  p.domains.personal.transitions = {
    code_checked_in: 'review'
  };
  expect(match({
    policy: p,
    intent: {
      ...intent,
      operation: 'progress',
      transition: 'code_checked_in',
      statement: 'I checked in Contact Sample',
      quote: 'I checked in Contact Sample'
    }
  }).mode).toBe('progress');
});
it('matches a requested project-container rename by scoped identity while requiring confirmation', () => {
  const container = {
    ref: {
      ...ref,
      kind: 'container',
      id: 'sample-project'
    },
    title: 'Sample project',
    version: 'v1'
  };
  expect(match({
    items: [container],
    intent: {
      ...intent,
      operation: 'rename_container',
      title: 'Sample project',
      statement: 'Rename Sample project to New project',
      quote: 'Rename Sample project to New project'
    }
  })).toMatchObject({
    mode: 'clarify',
    matches: [container]
  });
});
