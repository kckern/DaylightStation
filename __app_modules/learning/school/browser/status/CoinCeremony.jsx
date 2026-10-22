/**
 * CoinCeremony: "+N silver" for one child, over the status board when their
 * coin column rises. A self-dismissing toast, the shape of the fitness ring
 * celebration (`FitnessToast.jsx`, `kind: 'ring-celebration'`): +N large, the
 * week's new total smaller (the coin column's figure, not the bank), who
 * earned it (face and name), and the standard silver coin.
 *
 * It sits over the BOARD PANE only (absolutely positioned inside
 * `.school-status-board`), so it never covers the keypad. It never takes
 * focus. A tap, or OK once tabbed to, dismisses it early. A new `revision`
 * (a merged rise for the same child) restarts its clock. Motion is one enter
 * and one exit, both off under prefers-reduced-motion.
 */
import { useEffect, useRef, useState } from 'react';
import ProfileAvatar from "../../../../../frontend/src/lib/identity/ProfileAvatar.jsx";
import CoinIcon from "../../../../../frontend/src/lib/icons/CoinIcon.jsx";
import { schoolLog } from "../schoolLog.js";

// Keep in sync with the exit animation in School.scss.
export const CEREMONY_EXIT_MS = 320;

export default function CoinCeremony({ toast, durationMs = 3500, onDone }) {
  const [exiting, setExiting] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const id = toast?.id ?? null;
  const revision = toast?.revision ?? 0;

  useEffect(() => {
    if (id == null) return undefined;
    setExiting(false);
    schoolLog.selfService('status-board.coin-ceremony.shown', {
      learnerId: toast.kid?.id ?? toast.learnerId, gained: toast.gained, total: toast.total, revision, durationMs,
    });
    const hide = setTimeout(() => setExiting(true), durationMs);
    const done = setTimeout(() => {
      schoolLog.selfService('status-board.coin-ceremony.dismissed', { learnerId: toast.kid?.id ?? toast.learnerId, reason: 'timeout' });
      onDoneRef.current?.(id);
    }, durationMs + CEREMONY_EXIT_MS);
    return () => { clearTimeout(hide); clearTimeout(done); };
    // The clock restarts on a new pop or a merged rise, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, revision, durationMs]);

  if (!toast) return null;
  const { kid, gained, total } = toast;
  const dismiss = () => {
    schoolLog.selfService('status-board.coin-ceremony.dismissed', { learnerId: kid.id, reason: 'tap' });
    onDoneRef.current?.(id);
  };
  return (
    <div className="school-coin-ceremony" data-testid="coin-ceremony">
      <div className="school-coin-ceremony__live" role="status" aria-live="polite">
        {`${kid.name} earned ${gained} silver. ${total} this week.`}
      </div>
      <button
        type="button"
        className={`school-coin-ceremony__card${exiting ? ' is-exiting' : ''}`}
        aria-label={`Dismiss: ${kid.name} earned ${gained} silver`}
        onClick={dismiss}
      >
        <CoinIcon className="school-coin-ceremony__coin" metal="silver" />
        <span className="school-coin-ceremony__gained" aria-hidden="true">{`+${gained}`}</span>
        <span className="school-coin-ceremony__total" aria-hidden="true">{`${total} this week`}</span>
        <span className="school-coin-ceremony__who" aria-hidden="true">
          <ProfileAvatar id={kid.id} name={kid.name} size={192} />
          <span className="school-coin-ceremony__name">{kid.name}</span>
        </span>
      </button>
    </div>
  );
}
