// The owner's side of triage: the ordered card session, applying an answer to a card,
// the action log and undo.
//
// Rules carried here:
// - Every answer re-reads its item first. Gone, or at a different version than the card
//   was made from -> `conflict`, the card is set to 'conflict' and nothing is done.
// - The owner's explicit answers execute in dry run too; dry run governs only the pass's
//   unattended pre-dos.
// - Task writes go only through the work runtime, as the owner's web principal
//   (propose -> confirmWeb -> execute).
// - Every answered card writes an owner log entry (with an inverse where one exists), so
//   the pass never re-cards the item at the version it was answered at.
// - Answers and the pass share one per-user lock: an answer waits (up to answerWaitMs,
//   then 409 pass_running) for a running pass, and a pass waits for an answer in flight.
// - An action the version check cannot guard (send, create a task) is preceded by marking
//   the card 'applying'. A later answer to an 'applying' card never re-executes: it finds
//   the owner log entry for the card (-> answered) or reports `answer_in_doubt`.
// - An interpreted (free-text or voice) answer never sends a reply; the owner taps Send.
import moment from 'moment-timezone';
import { MAILBOX_SCOPE_MISSING, MAILBOX_NOT_FOUND } from '../ports/IMailbox.mjs';
import { draftReply as defaultDraftReply } from './draftReply.mjs';
import { interpretAnswer as defaultInterpret, cardChoices } from './interpretAnswer.mjs';
import { createUserLock } from './userLock.mjs';

const DAY_MS = 86400000;
const RECAP_DEFAULT_DAYS = 7;
const LOG_MAX_DAYS = 90;
const OPEN_WORK = new Set(['open', 'in_progress', 'paused']);
const CONFLICT_WORK = new Set(['WORK_SELECTION_CHANGED', 'WORK_REF_NOT_AVAILABLE']);
const TITLE_MAX = 500;
const DRAFT_EDIT_MAX = 20000;
const STEP_ORDER = ['urgent', 'recap', 'unsure', 'reply', 'todo'];
const RECAP_CHOICES = Object.freeze([{ key: 'ok', label: 'Got it' }]);
// Choices whose effect does not change the item's version, so the version check cannot
// stop a repeat: they go through the 'applying' state.
const UNGUARDED = new Set(['send', 'task', 'shrink']);
const ANSWER_WAIT_MS = 30000;

const fail = (code, message) => Object.assign(new Error(message ?? code), { code });
const replySubject = (s) => (/^re:/i.test(String(s ?? '').trim()) ? String(s).trim() : `Re: ${String(s ?? '').trim()}`);

/** Due date ('YYYY-MM-DD') for a todo answer, in the user's timezone. */
export function dueDateFor(choice, asOf, timezone) {
  const tz = timezone && moment.tz.zone(timezone) ? timezone : 'UTC';
  const today = moment.tz(asOf, tz);
  if (choice === 'push') return today.clone().add(1, 'month').startOf('month').format('YYYY-MM-DD');
  if (choice === 'do_week') {
    const wd = today.isoWeekday(); // Mon=1 .. Sun=7
    return (wd >= 5 ? today : today.clone().isoWeekday(5)).format('YYYY-MM-DD');
  }
  throw new TypeError(`no due date rule for ${choice}`);
}

export function createTriageSession({
  store, mailbox = null, work = null, aiGateway = null, resolvePolicy, undoAction = null,
  interpret = defaultInterpret, draftReply = defaultDraftReply, ownerName = () => '',
  userTimezone = () => null, clock = () => Date.now(), nextId = () => globalThis.crypto.randomUUID(), logger = null,
  lock = createUserLock(), answerWaitMs = ANSWER_WAIT_MS,
}) {
  if (!store || typeof resolvePolicy !== 'function') throw new TypeError('TriageSession requires store and resolvePolicy');

  // Shared with the pass (composition passes the same lock to both).
  const exclusive = async (username, fn) => {
    let release;
    try {
      release = await lock.acquire(username, { kind: 'answer', timeoutMs: answerWaitMs });
    } catch (err) {
      if (err?.code !== 'TRIAGE_BUSY') throw err;
      logger?.info?.('triage.card.busy', { username, holder: err.holder ?? null });
      throw Object.assign(fail('TRIAGE_BUSY'), { holder: err.holder ?? null });
    }
    try {
      return await fn();
    } finally {
      release();
    }
  };

  const served = (card) => ({
    ...card, choices: cardChoices(card), source: card.display?.source ?? null,
    ...(card.status === 'applying' ? { applying: true } : {}),
  });

  // Re-read the queue right before writing and patch only this card. `remove` drops fields.
  async function patchCard(username, cardId, patch, remove = []) {
    const q = await store.readQueue(username);
    let next = null;
    const cards = q.cards.map((c) => {
      if (c.cardId !== cardId) return c;
      next = { ...c, ...patch };
      for (const k of remove) delete next[k];
      return next;
    });
    if (!next) return null;
    await store.writeQueue(username, { ...q, cards });
    return next;
  }

  async function ownerLog(username, card, { action, choice, inverse, itemVersion, asOf }) {
    const entry = {
      id: `log.${nextId()}`, at: asOf, actor: 'owner', passId: card.passId ?? null, cardId: card.cardId,
      itemId: card.itemId, kind: card.kind, ref: card.ref, itemVersion: itemVersion ?? card.itemVersion,
      priorVersion: card.itemVersion, action, choice, inverse, dryRun: false, undoneAt: null,
      title: card.display?.title ?? '',
    };
    try {
      await store.appendLog(username, entry);
    } catch (err) {
      // The action already happened; keep the full entry in the structured log so it can be traced.
      logger?.error?.('triage.session.log_failed', { username, entry, error: err?.message });
    }
    return entry;
  }

  // --- recap -------------------------------------------------------------
  const readState = async (username) => (typeof store.readState === 'function' ? await store.readState(username) : null) ?? {};
  async function recapCard(username, asOf, state) {
    const since = Number.isFinite(state.recapSeenAt) ? state.recapSeenAt : asOf - RECAP_DEFAULT_DAYS * DAY_MS;
    const rows = (await store.readLog(username, { sinceMs: since }))
      .filter((e) => e.at > since && e.actor === 'system' && e.dryRun !== true);
    if (rows.length === 0) return null;
    const entries = rows.map((e) => ({
      entryId: e.id, at: e.at, action: e.action, kind: e.kind ?? null, title: e.title ?? '',
      uncertain: e.uncertain === true, undoneAt: e.undoneAt ?? null, undoable: !!e.inverse && !e.undoneAt,
    }));
    return {
      cardId: 'recap', kind: 'recap', step: 'recap', status: 'open', choices: RECAP_CHOICES.map((c) => ({ ...c })),
      suggested: 'ok', why: 'Done for you since your last session', source: null,
      counts: {
        archived: rows.filter((e) => e.action === 'archive' && !e.uncertain).length,
        closed: rows.filter((e) => e.action === 'complete' && !e.uncertain).length,
        kept: rows.filter((e) => e.action === 'keep').length,
      },
      entries,
    };
  }

  // --- version check -----------------------------------------------------
  /** -> { ok: true, current } | { outcome: 'conflict' } | { outcome: 'failed', reason } */
  async function recheck(username, card, asOf) {
    if (card.kind === 'email') {
      if (!mailbox) return { outcome: 'failed', reason: 'mailbox_unavailable' };
      let m;
      try {
        m = await mailbox.getMessage(username, card.ref?.id);
      } catch (err) {
        return { outcome: 'failed', reason: err?.code === MAILBOX_SCOPE_MISSING ? 'mailbox_permission_missing' : 'mailbox_unavailable' };
      }
      if (!m || String(m.version) !== String(card.itemVersion)) return { outcome: 'conflict' };
      return { ok: true, current: m };
    }
    if (typeof work?.context?.getItem !== 'function') return { outcome: 'failed', reason: 'work_unavailable' };
    let item;
    try {
      item = await work.context.getItem({ username, ref: card.ref, asOf });
    } catch (err) {
      return { outcome: 'failed', reason: 'work_unavailable' };
    }
    if (!item || item.version !== card.itemVersion || !OPEN_WORK.has(item.status?.category)) return { outcome: 'conflict' };
    return { ok: true, current: item };
  }

  // --- work writes -------------------------------------------------------
  async function viaWork({ auth, intent, asOf, create = false }) {
    if (typeof work?.commands?.propose !== 'function' || typeof work?.decisions?.confirmWeb !== 'function') {
      return { outcome: 'failed', reason: 'work_unavailable' };
    }
    const principal = (await work.principal?.web?.(auth)) ?? null;
    if (!principal) return { outcome: 'failed', reason: 'principal_unavailable' };
    let executing = false;
    try {
      const proposed = await work.commands.propose({ principal, intent, asOf });
      if (proposed?.outcome === 'denied') return { outcome: 'failed', reason: proposed.reason ?? 'denied' };
      if (!proposed?.command) return { outcome: 'failed', reason: 'propose_failed' };
      const { confirmationId } = await work.decisions.confirmWeb({
        principal, commandId: proposed.command.id, expectedVersion: proposed.command.expectedVersion, asOf,
      });
      executing = true;
      const r = await work.commands.execute({ principal, commandId: proposed.command.id, confirmationId, asOf });
      if (r?.outcome === 'applied' || r?.outcome === 'already_applied') return { outcome: 'applied', result: r };
      if (r?.outcome === 'conflict') return { outcome: 'conflict' };
      // 'uncertain' may have landed.
      return { outcome: 'failed', reason: r?.reason ?? r?.outcome ?? 'failed', ...(r?.outcome === 'uncertain' ? { inDoubt: true } : {}) };
    } catch (err) {
      if (!create && CONFLICT_WORK.has(err?.code)) return { outcome: 'conflict' };
      // A throw once execute started may have landed.
      return { outcome: 'failed', reason: err?.code ?? err?.message ?? 'error', ...(executing ? { inDoubt: true } : {}) };
    }
  }

  async function taskDestination(username, domainId, asOf) {
    if (typeof work?.context?.execute !== 'function') return null;
    try {
      const view = await work.context.execute({ username, domainIds: [domainId], asOf });
      const rows = (view?.containers ?? []).filter((c) => c?.ref?.kind === 'container');
      return rows.length === 1 ? rows[0].ref.id : null;
    } catch (err) {
      logger?.warn?.('triage.session.destination_unavailable', { username, domainId, error: err?.message });
      return null;
    }
  }

  // --- mailbox draft helpers ---------------------------------------------
  // Writes `body` to the card's mailbox draft (creating one when it has none or it was
  // deleted). Returns the draft id.
  async function ensureDraft(username, card, body, { update }) {
    if (card.draftId && update) {
      try {
        await mailbox.updateDraft(username, card.draftId, { body });
        return card.draftId;
      } catch (err) {
        if (err?.code !== MAILBOX_NOT_FOUND) throw err;
        logger?.info?.('triage.session.draft_gone', { username, cardId: card.cardId });
      }
    } else if (card.draftId) {
      return card.draftId;
    }
    const d = card.display ?? {};
    const created = await mailbox.createDraft(username, {
      threadId: d.threadId ?? undefined, to: d.from?.address, subject: replySubject(d.title), body,
    });
    return created.draftId;
  }

  const mailFailure = (err) => (err?.code === MAILBOX_SCOPE_MISSING
    ? { outcome: 'failed', reason: 'mailbox_permission_missing' }
    : { outcome: 'failed', reason: err?.code ?? err?.message ?? 'error' });

  // --- applying a choice -------------------------------------------------
  async function applyEmail({ username, card, choice, draftBody, current, auth, asOf, policy }) {
    if (choice === 'keep') {
      return { outcome: 'applied', log: { action: 'keep', inverse: null } };
    }
    if (choice === 'archive') {
      try {
        const r = await mailbox.archive(username, card.ref.id);
        return { outcome: 'applied', log: { action: 'archive', inverse: { action: 'unarchive', ref: card.ref }, itemVersion: r?.version || undefined } };
      } catch (err) {
        if (err?.code === MAILBOX_NOT_FOUND) return { outcome: 'conflict' };
        return mailFailure(err);
      }
    }
    if (choice === 'reply') {
      let body = card.draftBody;
      if (!body) {
        try {
          const d = card.display ?? {};
          ({ body } = await draftReply({ aiGateway, message: { from: d.from, subject: d.title, snippet: d.snippet }, ownerName: ownerName(username) }));
        } catch (err) {
          logger?.warn?.('triage.session.draft_failed', { username, cardId: card.cardId, error: err?.message });
          return { outcome: 'failed', reason: 'draft_unavailable' };
        }
      }
      return { outcome: 'draft_updated', patch: { step: 'reply', draftBody: body } };
    }
    if (choice === 'send') {
      const body = draftBody ?? card.draftBody;
      if (!body && !card.draftId) return { outcome: 'failed', reason: 'no_draft' };
      let draftId;
      try {
        draftId = await ensureDraft(username, card, body, { update: draftBody !== undefined });
      } catch (err) {
        return mailFailure(err); // nothing sent
      }
      try {
        await mailbox.sendDraft(username, draftId);
      } catch (err) {
        // A permission rejection or a vanished draft did not send; anything else may have.
        const sure = err?.code === MAILBOX_SCOPE_MISSING || err?.code === MAILBOX_NOT_FOUND;
        return { ...mailFailure(err), ...(sure ? {} : { inDoubt: true }), patch: { draftId } };
      }
      return { outcome: 'applied', log: { action: 'send', inverse: null }, patch: { draftId, ...(body ? { draftBody: body } : {}) } };
    }
    if (choice === 'task') {
      const domainId = policy.taskDomain ?? 'personal';
      const containerId = await taskDestination(username, domainId, asOf);
      if (!containerId) return { outcome: 'failed', reason: 'task_destination_unavailable' };
      const d = card.display ?? {};
      const from = d.from?.address ? `From: ${d.from.name ? `${d.from.name} ` : ''}<${d.from.address}>` : '';
      const description = [d.url ?? current?.url ?? '', from, d.snippet ?? ''].filter(Boolean).join('\n\n');
      const title = (String(d.title ?? '').trim() || '(no subject)').slice(0, TITLE_MAX);
      const r = await viaWork({ auth, asOf, create: true, intent: {
        operation: 'create_task', domainId, ref: null,
        payload: { title, containerId, ...(description ? { description } : {}) },
      } });
      if (r.outcome !== 'applied') return r;
      // Nothing to reverse cleanly yet: undo of a created task is not offered (inverse null).
      return { outcome: 'applied', log: { action: 'create_task', inverse: null } };
    }
    throw fail('TRIAGE_INVALID_ANSWER', `unknown email choice ${choice}`);
  }

  async function applyTodo({ username, card, choice, text, current, auth, asOf }) {
    const domainId = card.domainId;
    const postVersion = (r) => r.result?.item?.version ?? null;
    if (choice === 'drop') {
      const r = await viaWork({ auth, asOf, intent: { operation: 'complete', domainId, ref: card.ref, payload: {}, expectedVersion: card.itemVersion } });
      if (r.outcome !== 'applied') return r;
      const v = postVersion(r);
      return { outcome: 'applied', log: { action: 'complete', itemVersion: v ?? undefined,
        inverse: { action: 'reopen', ref: card.ref, payload: { domainId }, expectedVersion: v } } };
    }
    if (choice === 'push' || choice === 'do_week') {
      const tz = userTimezone(username);
      const dueDate = dueDateFor(choice, asOf, tz);
      // The work layer sets a date only: undo restores the prior date (a timed due keeps its
      // day, not its time; a recurrence is not restored). The full prior due is kept.
      const d = current?.due ?? null;
      const zone = tz && moment.tz.zone(tz) ? tz : 'UTC';
      const prior = d?.date ?? (Number.isFinite(d?.at) ? moment.tz(d.at, zone).format('YYYY-MM-DD') : null);
      const priorDue = d ? { date: d.date ?? null, at: Number.isFinite(d.at) ? d.at : null, recurring: d.recurring === true } : null;
      const r = await viaWork({ auth, asOf, intent: { operation: 'update_task', domainId, ref: card.ref, payload: { dueDate }, expectedVersion: card.itemVersion } });
      if (r.outcome !== 'applied') return r;
      const v = postVersion(r);
      return { outcome: 'applied', log: { action: 'update_task', itemVersion: v ?? undefined,
        inverse: { action: 'update_task', ref: card.ref, payload: { domainId, dueDate: prior, priorDue }, expectedVersion: v } } };
    }
    if (choice === 'shrink') {
      const title = String(text ?? '').trim().slice(0, TITLE_MAX);
      const containerId = current?.containerRef?.id;
      if (!containerId) return { outcome: 'failed', reason: 'task_destination_unavailable' };
      const r = await viaWork({ auth, asOf, create: true, intent: { operation: 'create_task', domainId, ref: null, payload: { title, containerId } } });
      if (r.outcome !== 'applied') return r;
      // The original stays open; the new step has no clean inverse yet (inverse null).
      return { outcome: 'applied', log: { action: 'create_task', inverse: null } };
    }
    throw fail('TRIAGE_INVALID_ANSWER', `unknown todo choice ${choice}`);
  }

  // --- answer -------------------------------------------------------------
  async function answerOne({ username, cardId, choice, text, draft, auth }) {
    const asOf = clock();
    const policy = resolvePolicy(username) ?? {};

    if (cardId === 'recap') {
      if (choice !== 'ok') throw fail('TRIAGE_INVALID_ANSWER', 'recap takes ok');
      const state = (typeof store.readState === 'function' ? await store.readState(username) : null) ?? {};
      await store.writeState(username, { ...state, recapSeenAt: asOf });
      logger?.info?.('triage.card.answered', { username, kind: 'recap', choice: 'ok', outcome: 'applied' });
      return { outcome: 'applied', card: null };
    }

    const queue = await store.readQueue(username);
    const card = queue.cards.find((c) => c.cardId === cardId);
    if (!card) throw fail('TRIAGE_CARD_NOT_FOUND');
    if (card.status === 'applying') return resolveApplying(username, card);
    if (card.status !== 'open') throw Object.assign(fail('TRIAGE_CARD_NOT_OPEN'), { status: card.status });

    const keys = new Set(cardChoices(card).map((c) => c.key));
    const reply = card.kind === 'email' && card.step === 'reply';
    let draftBody;
    if (draft !== undefined && draft !== null) {
      if (!reply || typeof draft.body !== 'string' || !draft.body.trim()) throw fail('TRIAGE_INVALID_ANSWER', 'draft needs a reply card and a body');
      draftBody = draft.body.slice(0, DRAFT_EDIT_MAX);
    }
    const done = (outcome, extra = {}, next = card) => {
      logger?.info?.('triage.card.answered', { username, cardId, kind: card.kind, choice: choice ?? null, outcome, reason: extra.reason });
      return { outcome, ...extra, card: next ? served(next) : null };
    };

    if (choice !== undefined && choice !== null && !keys.has(choice)) throw fail('TRIAGE_INVALID_ANSWER', `choice ${choice} not offered`);
    if (!choice && typeof text === 'string' && text.trim()) {
      const read = await interpret({ aiGateway, card, text, logger });
      if (read?.choice === 'send') {
        // Sending is irreversible: an interpreted answer never sends. The owner taps Send.
        return done('skipped', { interpreted: 'send' });
      } else if (read?.choice && keys.has(read.choice)) {
        choice = read.choice;
        // A smaller next step keeps the owner's words (the model's short title if it gave one).
        text = choice === 'shrink' ? (read.stepTitle ?? text) : undefined;
      } else if (read?.draftEdit && reply) {
        draftBody = read.draftEdit;
      } else {
        return done('skipped', { unclear: true });
      }
    }
    if (choice === 'shrink' && !(typeof text === 'string' && text.trim())) return done('skipped', { needsText: true });

    // Draft edit only: no action on the message, so no version check.
    if (!choice) {
      if (draftBody === undefined) throw fail('TRIAGE_INVALID_ANSWER', 'nothing to apply');
      if (!mailbox) return done('failed', { reason: 'mailbox_unavailable' });
      let draftId = card.draftId ?? null;
      if (draftId) {
        try {
          draftId = await ensureDraft(username, card, draftBody, { update: true });
        } catch (err) {
          return done('failed', { reason: mailFailure(err).reason });
        }
      }
      const next = await patchCard(username, cardId, { draftBody, ...(draftId ? { draftId } : {}) });
      return done('draft_updated', {}, next ?? card);
    }

    const check = await recheck(username, card, asOf);
    if (check.outcome === 'conflict') {
      const next = await patchCard(username, cardId, { status: 'conflict', answeredAt: asOf, answer: { choice } });
      logger?.info?.('triage.card.conflict', { username, cardId, kind: card.kind, choice });
      return done('conflict', {}, next ?? card);
    }
    if (!check.ok) return done('failed', { reason: check.reason });

    // The version check cannot stop a repeat of these: mark the card first (a failed write
    // here means nothing was done).
    const unguarded = UNGUARDED.has(choice);
    if (unguarded) await patchCard(username, cardId, { status: 'applying', applyingAt: asOf, answer: { choice }, applyingAction: choice === 'send' ? 'send' : 'create_task' });

    const r = card.kind === 'email'
      ? await applyEmail({ username, card, choice, draftBody, current: check.current, auth, asOf, policy })
      : await applyTodo({ username, card, choice, text, current: check.current, auth, asOf });

    if (unguarded && r.outcome !== 'applied') {
      if (r.inDoubt) {
        // It may have happened: leave the card 'applying' for the owner, never retry.
        if (r.patch) await patchCard(username, cardId, r.patch).catch(() => {});
        logger?.warn?.('triage.card.in_doubt', { username, cardId, kind: card.kind, choice, reason: r.reason });
        return done('failed', { reason: r.reason, inDoubt: true }, { ...card, ...(r.patch ?? {}), status: 'applying' });
      }
      await patchCard(username, cardId, { status: 'open', ...(r.patch ?? {}) }, ['applyingAt', 'applyingAction', 'answer']);
    }

    if (r.outcome === 'conflict') {
      const next = await patchCard(username, cardId, { status: 'conflict', answeredAt: asOf, answer: { choice } });
      logger?.info?.('triage.card.conflict', { username, cardId, kind: card.kind, choice });
      return done('conflict', {}, next ?? card);
    }
    if (r.outcome === 'failed') return done('failed', { reason: r.reason }, { ...card, ...(r.patch ?? {}) });
    if (r.outcome === 'draft_updated') {
      const next = await patchCard(username, cardId, r.patch);
      return done('draft_updated', {}, next ?? card);
    }
    const entry = await ownerLog(username, card, { ...r.log, choice, asOf });
    const next = await patchCard(username, cardId, {
      ...(r.patch ?? {}), status: 'answered', answeredAt: asOf, answer: { choice }, logEntryId: entry.id,
    }, ['applyingAt', 'applyingAction']);
    return done('applied', { entryId: entry.id }, next ?? card);
  }

  // A card left 'applying' (the effect ran, or may have, but the card was not marked
  // answered). Never re-executed: the owner log decides.
  async function resolveApplying(username, card) {
    const since = Number.isFinite(card.applyingAt) ? card.applyingAt : 0;
    const hit = (await store.readLog(username, { sinceMs: since }))
      .find((e) => e.cardId === card.cardId && e.actor === 'owner');
    if (!hit) {
      logger?.warn?.('triage.card.in_doubt', { username, cardId: card.cardId, kind: card.kind, choice: card.answer?.choice ?? null });
      throw Object.assign(fail('TRIAGE_ANSWER_IN_DOUBT'), { status: 'applying' });
    }
    const next = await patchCard(username, card.cardId, { status: 'answered', answeredAt: hit.at, logEntryId: hit.id }, ['applyingAt', 'applyingAction']);
    logger?.info?.('triage.card.answered', { username, cardId: card.cardId, kind: card.kind, choice: card.answer?.choice ?? null, outcome: 'applied', recovered: true });
    return { outcome: 'applied', entryId: hit.id, card: served(next ?? card) };
  }

  return {
    async summary({ username }) {
      const policy = resolvePolicy(username) ?? {};
      const q = await store.readQueue(username);
      const open = q.cards.filter((c) => c.status === 'open');
      return {
        enrolled: policy.enrolled === true, mode: policy.mode ?? 'off',
        mailbox: q.mailbox ?? null, lastPassAt: q.builtAt ?? null,
        preDone: { archived: q.preDone?.archived ?? 0, closed: q.preDone?.closed ?? 0, kept: q.preDone?.kept ?? 0 },
        mailboxName: mailbox?.displayName ?? null,
        // Dry-run cards are counted under wouldHave, not again here.
        open: {
          unsure: open.filter((c) => c.step === 'unsure' && !c.dryRunAction).length,
          reply: open.filter((c) => c.step === 'reply' && !c.dryRunAction).length,
          todo: open.filter((c) => c.step === 'todo' && !c.dryRunAction).length,
        },
        // Dry run: what the pass would have done (cards the pass marked with dryRunAction).
        wouldHave: {
          archived: open.filter((c) => c.dryRunAction === 'archive').length,
          closed: open.filter((c) => c.dryRunAction === 'close').length,
        },
        draftsReady: open.filter((c) => c.step === 'reply' && c.draftBody).length,
      };
    },

    async session({ username }) {
      const asOf = clock();
      const q = await store.readQueue(username);
      const open = q.cards.filter((c) => c.status === 'open' || c.status === 'applying');
      const order = (a, b) => (a.skippedAt ?? -1) - (b.skippedAt ?? -1) || (a.createdAt ?? 0) - (b.createdAt ?? 0);
      const isUrgent = (c) => c.kind === 'email' && c.step === 'reply' && c.urgent === true;
      const groups = {
        urgent: open.filter(isUrgent),
        recap: [],
        unsure: open.filter((c) => c.step === 'unsure'),
        reply: open.filter((c) => c.step === 'reply' && !isUrgent(c)),
        todo: open.filter((c) => c.step === 'todo'),
      };
      const state = await readState(username);
      let recap = await recapCard(username, asOf, state);
      // Dry run did nothing on its own, so the recap carries "what I would have done" counts instead.
      if (!recap && (resolvePolicy(username) ?? {}).mode === 'dryRun') {
        const seen = Number.isFinite(state.recapSeenAt) ? state.recapSeenAt : -1;
        const would = {
          archived: q.cards.filter((c) => c.status === 'open' && c.dryRunAction === 'archive').length,
          closed: q.cards.filter((c) => c.status === 'open' && c.dryRunAction === 'close').length,
        };
        if (seen < (q.builtAt ?? 0) && would.archived + would.closed > 0) {
          recap = {
            cardId: 'recap', kind: 'recap', step: 'recap', status: 'open', choices: RECAP_CHOICES.map((c) => ({ ...c })),
            suggested: 'ok', why: 'What I would have done', source: null, counts: { archived: 0, closed: 0, kept: 0 }, wouldHave: would, entries: [],
          };
        }
      }
      const cards = [];
      const steps = [];
      for (const id of STEP_ORDER) {
        const list = id === 'recap' ? (recap ? [recap] : []) : groups[id].sort(order).map(served);
        if (list.length === 0) continue;
        steps.push({ id, count: list.length });
        cards.push(...list);
      }
      // Answers since the owner acknowledged the recap, else since the queue was first built;
      // a later pass does not reset it.
      const since = Number.isFinite(state.recapSeenAt) ? state.recapSeenAt : (q.firstBuiltAt ?? q.builtAt ?? 0);
      const done = q.cards.filter((c) => (c.status === 'answered' || c.status === 'conflict') && (c.answeredAt ?? 0) >= since).length;
      logger?.info?.('triage.session.served', { username, total: cards.length + done, done, steps: steps.map((s) => `${s.id}:${s.count}`).join(',') });
      return { steps, cards, total: cards.length + done, done };
    },

    answer: (input) => exclusive(input.username, () => answerOne(input)),

    // The owner's exit for an 'applying' (in doubt) card: it did happen -> log it as the
    // normal path would and mark answered; it did not -> back to open.
    resolve: ({ username, cardId, happened }) => exclusive(username, async () => {
      const q = await store.readQueue(username);
      const card = q.cards.find((c) => c.cardId === cardId);
      if (!card) throw fail('TRIAGE_CARD_NOT_FOUND');
      if (card.status !== 'applying') throw Object.assign(fail('TRIAGE_CARD_NOT_APPLYING'), { status: card.status });
      const choice = card.answer?.choice ?? null;
      if (happened === true) {
        const asOf = clock();
        const action = card.applyingAction ?? 'create_task';
        const entry = await ownerLog(username, card, { action, choice, inverse: null, asOf });
        const next = await patchCard(username, cardId, { status: 'answered', answeredAt: asOf, logEntryId: entry.id }, ['applyingAt', 'applyingAction']);
        logger?.info?.('triage.card.resolved', { username, cardId, kind: card.kind, choice, happened: true });
        return { outcome: 'applied', entryId: entry.id, card: served(next ?? card) };
      }
      const next = await patchCard(username, cardId, { status: 'open' }, ['applyingAt', 'applyingAction', 'answer']);
      logger?.info?.('triage.card.resolved', { username, cardId, kind: card.kind, choice, happened: false });
      return { outcome: 'reopened', card: served(next ?? card) };
    }),

    skip: ({ username, cardId }) => exclusive(username, async () => {
      const q = await store.readQueue(username);
      const card = q.cards.find((c) => c.cardId === cardId);
      if (!card) throw fail('TRIAGE_CARD_NOT_FOUND');
      if (card.status !== 'open') throw Object.assign(fail('TRIAGE_CARD_NOT_OPEN'), { status: card.status });
      const next = await patchCard(username, cardId, { skippedAt: clock() });
      logger?.info?.('triage.card.skipped', { username, cardId, kind: card.kind });
      return { outcome: 'skipped', card: served(next ?? card) };
    }),

    async log({ username, sinceDays = 7 }) {
      const days = Math.min(LOG_MAX_DAYS, Math.max(1, Number.isFinite(sinceDays) ? Math.floor(sinceDays) : 7));
      const rows = await store.readLog(username, { sinceMs: clock() - days * DAY_MS });
      const entries = rows.slice().reverse().map((e) => ({
        id: e.id, at: e.at, actor: e.actor, action: e.action, kind: e.kind ?? null, title: e.title ?? '',
        dryRun: e.dryRun === true, uncertain: e.uncertain === true, undoneAt: e.undoneAt ?? null,
        undoable: !!e.inverse && !e.undoneAt && e.dryRun !== true,
      }));
      return { sinceDays: days, entries };
    },

    async undo({ username, entryId, auth }) {
      logger?.info?.('triage.undo.requested', { username, entryId });
      if (typeof undoAction?.undo !== 'function') return { outcome: 'failed', reason: 'undo_unavailable' };
      // Task inverses need the owner's web principal; mail inverses do not use it.
      const principal = (await work?.principal?.web?.(auth)) ?? null;
      return undoAction.undo({ username, entryId, principal });
    },
  };
}

export default createTriageSession;
