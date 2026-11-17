import { describe, it, expect } from 'vitest';
import { HistoricalJournalEvidence } from './HistoricalJournalEvidence.mjs';
const asOf = Date.parse('2026-11-02T08:30:00Z');
const from = asOf - 90 * 86400000;
const row = (id, at, content = 'I will send the letter.') => ({
  id,
  senderId: 'author',
  timestamp: new Date(at).toISOString(),
  content
});
const make = rows => new HistoricalJournalEvidence({
  loadJournal: async () => ({
    messages: rows
  }),
  identityForUser: async () => ({
    senderId: 'author',
    conversationId: 'private'
  }),
  timezoneForUser: () => 'America/Los_Angeles'
});
const query = {
  username: 'sample',
  from,
  asOf
};
describe('bounded historical journal evidence', () => {
  it('keeps import proof stable across CLI/live identity metadata and row key ordering',async()=>{
    const original=row('entry',asOf);
    const initial=await make([original]).read(query);
    const reordered=Object.fromEntries(Object.entries(original).reverse());
    const live=new HistoricalJournalEvidence({loadJournal:async()=>({messages:[reordered]}),identityForUser:async()=>({username:'sample',senderId:'author',conversationId:'private',extra:'runtime-only'}),timezoneForUser:()=> 'America/Los_Angeles'});
    const later=await live.read(query);
    expect(later.messages[0].ref).toBe(initial.messages[0].ref);expect(later.sourceHashes).toEqual(initial.sourceHashes);
  });
  it('includes the exact rolling boundary across DST and never fabricates verification', async () => {
    const result = await make([row('old', from - 1), row('boundary', from), row('recent', asOf), row('future', asOf + 1)]).read(query);
    expect(result.messages.map(m => m.messageId)).toEqual(['boundary', 'recent']);
    expect(result.messages.every(m => m.verified === false && m.previewOnly && m.origin === 'historical_import')).toBe(true);
    expect(result.complete).toBe(true);
    expect(Object.keys(result.sourceHashes)).toHaveLength(2);
  });
  it('excludes bots, other senders and unverified provider receipts', async () => {
    const result = await make([{
      ...row('bot', asOf),
      role: 'assistant'
    }, {
      ...row('stranger', asOf),
      senderId: 'other'
    }, {
      ...row('provider', asOf),
      source: {
        platform: 'todoist',
        verified: true
      }
    }, row('author', asOf)]).read(query);
    expect(result.messages.map(m => m.messageId)).toEqual(['author']);
  });
  it('binds evidence identity to source bytes so edits invalidate previously selected refs', async () => {
    const rows = [row('entry', asOf)],
      reader = make(rows);
    const before = await reader.read(query);
    rows[0].content = 'I sent the letter.';
    const after = await reader.read(query);
    expect(after.messages[0].ref).not.toBe(before.messages[0].ref);
    expect(after.sourceHashes).not.toEqual(before.sourceHashes);
    expect(after.messages[0].originalRef).toBe(before.messages[0].originalRef);
  });
  it('pages deterministically without losing oversized resolutions or equal-time messages', async () => {
    const rows = Array.from({
      length: 103
    }, (_, i) => row(String(i), asOf, i === 0 ? 'x'.repeat(20001) : 'A commitment.'));
    const reader = make(rows),
      first = await reader.read(query);
    expect(first.complete).toBe(false);
    expect(first.rejected.some(r => r.reason === 'oversized_message')).toBe(true);
    const second = await reader.read({
      ...query,
      cursor: first.nextCursor
    });
    expect(second.complete).toBe(true);
    expect(new Set([...first.messages, ...second.messages].map(m => m.ref)).size).toBe(102);
  });
  it('rejects invalid and overlong ranges and cursors from another range', async () => {
    const reader = make([row('one', asOf)]);
    await expect(reader.read({
      ...query,
      from: from - 1
    })).rejects.toThrow(/range/i);
    await expect(reader.read({
      ...query,
      from: NaN
    })).rejects.toThrow(/range/i);
    const first = await reader.read(query);
    await expect(reader.read({
      ...query,
      username: 'other',
      cursor: first.nextCursor
    })).rejects.toThrow(/cursor/i);
  });
});
