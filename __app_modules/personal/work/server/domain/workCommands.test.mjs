import { describe, it, expect } from 'vitest';
import { planCommand } from './workCommands.mjs';
import { item, ref } from '../../../../../tests/_lib/work/stateHarness.mjs';
import { AS_OF } from '../../../../../tests/_lib/work/observations.mjs';
const principal = {
  username: 'sample',
  authored: true,
  kind: 'text',
  receiptId: 'receipt-1',
  receivedAt: AS_OF,
  edited: false
};
const policy = {
  enabled: true,
  providerWrites: true,
  revision: 'policy-1',
  writer: {
    write: true
  },
  providers: {
    p: {
      type: 'todoist',
      accountId: 'personal',
      operations: ['read', 'complete', 'create_task', 'delete_task']
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
  confirmedAt: AS_OF
};
const intent = {
  domainId: 'personal',
  operation: 'complete',
  ref,
  payload: {},
  sourceReceipt: 'receipt-1',
  statement: 'I finished Contact Sample',
  mode: 'auto'
};
const plan = (patch = {}) => planCommand({
  intent,
  item: item(),
  link,
  policy,
  principal,
  asOf: AS_OF,
  ...patch
});
describe('pure Work command planning', () => {
  it('requires a single exact linked affirmative current completion for auto mode', () => {
    expect(plan()).toMatchObject({
      requiresConfirmation: false,
      command: {
        ref,
        operation: 'complete',
        expectedVersion: 'item-v1'
      }
    });
    expect(plan({
      link: null
    }).requiresConfirmation).toBe(true);
    expect(plan({
      link: {
        ...link,
        relation: 'action_for'
      }
    }).requiresConfirmation).toBe(true);
  });
  it.each(["I haven't finished Contact Sample", 'I might finish Contact Sample', 'I will finish Contact Sample', 'Sample said they finished Contact Sample', '"I finished Contact Sample"', 'I finished Someone Else'])('requires a decision for unsupported or unsafe statement %s', statement => {
    expect(plan({
      intent: {
        ...intent,
        statement
      }
    }).requiresConfirmation).toBe(true);
  });
  it('does not grant automatic authority to edits, paused routes, or board progress', () => {
    expect(plan({
      principal: {
        ...principal,
        edited: true
      }
    }).requiresConfirmation).toBe(true);
    const p = structuredClone(policy);
    p.domains.personal.autoComplete = 'never';
    expect(plan({
      policy: p
    }).requiresConfirmation).toBe(true);
  });
  it('denies another user/account/destination or disabled permission', () => {
    expect(plan({
      principal: {
        ...principal,
        username: 'other'
      }
    })).toHaveProperty('denied');
    expect(plan({
      item: item({
        ref: {
          ...ref,
          accountId: 'other'
        }
      })
    })).toHaveProperty('denied');
    expect(plan({
      item: item({
        containerRef: {
          ...ref,
          kind: 'container',
          id: 'other'
        }
      })
    })).toHaveProperty('denied');
    expect(plan({
      policy: {
        ...policy,
        providerWrites: false
      }
    })).toHaveProperty('denied');
  });
  it('keeps duplicate receipt/action IDs stable while requiring named destructive confirmation', () => {
    const a = plan(),
      b = plan({
        asOf: AS_OF + 10
      });
    expect(a.command.id).toBe(b.command.id);
    expect(plan({
      intent: {
        ...intent,
        operation: 'delete_task',
        mode: 'manual'
      }
    }).requiresConfirmation).toBe(true);
  });
});
