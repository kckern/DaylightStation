// The triage pass: collect a user's inbox and open work items, apply the never-auto
// guardrails, ask the decision gateway, pre-do only the safe things, draft replies and
// write the card queue. One pass per username at a time (in-process lock: a Map in this
// runtime; it does not span processes or hosts).
//
// Safety rules carried here:
// - Dry run never archives or completes anything; it logs `dryRun: true` and cards the item.
// - Only an unblocked, confident archive and a guardrail auto-close are ever pre-done.
// - A permission rejection from the mailbox stops every later mailbox write in the pass.
// - A failed, denied or conflicting pre-do turns the item into a card; it is not retried.
// - An item already carded or logged at the same version is not looked at again.
import { itemFromMail, itemFromWork, cardIdFor } from '../domain/triageItem.mjs';
import { emailGuardrails, todoAutoClose } from '../domain/guardrails.mjs';
import { MAILBOX_SCOPE_MISSING, MAILBOX_NOT_FOUND } from '../ports/IMailbox.mjs';
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
      ctx.dryRunLog({ item, action: 'archive' });
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

  // A close is pre-done only from a complete work read, and never takes the last copy of a
  // duplicate pair: an exact duplicate whose twin was closed (or would be, or may be) earlier
  // in this pass stays open, and so does the twin of a duplicate closed earlier in the pass.
  const refKey = (r) => JSON.stringify([r?.provider, r?.accountId, r?.kind, r?.id]);
  function closeBlocker(item, todos, autoClose, closing) {
    if (!todos.complete) return 'work data may be out of date';
    if (closing.survivors.has(refKey(item.ref))) return 'its twin is being closed';
    if (autoClose?.reason === 'exact_duplicate') {
      const twin = autoClose.duplicateOf;
      if (!twin || closing.closed.has(refKey(twin))) return 'its twin is being closed';
      // todoAutoClose only matches a twin that is open in this same read; checked again here.
      if (!todos.rows.some((r) => refKey(r.item.ref) === refKey(twin))) return 'its twin is no longer open';
    }
    return null;
  }
  const markClosing = (closing, item, autoClose) => {
    closing.closed.add(refKey(item.ref));
    if (autoClose?.reason === 'exact_duplicate' && autoClose.duplicateOf) closing.survivors.add(refKey(autoClose.duplicateOf));
  };

  async function completeOne({ username, row, proposal, policy, ctx, passId, asOf, blocker, autoClose, closing }) {
    const { item, domainId } = row;
    const notClosed = (reason) => {
      logger?.warn?.('triage.pass.close_failed', { username, passId, itemId: item.id, reason });
      return { ...proposal, why: `Not closed automatically: ${proposal.why}` };
    };
    if (blocker) return { ...notClosed(blocker), why: `Not closed automatically (${blocker}): ${proposal.why}` };
    if (policy.mode !== 'live') {
      markClosing(closing, item, autoClose);
      ctx.dryRunLog({ item, action: 'complete' });
      return { ...proposal, why: `Would have closed: ${proposal.why}` };
    }
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
      const inverse = (version) => ({ action: 'reopen', ref: item.ref, payload: { domainId }, expectedVersion: version });
      const done = r?.outcome === 'applied' || r?.outcome === 'already_applied';
      if ((done && !r.item?.version) || r?.outcome === 'uncertain') {
        markClosing(closing, item, autoClose);
        // It may have closed: leave a trail that can be undone, and keep the card.
        await ctx.appendLog({ item, action: 'complete', dryRun: false, uncertain: true, inverse: inverse(null) });
        logger?.warn?.('triage.pass.close_uncertain', { username, passId, itemId: item.id, outcome: r?.outcome, reason: r?.reason ?? null });
        return { ...proposal, why: `May have been closed: ${proposal.why}` };
      }
      if (!done) return notClosed(r?.reason ?? r?.outcome ?? 'failed');
      markClosing(closing, item, autoClose);
      ctx.preDone.closed += 1;
      await ctx.appendLog({ item, action: 'complete', dryRun: false, inverse: inverse(r.item.version) });
      logger?.debug?.('triage.pass.closed', { username, passId, itemId: item.id });
      return null;
    } catch (err) {
      return notClosed(err?.code ?? err?.message ?? 'error');
    }
  }

  // Drafts. Dry run writes nothing to the mailbox: the body stays on the card only.
  // Live with compose: one mailbox draft per item. A re-carded item gets a fresh body
  // (`regenerate`, this pass only) and its existing draft is updated (`redraft`, persisted
  // until the update lands). A draft deleted in the mailbox is replaced by a new one.
  async function draftFor({ username, card: input, policy, ctx, passId, persist }) {
    const d = input.display ?? {};
    const live = policy.mode === 'live';
    if (live && !ctx.canCompose) return input;
    let card = input;
    const fail = (err, keep) => {
      if (isScope(err)) { ctx.canCompose = false; ctx.mailbox = 'reconnect_needed'; }
      logger?.warn?.('triage.pass.draft_failed', { username, passId, itemId: card.itemId, error: err?.message, code: err?.code ?? null });
      return keep;
    };
    if (card.regenerate || !card.draftBody) {
      try {
        const { body } = await draftReply({ aiGateway, message: { from: d.from, subject: d.title, snippet: d.snippet }, ownerName: ownerName(username) });
        card = { ...card, draftBody: body, ...(card.draftId ? { redraft: true } : {}) };
      } catch (err) {
        return fail(err, input);
      }
    }
    if (!live) return card;
    if (card.draftId && card.redraft) {
      try {
        await mailbox.updateDraft(username, card.draftId, { body: card.draftBody });
        const { redraft, ...done } = card;
        logger?.debug?.('triage.pass.draft_updated', { username, passId, itemId: card.itemId });
        return persist(done, 'updated');
      } catch (err) {
        if (err?.code !== MAILBOX_NOT_FOUND) return fail(err, card); // new body kept; retried next pass
        logger?.info?.('triage.pass.draft_gone', { username, passId, itemId: card.itemId });
        const { draftId, redraft, ...rest } = card;
        card = rest;
      }
    }
    if (card.draftId) return card;
    try {
      const draft = await mailbox.createDraft(username, {
        threadId: d.threadId ?? undefined, to: d.from?.address, subject: replySubject(d.title), body: card.draftBody,
      });
      logger?.debug?.('triage.pass.drafted', { username, passId, itemId: card.itemId });
      return persist({ ...card, draftId: draft.draftId }, 'created');
    } catch (err) {
      return fail(err, card);
    }
  }

  // An email card whose message is not in this listing (outside the window or past inboxMax)
  // is kept unless the mailbox says the message left the inbox. Unknown => keep.
  // The port has no lighter lookup than getMessage (full fetch); these re-checks are few
  // (open cards outside the listing only), so that cost is accepted.
  async function stillInInbox(username, card) {
    try {
      const m = await mailbox.getMessage(username, card.ref?.id);
      return !(m === null || (Array.isArray(m.labels) && !m.labels.includes('INBOX')));
    } catch (err) {
      logger?.debug?.('triage.pass.recheck_failed', { username, itemId: card.itemId, error: err?.message });
      return true;
    }
  }

  async function execute({ username, trigger, asOf, policy }) {
    const passId = `pass.${nextId()}`;
    logger?.info?.('triage.pass.started', { username, trigger, passId, mode: policy.mode });
    const caps = mailbox?.capabilities?.(username) ?? { read: false, modify: false, compose: false };
    const pendingDryRun = [];
    const ctx = {
      mailbox: mailbox && (!caps.read || !caps.modify) ? 'reconnect_needed' : 'ok',
      canModify: caps.modify === true,
      canCompose: caps.compose === true,
      preDone: { archived: 0, closed: 0 },
      // The action (if any) already happened; a log write failure must not abort the pass,
      // and the full entry goes to the structured log so the action can still be traced and undone.
      appendLog: async ({ item, action, inverse, dryRun, uncertain }) => {
        const entry = {
          id: `log.${nextId()}`, at: asOf, actor: 'system', passId, itemId: item.id, kind: item.kind, ref: item.ref,
          itemVersion: item.version, action, inverse, dryRun, undoneAt: null, ...(uncertain ? { uncertain: true } : {}),
        };
        try {
          await store.appendLog(username, entry);
        } catch (err) {
          logger?.error?.('triage.pass.log_failed', { username, entry, error: err?.message });
        }
      },
      // Dry-run entries are written after the queue, so a failed queue write never hides a
      // "would have" item behind a log entry that marks it as seen.
      dryRunLog: ({ item, action }) => { pendingDryRun.push({ item, action, inverse: null, dryRun: true }); },
    };

    const queue = await store.readQueue(username);
    const logged = await store.readLog(username, { sinceMs: asOf - LOG_LOOKBACK_DAYS * DAY_MS });
    const seen = new Set([
      ...queue.cards.map((c) => seenKey(c.itemId, c.itemVersion)),
      ...logged.map((e) => seenKey(e.itemId, e.itemVersion)),
    ]);

    const emails = await collectEmail(username, policy, ctx);
    const todos = await collectTodos(username, asOf);

    // Earlier cards: keep while their item is present and unchanged; replace when it changed.
    // Missing from this read: an email card goes only when the mailbox says the message left
    // the inbox; a todo card goes only after a complete work read. An unread source keeps all.
    const present = new Map();
    for (const it of emails ?? []) present.set(it.id, it.version);
    for (const r of todos?.rows ?? []) present.set(r.item.id, r.item.version);
    const previous = new Map();
    const kept = [];
    for (const c of queue.cards) {
      if (present.has(c.itemId)) {
        if (present.get(c.itemId) === c.itemVersion) kept.push(c);
        else previous.set(c.itemId, c);
        continue;
      }
      if (c.kind === 'email') {
        if (emails === null) kept.push(c);
        else if ((c.status === 'open' || c.status === 'skipped') && await stillInInbox(username, c)) kept.push(c);
        continue;
      }
      if (todos === null || !todos.complete) kept.push(c);
    }

    const fresh = [];
    const toCard = (item, proposal, extra = {}) => {
      const card = {
        cardId: cardIdFor(item.id, item.version), passId, createdAt: asOf,
        itemId: item.id, kind: item.kind, ref: item.ref, itemVersion: item.version,
        step: proposal.step, urgent: proposal.urgent === true, choices: proposal.choices, suggested: proposal.suggested,
        confidence: proposal.confidence, why: proposal.why, preDo: null, status: 'open',
        display: display(item), ...extra,
      };
      // A re-carded item keeps the draft it already has (never a second mailbox draft).
      const prev = previous.get(item.id);
      if (prev?.draftId || prev?.draftBody) {
        if (prev.draftId) card.draftId = prev.draftId;
        if (prev.draftBody) card.draftBody = prev.draftBody;
        if (card.step === 'reply') card.regenerate = true;
      }
      return card;
    };

    const senders = new Map();
    for (const item of emails ?? []) {
      if (seen.has(seenKey(item.id, item.version))) continue;
      const guard = emailGuardrails(item, { sentToCount: await knownSender(username, item.facts, senders) });
      const proposal = await classifyEmail({ item, guard, policy, evaluate, logger });
      logger?.debug?.('triage.pass.item', { username, passId, itemId: item.id, kind: 'email', step: proposal.step, preDo: proposal.preDo?.action ?? null, rules: guard.rules });
      let card = proposal;
      if (proposal.preDo?.action === 'archive') card = await archiveOne({ username, item, proposal, policy, ctx, passId, asOf });
      if (!card) continue;
      fresh.push(toCard(item, card));
    }

    const openItems = (todos?.rows ?? []).map((r) => r.item);
    const closing = { closed: new Set(), survivors: new Set() };
    for (const row of todos?.rows ?? []) {
      const { item } = row;
      if (seen.has(seenKey(item.id, item.version))) continue;
      const autoClose = todoAutoClose(item, { openItems, asOf, overdueDays: policy.overdueDays });
      const proposal = await classifyTodo({ item, autoClose, evaluate, capabilities: row.operations, logger, asOf });
      logger?.debug?.('triage.pass.item', { username, passId, itemId: item.id, kind: 'todo', preDo: proposal.preDo?.action ?? null });
      let card = proposal;
      if (proposal.preDo?.action === 'complete') {
        card = await completeOne({ username, row, proposal, policy, ctx, passId, asOf, autoClose, closing,
          blocker: closeBlocker(item, todos, autoClose, closing) });
      }
      if (!card) continue;
      fresh.push(toCard(item, card, { domainId: row.domainId }));
    }

    let cards = [...kept, ...fresh];
    const strip = (list) => list.map(({ regenerate, ...c }) => c);
    // Checkpoint: the cards are durable before drafts and dry-run log entries are written.
    await store.writeQueue(username, { passId, builtAt: asOf, cards: strip(cards) });
    for (const entry of pendingDryRun) await ctx.appendLog(entry);

    // Drafts for open reply cards that lack one (including ones a crash or failure left
    // without). Each mailbox draft is persisted at once so a re-run does not make another.
    const drafts = { created: 0, updated: 0 };
    for (let i = 0; i < cards.length; i += 1) {
      const c = cards[i];
      if (c.kind !== 'email' || c.step !== 'reply' || c.status !== 'open') continue;
      const persist = async (next, how) => {
        cards[i] = next;
        drafts[how] += 1;
        try {
          await store.writeQueue(username, { passId, builtAt: asOf, cards: strip(cards) });
        } catch (err) {
          logger?.error?.('triage.pass.draft_not_recorded', { username, passId, itemId: next.itemId, draftId: next.draftId, error: err?.message });
        }
        return next;
      };
      cards[i] = await draftFor({ username, card: c, policy, ctx, passId, persist });
    }
    cards = strip(cards);
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
      archived: ctx.preDone.archived, closed: ctx.preDone.closed, newCards: fresh.length, draftsCreated: drafts.created, draftsUpdated: drafts.updated, ...queued,
      emailRead: emails !== null, todosRead: todos !== null, todosComplete: todos?.complete ?? null,
    });
    return summary;
  }

  return {
    /**
     * Runs one pass. Returns `{ passId, preDone: { archived, closed }, queued: { unsure, reply,
     * todo, urgent }, mailbox: 'ok'|'reconnect_needed' }` or `{ skipped: 'not_enrolled'|'already_running' }`.
     * `queued` counts every open card in the queue after the pass, not only the new ones.
     * The lock is in-process only (one Map per runtime): it does not span processes or hosts.
     */
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
