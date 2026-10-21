import { useEffect, useId, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import { TouchButton } from '../../../../../../../frontend/src/lib/ui/index.js';
import {
  affordableOffers, buyPass, errorBody, nextSheetLabel, passCapUsed, printNextSheet,
  readCompletion, readNextSheet, schoolProgress,
} from '../../earlyPass.js';
import './SchoolLock.scss';

/** When print-next answers with no sentence (a 404, a 400, no network). */
export const PRINT_FALLBACK = 'Can’t print right now. Ask a grown-up.';
export const SNEAK_USED_COPY = 'Sneak used today — finish school to play more.';
export const CONFIRM_COPY = 'One game, then games lock until school is done';

function lockMessage(access) {
  if (access.status === 'error') return 'School status is unavailable. Games stay locked until it can be checked.';
  if (access.state === 'indeterminate') return 'School could not determine today’s plan. Ask a grown-up for help.';
  if (access.status === 'locked') return 'Choose your own profile, then finish today’s schoolwork to unlock Games.';
  if (access.status === 'loading') return 'Checking today’s schoolwork…';
  return 'Finish today’s schoolwork to unlock Games.';
}

/** What a refused buy says to the child. Exported for its tests. */
export function buyNotice(error, coin, body = errorBody(error)) {
  if (error?.status === 402) {
    const shortfall = Number.isFinite(body?.shortfall) ? body.shortfall : null;
    return shortfall != null ? `${shortfall} more ${body?.coin ?? coin} to buy a game.` : `Not enough ${coin} yet.`;
  }
  if (body?.code === 'PASS_CAP') return SNEAK_USED_COPY;
  if (body?.code === 'PASS_NOT_SOLD') return 'Games aren’t for sale right now.';
  return 'Couldn’t buy a game right now. Try again later.';
}

/**
 * "Print my next sheet (Math 4-02)": the one thing on the lock screen that
 * moves the day forward. Rendered only when School says something would
 * print; a 404 (self-service off) or any failed read shows nothing. The
 * reply's own sentence is what the child reads afterwards, and the label is
 * read again after a print, so it names the sheet after the one just sent.
 */
export function PrintNextButton({ learnerId, deviceId = null }) {
  const log = useMemo(() => getLogger().child({ component: 'piano-early-pass' }), []);
  const [label, setLabel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sentence, setSentence] = useState('');
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!learnerId) { setLabel(null); return () => {}; }
    Promise.resolve().then(() => readNextSheet(learnerId))
      .then((next) => { if (!cancelled) setLabel(nextSheetLabel(next)); })
      .catch(() => { if (!cancelled) setLabel(null); });
    return () => { cancelled = true; };
  }, [learnerId, reads]);

  const print = async () => {
    setBusy(true);
    try {
      const res = await printNextSheet(learnerId, deviceId);
      setSentence(typeof res?.sentence === 'string' && res.sentence ? res.sentence : PRINT_FALLBACK);
      log.info('piano.early-pass.print-next', { learnerId, outcome: res?.outcome ?? null });
      setReads((n) => n + 1);
    } catch (error) {
      setSentence(PRINT_FALLBACK);
      log.warn('piano.early-pass.print-next-failed', { learnerId, status: error?.status ?? null, error: error?.message ?? String(error) });
    } finally {
      setBusy(false);
    }
  };
  if (!label && !sentence) return null;
  return (
    <div className="piano-school-lock__print" aria-busy={busy}>
      {label && <TouchButton variant="secondary" onClick={print} disabled={busy}>{label}</TouchButton>}
      <p className="piano-school-lock__sentence" role="status" aria-live="polite">{sentence}</p>
    </div>
  );
}

/**
 * The early-pass offer under the school lock: today's progress, the coins
 * that buy one game, and the sheet that earns more. Only in the ordinary
 * incomplete case; every other lock reason keeps its plain copy.
 */
function EarlyPassOffer({ access, learnerId, deviceId }) {
  const log = useMemo(() => getLogger().child({ component: 'piano-early-pass' }), []);
  const [progress, setProgress] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const offeredRef = useRef(null);
  const confirmRef = useRef(null);
  const confirmId = useId();
  const offers = affordableOffers(access);
  const used = passCapUsed(access);
  const offerKey = offers.map((o) => `${o.coin}:${o.price}`).join(',');

  useEffect(() => {
    let cancelled = false;
    setProgress(null);
    Promise.resolve().then(() => readCompletion(learnerId))
      .then((completion) => { if (!cancelled) setProgress(schoolProgress(completion)); })
      .catch(() => { if (!cancelled) setProgress(null); });
    return () => { cancelled = true; };
  }, [learnerId]);

  // Edge-triggered: the access hook refreshes every 15s and re-renders this.
  // The payload is rebuilt from the key, so the effect depends on the key alone.
  useEffect(() => {
    const key = offerKey ? `${learnerId}:${offerKey}` : null;
    if (offeredRef.current === key) return;
    offeredRef.current = key;
    if (!key) return;
    const quoted = offerKey.split(',').map((row) => {
      const [coin, price] = row.split(':');
      return { coin, price: Number(price) };
    });
    log.info('piano.early-pass.offered', { learnerId, offers: quoted });
  }, [learnerId, log, offerKey]);

  // The confirm step takes focus on its safe answer. TouchButton does not
  // forward refs, so the group is the handle.
  useEffect(() => {
    if (confirming) confirmRef.current?.querySelector('[data-confirm-cancel]')?.focus?.();
  }, [confirming]);

  const buy = async (offer) => {
    setBusy(true);
    setNotice('');
    try {
      const res = await buyPass(learnerId, offer.coin);
      log.info('piano.early-pass.bought', { learnerId, coin: offer.coin, price: offer.price, passId: res?.pass?.passId ?? null });
    } catch (error) {
      const body = errorBody(error);
      log.warn('piano.early-pass.refused', {
        learnerId, action: 'buy', coin: offer.coin, status: error?.status ?? null,
        code: body?.code ?? null, passId: body?.passId ?? null,
      });
      setNotice(buyNotice(error, offer.coin, body));
    } finally {
      // Always, success or not: a failed buy can still leave a real pass
      // behind (economy.md, "For the kiosk and Portal").
      setBusy(false);
      setConfirming(null);
      try { access.refresh?.(); } catch { /* the lock stands */ }
    }
  };

  return (
    <div className="piano-school-lock__offer" aria-busy={busy}>
      {progress && <p className="piano-school-lock__progress">{`School: ${progress.done} of ${progress.total} done today`}</p>}
      {used && <p className="piano-school-lock__used">{SNEAK_USED_COPY}</p>}
      {confirming ? (
        <div ref={confirmRef} className="piano-school-lock__confirm" role="group" aria-labelledby={confirmId}>
          <p id={confirmId}>{CONFIRM_COPY}</p>
          <TouchButton onClick={() => buy(confirming)} disabled={busy}>{`Yes, spend ${confirming.price} ${confirming.coin}`}</TouchButton>
          <TouchButton data-confirm-cancel="" variant="secondary" onClick={() => setConfirming(null)} disabled={busy}>Not now</TouchButton>
        </div>
      ) : offers.map((offer) => (
        <TouchButton key={offer.coin} onClick={() => { setNotice(''); setConfirming(offer); }} disabled={busy}>
          {`Spend ${offer.price} ${offer.coin}: one game`}
        </TouchButton>
      ))}
      <p className="piano-school-lock__notice" role="status" aria-live="polite">{notice}</p>
      <PrintNextButton learnerId={learnerId} deviceId={deviceId} />
    </div>
  );
}

/**
 * Gate 1's lock panel — shown in place of the Games routes while the school
 * day is not done. Same family as `BudgetLock` (`piano-mode__placeholder`).
 * The copy per reason is unchanged from the inline lock it replaced; the
 * plain `incomplete` case adds the early pass. Only the notice and the print
 * sentence are live regions, so a 15s refresh does not re-announce the panel.
 */
export default function SchoolLock({ access, learnerId, deviceId = null }) {
  const headingId = useId();
  const offerable = access.status === 'ready' && access.state === 'incomplete' && Boolean(learnerId) && learnerId !== 'guest';
  return (
    <section className="piano-mode__placeholder piano-games__school-lock piano-school-lock" aria-labelledby={headingId}>
      <h2 id={headingId}>Games are locked</h2>
      <p>{lockMessage(access)}</p>
      {offerable && <EarlyPassOffer access={access} learnerId={learnerId} deviceId={deviceId} />}
    </section>
  );
}

/**
 * After the early-pass game: no rematch, no picker. Games lock again until
 * school is done, and the next sheet is one tap away.
 */
export function RelockScreen({ learnerId, deviceId = null, outcome = null }) {
  const headingId = useId();
  return (
    <section className="piano-mode__placeholder piano-games__relock piano-school-lock" aria-labelledby={headingId}>
      <h2 id={headingId}>Good game!</h2>
      <p>Games lock again until school is done.</p>
      <p className="piano-school-lock__notice" role="status" aria-live="polite">{outcome === 'refunded' ? 'Your coins are back.' : ''}</p>
      <PrintNextButton learnerId={learnerId} deviceId={deviceId} />
    </section>
  );
}
