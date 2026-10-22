/**
 * BankDoor — the one way into a kid's bank on the locked panel (school economy
 * slice 1, C3). The board's coin cell (a button on the kid's own card) and a
 * kid's chip on the bank strip both name the kid, so each goes straight to
 * `choose(learnerId, via)`: `POST /school/bank/open`, which checks the roster
 * and answers an `economy-bank` launch target (`OpenBankAtPanel`). No grant:
 * the door is the roster check, and the bank read itself is unauthenticated in
 * slice 1.
 *
 * The door is a hook plus a sheet. The strip can sit in the keypad column
 * (narrow panels), where the board and anything inside it is hidden, so a
 * REFUSAL is drawn by the panel itself (`BankDoorSheet`: the shelf door's
 * "Whose bank?" screen of faces, `LearnerChoice`, with the refusal under it),
 * not inside the board. The faces there choose again through the same request.
 *
 * A LATE ANSWER OPENS NOTHING. Closing the sheet bumps a generation and the
 * reply is dropped, as on the shelf door. SchoolApp closes the door whenever
 * the panel leaves its resting view or goes home, so a refusal never waits
 * on screen for the next child; the sheet also closes itself when idle.
 *
 * FOCUS. The sheet moves focus to its Back button when it opens and hands it
 * back to whatever opened it (the coin cell or a chip) when it closes, if
 * that is still on the page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { schoolApi } from "../schoolApi.js";
import LearnerChoice from "../books/LearnerChoice.jsx";
import ScreenHeader from "../shared/ScreenHeader.jsx";

export const OPEN_FAILED = 'Could not open the bank. Try again.';

// The use case's own refusals (`OpenBankAtPanel`) are written for a kid; a
// 404 (door not wired) or a 500 is not, so those read as the plain sentence.
const SPOKEN = new Set([400, 403, 503]);
const refusalText = (result) => {
  if (!SPOKEN.has(result?.status)) return OPEN_FAILED;
  const error = result?.data?.error;
  if (typeof error === 'string' && error.trim()) return error;
  if (typeof error?.message === 'string' && error.message.trim()) return error.message;
  return OPEN_FAILED;
};

/**
 * @param {{screenId: string|null, onLaunch: (target: object, learnerId: string) => unknown}} args
 * @returns {{asking: boolean, busy: boolean, error: string|null, close: () => void, choose: (learnerId: string, via?: string) => Promise<void>}}
 */
export function useBankDoor({ screenId = null, onLaunch }) {
  const log = useMemo(() => getLogger().child({ component: 'school-bank-door' }), []);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  // What opened the sheet, to hand focus back to on close.
  const trigger = useRef(null);
  const noteTrigger = useCallback(() => {
    const el = typeof document !== 'undefined' ? document.activeElement : null;
    trigger.current = el && el !== document.body ? el : null;
  }, []);

  const close = useCallback(() => {
    generation.current += 1;
    inFlight.current = false;
    setAsking(false);
    setBusy(false);
    setError(null);
    const el = trigger.current;
    trigger.current = null;
    if (el?.isConnected && typeof el.focus === 'function') el.focus();
  }, []);

  const choose = useCallback(async (learnerId, via = 'face') => {
    if (inFlight.current || !learnerId) return;
    if (via !== 'face') noteTrigger();
    inFlight.current = true;
    const gen = generation.current;
    setBusy(true);
    setError(null);
    let result;
    try {
      result = await schoolApi.bankOpen({ screenId, learnerId });
    } catch {
      result = { ok: false, status: 0, data: null };
    }
    if (gen !== generation.current) return;
    inFlight.current = false;
    setBusy(false);
    const target = result?.ok ? result.data?.launchTarget : null;
    if (target?.program !== 'economy-bank' || target.learnerId !== learnerId) {
      log.warn('economy.bank.door-open-failed', { learnerId, via, status: result?.status ?? null });
      // From a chip there was no sheet up; the refusal needs somewhere to stand.
      setError(refusalText(result));
      setAsking(true);
      return;
    }
    log.info('economy.bank.door-opened', { learnerId, via, screenId });
    trigger.current = null; // the bank screen takes over; nothing to hand back to
    setAsking(false);
    onLaunch(target, learnerId);
  }, [screenId, onLaunch, log, noteTrigger]);

  return useMemo(() => ({ asking, busy, error, close, choose }), [asking, busy, error, close, choose]);
}

/**
 * "Whose bank?": the shelf door's screen, with Back as the way out. It takes
 * focus on open and closes itself after `idleTimeoutSeconds` without a touch
 * (the bank screen's own idle exit; `<= 0` disables it).
 */
export function BankDoorSheet({ door, roster = [], idleTimeoutSeconds = 0 }) {
  if (!door.asking) return null;
  return <Sheet door={door} roster={roster} idleTimeoutSeconds={idleTimeoutSeconds} />;
}

function Sheet({ door, roster, idleTimeoutSeconds }) {
  const root = useRef(null);
  const idle = useRef(null);
  const closeRef = useRef(door.close);
  closeRef.current = door.close;
  const noteActivity = useCallback(() => {
    clearTimeout(idle.current);
    if (idleTimeoutSeconds > 0) idle.current = setTimeout(() => closeRef.current(), idleTimeoutSeconds * 1000);
  }, [idleTimeoutSeconds]);
  useEffect(() => { noteActivity(); return () => clearTimeout(idle.current); }, [noteActivity]);
  useEffect(() => {
    root.current?.querySelector('[data-testid="screen-header-back"]')?.focus();
  }, []);
  return (
    <section
      ref={root}
      className="school-book-scan school-book-scan--who school-bank-door__sheet"
      role="dialog" aria-modal="true" aria-label="Whose bank"
      onPointerDownCapture={noteActivity}
      onKeyDownCapture={noteActivity}
    >
      <div className="school-book-scan__screen">
        {/* Back stays live while a pick is in flight: `close` drops the late answer. */}
        <ScreenHeader title="Bank" onBack={door.close} />
        <div className="school-book-scan__ask">
          <h2 className="school-book-scan__ask-title">Whose bank?</h2>
        </div>
        <LearnerChoice roster={roster} busy={door.busy} onChoose={(id) => door.choose(id, 'face')} />
        {door.error && <p className="school-book-scan__error" role="alert">{door.error}</p>}
      </div>
    </section>
  );
}

