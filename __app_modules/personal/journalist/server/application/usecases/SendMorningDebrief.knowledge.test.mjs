import { it, expect, vi } from 'vitest';
import { SendMorningDebrief } from './SendMorningDebrief.mjs';
const asOf = Date.parse('2026-11-03T15:00Z');
function setup({
  workCompanion = null,
  failPrepare = false,
  sendAllowed = true,
  failAck = false
} = {}) {
  const order = [],
    selection = {
      mode: 'knowledge',
      selectionId: 'selection-1',
      askDate: '2026-11-03',
      queuedCount: 3,
      questions: [{
        id: 'q1',
        text: 'Did you finish: Sample reply?'
      }, {
        id: 'q2',
        text: 'Did you finish: Another reply?'
      }]
    };
  const source = {
    prepareDelivery: vi.fn(async () => {
      order.push('prepare');
      if (failPrepare) throw Error('write failed');
      return {
        deliveryId: 'delivery-1',
        sendAllowed,
        questions: selection.questions,
        choices: [[{
          text: '1. Yes',
          callback_data: 'kb1:sample:y'
        }], [{
          text: '2. Yes',
          callback_data: 'kb1:other:y'
        }]]
      };
    }),
    recordDelivery: vi.fn(async () => {
      order.push('ack');
      if (failAck) throw Error('ack failed');
    }),
    recordDeliveryFailure: vi.fn(async () => {})
  };
  const send = vi.fn(async () => {
      order.push('send');
      return {
        messageId: '99'
      };
    }),
    state = {
      set: vi.fn(async () => {})
    };
  const service = new SendMorningDebrief({
    workCompanion,
    messagingGateway: {
      sendMessage: send
    },
    conversationStateStore: state,
    followUpSource: source,
    clock: () => asOf,
    logger: {
      info() {},
      warn() {},
      error() {}
    }
  });
  const debrief = {
    success: true,
    date: '2026-11-02',
    username: 'sample',
    askDate: '2026-11-03',
    summary: 'Meeting.\n\n• Did you finish: Sample reply?\n• Did you finish: Another reply?',
    knowledgeFacts: 'Meeting.',
    headline: null,
    knowledgeSelection: selection,
    lifelog: {
      _meta: {
        sources: ['calendar']
      },
      summaries: []
    }
  };
  return {
    service,
    source,
    send,
    state,
    debrief,
    order
  };
}
const run = d => d.service.execute({
  conversationId: 'private-sample',
  debrief: d.debrief
});
it('prepares both question tokens before transport and binds them to the one acknowledged message', async () => {
  const d = setup();
  await run(d);
  expect(d.order).toEqual(['prepare', 'send', 'ack']);
  expect(d.source.recordDelivery).toHaveBeenCalledWith({
    username: 'sample',
    deliveryId: 'delivery-1',
    botMessageId: '99',
    asOf
  });
  const options = d.send.mock.calls[0][2];
  expect(options.inline).toBe(true);
  expect(options.choices.flat().filter(b => b.callback_data.startsWith('kb1:'))).toHaveLength(2);
  expect(options.choices.flat()).toContainEqual({
    text: '💬 3 more',
    callback_data: 'debrief:ask'
  });
  expect(d.state.set.mock.calls[0][1].debrief).toMatchObject({
    askDate: '2026-11-03',
    knowledgeSelection: d.debrief.knowledgeSelection
  });
});
it('sends facts only when preparation cannot durably reserve the questions', async () => {
  const d = setup({
    failPrepare: true
  });
  await run(d);
  expect(d.send.mock.calls[0][1]).not.toContain('?');
  expect(d.source.recordDelivery).not.toHaveBeenCalled();
});
it('suppresses a duplicate send when preparation returns an existing reservation', async () => {
  const d = setup({
    sendAllowed: false
  });
  expect((await run(d)).suppressed).toBe(true);
  expect(d.send).not.toHaveBeenCalled();
});
it('quarantines an acknowledged transport whose receipt persistence failed', async () => {
  const d = setup({
    failAck: true
  });
  await expect(run(d)).rejects.toThrow('ack failed');
  expect(d.send).toHaveBeenCalledTimes(1);
  expect(d.source.recordDeliveryFailure).toHaveBeenCalledWith({
    username: 'sample',
    deliveryId: 'delivery-1',
    uncertain: true,
    asOf
  });
});
it('records control-day questions against the acknowledged legacy message without adding KB buttons', async () => {
  const d = setup();
  delete d.debrief.knowledgeSelection;
  d.debrief.knowledgeControl = {
    mode: 'legacy',
    reason: 'control',
    selectionId: 'control-1',
    askDate: '2026-11-03'
  };
  d.source.prepareDelivery.mockResolvedValue({
    deliveryId: 'control-delivery',
    sendAllowed: true,
    questions: [],
    choices: []
  });
  await run(d);
  expect(d.source.prepareDelivery.mock.calls[0][0]).toMatchObject({
    selectionId: 'control-1',
    questionIds: ['legacy.0', 'legacy.1']
  });
  expect(d.source.recordDelivery).toHaveBeenCalledWith({
    username: 'sample',
    deliveryId: 'control-delivery',
    botMessageId: '99',
    asOf
  });
  expect(d.send.mock.calls[0][2].choices.flat().some(b => b.callback_data.startsWith('kb1:'))).toBe(false);
});
it('sends one KB question plus one bound Work invitation after shared preparations', async () => {
  const work = {
    prepareForMorning: vi.fn(async () => ({
      decisionId: 'work-page',
      text: 'Review one older work item?',
      choices: [[{
        text: 'Review',
        callback_data: 'w1:bound'
      }]]
    })),
    recordDelivery: vi.fn(async () => {}),
    recordDeliveryFailure: vi.fn()
  };
  const d = setup({
    workCompanion: work
  });
  d.debrief.knowledgeSelection.questions.splice(1);
  d.debrief.workOffer = {
    id: 'offer-one'
  };
  d.source.prepareDelivery.mockResolvedValue({
    deliveryId: 'kb',
    sendAllowed: true,
    questions: d.debrief.knowledgeSelection.questions,
    choices: []
  });
  await run(d);
  expect(d.send.mock.calls[0][1].match(/\?/g)).toHaveLength(2);
  expect(work.prepareForMorning).toHaveBeenCalledTimes(1);
  expect(work.recordDelivery).toHaveBeenCalledWith(expect.objectContaining({
    decisionId: 'work-page',
    botMessageId: '99'
  }));
  expect(d.send.mock.calls[0][2].choices.flat()).toContainEqual({
    text: 'Review',
    callback_data: 'w1:bound'
  });
});
it('cannot add a Work invitation when two KB questions are prepared or on control dates', async () => {
  const work = {
    prepareForMorning: vi.fn()
  };
  const d = setup({
    workCompanion: work
  });
  d.debrief.workOffer = {
    id: 'one'
  };
  await run(d);
  expect(work.prepareForMorning).not.toHaveBeenCalled();
  delete d.debrief.knowledgeSelection;
  d.debrief.knowledgeControl = {
    selectionId: 'control'
  };
  await run(d);
  expect(work.prepareForMorning).not.toHaveBeenCalled();
});
it('a shared-cap denial keeps an ordinary facts debrief without substituting a Work question', async () => {
  const work = {
    prepareForMorning: vi.fn()
  };
  const d = setup({
    workCompanion: work
  });
  d.debrief.workOffer = {
    id: 'one'
  };
  d.source.prepareDelivery.mockResolvedValue({
    sendAllowed: false,
    status: 'attention_denied',
    reason: 'daily_budget'
  });
  const result = await run(d);
  expect(result.success).toBe(true);
  expect(d.send).toHaveBeenCalledTimes(1);
  expect(d.send.mock.calls[0][1]).not.toContain('?');
  expect(work.prepareForMorning).not.toHaveBeenCalled();
});
