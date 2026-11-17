import { it, expect, vi } from 'vitest';
import { ProcessTextEntry } from './ProcessTextEntry.mjs';
function setup({
  failWork = false,
  mismatch = false,
  kb = false
} = {}) {
  const order = [],
    saved = [],
    principal = {},
    source = {
      platform: 'telegram',
      conversationId: 'telegram:private',
      messageId: '99',
      senderId: '101',
      verified: true
    };
  const repo = {
    saveMessage: vi.fn(async message => {
      order.push('saved');
      const row = {
        ...message,
        content: message.text,
        source: {
          ...message.source,
          contentHash: 'computed-by-repository'
        }
      };
      saved.push(row);
      return row;
    }),
    getMessageHistory: async () => []
  };
  const work = {
    sourceForEntry: () => mismatch ? {
      ...source,
      senderId: '202'
    } : source,
    onEntrySaved: vi.fn(async ({
      message
    }) => {
      order.push('work');
      expect(saved).toContain(message);
      if (failWork) throw new Error('offline');
      return {
        handled: true,
        scheduled: true
      };
    })
  };
  const knowledge = kb ? {
    sourceForEntry: () => source,
    shouldSuppressFollowUp: () => true,
    onEntrySaved: vi.fn(async () => ({
      scheduled: true,
      suppressFollowUp: true,
      ackHandled: false
    }))
  } : null;
  const ai = {
      chat: vi.fn(async () => null)
    },
    sent = [];
  const service = new ProcessTextEntry({
    messagingGateway: {
      sendMessage: async (_chat, text) => {
        sent.push(text);
        return {
          messageId: '200'
        };
      }
    },
    aiGateway: ai,
    journalEntryRepository: repo,
    workCompanion: work,
    knowledgeCompanion: knowledge,
    clock: () => 1000,
    logger: {
      debug() {},
      warn() {},
      error() {}
    }
  });
  return {
    service,
    work,
    knowledge,
    repo,
    order,
    sent,
    ai,
    principal
  };
}
const run = x => x.service.execute({
  chatId: 'telegram:private',
  messageId: '99',
  senderId: '101',
  senderName: 'Sample',
  text: 'I finished Sample task. '.repeat(40),
  workPrincipal: x.principal,
  knowledgePrincipal: x.principal,
  aiAvailable: false
});
it('persists independent Work provenance and invokes coordination only after a successful journal save when KB is absent', async () => {
  const x = setup();
  expect((await run(x)).success).toBe(true);
  expect(x.repo.saveMessage.mock.calls[0][0]).toMatchObject({
    role: 'user',
    source: {
      verified: true
    }
  });
  expect(x.order).toEqual(['saved', 'work']);
});
it('preserves journal success and suppression when Work is unavailable', async () => {
  const x = setup({
    failWork: true,
    kb: true
  });
  expect((await run(x)).suppressedFollowUp).toBe(true);
  expect(x.repo.saveMessage).toHaveBeenCalledTimes(1);
  expect(x.work.onEntrySaved).toHaveBeenCalledTimes(1);
  expect(x.ai.chat).not.toHaveBeenCalled();
  expect(x.sent).toEqual(['📝 Noted.']);
});
it('does not use disagreeing KB and Work provenance or restore a suppressed feelings question', async () => {
  const x = setup({
    mismatch: true,
    kb: true
  });
  await run(x);
  expect(x.repo.saveMessage.mock.calls[0][0].source).toBeUndefined();
  expect(x.work.onEntrySaved).not.toHaveBeenCalled();
  expect(x.knowledge.onEntrySaved).not.toHaveBeenCalled();
  expect(x.ai.chat).not.toHaveBeenCalled();
});
it('does not ask an unrelated immediate follow-up after Work already delivered a correction page', async () => {
  const x = setup();
  x.work.onEntrySaved.mockResolvedValue({
    handled: true,
    suppressFollowUp: true,
    ackHandled: true
  });
  const result = await x.service.execute({
    chatId: 'telegram:private',
    messageId: '99',
    senderId: '101',
    senderName: 'Sample',
    text: 'Correction: I have not completed that task.',
    workPrincipal: x.principal,
    aiAvailable: true
  });
  expect(result.suppressedFollowUp).toBe(true);
  expect(x.ai.chat).not.toHaveBeenCalled();
  expect(x.sent).toEqual([]);
});
