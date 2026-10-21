/**
 * BankDoor — "show me my bank", asked from the panel's resting state
 * (school economy slice 1, C3). The shelf's panel door (`BookShelfDoor`)
 * pattern: a button beside the board, a "Whose bank?" screen of faces
 * (`LearnerChoice`, the shelf's own grid), and `POST /school/bank/open`, which
 * checks the roster and mints a short-lived bank grant (`OpenBankAtPanel`).
 *
 * TWO WAYS IN, ONE DOOR. The coin button in the board header asks who first.
 * A tap on a kid's chip on the bank strip already names the kid, so it goes
 * straight to `choose(learnerId)`: the same request, the same grant, the same
 * proof as tapping that face. That is why the door is a hook with two views:
 * the strip can sit in the keypad column (narrow panels), where the board
 * header and anything inside it is hidden, so the "who" screen is drawn by
 * the panel itself (`BankDoorSheet`), not inside the header.
 *
 * A LATE ANSWER OPENS NOTHING. Closing the sheet bumps a generation and the
 * reply is dropped, as on the shelf door.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import CoinIcon from "../../../../../frontend/src/lib/icons/CoinIcon.jsx";
import { schoolApi } from "../schoolApi.js";
import LearnerChoice from "../books/LearnerChoice.jsx";
import ScreenHeader from "../shared/ScreenHeader.jsx";
import { useCoinColor } from "../shared/useCoinColor.js";

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
 * @returns {{asking: boolean, busy: boolean, error: string|null, ask: () => void, close: () => void, choose: (learnerId: string, via?: string) => Promise<void>}}
 */
export function useBankDoor({ screenId = null, onLaunch }) {
  const log = useMemo(() => getLogger().child({ component: 'school-bank-screen' }), []);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const generation = useRef(0);
  const inFlight = useRef(false);

  const close = useCallback(() => {
    generation.current += 1;
    inFlight.current = false;
    setAsking(false);
    setBusy(false);
    setError(null);
  }, []);

  const ask = useCallback(() => {
    log.info('economy.bank.door-asked', {});
    setError(null);
    setAsking(true);
  }, [log]);

  const choose = useCallback(async (learnerId, via = 'face') => {
    if (inFlight.current || !learnerId) return;
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
    if (!target?.bankGrant) {
      log.warn('economy.bank.door-open-failed', { learnerId, via, status: result?.status ?? null });
      // From a chip there was no sheet up; the refusal needs somewhere to stand.
      setError(refusalText(result));
      setAsking(true);
      return;
    }
    log.info('economy.bank.door-opened', { learnerId, via, screenId });
    setAsking(false);
    onLaunch(target, learnerId);
  }, [screenId, onLaunch, log]);

  return { asking, busy, error, ask, close, choose };
}

/** The coin button in the board header. Hidden while the sheet is up. */
export function BankDoorButton({ door }) {
  const [gold, goldRef] = useCoinColor('gold');
  if (door.asking) return null;
  return (
    <button
      type="button"
      ref={goldRef}
      className="school-book-door school-bank-door"
      data-testid="bank-door"
      onClick={door.ask}
    >
      <CoinIcon className="school-bank-door__icon" color={gold} />
      <span className="school-book-door__label">My bank</span>
    </button>
  );
}

/** "Whose bank?": the shelf door's screen, with Back as the way out. */
export function BankDoorSheet({ door, roster = [] }) {
  if (!door.asking) return null;
  return (
    <section className="school-book-scan school-book-scan--who school-bank-door__sheet" role="dialog" aria-modal="true" aria-label="Whose bank">
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

