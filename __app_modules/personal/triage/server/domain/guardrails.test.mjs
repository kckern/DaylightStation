import { describe, it, expect } from 'vitest';
import { itemFromMail, itemFromWork } from './triageItem.mjs';
import { emailGuardrails, todoGuardrails, todoAutoClose } from './guardrails.mjs';

const DAY = 86400000;
const ASOF = Date.UTC(2026, 10, 19);
const mail = (o = {}) => itemFromMail({
  ref: { provider: 'mail-a', accountId: 'sample', kind: 'message', id: 'm1' }, threadId: 't', version: '1',
  from: { name: 'X', address: 'x@example.com' }, to: [], subject: 'Hello', snippet: '', receivedAt: 1, labels: [],
  starred: false, hasAttachments: false, automated: false, ownerRepliedInThread: false, ...o,
});
const task = (id, o = {}) => itemFromWork({
  ref: { provider: 'tasks-a', accountId: 'sample', kind: 'task', id }, title: 'Buy filters', description: null,
  status: { category: 'open', native: null }, containerRef: { id: 'list1' }, due: null, createdAt: 1000,
  modifiedAt: ASOF, version: '1', ...o,
});

describe('emailGuardrails', () => {
  it('deadline and money from an automated sender are soft, not blocks', () => {
    const r = emailGuardrails(mail({ automated: true, subject: 'Your secure sign-in link', snippet: 'This link expires in 24 hours. We charged $16.00' }), { sentToCount: 0 });
    expect(r).toEqual({ blocked: false, rules: [], soft: ['deadline', 'money'] });
  });
  it('legal, medical and school matters still block automated mail', () => {
    const r = emailGuardrails(mail({ automated: true, subject: 'Appointment reminder: due Friday' }), { sentToCount: 0 });
    expect(r.blocked).toBe(true);
    expect(r.rules).toEqual(['sensitive_topic']);
    expect(r.soft).toEqual(['deadline']);
  });
  it('deadline and money from a person still block', () => {
    expect(emailGuardrails(mail({ subject: 'Invoice $1,240 due Friday' }), { sentToCount: 0 }).blocked).toBe(true);
  });
  it('blocks invoice with amount and deadline', () => {
    expect(emailGuardrails(mail({ subject: 'Invoice $1,240 due Friday' }), { sentToCount: 0 }))
      .toEqual({ blocked: true, rules: ['deadline', 'money'], soft: [] });
  });
  it('does not block a plain shipping receipt', () => {
    const r = emailGuardrails(mail({ automated: true, from: { name: '', address: 'no-reply@shop.com' }, subject: 'Your order has shipped', snippet: 'Track your package. Thanks for shopping with us!' }), { sentToCount: 0 });
    expect(r).toEqual({ blocked: false, rules: [], soft: [] });
  });
  it('blocks known person', () => {
    expect(emailGuardrails(mail({ automated: false }), { sentToCount: 2 }).rules).toEqual(['known_person']);
  });
  it('does not treat automated sender as known person', () => {
    expect(emailGuardrails(mail({ automated: true }), { sentToCount: 3 }).rules).toEqual([]);
  });
  it('blocks starred', () => {
    expect(emailGuardrails(mail({ starred: true }), { sentToCount: 0 }).rules).toEqual(['starred']);
  });
  it('blocks parent-teacher as sensitive', () => {
    expect(emailGuardrails(mail({ subject: 'Re: Parent-teacher conference' }), { sentToCount: 0 }).rules).toContain('sensitive_topic');
  });
  it('blocks attachment from a person but not from automated', () => {
    expect(emailGuardrails(mail({ automated: false, hasAttachments: true }), { sentToCount: 0 }).rules).toEqual(['attachment_from_person']);
    expect(emailGuardrails(mail({ automated: true, hasAttachments: true }), { sentToCount: 0 }).blocked).toBe(false);
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
    expect(n.duplicateOf.title).toBe('Buy filters');
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

describe('fix round 1: inflections, stems, phrasing, fail-closed', () => {
  const hit = (text, rule) => expect(emailGuardrails(mail({ snippet: text }), {}).rules).toContain(rule);
  it.each([
    ['appointments', 'sensitive_topic'], ['contracts', 'sensitive_topic'], ['schools', 'sensitive_topic'],
    ['doctors', 'sensitive_topic'], ['billed', 'money'], ['refunded', 'money'], ['invoiced', 'money'],
    ['pediatrician visit', 'sensitive_topic'], ['pharmacy pickup', 'sensitive_topic'], ['therapy', 'sensitive_topic'],
    ['vaccine', 'sensitive_topic'], ['surgery', 'sensitive_topic'], ['custody', 'sensitive_topic'], ['divorce', 'sensitive_topic'],
    ['passport', 'sensitive_topic'], ['visa', 'sensitive_topic'], ['immigration', 'sensitive_topic'], ['police report', 'sensitive_topic'],
    ['daycare', 'sensitive_topic'], ['legal notice', 'sensitive_topic'], ['medical', 'sensitive_topic'], ['health plan', 'sensitive_topic'],
    ['rent', 'money'], ['mortgage', 'money'], ['statement ready', 'money'], ['subscription', 'money'], ['renewal', 'money'],
    ['please renew', 'deadline'], ['pay', 'money'], ['paid', 'money'], ['receipt', 'money'], ['loan', 'money'], ['bank', 'money'],
    ['credit card', 'money'], ['50 dollars', 'money'], ['12 €', 'money'], ['CHF 40', 'money'], ['AUD 9', 'money'], ['¥500', 'money'],
    ['no later than Monday', 'deadline'], ['closes tonight', 'deadline'], ['ends Friday', 'deadline'], ['before Friday', 'deadline'],
    ['today only', 'deadline'], ['within 48 hours', 'deadline'],
  ])('%s -> %s', (text, rule) => hit(text, rule));

  it.each(['Pay rent', 'Pay the plumber', 'Renew passport'])('"%s" overdue todo is never auto-closed', (title) => {
    const t = task('z', { title, due: { date: null, at: ASOF - 200 * DAY, recurring: false }, modifiedAt: ASOF - 200 * DAY });
    expect(todoGuardrails(t).blocked).toBe(true);
    expect(todoAutoClose(t, { openItems: [t.facts], asOf: ASOF, overdueDays: 60 }).eligible).toBe(false);
  });
  it('fails closed on missing item or facts', () => {
    for (const bad of [null, undefined, {}, { facts: null }]) {
      expect(emailGuardrails(bad, {})).toEqual({ blocked: true, rules: ['missing_facts'], soft: [] });
      expect(todoGuardrails(bad)).toEqual({ blocked: true, rules: ['missing_facts'] });
    }
  });
  it('tolerates missing snippet, from and description', () => {
    expect(() => emailGuardrails({ facts: { automated: true } }, {})).not.toThrow();
    expect(todoGuardrails({ facts: { title: 'Water plants' } }).blocked).toBe(false);
  });
  it('shipped notice stays unblocked', () => {
    expect(emailGuardrails(mail({ subject: 'Your order has shipped', snippet: '' }), {}).blocked).toBe(false);
  });
});

