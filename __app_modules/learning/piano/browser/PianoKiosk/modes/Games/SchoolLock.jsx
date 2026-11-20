import { useEffect, useId, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import { TouchButton } from '../../../../../../../frontend/src/lib/ui/index.js';
import ProfileAvatar from '../../../../../../../frontend/src/lib/identity/ProfileAvatar.jsx';
import CoinIcon from '../../../../../../../frontend/src/lib/icons/CoinIcon.jsx';
import LockIcon from '../../../../../../wellness/fitness/browser/lock-indicator.mjs';
import { SubjectIcon as Icon, hasSubjectIcon as hasIcon, subjectLabel } from '../../../../../school/browser/subject-identity.mjs';
import {
  affordableOffers, buyPass, errorBody, nextSheetCard, nextSheetLabel, passCapUsed, printNextSheet,
  readCompletion, readNextSheet, schoolSections,
} from '../../earlyPass.js';
import './SchoolLock.scss';

/** When print-next answers with no sentence (a 404, a 400, no network). */
export const PRINT_FALLBACK = 'Can’t print right now. Ask a grown-up.';
export const SNEAK_USED_COPY = 'Sneak used today — finish school to play more.';
export const CONFIRM_COPY = 'One game, then games lock until school is done';
/** What the child reads once the sheet is on its way. The server's own sentence is for grown-ups. */
export const PRINTED_COPY = 'Printing! Go get it from the printer.';
export const DEBOUNCED_COPY = 'Already printing — check the printer.';

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
    // Gold is fractional: 0.4 gold short reads "1 more gold", never a decimal.
    const shortfall = Number.isFinite(body?.shortfall) && body.shortfall > 0 ? Math.ceil(body.shortfall - 1e-9) : null;
    return shortfall != null ? `${shortfall} more ${body?.coin ?? coin} to buy a game.` : `Not enough ${coin} yet.`;
  }
  if (body?.code === 'PASS_CAP') return SNEAK_USED_COPY;
  if (body?.code === 'PASS_NOT_SOLD') return 'Games aren’t for sale right now.';
  return 'Couldn’t buy a game right now. Try again later.';
}

/**
 * What the child reads after a print, by the reply's outcome. `done` and
 * `debounced` use the kiosk's own words: the reply's sentence on success is
 * written for the Portal and grown-ups ("Regenerating that worksheet with the
 * current print layout." on a reprint, 2026-11-20), not for the piano. A
 * refusal or failure keeps the reply's sentence, which says why.
 */
export function printResult(res) {
  if (res?.outcome === 'done') return { tone: 'ok', text: PRINTED_COPY };
  if (res?.outcome === 'debounced') return { tone: 'ok', text: DEBOUNCED_COPY };
  const sentence = typeof res?.sentence === 'string' && res.sentence ? res.sentence : null;
  if (!res?.outcome && sentence) return { tone: 'ok', text: sentence };
  return { tone: 'warn', text: sentence ?? PRINT_FALLBACK };
}

const shortSubject = (subject) => String(subjectLabel(subject) ?? '').split(' & ')[0];

function SubjectMark({ subject, className }) {
  return hasIcon(subject) ? <Icon name={subject} className={className} /> : <Icon name="school" className={className} />;
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
      <path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 11-11-1.4-1.4z" fill="currentColor" />
    </svg>
  );
}

/** The child's face with the lock on it: whose games these are, and that they are shut. */
function LockedAvatar({ learnerId, learnerName }) {
  return (
    <span className="piano-school-lock__face">
      <ProfileAvatar id={learnerId && learnerId !== 'guest' ? learnerId : null} name={learnerName || learnerId || '?'} size={240} />
      <span className="piano-school-lock__face-lock" aria-hidden="true"><LockIcon /></span>
    </span>
  );
}

/**
 * Today's school as a row of subject tiles: done ones green with a check,
 * the ones left in amber. The count is the heading of the row, so "4 of 6"
 * and the tiles can never disagree.
 */
function SubjectStrip({ sections }) {
  const done = sections.filter((s) => s.done).length;
  return (
    <div className="piano-school-lock__today">
      <p className="piano-school-lock__progress">{`School today: ${done} of ${sections.length} done`}</p>
      <ul className="piano-school-lock__subjects">
        {sections.map(({ subject, done: isDone }) => (
          <li key={subject} className={`piano-school-lock__subject piano-school-lock__subject--${isDone ? 'done' : 'todo'}`}>
            <span className="piano-school-lock__subject-tile">
              <SubjectMark subject={subject} className="piano-school-lock__subject-icon" />
              {isDone && <span className="piano-school-lock__subject-check"><CheckGlyph /></span>}
            </span>
            <span className="piano-school-lock__subject-name">{shortSubject(subject)}</span>
            <span className="piano-school-lock__visually-hidden">{isDone ? ' done' : ' to do'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Print my next sheet": the one thing on the lock screen that moves the day
 * forward, drawn as a card — the subject's icon, the sheet's name, what it
 * pays, and a Print badge. Rendered only when School says something would
 * print; a 404 (self-service off) or any failed read shows nothing. The label
 * is read again after a print, so it names the sheet after the one just sent.
 */
export function PrintNextButton({ learnerId, deviceId = null }) {
  const log = useMemo(() => getLogger().child({ component: 'piano-early-pass' }), []);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!learnerId) { setNext(null); return () => {}; }
    Promise.resolve().then(() => readNextSheet(learnerId))
      .then((res) => { if (!cancelled) setNext(res); })
      .catch(() => { if (!cancelled) setNext(null); });
    return () => { cancelled = true; };
  }, [learnerId, reads]);

  const print = async () => {
    setBusy(true);
    try {
      const res = await printNextSheet(learnerId, deviceId);
      setResult(printResult(res));
      log.info('piano.early-pass.print-next', { learnerId, outcome: res?.outcome ?? null });
      setReads((n) => n + 1);
    } catch (error) {
      setResult({ tone: 'warn', text: PRINT_FALLBACK });
      log.warn('piano.early-pass.print-next-failed', { learnerId, status: error?.status ?? null, error: error?.message ?? String(error) });
    } finally {
      setBusy(false);
    }
  };

  const card = nextSheetCard(next);
  const label = nextSheetLabel(next);
  if (!card && !result) return null;
  return (
    <div className="piano-school-lock__print" aria-busy={busy}>
      {card && (
        <TouchButton
          variant="secondary" wrapLabel={false} className="piano-school-lock__sheet"
          onClick={print} disabled={busy} aria-label={label}
        >
          <span className="piano-school-lock__sheet-art"><SubjectMark subject={card.subject} /></span>
          <span className="piano-school-lock__sheet-copy">
            <span className="piano-school-lock__sheet-kicker">
              {card.subject ? `Next ${shortSubject(card.subject)} sheet` : 'Next sheet'}
            </span>
            <span className="piano-school-lock__sheet-title">{card.title}</span>
            {(card.silver > 0 || card.gems > 0) && (
              <span className="piano-school-lock__sheet-reward">
                {card.silver > 0 && <span><CoinIcon metal="silver" size="1.15em" />{`+${card.silver} silver`}</span>}
                {card.gems > 0 && <span>{`+${card.gems} gem${card.gems === 1 ? '' : 's'}`}</span>}
              </span>
            )}
          </span>
          <span className="piano-school-lock__sheet-go">
            <Icon name="print" className="piano-school-lock__sheet-go-icon" />
            <span>{busy ? 'Sending…' : 'Print'}</span>
          </span>
        </TouchButton>
      )}
      <p className={`piano-school-lock__sentence${result ? ` piano-school-lock__sentence--${result.tone}` : ''}`} role="status" aria-live="polite">
        {result && result.tone === 'ok' && <CheckGlyph />}
        {result?.text ?? ''}
      </p>
    </div>
  );
}

/**
 * The early-pass offer under the school lock: today's subjects, the sheet
 * that earns more, and the coins that buy one game. Only in the ordinary
 * incomplete case; every other lock reason keeps its plain copy.
 */
function EarlyPassOffer({ access, learnerId, deviceId }) {
  const log = useMemo(() => getLogger().child({ component: 'piano-early-pass' }), []);
  const [sections, setSections] = useState([]);
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
    setSections([]);
    Promise.resolve().then(() => readCompletion(learnerId))
      .then((completion) => { if (!cancelled) setSections(schoolSections(completion)); })
      .catch(() => { if (!cancelled) setSections([]); });
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

  const metal = (coin) => (coin === 'gold' ? 'gold' : 'silver');
  return (
    <div className="piano-school-lock__offer" aria-busy={busy}>
      {sections.length > 0 && <SubjectStrip sections={sections} />}
      <PrintNextButton learnerId={learnerId} deviceId={deviceId} />
      {used && <p className="piano-school-lock__used">{SNEAK_USED_COPY}</p>}
      {confirming ? (
        <div ref={confirmRef} className="piano-school-lock__confirm" role="group" aria-labelledby={confirmId}>
          <p id={confirmId}>{CONFIRM_COPY}</p>
          <div className="piano-school-lock__confirm-actions">
            <TouchButton onClick={() => buy(confirming)} disabled={busy}>
              <CoinIcon metal={metal(confirming.coin)} size="1.2em" />{`Yes, spend ${confirming.price} ${confirming.coin}`}
            </TouchButton>
            <TouchButton data-confirm-cancel="" variant="secondary" onClick={() => setConfirming(null)} disabled={busy}>Not now</TouchButton>
          </div>
        </div>
      ) : offers.length > 0 && (
        <div className="piano-school-lock__buy">
          <span className="piano-school-lock__or">or</span>
          {offers.map((offer) => (
            <TouchButton key={offer.coin} variant="secondary" density="compact" className="piano-school-lock__coin-offer"
              onClick={() => { setNotice(''); setConfirming(offer); }} disabled={busy}>
              <CoinIcon metal={metal(offer.coin)} size="1.3em" />{`Spend ${offer.price} ${offer.coin}: one game`}
            </TouchButton>
          ))}
        </div>
      )}
      <p className="piano-school-lock__notice" role="status" aria-live="polite">{notice}</p>
    </div>
  );
}

/**
 * Gate 1's lock panel — shown in place of the Games routes while the school
 * day is not done: the child's avatar with a lock on it, the lock's reason,
 * and (in the plain `incomplete` case) today's subjects, the next sheet to
 * print, and the early pass. Only the notice and the print sentence are live
 * regions, so a 15s refresh does not re-announce the panel.
 */
export default function SchoolLock({ access, learnerId, learnerName = null, deviceId = null }) {
  const headingId = useId();
  const offerable = access.status === 'ready' && access.state === 'incomplete' && Boolean(learnerId) && learnerId !== 'guest';
  return (
    <section className="piano-games__school-lock piano-school-lock" aria-labelledby={headingId}>
      <header className="piano-school-lock__hero">
        <LockedAvatar learnerId={learnerId} learnerName={learnerName} />
        <div className="piano-school-lock__hero-copy">
          <h2 id={headingId}>Games are locked</h2>
          <p>{lockMessage(access)}</p>
        </div>
      </header>
      {offerable && <EarlyPassOffer access={access} learnerId={learnerId} deviceId={deviceId} />}
    </section>
  );
}

/**
 * After the early-pass game: no rematch, no picker. Games lock again until
 * school is done, and the next sheet is one tap away.
 */
export function RelockScreen({ learnerId, learnerName = null, deviceId = null, outcome = null, played = true }) {
  const headingId = useId();
  // "Good game!" only after a game. A pass left at the challenge or the
  // loading screen reads neutrally.
  return (
    <section className="piano-games__relock piano-school-lock" aria-labelledby={headingId}>
      <header className="piano-school-lock__hero">
        <LockedAvatar learnerId={learnerId} learnerName={learnerName} />
        <div className="piano-school-lock__hero-copy">
          <h2 id={headingId}>{played ? 'Good game!' : 'Games are locked'}</h2>
          <p>{played ? 'Games lock again until school is done.' : 'Games are locked again until school is done.'}</p>
        </div>
      </header>
      <p className="piano-school-lock__notice" role="status" aria-live="polite">{outcome === 'refunded' ? 'Your coins are back.' : ''}</p>
      <div className="piano-school-lock__offer">
        <PrintNextButton learnerId={learnerId} deviceId={deviceId} />
      </div>
    </section>
  );
}
