// The triage pass: collect a user's inbox and open work items, apply the never-auto
// guardrails, ask the decision gateway, pre-do only the safe things, draft replies and
// write the card queue. One pass per username at a time (in-process).
//
// Safety rules carried here:
// - Dry run never archives or completes anything; it logs `dryRun: true` and cards the item.
// - Only an unblocked, confident archive and a guardrail auto-close are ever pre-done.
// - A permission rejection from the mailbox stops every later mailbox write in the pass.
// - A failed, denied or conflicting pre-do turns the item into a card; it is not retried.
// - An item already carded or logged at the same version is not looked at again.
import { itemFromMail, itemFromWork, cardIdFor } from '../domain/triageItem.mjs';
import { emailGuardrails, todoAutoClose } from '../domain/guardrails.mjs';
import { MAILBOX_SCOPE_MISSING } from '../ports/IMailbox.mjs';
import { classifyEmail } from './classifyEmail.mjs';
import { classifyTodo } from './classifyTodo.mjs';
import { draftReply as defaultDraftReply } from './draftReply.mjs';

const DAY_MS = 86400000;
const LOG_LOOKBACK_DAYS = 90;
const OPEN = new Set(['open', 'in_progress', 'paused']);
const SYSTEM_JOB = 'triage-overnight';

const seenKey = (itemId, version) => `${itemId}@${version}`;
const isScope = (err) => err?.code === MAILBOX_SCOPE_MISSING;
const replySubject = (s) => (/^re:/i.test(String(s ?? '').trim()) ? String(s).trim() : `Re: ${String(s ?? '').trim()}`);

function display(item) {
  const f = item.facts ?? {};
  if (item.kind === 'email') {
    return { title: f.subject ?? '', from: { name: f.from?.name ?? '', address: f.from?.address ?? '' },
      snippet: f.snippet ?? '', at: Number.isFinite(f.receivedAt) ? f.receivedAt : null, threadId: f.threadId ?? null };
  }
  return { title: f.title ?? '', snippet: typeof f.description === 'string' ? f.description.slice(0, 280) : '',
    due: f.due ?? null, at: Number.isFinite(f.modifiedAt) ? f.modifiedAt : (f.createdAt ?? null), url: f.url ?? null };
}

export function createRunTriagePass({
  mailbox = null, work = null, store, decisionGateway = null, aiGateway = null,
  resolvePolicy, ownerName = () => '', draftReply = defaultDraftReply,
  clock = () => Date.now(), nextId = () => globalThis.crypto.randomUUID(), logger = null,
}) {
  if (!store || typeof resolvePolicy !== 'function') throw new TypeError('RunTriagePass requires store and resolvePolicy');
  const running = new Map();
  const evaluate = (state, questions, opts) => {
    if (typeof decisionGateway?.evaluate !== 'function') throw new Error('decision gateway unavailable');
    return decisionGateway.evaluate(state, questions, opts);
  };

  async function collectEmail(username, policy, ctx) {
    if (!mailbox) { logger?.info?.('triage.pass.email_skipped', { username, reason: 'mailbox_unavailable' }); return null; }
    try {
      const messages = await mailbox.listInbox(username, { newerThanDays: policy.inboxWindowDays, max: policy.inboxMax });
      return messages.map(itemFromMail);
    } catch (err) {
      if (isScope(err)) ctx.mailbox = 'reconnect_needed';
      logger?.warn?.('triage.pass.inbox_unavailable', { username, error: err?.message, code: err?.code ?? null });
      return null;
    }
  }

  async function collectTodos(username, asOf) {
    if (typeof work?.context?.actionableItems !== 'function') {
      logger?.info?.('triage.pass.todos_skipped', { username, reason: 'work_unavailable' });
      return null;
    }
    try {
      const view = await work.context.actionableItems({ username, asOf });
      const rows = (view?.items ?? []).filter((r) => OPEN.has(r?.item?.status?.category));
      return {
        complete: view?.coverage?.complete === true,
        rows: rows.map((r) => ({ item: itemFromWork(r.item), domainId: r.domainId, operations: new Set(r.operations ?? []) })),
      };
    } catch (err) {
      logger?.warn?.('triage.pass.todos_unavailable', { username, error: err?.message, code: err?.code ?? null });
      return null;
    }
  }

  async function knownSender(username, facts, cache) {
    if (facts?.automated || !facts?.from?.address) return 0;
    const address = String(facts.from.address).toLowerCase();
    if (!cache.has(address)) {
      cache.set(address, (async () => {
        try {
          return (await mailbox.senderHistory(username, address))?.sentToCount ?? 1;
        } catch (err) {
          // Fail closed: an unknown history counts as a person the owner has written to.
          logger?.warn?.('triage.pass.sender_history_failed', { username, error: err?.message });
          return 1;
        }
      })());
    }
    return cache.get(address);
  }

  async function archiveOne({ username, item, proposal, policy, ctx, passId, asOf }) {
    if (policy.mode !== 'live') {
      await ctx.appendLog({ item, action: 'archive', inverse: null, dryRun: true });
      return { ...proposal, why: `Would have archived: ${proposal.why.replace(/^Archived:\s*/, '')}` };
    }
    if (!ctx.canModify) return { ...proposal, why: 'Not archived: the mailbox needs reconnecting' };
    try {
      await mailbox.archive(username, item.ref.id);
    } catch (err) {
      if (isScope(err)) {
        ctx.canModify = false;
        ctx.mailbox = 'reconnect_needed';
        logger?.warn?.('triage.pass.mailbox_permission_missing', { username, passId });
        return { ...proposal, why: 'Not archived: the mailbox needs reconnecting' };
      }
      logger?.warn?.('triage.pass.archive_failed', { username, passId, itemId: item.id, error: err?.message });
      return { ...proposal, why: 'Not archived: the mailbox did not answer' };
    }
    ctx.preDone.archived += 1;
    await ctx.appendLog({ item, action: 'archive', inverse: { action: 'unarchive', ref: item.ref }, dryRun: false });
    logger?.debug?.('triage.pass.archived', { username, passId, itemId: item.id, at: asOf });
    return null;
  }

  async function completeOne({ username, row, proposal, policy, ctx, passId, asOf }) {
    const { item, domainId } = row;
    if (policy.mode !== 'live') {
      await ctx.appendLog({ item, action: 'complete', inverse: null, dryRun: true });
      return { ...proposal, why: `Would have closed: ${proposal.why}` };
    }
    const notClosed = (reason) => {
      logger?.warn?.('triage.pass.close_failed', { username, passId, itemId: item.id, reason });
      return { ...proposal, why: `Not closed automatically: ${proposal.why}` };
    };
    const principal = work?.principal?.system?.({ username, job: SYSTEM_JOB }) ?? null;
    if (!principal || typeof work?.decisions?.confirmSystem !== 'function') return notClosed('principal_unavailable');
    try {
      const proposed = await work.commands.propose({
        principal, asOf,
        intent: { operation: 'complete', domainId, ref: item.ref, payload: {}, expectedVersion: item.version },
      });
      if (proposed?.outcome === 'denied' || !proposed?.command) return notClosed(proposed?.reason ?? 'propose_failed');
      const { confirmationId } = await work.decisions.confirmSystem({
        principal, commandId: proposed.command.id, expectedVersion: proposed.command.expectedVersion, asOf,
      });
      const r = await work.commands.execute({ principal, commandId: proposed.command.id, confirmationId, asOf });
      if (r?.outcome !== 'applied' && r?.outcome !== 'already_applied') return notClosed(r?.reason ?? r?.outcome ?? 'failed');
      ctx.preDone.closed += 1;
      await ctx.appendLog({
        item, action: 'complete', dryRun: false,
        inverse: { action: 'reopen', ref: item.ref, payload: { domainId }, expectedVersion: r.item?.version ?? null },
      });
      logger?.debug?.('triage.pass.closed', { username, passId, itemId: item.id });
      return null;
    } catch (err) {
      return notClosed(err?.code ?? err?.message ?? 'error');
    }
  }

  async function attachDraft({ username, item, card, ctx, passId }) {
    if (!ctx.canCompose) return card;
    try {
      const { body } = await draftReply({ aiGateway, message: item.facts, ownerName: ownerName(username) });
      const draft = await mailbox.createDraft(username, {
        threadId: item.facts.threadId, to: item.facts.from?.address, subject: replySubject(item.facts.subject), body,
      });
      logger?.debug?.('triage.pass.drafted', { username, passId, itemId: item.id });
      return { ...card, draftId: draft.draftId, draftBody: body };
    } catch (err) {
      if (isScope(err)) { ctx.canCompose = false; ctx.mailbox = 'reconnect_needed'; }
      logger?.warn?.('triage.pass.draft_failed', { username, passId, itemId: item.id, error: err?.message, code: err?.code ?? null });
      return card;
    }
  }

  async function execute({ username, trigger, asOf, policy }) {
    const passId = `pass.${nextId()}`;
    logger?.info?.('triage.pass.started', { username, trigger, passId, mode: policy.mode });
    const caps = mailbox?.capabilities?.(username) ?? { read: false, modify: false, compose: false };
    const ctx = {
      mailbox: mailbox && (!caps.read || !caps.modify) ? 'reconnect_needed' : 'ok',
      canModify: caps.modify === true,
      canCompose: caps.compose === true,
      preDone: { archived: 0, closed: 0 },
      // The action (if any) already happened; a log write failure must not abort the pass,
      // and the full entry goes to the structured log so the action can still be traced and undone.
      appendLog: async ({ item, action, inverse, dryRun }) => {
        const entry = {
          id: `log.${nextId()}`, at: asOf, actor: 'system', passId, itemId: item.id, kind: item.kind, ref: item.ref,
          itemVersion: item.version, action, inverse, dryRun, undoneAt: null,
        };
        try {
          await store.appendLog(username, entry);
        } catch (err) {
          logger?.error?.('triage.pass.log_failed', { username, entry, error: err?.message });
        }
      },
    };

    const queue = await store.readQueue(username);
    const logged = await store.readLog(username, { sinceMs: asOf - LOG_LOOKBACK_DAYS * DAY_MS });
    const seen = new Set([
      ...queue.cards.map((c) => seenKey(c.itemId, c.itemVersion)),
      ...logged.map((e) => seenKey(e.itemId, e.itemVersion)),
    ]);

    const emails = await collectEmail(username, policy, ctx);
    const todos = await collectTodos(username, asOf);

    // Earlier cards: keep while their item is present and unchanged; drop when it changed or
    // vanished. When a source could not be read (or was read incompletely), its cards stay.
    const present = new Map();
    for (const it of emails ?? []) present.set(it.id, it.version);
    for (const r of todos?.rows ?? []) present.set(r.item.id, r.item.version);
    const kept = queue.cards.filter((c) => {
      if (present.has(c.itemId)) return present.get(c.itemId) === c.itemVersion;
      if (c.kind === 'email') return emails === null;
      return todos === null || !todos.complete;
    });

    const fresh = [];
    const toCard = (item, proposal, extra = {}) => ({
      cardId: cardIdFor(item.id, item.version), passId, createdAt: asOf,
      itemId: item.id, kind: item.kind, ref: item.ref, itemVersion: item.version,
      step: proposal.step, urgent: proposal.urgent === true, choices: proposal.choices, suggested: proposal.suggested,
      confidence: proposal.confidence, why: proposal.why, preDo: null, status: 'open',
      display: display(item), ...extra,
    });

    const senders = new Map();
    for (const item of emails ?? []) {
      if (seen.has(seenKey(item.id, item.version))) continue;
      const guard = emailGuardrails(item, { sentToCount: await knownSender(username, item.facts, senders) });
      const proposal = await classifyEmail({ item, guard, policy, evaluate, logger });
      logger?.debug?.('triage.pass.item', { username, passId, itemId: item.id, kind: 'email', step: proposal.step, preDo: proposal.preDo?.action ?? null, rules: guard.rules });
      let card = proposal;
      if (proposal.preDo?.action === 'archive') card = await archiveOne({ username, item, proposal, policy, ctx, passId, asOf });
      if (!card) continue;
      let built = toCard(item, card);
      if (built.step === 'reply') built = await attachDraft({ username, item, card: built, ctx, passId });
      fresh.push(built);
    }

    const openItems = (todos?.rows ?? []).map((r) => r.item);
    for (const row of todos?.rows ?? []) {
      const { item } = row;
      if (seen.has(seenKey(item.id, item.version))) continue;
      const autoClose = todoAutoClose(item, { openItems, asOf, overdueDays: policy.overdueDays });
      const proposal = await classifyTodo({ item, autoClose, evaluate, capabilities: row.operations, logger, asOf });
      logger?.debug?.('triage.pass.item', { username, passId, itemId: item.id, kind: 'todo', preDo: proposal.preDo?.action ?? null });
      let card = proposal;
      if (proposal.preDo?.action === 'complete') card = await completeOne({ username, row, proposal, policy, ctx, passId, asOf });
      if (!card) continue;
      fresh.push(toCard(item, card, { domainId: row.domainId }));
    }

    const cards = [...kept, ...fresh];
    await store.writeQueue(username, { passId, builtAt: asOf, cards });
    const open = cards.filter((c) => c.status === 'open');
    const queued = {
      unsure: open.filter((c) => c.step === 'unsure').length,
      reply: open.filter((c) => c.step === 'reply').length,
      todo: open.filter((c) => c.step === 'todo').length,
      urgent: open.filter((c) => c.urgent).length,
    };
    const summary = { passId, preDone: ctx.preDone, queued, mailbox: ctx.mailbox };
    logger?.info?.('triage.pass.completed', {
      username, trigger, passId, mode: policy.mode, mailbox: ctx.mailbox,
      archived: ctx.preDone.archived, closed: ctx.preDone.closed, newCards: fresh.length, ...queued,
      emailRead: emails !== null, todosRead: todos !== null,
    });
    return summary;
  }

  return {
    run({ username, trigger = 'manual', asOf } = {}) {
      const policy = resolvePolicy(username);
      if (!policy?.enrolled || policy.mode === 'off') {
        logger?.info?.('triage.pass.skipped', { username: username ?? null, trigger, reason: 'not_enrolled' });
        return Promise.resolve({ skipped: 'not_enrolled' });
      }
      if (running.has(username)) {
        logger?.info?.('triage.pass.skipped', { username, trigger, reason: 'already_running' });
        return Promise.resolve({ skipped: 'already_running' });
      }
      const at = Number.isFinite(asOf) ? asOf : clock();
      const p = (async () => {
        try {
          return await execute({ username, trigger, asOf: at, policy });
        } catch (err) {
          logger?.error?.('triage.pass.failed', { username, trigger, error: err?.message, code: err?.code ?? null });
          throw err;
        }
      })().finally(() => running.delete(username));
      running.set(username, p);
      return p;
    },
    isRunning: (username) => running.has(username),
  };
}

export default createRunTriagePass;
