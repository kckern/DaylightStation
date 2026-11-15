export const TZ = 'America/Los_Angeles';
export const AS_OF = Date.parse('2026-11-03T15:00:00Z');
export function evidence(overrides = {}) {
  return { ref: 'journalist:msg:source-1', sourceId: 'source-1', conversationId: 'private-sample', messageId: 'message-10',
    at: Date.parse('2026-11-02T17:00:00Z'), localDate: '2026-11-02', content: 'I will contact Sample on Monday',
    senderId: 'sender-sample', verified: true, previewOnly: false, senderMatchesConfiguredUser: true, source: 'user', ...overrides };
}
export function loop(overrides = {}) {
  return { schema: 'lifelog-knowledge/v1', id: 'loop.application-reply', kind: 'loop', title: 'Sample reply', status: 'open',
    created: { at: Date.parse('2026-10-26T17:00Z'), sourceAt: Date.parse('2026-10-26T16:00Z'), by: 'extractor@v1' },
    touched: '2026-11-02', links: [], pinned: [], user_edits: [], sensitivity: 'normal', ask_policy: 'normal',
    evidence: [{ ref: 'journalist:msg:source-old', date: '2026-10-26', quote: 'I will wait for a reply', source: 'user' }],
    loop: { kind_of: 'status', due: '2026-11-02', ask: { eligible_from: '2026-11-03', cooldown_days: 7, max_asks: 2 }, stakes: 3, answer: null }, ...overrides };
}
export function snapshot(objects = {}, overrides = {}) {
  return { revision: 1, objects, asks: [], quiz: [], state: { processedProposalIds: [], pendingReviews: [] },
    health: { available: true, conflicted: false, recovering: false, lastSweepAt: AS_OF, reason: null }, ...overrides };
}
export function proposal(overrides = {}) {
  return { id: 'proposal-1', op: 'open_loop', target: 'loop.application-reply', evidenceRef: 'journalist:msg:source-1',
    quote: 'I will contact Sample on Monday', fields: { title: 'Contact Sample', kind_of: 'status', dueText: 'Monday', stakes: 3 }, ...overrides };
}
export function ask(overrides = {}) {
  return { id: 'ask-1', objectId: 'loop.application-reply', channel: 'morning', askDate: '2026-10-27',
    deliveredAt: Date.parse('2026-10-27T14:00Z'), botMessageId: 'bot-1', response: null, ...overrides };
}
