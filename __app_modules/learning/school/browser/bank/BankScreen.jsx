/**
 * BankScreen — one kid's coin bank on the Portal (school economy slice 1, C3).
 * Opened from the board's coin cell (SchoolApp's bank door), which checks the
 * roster and puts an identity on the panel. The bank read itself is
 * unauthenticated in slice 1.
 *
 * THREE TABS. The screen's primary job is "here is the balance, how did it get
 * here", so History opens first and the other two are a tap away:
 *
 *   1. History. The balances (silver "becomes gold in N days"; gold and gems
 *      "yours for good"), then the ledger as a table grouped by day
 *      (`BankLedger.jsx`). Earnings are paid in as they are earned, so the
 *      ledger is the whole story: there is no "not yet paid" panel.
 *   2. How to earn. Today's remaining work: the next sheet (`/next`) and the
 *      agenda's still-owed sections. Titles only unless the economy prices one.
 *   3. How to spend. Each privilege on sale, its price in each coin and
 *      whether it can be bought ("can buy at the piano", "3 more silver",
 *      "after school is done"). No buy button: buying is at the piano kiosk.
 *
 * The tabs are a roving-tabindex tablist: Left/Right/Home/End move and select,
 * a tap or Enter selects. Esc is bound to nothing.
 *
 * COINS START SOON. Before the economy is live (the bank's `mode` is not
 * `live`), History and How to spend say "Coins start soon." in place of the
 * balances, history and prices: every bank reads 0 until then, and a kid must
 * not be shown "0 silver" for a day's work. How to earn still shows.
 *
 * NAPPING. A bank read that fails shows "The bank is napping. Try again soon."
 * and NO numbers: no balance, no history, no prices. Nothing falls back to an
 * earlier read or a cache. How to earn does not come from the bank, so it
 * still shows.
 *
 * Refreshes on the `school` topic's events for this kid (coalesced, as the
 * strip does), so a payout or a pass at the piano shows while the screen is up.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useWebSocketSubscription } from "../../../../../frontend/src/hooks/useWebSocket.js";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { StatCard } from "../../../../../frontend/src/lib/ui/index.js";
import CoinIcon from "../../../../../frontend/src/lib/icons/CoinIcon.jsx";
import { coinFigure } from "../../../../../frontend/src/lib/coins/coinFigure.js";
import GemIcon from "../../../../../frontend/src/lib/icons/GemIcon.jsx";
import ProfileAvatar from "../../../../../frontend/src/lib/identity/ProfileAvatar.jsx";
import ScreenHeader from "../shared/ScreenHeader.jsx";
import { schoolApi } from "../schoolApi.js";
import { SCHOOL_REFRESH_EVENTS, coalescer } from "../status/schoolRefreshEvents.js";
import { NAPPING, earnItems, goldCountdown, schoolDoneFrom, spendItems } from "./bankScreenModel.js";
import { LedgerTable } from "./BankLedger.jsx";
import './BankScreen.scss';

export { NAPPING };
export const NOTHING_TO_SPEND = 'Nothing to spend on yet.';
export const COINS_SOON = 'Coins start soon.';

function Identity({ learner }) {
  if (!learner) return null;
  const name = learner.name || learner.id;
  return (
    <div className="school-selfservice-card__learner">
      <ProfileAvatar id={learner.id} name={name} size={48} />
      <span>{name}</span>
    </div>
  );
}

export const TABS = Object.freeze([
  { id: 'history', label: 'History' },
  { id: 'earn', label: 'How to earn' },
  { id: 'spend', label: 'How to spend' },
]);

// A balance's label: the standard icon, then the word.
const coinLabel = (icon, text) => (
  <span className="school-bank-screen__stat-label">{icon}{text}</span>
);

export default function BankScreen({ learner, onExit, idleTimeoutSeconds = 0, now = null }) {
  const learnerId = learner?.id ?? null;
  const log = useMemo(() => getLogger().child({ component: 'school-bank-screen' }), []);
  // { status: 'loading'|'ok'|'unavailable', data }
  const [bank, setBank] = useState({ status: 'loading', data: null });
  const [agenda, setAgenda] = useState(null);
  const [next, setNext] = useState(null);
  const [tab, setTab] = useState('history');
  const tabRefs = useRef({});
  const aliveRef = useRef(true);
  const seqRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    if (learnerId) log.info('economy.bank.opened', { learnerId });
  }, [learnerId, log]);

  const load = useCallback(() => {
    if (!learnerId) return;
    const n = ++seqRef.current;
    const latest = () => aliveRef.current && seqRef.current === n;
    Promise.resolve().then(() => schoolApi.economyBank(learnerId))
      .then((res) => {
        if (!latest()) return;
        if (res?.ok && Number.isFinite(res.data?.balances?.silver)) { setBank({ status: 'ok', data: res.data }); return; }
        log.warn('economy.bank.unavailable', { learnerId, status: res?.status ?? null });
        setBank({ status: 'unavailable', data: null });
      })
      .catch((error) => {
        if (!latest()) return;
        log.warn('economy.bank.unavailable', { learnerId, error: error?.message ?? String(error) });
        setBank({ status: 'unavailable', data: null });
      });
    Promise.resolve().then(() => schoolApi.agendaPreview(learnerId))
      .then((res) => { if (latest()) setAgenda(res?.ok ? (res.data ?? null) : null); })
      .catch(() => { if (latest()) setAgenda(null); });
    Promise.resolve().then(() => schoolApi.nextItem(learnerId))
      .then((res) => { if (latest()) setNext(res?.ok ? (res.data ?? null) : null); })
      .catch(() => { if (latest()) setNext(null); });
  }, [learnerId, log]);

  useEffect(() => { load(); }, [load]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const burst = useMemo(() => coalescer(() => { if (aliveRef.current) loadRef.current(); }), []);
  useEffect(() => () => burst.cancel(), [burst]);
  const onSchool = useCallback((payload) => {
    if (!SCHOOL_REFRESH_EVENTS.has(payload?.event) || payload?.learnerId !== learnerId) return;
    burst.poke();
  }, [burst, learnerId]);
  useWebSocketSubscription('school', onSchool, [onSchool]);

  // A screen left up on a shared panel goes back to the board on its own.
  const idleRef = useRef(null);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  const noteActivity = useCallback(() => {
    clearTimeout(idleRef.current);
    if (!(idleTimeoutSeconds > 0)) return;
    idleRef.current = setTimeout(() => {
      log.info('economy.bank.idle-exit', { learnerId });
      exitRef.current?.('idle');
    }, idleTimeoutSeconds * 1000);
  }, [idleTimeoutSeconds, learnerId, log]);
  useEffect(() => { noteActivity(); return () => clearTimeout(idleRef.current); }, [noteActivity]);

  const at = now ?? Date.now();
  const soon = bank.status === 'ok' && bank.data?.mode !== 'live';
  const data = bank.status === 'ok' && !soon ? bank.data : null;
  const schoolDone = schoolDoneFrom(agenda);
  const spend = data ? spendItems({ offers: data.offers, pass: data.pass, balances: data.balances, schoolDone }) : null;
  const earn = earnItems({ agenda, next });

  const selectTab = useCallback((id, { focus = false } = {}) => {
    setTab((prev) => {
      if (prev !== id) log.info('economy.bank.tab-changed', { learnerId, tab: id });
      return id;
    });
    if (focus) tabRefs.current[id]?.focus();
  }, [learnerId, log]);
  const onTabKeyDown = (event, index) => {
    const last = TABS.length - 1;
    const target = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
    if (target == null) return;
    event.preventDefault();
    selectTab(TABS[target].id, { focus: true });
  };
  // Shown in a tab that needs the bank when it has nothing to say.
  const bankNote = bank.status === 'loading'
    ? <p className="school-bank-screen__quiet" role="status">Opening your bank…</p>
    : bank.status === 'unavailable'
      ? <p className="school-bank-screen__napping" role="status" data-testid="bank-napping">{NAPPING}</p>
      : soon ? <p className="school-bank-screen__soon" role="status" data-testid="bank-soon">{COINS_SOON}</p> : null;

  return (
    <section
      className="school-bank-screen"
      data-testid="bank-screen"
      onPointerDownCapture={noteActivity}
      onKeyDownCapture={noteActivity}
    >
      <ScreenHeader
        className="school-bank-screen__header"
        title="Bank"
        identity={<Identity learner={learner} />}
        onBack={() => onExit?.('back')}
      />
      <div className="school-bank-screen__tabs" role="tablist" aria-label="Bank" data-testid="bank-tabs">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`bank-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`bank-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`school-bank-screen__tab${tab === t.id ? ' is-selected' : ''}`}
            data-testid={`bank-tab-${t.id}`}
            onClick={() => selectTab(t.id)}
            onKeyDown={(event) => onTabKeyDown(event, i)}
          >{t.label}</button>
        ))}
      </div>
      <div
        className="school-bank-screen__body"
        role="tabpanel"
        id={`bank-panel-${tab}`}
        aria-labelledby={`bank-tab-${tab}`}
      >
        {tab === 'history' && (
          data ? (
            <>
              <section className="school-bank-screen__balances" aria-label="Balances" data-testid="bank-balances">
                <StatCard
                  emphasis
                  label={coinLabel(<CoinIcon className="school-bank-screen__stat-icon" metal="silver" />, 'Silver')}
                  value={coinFigure(data.balances.silver)}
                  trend={goldCountdown({ weekEndsOn: data.weekEndsOn, studyDay: data.studyDay, weekEndsAt: data.weekEndsAt, now: at })}
                />
                <StatCard
                  label={coinLabel(<CoinIcon className="school-bank-screen__stat-icon" metal="gold" />, 'Gold')}
                  value={coinFigure(data.balances.gold)}
                  trend="yours for good"
                />
                <StatCard
                  label={coinLabel(<GemIcon className="school-bank-screen__stat-icon" />, 'Gems')}
                  value={coinFigure(data.balances.gems)}
                  trend="yours for good"
                />
              </section>
              <section className="school-bank-screen__section school-bank-screen__history" aria-label="History" data-testid="bank-history">
                <LedgerTable history={data.history} now={at} />
              </section>
            </>
          ) : bankNote
        )}

        {tab === 'spend' && (data ? (
          <section className="school-bank-screen__section" aria-label="How to spend" data-testid="bank-spend">
            {spend.empty ? <p className="school-bank-screen__quiet">{NOTHING_TO_SPEND}</p> : (
              <ul className="school-bank-screen__offers">
                {spend.items.map((item) => (
                  <li key={item.privilege} className="school-bank-screen__offer" data-testid="bank-offer">
                    <span className="school-bank-screen__offer-label">{item.label}</span>
                    <ul className="school-bank-screen__prices">
                      {item.prices.map((row) => (
                        <li key={row.coin} className={`school-bank-screen__price school-bank-screen__price--${row.coin}`}>
                          <span className="school-bank-screen__price-amount">{`${row.price} ${row.coin}`}</span>
                          {row.state && <span className="school-bank-screen__price-state">{row.state}</span>}
                        </li>
                      ))}
                    </ul>
                    {item.note && <p className="school-bank-screen__offer-note">{item.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : bankNote)}

        {tab === 'earn' && (
          <section className="school-bank-screen__section" aria-label="How to earn" data-testid="bank-earn">
            {earn.items.length ? (
              <ul className="school-bank-screen__earn">
                {earn.items.map((item) => (
                  <li key={item.key} className={`school-bank-screen__earn-item${item.next ? ' school-bank-screen__earn-item--next' : ''}`}>
                    <span className="school-bank-screen__earn-title">{item.title}</span>
                    {item.reward && <span className="school-bank-screen__earn-reward">{item.reward}</span>}
                    {item.next && <span className="school-bank-screen__earn-tag">next</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="school-bank-screen__quiet">
                {earn.done ? 'All done for today.' : earn.status === 'unavailable' ? "Can't see today's list right now." : 'Nothing left on today’s list.'}
              </p>
            )}
          </section>
        )}
      </div>
    </section>
  );
}

BankScreen.propTypes = {
  /** Whose bank: `{ id, name }` from the roster. */
  learner: PropTypes.shape({ id: PropTypes.string.isRequired, name: PropTypes.string }),
  /** Back to the board; called with `'back'` or `'idle'`. */
  onExit: PropTypes.func,
  /** The panel's own idle knob; `<= 0` keeps the screen up until Back. */
  idleTimeoutSeconds: PropTypes.number,
  /** A fixed clock for tests. */
  now: PropTypes.number,
};
