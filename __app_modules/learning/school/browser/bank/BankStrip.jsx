/**
 * BankStrip — each kid's silver this week and the next sheet they can earn it
 * with, on the locked Portal (school economy slice 1, Task C2).
 *
 * One chip per kid, IN ROSTER ORDER. Never sorted by silver, never ranked,
 * never a "top earner": the strip is each child's own bank, not a race.
 *
 * WHAT THE CHIP SAYS
 *
 *   - Silver: `balances.silver` from the economy bank. The week close
 *     converts the WHOLE silver balance to gold, so the silver balance is
 *     this week's unspent silver; a pass bought today shows as silver gone.
 *   - A gem when `balances.gems > 0`. Gems never convert, so this is "has
 *     gems", not "earned gems this week": the bank does not say which week a
 *     gem came from.
 *   - A "sneak used" tick when today's `piano.games` pass is active or
 *     consumed, or its cap is used. `state: 'unknown'` (the ledger could not
 *     be read) shows no tick: can't tell is not "unused" and not "used".
 *   - A failed bank read shows "bank is napping" and NO number. Numbers come
 *     only from a bank read that landed; never from the board's cache or any
 *     earlier figure.
 *
 * UNDER THE CHIP, the next earnable sheet (`GET .../next`): "+2 silver ·
 * Fractions 4-02" when the economy prices it, just the unit title while it
 * does not (`reward: null`), and nothing at all when there is no unit or it
 * is not paper. Print posts `print-next`; the button is disabled while the
 * request is in flight, and the reply's own sentence is the toast.
 *
 * EVERY READ SETTLES ON ITS OWN. Each kid's bank and next item are separate
 * requests, fired and never awaited by anything else, so a slow economy
 * cannot hold up the day board beside it and one kid's failure is that kid's
 * alone.
 *
 * REFRESH: the `school` topic's refresh events for that kid (including
 * `coins-changed`, which arrives in bursts during a payout and is coalesced),
 * a five-minute poll, and the printing kid right after a print.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWebSocketSubscription } from "../../../../../frontend/src/hooks/useWebSocket.js";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { TouchButton } from "../../../../../frontend/src/lib/ui/index.js";
import CoinIcon from "../../../../../frontend/src/lib/icons/CoinIcon.jsx";
import GemIcon from "../../../../../frontend/src/lib/icons/GemIcon.jsx";
import { schoolApi } from "../schoolApi.js";
import { SCHOOL_REFRESH_EVENTS, COINS_COALESCE_MS } from "../status/schoolRefreshEvents.js";
import './BankStrip.scss';

export const REFRESH_MS = 5 * 60_000;
export const TOAST_MS = 6_000;
/** The pass whose use the tick reports. */
export const SNEAK_PRIVILEGE = 'piano.games';
/** When print-next answers with no sentence (a 404, a 400, no network). */
export const PRINT_FALLBACK = "Can't print right now. Ask a grown-up.";
/** The Portal's own name for itself when the screen has none. */
export const DEFAULT_DEVICE_ID = 'portal';
/** CoinIcon's silver (see CoinIcon's header): there is no token for it. */
const SILVER = '#c0c0c0';

/** Below this width the board pane is hidden (School.scss), so the strip moves to the keypad column. */
export const NARROW_QUERY = '(max-width: 820px)';

/** Whether the narrow layout is in force. jsdom and old browsers without `matchMedia` read as wide. */
export function useNarrowPortal() {
  const query = () => {
    try { return typeof window !== 'undefined' && window.matchMedia?.(NARROW_QUERY)?.matches === true; } catch { return false; }
  };
  const [narrow, setNarrow] = useState(query);
  useEffect(() => {
    let list = null;
    try { list = window.matchMedia?.(NARROW_QUERY) ?? null; } catch { list = null; }
    if (!list?.addEventListener) return undefined;
    const onChange = (event) => setNarrow(event.matches === true);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

/** The chip's figures from a bank payload, or null when it cannot say. */
export function chipFromBank(data) {
  const silver = data?.balances?.silver;
  if (!Number.isFinite(silver)) return null;
  const gems = Number.isFinite(data.balances.gems) ? data.balances.gems : 0;
  const pass = data.pass?.[SNEAK_PRIVILEGE] ?? null;
  const sneakUsed = Boolean(pass) && pass.state !== 'unknown'
    && (pass.capUsed === true || pass.state === 'consumed' || pass.state === 'active');
  return { silver, gems, sneakUsed };
}

/** "+2 silver · Fractions 4-02", or just the title; null when nothing prints. */
export function nextLabel(next) {
  const unit = next?.unit;
  if (!unit || next.printable !== true) return null;
  const title = unit.title || unit.unitId;
  if (!title) return null;
  const reward = next.reward ?? null;
  const parts = [];
  if (Number.isFinite(reward?.silver) && reward.silver > 0) parts.push(`+${reward.silver} silver`);
  if (Number.isFinite(reward?.gems) && reward.gems > 0) parts.push(`+${reward.gems} gem${reward.gems === 1 ? '' : 's'}`);
  return [...parts, title].join(' · ');
}

export default function BankStrip({ kids = [], deviceId = null, className = '' }) {
  const log = useMemo(() => getLogger().child({ component: 'school-bank-strip' }), []);
  const device = deviceId || DEFAULT_DEVICE_ID;
  // learnerId -> { status: 'loading'|'ok'|'unavailable', chip }
  const [banks, setBanks] = useState({});
  // learnerId -> the `/next` payload, or null
  const [nexts, setNexts] = useState({});
  const [printing, setPrinting] = useState({});
  const [toast, setToast] = useState(null);
  const aliveRef = useRef(true);
  const timersRef = useRef(new Map());
  const toastTimerRef = useRef(null);
  const rosterIds = useMemo(() => new Set(kids.map((kid) => kid.id)), [kids]);

  useEffect(() => {
    aliveRef.current = true;
    const timers = timersRef.current;
    return () => {
      aliveRef.current = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      clearTimeout(toastTimerRef.current);
    };
  }, []);

  const loadBank = useCallback((learnerId) => {
    Promise.resolve().then(() => schoolApi.economyBank(learnerId))
      .then((res) => {
        if (!aliveRef.current) return;
        const chip = res?.ok ? chipFromBank(res.data) : null;
        if (!chip) {
          log.warn('economy.balance.unavailable', { learnerId, status: res?.status ?? null });
          setBanks((current) => ({ ...current, [learnerId]: { status: 'unavailable', chip: null } }));
          return;
        }
        setBanks((current) => ({ ...current, [learnerId]: { status: 'ok', chip } }));
      })
      .catch((error) => {
        if (!aliveRef.current) return;
        log.warn('economy.balance.unavailable', { learnerId, error: error?.message ?? String(error) });
        setBanks((current) => ({ ...current, [learnerId]: { status: 'unavailable', chip: null } }));
      });
  }, [log]);

  const loadNext = useCallback((learnerId) => {
    Promise.resolve().then(() => schoolApi.nextItem(learnerId))
      .then((res) => {
        if (!aliveRef.current) return;
        // A failed read shows no next item rather than a stale one.
        setNexts((current) => ({ ...current, [learnerId]: res?.ok ? (res.data ?? null) : null }));
      })
      .catch(() => {
        if (aliveRef.current) setNexts((current) => ({ ...current, [learnerId]: null }));
      });
  }, []);

  const loadKid = useCallback((learnerId) => { loadBank(learnerId); loadNext(learnerId); }, [loadBank, loadNext]);

  // First read for every kid, and again when the roster changes.
  useEffect(() => {
    for (const kid of kids) loadKid(kid.id);
  }, [kids, loadKid]);

  // The poll is the floor; the events below are the mechanism.
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      for (const kid of kids) loadKid(kid.id);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [kids, loadKid]);

  // One re-read per kid per burst: a payout mints line by line.
  const onSchool = useCallback((payload) => {
    const event = payload?.event;
    if (!SCHOOL_REFRESH_EVENTS.has(event)) return;
    const learnerId = payload?.learnerId ?? null;
    if (!learnerId || !rosterIds.has(learnerId)) return;
    const timers = timersRef.current;
    clearTimeout(timers.get(learnerId));
    timers.set(learnerId, setTimeout(() => {
      timers.delete(learnerId);
      if (aliveRef.current) loadKid(learnerId);
    }, COINS_COALESCE_MS));
  }, [rosterIds, loadKid]);
  useWebSocketSubscription('school', onSchool, [onSchool]);

  const showToast = useCallback((text) => {
    clearTimeout(toastTimerRef.current);
    setToast(text);
    toastTimerRef.current = setTimeout(() => { if (aliveRef.current) setToast(null); }, TOAST_MS);
  }, []);

  const print = useCallback(async (learnerId) => {
    const subject = nexts[learnerId]?.subject ?? null;
    log.info('economy.strip.print-tapped', { learnerId, subject, deviceId: device });
    setPrinting((current) => ({ ...current, [learnerId]: true }));
    let sentence = null;
    try {
      const res = await schoolApi.printNext(learnerId, subject, device);
      sentence = res?.ok && typeof res.data?.sentence === 'string' && res.data.sentence.trim() ? res.data.sentence : null;
    } catch {
      sentence = null;
    }
    if (!aliveRef.current) return;
    setPrinting((current) => ({ ...current, [learnerId]: false }));
    showToast(sentence ?? PRINT_FALLBACK);
    loadKid(learnerId);
  }, [nexts, device, log, showToast, loadKid]);

  if (!kids.length) return null;
  return (
    <section className={`school-bank-strip${className ? ` ${className}` : ''}`} aria-label="Silver this week">
      <ul className="school-bank-strip__kids">
        {kids.map((kid) => {
          const bank = banks[kid.id];
          const chip = bank?.status === 'ok' ? bank.chip : null;
          const label = nextLabel(nexts[kid.id]);
          return (
            <li key={kid.id} className="school-bank-strip__kid" data-testid="bank-chip" data-learner={kid.id}>
              <div className="school-bank-strip__chip">
                <span className="school-bank-strip__name">{kid.name ?? kid.id}</span>
                {chip && (
                  <span className="school-bank-strip__coins">
                    <CoinIcon className="school-bank-strip__coin" color={SILVER} />
                    <span className="school-bank-strip__silver" role="img" aria-label={`${chip.silver} silver this week`}>{chip.silver}</span>
                    {chip.gems > 0 && (
                      <GemIcon className="school-bank-strip__gem" label={`${chip.gems} gem${chip.gems === 1 ? '' : 's'}`} />
                    )}
                    {chip.sneakUsed && (
                      <span className="school-bank-strip__sneak" role="img" aria-label="Sneak used today">✓</span>
                    )}
                  </span>
                )}
                {bank?.status === 'unavailable' && (
                  <span className="school-bank-strip__napping">bank is napping</span>
                )}
              </div>
              {label && (
                <div className="school-bank-strip__next">
                  <span className="school-bank-strip__label">{label}</span>
                  <TouchButton
                    variant="secondary"
                    className="school-bank-strip__print"
                    disabled={printing[kid.id] === true}
                    aria-label={`Print ${label} for ${kid.name ?? kid.id}`}
                    onClick={() => print(kid.id)}
                  >
                    Print
                  </TouchButton>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {toast && <p className="school-bank-strip__toast" role="status">{toast}</p>}
    </section>
  );
}
