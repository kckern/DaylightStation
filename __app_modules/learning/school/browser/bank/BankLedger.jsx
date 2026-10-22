/**
 * BankLedger — the two pieces of the bank screen's History tab that answer
 * "how did the balance get here":
 *
 * - `UnpaidWeek`: this week's earnings the bank has not paid yet (the board's
 *   weekly figure, `figureInWeek`), line by line. Hidden by the caller when
 *   the figure prices another week.
 * - `LedgerTable`: the bank's history as a table grouped by day, newest first.
 *   Four columns: icon (the coin or gem that moved; a conversion shows both),
 *   amount (signed), description (where it came from, then what it was) and
 *   the balance after it. Wording and grouping are `bankScreenModel.js`'s
 *   (`historyByDay`, `ledgerEntry`); nothing here words a line itself, and a
 *   line from an older server without structured fields shows its sentence.
 */
import PropTypes from 'prop-types';
import CoinIcon from "../../../../../frontend/src/lib/icons/CoinIcon.jsx";
import GemIcon from "../../../../../frontend/src/lib/icons/GemIcon.jsx";
import { coinWord, historyByDay, ledgerEntry } from "./bankScreenModel.js";

const count = (v) => (Number.isFinite(v) ? v : 0);
const earnedText = ({ silver, gems }) => [
  silver > 0 ? `+${silver} silver` : null,
  gems > 0 ? `+${gems} ${coinWord('gems', gems)}` : null,
].filter(Boolean).join(' · ');

const CURRENCY_ICON = {
  silver: <CoinIcon className="school-bank-ledger__icon" metal="silver" />,
  gold: <CoinIcon className="school-bank-ledger__icon" metal="gold" />,
  gems: <GemIcon className="school-bank-ledger__icon" />,
};

export function UnpaidWeek({ figure }) {
  if (!figure) return null;
  const lines = (figure.earned ?? []).filter((l) => earnedText(l));
  return (
    <section className="school-bank-ledger__pending" data-testid="bank-pending" aria-labelledby="bank-pending-title">
      <div className="school-bank-ledger__pending-head">
        <h3 id="bank-pending-title" className="school-bank-screen__heading">This week, not yet paid</h3>
        <p className="school-bank-ledger__so-far"><CoinIcon className="school-bank-ledger__icon" metal="silver" />{`${count(figure.silver)} silver so far`}</p>
      </div>
      {lines.length > 0 && (
        <ul className="school-bank-ledger__pending-lines">
          {lines.map((l, i) => (
            <li key={`${l.ruleId ?? l.label}-${i}`}>{`${earnedText(l)} \u00b7 ${l.label}`}</li>
          ))}
        </ul>
      )}
      <p className="school-bank-screen__quiet school-bank-ledger__fine">
        Paid into the bank on payday.
      </p>
    </section>
  );
}

UnpaidWeek.propTypes = { figure: PropTypes.object };

function Row({ line }) {
  const e = ledgerEntry(line);
  const description = [e.sourceLabel, e.label].filter(Boolean).join(' · ');
  return (
    <tr className="school-bank-ledger__row" data-testid="bank-ledger-row" data-source={e.source ?? undefined}>
      <td className="school-bank-ledger__cell school-bank-ledger__cell--icon">
        {e.amounts.map((a) => <span key={a.currency} className="school-bank-ledger__leg">{CURRENCY_ICON[a.currency] ?? null}</span>)}
      </td>
      <td className="school-bank-ledger__cell school-bank-ledger__cell--amount">
        {e.amounts.map((a) => (
          <span
            key={a.currency}
            className={`school-bank-ledger__leg school-bank-ledger__amount ${a.delta > 0 ? 'is-plus' : 'is-minus'}`}
            aria-label={a.text}
          >{`${a.delta < 0 ? '−' : '+'}${Math.abs(a.delta)}`}</span>
        ))}
      </td>
      <td className="school-bank-ledger__cell school-bank-ledger__cell--what">{description}</td>
      <td className="school-bank-ledger__cell school-bank-ledger__cell--balance">{e.balanceText ?? ''}</td>
    </tr>
  );
}

export function LedgerTable({ history, now }) {
  const days = historyByDay(history ?? [], now);
  if (!days.length) return <p className="school-bank-screen__quiet">Nothing here yet.</p>;
  return (
    <table className="school-bank-ledger__table" data-testid="bank-ledger">
      <colgroup>
        <col className="school-bank-ledger__col-icon" />
        <col className="school-bank-ledger__col-amount" />
        <col />
        <col className="school-bank-ledger__col-balance" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Coin</th>
          <th scope="col">Amount</th>
          <th scope="col">Description</th>
          <th scope="col">Balance</th>
        </tr>
      </thead>
      {days.map((group) => (
        <tbody key={group.key} data-testid="bank-ledger-day">
          <tr className="school-bank-ledger__day"><th scope="colgroup" colSpan={4}>{group.label}</th></tr>
          {group.lines.map((line, i) => <Row key={ledgerEntry(line).key || `${group.key}:${i}`} line={line} />)}
        </tbody>
      ))}
    </table>
  );
}

LedgerTable.propTypes = { history: PropTypes.array, now: PropTypes.number };
