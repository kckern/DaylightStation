/**
 * CoinModal: one learner's coins, opened by tapping the coin column on their
 * status-board card. TermModal's sibling, with the same shell: its classes,
 * tap-anywhere close, the Close button and AUTO_CLOSE_MS. It adds focus on
 * Close (OK closes it on a kiosk) and Escape as a redundant fallback; FKB
 * may swallow Esc, so Esc is never the only way out. It is read-only: it
 * starts no work and spends nothing, which is why it may open on the Portal.
 *
 * Top to bottom:
 * - the bank's balances (silver, gold, gems);
 * - THIS WEEK, NOT YET PAID: the column's own preview silver, which the bank
 *   has not paid yet;
 * - the ledger by day, newest first. Every line is signed, named by where it
 *   came from or went, and followed by the balance after it.
 *
 * Balances and ledger are `GET /economy/users/:id/bank` (BankService). The
 * grouping and wording are `bank/bankScreenModel.js`, shared with the bank
 * screen and not forked.
 */
import { useEffect, useRef, useState } from 'react';
import ProfileAvatar from "../../../../../frontend/src/lib/identity/ProfileAvatar.jsx";
import CoinIcon from "../../../../../frontend/src/lib/icons/CoinIcon.jsx";
import GemIcon from "../../../../../frontend/src/lib/icons/GemIcon.jsx";
import { schoolApi } from "../schoolApi.js";
import { schoolLog } from "../schoolLog.js";
import { NAPPING, coinWord, historyByDay, ledgerEntry } from "../bank/bankScreenModel.js";
import { AUTO_CLOSE_MS } from "./TermModal.jsx";

const count = (v) => (Number.isFinite(v) ? v : 0);
const earnedText = ({ silver, gems }) => [
  silver > 0 ? `+${silver} silver` : null,
  gems > 0 ? `+${gems} ${coinWord('gems', gems)}` : null,
].filter(Boolean).join(' · ');

function Balances({ balances }) {
  const silver = count(balances?.silver);
  const gold = count(balances?.gold);
  const gems = count(balances?.gems);
  return (
    <ul className="school-coin-modal__balances" data-testid="coin-modal-balances" aria-label="Balances">
      <li className="school-coin-modal__balance" aria-label={`${silver} silver`}>
        <CoinIcon metal="silver" />
        <span aria-hidden="true">{silver}</span>
        <span className="school-coin-modal__unit" aria-hidden="true">silver</span>
      </li>
      <li className="school-coin-modal__balance school-coin-modal__balance--gold" aria-label={`${gold} gold`}>
        <CoinIcon metal="gold" />
        <span aria-hidden="true">{gold}</span>
        <span className="school-coin-modal__unit" aria-hidden="true">gold</span>
      </li>
      <li className="school-coin-modal__balance" aria-label={`${gems} ${coinWord('gems', gems)}`}>
        <GemIcon />
        <span aria-hidden="true">{gems}</span>
        <span className="school-coin-modal__unit" aria-hidden="true">{coinWord('gems', gems)}</span>
      </li>
    </ul>
  );
}

function UnpaidWeek({ figure }) {
  return (
    <section className="school-coin-modal__section school-coin-modal__pending" data-testid="coin-modal-pending" aria-labelledby="coin-modal-pending-title">
      <h3 id="coin-modal-pending-title" className="school-coin-modal__heading">This week, not yet paid</h3>
      {figure ? (
        <>
          <p className="school-coin-modal__so-far"><CoinIcon metal="silver" />{`${count(figure.silver)} silver so far`}</p>
          {(figure.earned ?? []).some((l) => earnedText(l)) && (
            <ul className="school-coin-modal__lines">
              {figure.earned.filter((l) => earnedText(l)).map((l, i) => (
                <li key={`${l.ruleId ?? l.label}-${i}`} className="school-coin-modal__pending-line">{`${earnedText(l)} · ${l.label}`}</li>
              ))}
            </ul>
          )}
          {figure.pendingSilver > 0 && <p className="school-coin-modal__quiet">{`+${figure.pendingSilver} more possible`}</p>}
          <p className="school-coin-modal__quiet">Paid into the bank on payday.</p>
        </>
      ) : <p className="school-coin-modal__quiet">Nothing earned yet this week.</p>}
    </section>
  );
}

function Ledger({ bank, now }) {
  if (bank.status === 'loading') return <p className="school-coin-modal__quiet" role="status">Opening the bank…</p>;
  if (bank.status === 'unavailable') return <p className="school-coin-modal__quiet" role="status" data-testid="coin-modal-napping">{NAPPING}</p>;
  const days = historyByDay(bank.data?.history ?? [], now);
  if (!days.length) return <p className="school-coin-modal__quiet">Nothing here yet.</p>;
  return days.map((group) => (
    <div key={group.key} className="school-coin-modal__day">
      <h4 className="school-coin-modal__day-label">{group.label}</h4>
      <ul className="school-coin-modal__lines">
        {group.lines.map((line, i) => {
          const e = ledgerEntry(line);
          return (
            <li key={e.key || `${group.key}:${i}`} className="school-coin-modal__line" data-testid="coin-ledger-line" data-source={e.source ?? undefined}>
              <span className="school-coin-modal__source">{e.sourceLabel ?? ''}</span>
              <span className="school-coin-modal__label">{e.label}</span>
              <span className="school-coin-modal__amounts">
                {e.amounts.map((a) => (
                  <span key={a.currency} className={`school-coin-modal__amount school-coin-modal__amount--${a.currency} ${a.delta > 0 ? 'is-plus' : 'is-minus'}`}>{a.text}</span>
                ))}
              </span>
              <span className="school-coin-modal__after">{e.balanceText ?? ''}</span>
            </li>
          );
        })}
      </ul>
    </div>
  ));
}

/**
 * @param {object} props
 * @param {{id: string, name: string}} props.kid
 * @param {object|null} props.figure  this week's preview figure (`figureInWeek`), or null
 * @param {() => void} props.onClose
 * @param {number|null} [props.now]  epoch ms for the day headings (tests); defaults to the clock
 */
export default function CoinModal({ kid, figure = null, onClose, now = null }) {
  const [bank, setBank] = useState({ status: 'loading', data: null });
  const closeRef = useRef(null);

  const closeWith = (reason) => {
    schoolLog.selfService('coin-modal.closed', { learnerId: kid.id, reason });
    onClose();
  };
  useEffect(() => { schoolLog.selfService('coin-modal.opened', { learnerId: kid.id }); }, [kid.id]);

  useEffect(() => {
    const timer = setTimeout(() => closeWith('timer'), AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  // OK on a kiosk presses whatever has focus: give it the way out.
  useEffect(() => { closeRef.current?.focus(); }, []);

  useEffect(() => {
    let alive = true;
    Promise.resolve(schoolApi.economyBank(kid.id))
      .then((res) => {
        if (!alive) return;
        if (res?.ok && res.data) {
          setBank({ status: 'ok', data: res.data });
          return;
        }
        setBank({ status: 'unavailable', data: null });
        schoolLog.selfServiceError?.('status-board.coins-bank-failed', { learnerId: kid.id, status: res?.status ?? null });
      })
      .catch((error) => {
        if (alive) setBank({ status: 'unavailable', data: null });
        schoolLog.selfServiceError?.('status-board.coins-bank-failed', { learnerId: kid.id, error: error?.message });
      });
    return () => { alive = false; };
  }, [kid.id]);

  const close = (event) => { event.stopPropagation(); closeWith('button'); };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); closeWith('escape'); }
  };

  return (
    // The whole surface closes it, like the term popup: a child should not have to find the X.
    <div
      className="school-term-modal school-coin-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`${kid.name}'s coins`}
      onClick={() => closeWith('tap')}
      onKeyDown={onKeyDown}
    >
      <div className="school-term-modal__sheet school-coin-modal__sheet">
        <header className="school-term-modal__header">
          <ProfileAvatar id={kid.id} name={kid.name} size={96} />
          <h2 className="school-term-modal__title">{kid.name}</h2>
          <button ref={closeRef} type="button" className="school-term-modal__close" aria-label="Close" onClick={close}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
          </button>
        </header>
        {bank.status === 'ok' && bank.data.balances && <Balances balances={bank.data.balances} />}
        <UnpaidWeek figure={figure} />
        <section className="school-coin-modal__section" data-testid="coin-modal-ledger" aria-labelledby="coin-modal-ledger-title">
          <h3 id="coin-modal-ledger-title" className="school-coin-modal__heading">History</h3>
          <Ledger bank={bank} now={now ?? Date.now()} />
        </section>
      </div>
    </div>
  );
}
