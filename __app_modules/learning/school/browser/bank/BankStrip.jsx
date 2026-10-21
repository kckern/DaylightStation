/**
 * BankStrip — the silver in each kid's bank and the next sheet they can earn
 * more with, on the locked Portal (school economy slice 1, Task C2).
 *
 * One chip per kid, IN ROSTER ORDER. Never sorted by silver, never ranked,
 * never a "top earner": the strip is each child's own bank, not a race.
 *
 * WHAT THE CHIP SAYS
 *
 *   - Silver IN THE BANK: `balances.silver` from the economy bank, captioned
 *     "in the bank". The week close converts the WHOLE silver balance to
 *     gold, so this is this week's unspent silver; a pass bought today shows
 *     as silver gone. The day board's silver is different on purpose: it is
 *     what the week's work EARNED (the earnings preview), named so.
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
 * NOTHING HERE MOVES THE BOARD. The chip line and the next line keep a fixed
 * height whether they hold a number, "bank is napping" or nothing, and the
 * toast overlays rather than takes a row. The live region is always in the
 * tree, so a screen reader hears the first toast too.
 *
 * EVERY READ SETTLES ON ITS OWN. Each kid's bank and next item are separate
 * requests, fired and never awaited by anything else, so a slow economy
 * cannot hold up the day board beside it and one kid's failure is that kid's
 * alone.
 *
 * REFRESH: the `school` topic's refresh events for that kid (including
 * `coins-changed`, which arrives in bursts during a payout and is coalesced,
 * at most 3 s late), a five-minute poll, and the printing kid right after a
 * print. Each read carries a per-kid sequence number, so an older reply that
 * lands late never overwrites a newer one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWebSocketSubscription } from "../../../../../frontend/src/hooks/useWebSocket.js";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { TouchButton } from "../../../../../frontend/src/lib/ui/index.js";
import CoinIcon from "../../../../../frontend/src/lib/icons/CoinIcon.jsx";
import GemIcon from "../../../../../frontend/src/lib/icons/GemIcon.jsx";
import { schoolApi } from "../schoolApi.js";
import { SCHOOL_REFRESH_EVENTS, coalescer } from "../status/schoolRefreshEvents.js";
import { useCoinColor } from "../shared/useCoinColor.js";
import './BankStrip.scss';

export const REFRESH_MS = 5 * 60_000;
export const TOAST_MS = 6_000;
/** The pass whose use the tick reports. */
export const SNEAK_PRIVILEGE = 'piano.games';
/** When print-next answers with no sentence (a 404, a 400, no network). */
export const PRINT_FALLBACK = "Can't print right now. Ask a grown-up.";
/** The Portal's own name for itself when the screen has none. */
export const DEFAULT_DEVICE_ID = 'portal';

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

/** The chip's top line: a button into the bank door when there is one, a plain row otherwise. */
// As a button its name is the action ("Open Ay's bank"); what the chip shows
// (the coins, or "bank is napping") is its description.
function ChipBox({ className, onOpen, label, describedBy, children }) {
  if (!onOpen) return <div className={className}>{children}</div>;
  return (
    <button type="button" className={className} onClick={onOpen} data-testid="bank-chip-open" aria-label={label} aria-describedby={describedBy}>
      {children}
    </button>
  );
}

/**
 * @param {object} props
 * @param {(learnerId: string) => void} [props.onOpen] - a tap on a kid's chip
 *   (name and coins, not Print) opens that kid's bank through the panel's bank
 *   door (`BankDoor`). Absent, the chip is not a button.
 */
export default function BankStrip({ kids = [], deviceId = null, className = '', onOpen = null }) {
  const log = useMemo(() => getLogger().child({ component: 'school-bank-strip' }), []);
  const device = deviceId || DEFAULT_DEVICE_ID;
  const [silverColor, silverRef] = useCoinColor('silver');
  // learnerId -> { status: 'ok'|'unavailable', chip }; absent until the first read lands
  const [banks, setBanks] = useState({});
  // learnerId -> the `/next` payload, or null
  const [nexts, setNexts] = useState({});
  const [printing, setPrinting] = useState({});
  const [toast, setToast] = useState('');
  const aliveRef = useRef(true);
  const burstsRef = useRef(new Map());
  const toastTimerRef = useRef(null);
  // `${kind}:${learnerId}` -> the latest request's number; a reply that is
  // not the latest is dropped.
  const seqRef = useRef(new Map());
  const rosterIds = useMemo(() => new Set(kids.map((kid) => kid.id)), [kids]);

  useEffect(() => {
    aliveRef.current = true;
    const bursts = burstsRef.current;
    return () => {
      aliveRef.current = false;
      for (const burst of bursts.values()) burst.cancel();
      bursts.clear();
      clearTimeout(toastTimerRef.current);
    };
  }, []);

  /** Number this request; `isLatest()` says whether it is still the newest for that kid. */
  const ticket = useCallback((kind, learnerId) => {
    const key = `${kind}:${learnerId}`;
    const n = (seqRef.current.get(key) ?? 0) + 1;
    seqRef.current.set(key, n);
    return () => aliveRef.current && seqRef.current.get(key) === n;
  }, []);

  const loadBank = useCallback((learnerId) => {
    const isLatest = ticket('bank', learnerId);
    const napping = (detail) => {
      if (!isLatest()) return;
      log.warn('economy.balance.unavailable', { learnerId, ...detail });
      setBanks((current) => ({ ...current, [learnerId]: { status: 'unavailable', chip: null } }));
    };
    Promise.resolve().then(() => schoolApi.economyBank(learnerId))
      .then((res) => {
        const chip = res?.ok ? chipFromBank(res.data) : null;
        if (!chip) { napping({ status: res?.status ?? null }); return; }
        if (isLatest()) setBanks((current) => ({ ...current, [learnerId]: { status: 'ok', chip } }));
      })
      .catch((error) => napping({ error: error?.message ?? String(error) }));
  }, [log, ticket]);

  const loadNext = useCallback((learnerId) => {
    const isLatest = ticket('next', learnerId);
    Promise.resolve().then(() => schoolApi.nextItem(learnerId))
      .then((res) => {
        // A failed read shows no next item rather than a stale one.
        if (isLatest()) setNexts((current) => ({ ...current, [learnerId]: res?.ok ? (res.data ?? null) : null }));
      })
      .catch(() => {
        if (isLatest()) setNexts((current) => ({ ...current, [learnerId]: null }));
      });
  }, [ticket]);

  const loadKid = useCallback((learnerId) => { loadBank(learnerId); loadNext(learnerId); }, [loadBank, loadNext]);
  const loadKidRef = useRef(loadKid);
  loadKidRef.current = loadKid;

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

  // One re-read per kid per burst: a payout mints line by line. Events that
  // are not `coins-changed` re-read the bank too, on purpose: a graded sheet
  // or a print is what moves silver and the next sheet, and the payout that
  // follows may not have published yet.
  const onSchool = useCallback((payload) => {
    const event = payload?.event;
    if (!SCHOOL_REFRESH_EVENTS.has(event)) return;
    const learnerId = payload?.learnerId ?? null;
    if (!learnerId || !rosterIds.has(learnerId)) return;
    const bursts = burstsRef.current;
    if (!bursts.has(learnerId)) {
      bursts.set(learnerId, coalescer(() => { if (aliveRef.current) loadKidRef.current(learnerId); }));
    }
    bursts.get(learnerId).poke();
  }, [rosterIds]);
  useWebSocketSubscription('school', onSchool, [onSchool]);

  const showToast = useCallback((text) => {
    clearTimeout(toastTimerRef.current);
    setToast(text);
    toastTimerRef.current = setTimeout(() => { if (aliveRef.current) setToast(''); }, TOAST_MS);
  }, []);

  const print = useCallback(async (learnerId) => {
    // `printing` is this mount's only guard; a remounted strip's second tap is
    // debounced server-side (IssueSubjectNext, per learnerId:subject, 20 s),
    // with IssueDocument's per-session print cooldown behind it.
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
    <section className={`school-bank-strip${className ? ` ${className}` : ''}`} aria-label="Silver in the bank" ref={silverRef}>
      <ul className="school-bank-strip__kids">
        {kids.map((kid) => {
          const bank = banks[kid.id];
          const chip = bank?.status === 'ok' ? bank.chip : null;
          const label = nextLabel(nexts[kid.id]);
          const name = kid.name ?? kid.id;
          return (
            <li key={kid.id} className="school-bank-strip__kid" data-testid="bank-chip" data-learner={kid.id}>
              <ChipBox
                className={`school-bank-strip__chip${onOpen ? ' school-bank-strip__chip--door' : ''}`}
                onOpen={onOpen ? () => onOpen(kid.id) : null}
                label={`Open ${name}'s bank`}
                describedBy={`school-bank-chip-${kid.id}`}
              >
                <span className="school-bank-strip__name">{name}</span>
                {chip && (
                  <span className="school-bank-strip__coins" id={`school-bank-chip-${kid.id}`}>
                    <CoinIcon className="school-bank-strip__coin" color={silverColor} />
                    <span className="school-bank-strip__silver" aria-hidden="true">{chip.silver}</span>
                    <span className="school-bank-strip__caption" aria-hidden="true">in the bank</span>
                    <span className="school-bank-strip__sr">{`${chip.silver} silver in the bank`}</span>
                    {chip.gems > 0 && (
                      <GemIcon className="school-bank-strip__gem" label={`${chip.gems} gem${chip.gems === 1 ? '' : 's'}`} />
                    )}
                    {chip.sneakUsed && (
                      <>
                        <span className="school-bank-strip__sneak" aria-hidden="true">✓</span>
                        <span className="school-bank-strip__sr">Sneak used today</span>
                      </>
                    )}
                  </span>
                )}
                {bank?.status === 'unavailable' && (
                  <span className="school-bank-strip__napping" id={`school-bank-chip-${kid.id}`}>bank is napping</span>
                )}
              </ChipBox>
              <div className="school-bank-strip__next" data-testid="bank-next">
                {label && (
                  <>
                    <span className="school-bank-strip__label">{label}</span>
                    <TouchButton
                      variant="secondary"
                      className="school-bank-strip__print"
                      disabled={printing[kid.id] === true}
                      aria-label={`Print ${label} for ${name}`}
                      onClick={() => print(kid.id)}
                    >
                      Print
                    </TouchButton>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {/* Always in the tree, so the live region exists before its first
          words; empty, it is hidden and takes no room. */}
      <p className={`school-bank-strip__toast${toast ? '' : ' school-bank-strip__toast--empty'}`} role="status" data-testid="bank-toast">{toast}</p>
    </section>
  );
}
