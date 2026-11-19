import { describe, it, expect } from 'vitest';
import { itemFromMail, itemFromWork } from './triageItem.mjs';
import { emailGuardrails, todoGuardrails, todoAutoClose } from './guardrails.mjs';

const DAY = 86400000;
const ASOF = Date.UTC(2026, 10, 19);
const mail = (o = {}) => itemFromMail({
  ref: { provider: 'gmail', accountId: 'sample', kind: 'message', id: 'm1' }, threadId: 't', version: '1',
  from: { name: 'X', address: 'x@example.com' }, to: [], subject: 'Hello', snippet: '', receivedAt: 1, labels: [],
  starred: false, hasAttachments: false, automated: true, ownerRepliedInThread: false, ...o,
});
const task = (id, o = {}) => itemFromWork({
  ref: { provider: 'todoist', accountId: 'sample', kind: 'task', id }, title: 'Buy filters', description: null,
  status: { category: 'open', native: null }, containerRef: { id: 'list1' }, due: null, createdAt: 1000,
  modifiedAt: ASOF, version: '1', ...o,
});

describe('emailGuardrails', () => {
  it('blocks invoice with amount and deadline', () => {
    expect(emailGuardrails(mail({ subject: 'Invoice $1,240 due Friday' }), { sentToCount: 0 }))
      .toEqual({ blocked: true, rules: ['deadline', 'money'] });
  });
  it('does not block a plain shipping receipt', () => {
    const r = emailGuardrails(mail({ from: { name: '', address: 'no-reply@shop.com' }, subject: 'Your order has shipped', snippet: 'Track your package. Thanks for shopping with us!' }), { sentToCount: 0 });
    expect(r).toEqual({ blocked: false, rules: [] });
  });
  it('blocks known person', () => {
    expect(emailGuardrails(mail({ automated: false }), { sentToCount: 2 }).rules).toEqual(['known_person']);
  });
  it('does not treat automated sender as known person', () => {
    expect(emailGuardrails(mail(), { sentToCount: 3 }).rules).toEqual([]);
  });
  it('blocks starred', () => {
    expect(emailGuardrails(mail({ starred: true }), { sentToCount: 0 }).rules).toEqual(['starred']);
  });
  it('blocks parent-teacher as sensitive', () => {
    expect(emailGuardrails(mail({ subject: 'Re: Parent-teacher conference' }), { sentToCount: 0 }).rules).toContain('sensitive_topic');
  });
  it('blocks attachment from a person but not from automated', () => {
    expect(emailGuardrails(mail({ automated: false, hasAttachments: true }), { sentToCount: 0 }).rules).toEqual(['attachment_from_person']);
    expect(emailGuardrails(mail({ hasAttachments: true }), { sentToCount: 0 }).blocked).toBe(false);
  });
  it('blocks replied thread', () => {
    expect(emailGuardrails(mail({ ownerRepliedInThread: true }), { sentToCount: 0 }).rules).toEqual(['replied_thread']);
  });
  it('detects deadline phrasing and currencies', () => {
    expect(emailGuardrails(mail({ snippet: 'Please respond by tomorrow' }), {}).rules).toContain('deadline');
    expect(emailGuardrails(mail({ snippet: 'Reminder: pickup' }), {}).rules).toContain('deadline');
    expect(emailGuardrails(mail({ snippet: 'Total USD 12' }), {}).rules).toContain('money');
    expect(emailGuardrails(mail({ snippet: 'You owe £3.50' }), {}).rules).toContain('money');
  });
  it('is word-boundary aware', () => {
    expect(emailGuardrails(mail({ subject: 'Please see the dueling pianos' }), {}).blocked).toBe(false);
  });
});

describe('todos', () => {
  it('closes the newer exact duplicate only', () => {
    const older = task('a', { createdAt: 1000 });
    const newer = task('b', { title: '  buy   FILTERS ', createdAt: 2000 });
    const open = [older.facts, newer.facts];
    const n = todoAutoClose(newer, { openItems: open, asOf: ASOF, overdueDays: 60 });
    expect(n).toMatchObject({ eligible: true, reason: 'exact_duplicate' });
    expect(n.duplicateOf.id).toBe('a');
    expect(todoAutoClose(older, { openItems: open, asOf: ASOF, overdueDays: 60 }).eligible).toBe(false);
  });
  it('does not dedupe across containers or closed tasks', () => {
    const a = task('a'); const b = task('b', { createdAt: 2000, containerRef: { id: 'other' } });
    expect(todoAutoClose(b, { openItems: [a.facts, b.facts], asOf: ASOF, overdueDays: 60 }).eligible).toBe(false);
    const c = task('c', { createdAt: 3000 }); const d = task('d', { status: { category: 'done' } });
    expect(todoAutoClose(c, { openItems: [d.facts, c.facts], asOf: ASOF, overdueDays: 60 }).eligible).toBe(false);
  });
  it('recurring 200 days overdue is not eligible', () => {
    const t = task('r', { title: 'Water plants', due: { date: null, at: ASOF - 200 * DAY, recurring: true }, modifiedAt: ASOF - 200 * DAY });
    expect(todoAutoClose(t, { openItems: [t.facts], asOf: ASOF, overdueDays: 60 }).eligible).toBe(false);
  });
  it('61 days overdue but modified 3 days ago is not eligible', () => {
    const t = task('o', { title: 'Water plants', due: { date: null, at: ASOF - 61 * DAY, recurring: false }, modifiedAt: ASOF - 3 * DAY });
    expect(todoAutoClose(t, { openItems: [t.facts], asOf: ASOF, overdueDays: 60 }).eligible).toBe(false);
  });
  it('long overdue and untouched is eligible', () => {
    const t = task('o', { title: 'Water plants', due: { date: null, at: ASOF - 61 * DAY, recurring: false }, modifiedAt: ASOF - 61 * DAY });
    expect(todoAutoClose(t, { openItems: [t.facts], asOf: ASOF, overdueDays: 60 })).toEqual({ eligible: true, reason: 'long_overdue' });
  });
  it('"Pay property tax" never auto-closes', () => {
    const t = task('p', { title: 'Pay property tax', due: { date: null, at: ASOF - 200 * DAY, recurring: false }, modifiedAt: ASOF - 200 * DAY });
    expect(todoGuardrails(t).blocked).toBe(true);
    expect(todoAutoClose(t, { openItems: [t.facts], asOf: ASOF, overdueDays: 60 }).eligible).toBe(false);
  });
  it('item id is sha256 of canonical ref', () => {
    expect(task('a').id).toMatch(/^[0-9a-f]{64}$/);
    expect(task('a').id).toBe(task('a').id);
  });
});
