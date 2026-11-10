import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketSubscription } from '../../../../../frontend/src/hooks/useWebSocket.js';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { readBank, passFromBank, offersFromBank } from './earlyPass.js';

const REFRESH_MS = 15000;
// The bank is read far less often than the entitlement: the pass changes only
// when someone buys or spends one, and every buy or spend ends in an explicit
// `refresh()`. The slow timer catches a purchase made elsewhere.
const BANK_REFRESH_MS = 60000;
// The refresh causes that re-read the bank even when nothing else changed.
// An explicit `refresh()` (no cause, or an event object) is one of them.
const BANK_CAUSES = new Set(['explicit', 'visible', 'bank-timer']);
const UNLOCKED_STATES = new Set(['complete', 'no_work_today']);

export function completionAllowsGames(state) {
  return UNLOCKED_STATES.has(state);
}

export function activePianoGamesDecision(payload, at = Date.now()) {
  return (payload?.items ?? [])
    .filter((item) => item?.capabilityId === 'piano.games'
      && item?.subject?.kind === 'learner'
      && item?.period?.kind === 'interval'
      && /^school-day:\d{4}-\d{2}-\d{2}$/.test(item.period.id ?? '')
      && Number.isFinite(item.period.startsAt)
      && Number.isFinite(item.period.endsAt)
      && at >= item.period.startsAt && at < item.period.endsAt)
    .sort((left, right) => right.period.startsAt - left.period.startsAt)[0] ?? null;
}

function completionStateForDecision(decision) {
  if (!decision || decision.degraded || decision.basisState === 'indeterminate') return 'indeterminate';
  return decision.decision === 'granted' ? 'complete' : 'incomplete';
}

/**
 * Resolve whether the active piano player may enter Games.
 *
 * The `piano.games` entitlement is purely derived and can reopen during a day,
 * so this is not a one-shot fetch. It refreshes on State Gates events, while
 * mounted, and when the tab becomes visible. Guest has no roster-backed
 * identity; Guest, a missing identity, and a failed read all stay closed.
 *
 * THE EARLY PASS (school economy slice 1). After a real `incomplete` — a
 * verdict, never `indeterminate` or a failed read — the hook reads the
 * learner's economy bank. An active `piano.games` pass opens Games for one
 * game: `{ unlocked: true, via: 'pass', pass }`. A locked `incomplete` result
 * carries `pass` and `offers` (the `piano.games` quote rows) so the lock
 * screen can sell one. A failed bank read leaves the lock exactly as it was:
 * the pass can open the gate, never close it, and never turn a verdict into
 * an error. Other results carry `pass: null, offers: []`.
 *
 * The bank is NOT read on the 15s entitlement poll. It is read on the edge
 * into `incomplete`, when the tab becomes visible, on an explicit `refresh()`,
 * and on a 60s timer; between those the last answer is reused. Never while
 * `pauseBankReads.current` is true (Games sets it while a pass game is on
 * screen, which must not be yanked by its own consume).
 */
export default function useSchoolGameAccess(learnerId, { schoolLearner, pauseBankReads = null } = {}) {
  const guest = learnerId === 'guest';
  // `false` is the only value that opts a subject OUT. `undefined` is the
  // roster not having answered yet, and an unanswered roster must keep the gate
  // shut — otherwise racing the roster fetch is a reliable unlock.
  const notGated = schoolLearner === false && !guest && Boolean(learnerId);
  const requestGeneration = useRef(0);
  // THE VERDICT WAS UNLOGGED UNTIL 2026-08-28. Only `read-failed` ever emitted,
  // so a successful read that UNLOCKED games left no trace at all — and on
  // 2026-08-28 that is the case that mattered: a child with unfinished work sat
  // in front of an open games menu and the logs could not say whether the gate
  // had been consulted, what it answered, or which learner it answered for.
  // (The cause was upstream — `GetLearnerDayCompletion` passes
  // `assignedPrograms: false`, so a learner whose whole plan is assigned
  // programs reads `no_work_today` — but nothing on the kiosk side could have
  // shown that.)
  //
  // Edge-triggered on (learner, state, unlocked): the hook refreshes every 15s
  // and a line per refresh would be ~240/hour per kiosk. A transition is the
  // only interesting moment, and it is exactly what a "why were games open?"
  // query needs.
  const lastVerdict = useRef(null);
  // The pass id the last `pass-active` line named. Edge-triggered like the
  // verdict, for the same 15s-refresh reason.
  const lastPassActive = useRef(null);
  // The last bank answer and the state it was read under, per learner.
  const bankCache = useRef(null);
  const lastState = useRef(null);
  const pauseRef = useRef(pauseBankReads);
  pauseRef.current = pauseBankReads;
  const [snapshot, setSnapshot] = useState(() => (notGated
    ? { learnerId, status: 'ready', state: 'not_gated', unlocked: true }
    : { learnerId, status: guest ? 'locked' : 'loading', state: null, unlocked: false }));

  // Shared by both verdict paths. The wrap is not decoration: this sits inside
  // the try that turns a throw into `status: 'error'`, and `error` LOCKS games.
  // A logger fault would otherwise lock a child out of a reward they had
  // earned, for a reason that has nothing to do with them. The read outranks
  // the log line. Edge-triggered on (learner, state, unlocked): the hook
  // refreshes every 15s and a line per refresh would be ~240/hour per kiosk.
  const emitVerdict = useCallback((state, unlocked, basisState, via = null) => {
    const verdict = `${learnerId}:${state}:${unlocked}:${via}`;
    if (lastVerdict.current === verdict) return;
    lastVerdict.current = verdict;
    try {
      getLogger().child({ component: 'piano-school-access' }).info?.(
        'piano.school-access.verdict',
        // `state` is the field that explains the verdict, with one limit: it
        // is derived from the entitlement, so every `granted` reads `complete`
        // — School's `no_work_today` never reaches this line (ask School's
        // `/school/lifecycle/learners/:id/completion` for that). `not_gated`
        // says the gate does not cover this person at all.
        { learnerId, state, unlocked, basisState, ...(via ? { via } : {}) },
      );
    } catch { /* never let observability close a gate */ }
  }, [learnerId]);

  const emitPassActive = useCallback((pass) => {
    const passId = pass?.passId ?? null;
    if (lastPassActive.current === passId) return;
    lastPassActive.current = passId;
    if (!passId) return;
    try {
      getLogger().child({ component: 'piano-school-access' }).info?.(
        'piano.school-access.pass-active',
        { learnerId, passId, coin: pass.coin ?? null, paid: pass.paid ?? null },
      );
    } catch { /* never let observability close a gate */ }
  }, [learnerId]);

  // Only ever asked after a real `incomplete`. Returns what the lock needs,
  // or null when this read is stale. A throw is caught HERE: a failed pass
  // read must not reach the outer catch, which turns the result into `error`.
  const readPass = useCallback(async (generation) => {
    try {
      const bank = await readBank(learnerId);
      if (generation !== requestGeneration.current) return null;
      return { pass: passFromBank(bank), offers: offersFromBank(bank) };
    } catch (error) {
      if (generation !== requestGeneration.current) return null;
      try {
        getLogger().child({ component: 'piano-school-access' }).warn?.(
          'piano.school-access.pass-read-failed',
          { learnerId, error: error?.message ?? String(error) },
        );
      } catch { /* the lock stands either way */ }
      return { pass: null, offers: [] };
    }
  }, [learnerId]);

  const refresh = useCallback(async (cause = 'explicit') => {
    const why = typeof cause === 'string' ? cause : 'explicit';
    const generation = ++requestGeneration.current;
    // NOT ASKED, not merely answered favourably. State Gates enumerates gate
    // instances from evidence, so a household member School does not track has
    // no `piano.games` item at all — which read as `indeterminate`, and
    // `indeterminate` fails closed. That is the right posture for a learner
    // whose day cannot be judged and a category error for someone who was
    // never assigned a day: on 2026-09-02 it had both grown-ups permanently
    // locked out of Games and told to finish schoolwork they had never had.
    // There is no question to put to a gate whose subject it does not cover.
    if (notGated) {
      // Logged like any other verdict, and this one is an UNLOCK — the first
      // place to look when the next report says the gate let someone through.
      emitVerdict('not_gated', true, null);
      setSnapshot({ learnerId, status: 'ready', state: 'not_gated', unlocked: true });
      return;
    }
    if (!learnerId) {
      setSnapshot({ learnerId, status: 'loading', state: null, unlocked: false });
      return;
    }
    if (learnerId === 'guest') {
      setSnapshot({ learnerId, status: 'locked', state: null, unlocked: false });
      return;
    }

    try {
      const result = await DaylightAPI(
        `api/v1/entitlements?${new URLSearchParams({
          capabilityId: 'piano.games', subjectKind: 'learner',
          subjectId: learnerId, periodKind: 'interval',
        })}`,
      );
      if (generation !== requestGeneration.current) return;
      const decision = activePianoGamesDecision(result);
      const state = completionStateForDecision(decision);
      const unlocked = decision?.decision === 'granted'
        && decision.degraded !== true && decision.basisState !== 'indeterminate';
      let early = { pass: null, offers: [] };
      if (state === 'incomplete' && !unlocked) {
        const cached = bankCache.current?.learnerId === learnerId ? bankCache.current : null;
        const edge = lastState.current?.learnerId !== learnerId || lastState.current?.state !== 'incomplete';
        const paused = pauseRef.current?.current === true;
        if (!paused && (!cached || edge || BANK_CAUSES.has(why))) {
          early = await readPass(generation);
          if (!early) return;
          bankCache.current = { learnerId, ...early };
        } else if (cached) {
          early = { pass: cached.pass, offers: cached.offers };
        }
      }
      lastState.current = { learnerId, state };
      const viaPass = early.pass?.state === 'active' && Boolean(early.pass.passId);
      emitVerdict(state, unlocked || viaPass, decision?.basisState ?? null, viaPass ? 'pass' : null);
      emitPassActive(viaPass ? early.pass : null);
      setSnapshot({
        learnerId, status: 'ready', state, unlocked: unlocked || viaPass,
        ...(viaPass ? { via: 'pass' } : {}), pass: early.pass, offers: early.offers,
      });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      getLogger().child({ component: 'piano-school-access' }).warn(
        'piano.school-access.read-failed',
        { learnerId, error: error?.message ?? String(error) },
      );
      setSnapshot({ learnerId, status: 'error', state: null, unlocked: false });
    }
  }, [learnerId, notGated, emitVerdict, emitPassActive, readPass]);

  const onStateGates = useCallback((event) => {
    const current = event?.payload?.current;
    const capabilityId = current?.capabilityId ?? event?.payload?.capabilityId ?? null;
    if (capabilityId !== 'piano.games') return;
    const subjectId = current?.subject?.id ?? event?.payload?.subject?.id ?? null;
    if (subjectId && subjectId !== learnerId) return;
    refresh('state-gates');
  }, [learnerId, refresh]);
  useWebSocketSubscription('state-gates', onStateGates, [onStateGates]);

  useEffect(() => {
    let cancelled = false;
    const guardedRefresh = async (cause) => {
      if (!cancelled) await refresh(cause);
    };
    guardedRefresh('initial');
    const gatedHere = learnerId && !guest && !notGated;
    const timer = gatedHere ? setInterval(() => guardedRefresh('poll'), REFRESH_MS) : null;
    const bankTimer = gatedHere ? setInterval(() => guardedRefresh('bank-timer'), BANK_REFRESH_MS) : null;
    const onVisibility = () => { if (document.visibilityState === 'visible') guardedRefresh('visible'); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      requestGeneration.current += 1;
      if (timer) clearInterval(timer);
      if (bankTimer) clearInterval(bankTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, learnerId, guest, notGated]);

  // Never project one player's cached unlock onto a newly-selected identity,
  // even for the single render before that identity's effect starts its read.
  const current = snapshot.learnerId === learnerId
    ? snapshot
    : notGated
      ? { learnerId, status: 'ready', state: 'not_gated', unlocked: true }
      : { learnerId, status: guest ? 'locked' : 'loading', state: null, unlocked: false };
  return { ...current, refresh };
}
