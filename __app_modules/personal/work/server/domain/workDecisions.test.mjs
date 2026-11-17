import { it, expect } from 'vitest';
import { validateWorkDecisionReply, validateWorkFlowState } from './workDecisions.mjs';
const decision = {
  username: 'sample',
  senderId: '101',
  conversationId: 'telegram:private',
  status: 'delivered',
  botMessageId: '200',
  policyRevision: 'policy-1',
  createdAt: 1000,
  expiresAt: 100000,
  choices: [{
    tokenHash: 'hash',
    action: 'confirm'
  }]
};
const principal = {
  username: 'sample',
  senderId: '101',
  conversationId: 'telegram:private',
  kind: 'callback',
  messageId: '200',
  authored: true
};
it('binds action to actual sender, conversation, message, config, delivery and expiry', () => {
  const input = {
    decision,
    principal,
    tokenHash: 'hash',
    botMessageId: '200',
    policyRevision: 'policy-1',
    asOf: 2000
  };
  expect(validateWorkDecisionReply(input)).toMatchObject({
    action: 'confirm'
  });
  for (const patch of [{
    principal: {
      ...principal,
      senderId: '202'
    }
  }, {
    botMessageId: '201'
  }, {
    policyRevision: 'new'
  }, {
    asOf: 100001
  }, {
    decision: {
      ...decision,
      status: 'prepared'
    }
  }, {
    decision: {
      ...decision,
      status: 'uncertain'
    }
  }, {
    tokenHash: 'other'
  }]) expect(validateWorkDecisionReply({
    ...input,
    ...patch
  })).toHaveProperty('denied');
});
it('keeps flow state finite and forbids payload authority or unbounded candidate pages', () => {
  const flow = {
    flowType: 'match',
    offerId: 'offer-1',
    step: 'select',
    selectionRefs: [],
    pageCursor: 0,
    expectedVersion: null,
    policyRevision: 'policy-1',
    sourceReceipt: 'source-1'
  };
  expect(validateWorkFlowState(flow)).toBe(true);
  expect(validateWorkFlowState({
    ...flow,
    providerWrites: true
  })).toBe(false);
  expect(validateWorkFlowState({
    ...flow,
    selectionRefs: Array(4).fill({
      provider: 'todoist',
      accountId: 'personal',
      kind: 'task',
      id: 'task'
    })
  })).toBe(false);
});
