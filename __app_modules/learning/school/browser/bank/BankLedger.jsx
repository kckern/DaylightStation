/**
 * BankLedger — the bank screen's History table, answering "how did the
 * balance get here": the bank's history grouped by day, newest first.
 * Five columns: time, icon (the coin or gem that moved; a conversion shows
 * both), amount (signed), description (what it was, then what it was for:
 * the day it paid for, the week's rings) and the balance after it. There is
 * no "not yet paid" panel: a payout lands in the bank as soon as it is
 * earned. Wording and grouping are `bankScreenModel.js`'s (`historyByDay`,
 * `ledgerEntry`); nothing here words a line itself, and a line from an older
 * server without structured fields shows its sentence.
 */
import PropTypes from 'prop-types';
import CoinIcon from "../../../../../frontend/src/lib/icons/CoinIcon.jsx";
import GemIcon from "../../../../../frontend/src/lib/icons/GemIcon.jsx";
import { historyByDay, ledgerEntry } from "./bankScreenModel.js";

const CURRENCY_ICON = {
  silver: <CoinIcon className="school-bank-ledger__icon" metal="silver" />,
  gold: <CoinIcon className="school-bank-ledger__icon" metal="gold" />,
  gems: <GemIcon className="school-bank-ledger__icon" />,
};

function Row({ line }) {
  const e = ledgerEntry(line);
  return (
    <tr className="school-bank-ledger__row" data-testid="bank-ledger-row" data-source={e.source ?? undefined}>
      <td className="school-bank-ledger__cell school-bank-ledger__cell--time">{e.time ?? ''}</td>
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
      <td className="school-bank-ledger__cell school-bank-ledger__cell--what">
        {e.label}
        {e.detail && <span className="school-bank-ledger__detail">{` \u00b7 ${e.detail}`}</span>}
      </td>
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
        <col className="school-bank-ledger__col-time" />
        <col className="school-bank-ledger__col-icon" />
        <col className="school-bank-ledger__col-amount" />
        <col />
        <col className="school-bank-ledger__col-balance" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Coin</th>
          <th scope="col">Amount</th>
          <th scope="col">Description</th>
          <th scope="col">Balance</th>
        </tr>
      </thead>
      {days.map((group) => (
        <tbody key={group.key} data-testid="bank-ledger-day">
          <tr className="school-bank-ledger__day"><th scope="colgroup" colSpan={5}>{group.label}</th></tr>
          {group.lines.map((line, i) => <Row key={ledgerEntry(line).key || `${group.key}:${i}`} line={line} />)}
        </tbody>
      ))}
    </table>
  );
}

LedgerTable.propTypes = { history: PropTypes.array, now: PropTypes.number };
