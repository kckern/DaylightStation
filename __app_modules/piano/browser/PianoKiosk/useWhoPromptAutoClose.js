import { useEffect, useRef } from 'react';

/**
 * Auto-close for the Who's-Playing re-prompt (PianoApp). The prompt's 30s
 * timeout dismisses to Guest, so it must never linger once the question is
 * moot. Two closers, both SILENT (keep the current player — a guest dismiss
 * here would be exactly the mis-credit the prompt exists to prevent):
 *
 *  • Playback starts (video lecture mounts, or audio starts playing). The tap
 *    that fires the idle-gap prompt is a window `pointerdown` that still
 *    completes its own click — so it can BE the tap that launches a lecture,
 *    and the fire-time `videoActive || playing` guard can't see that yet. The
 *    chrome chip already self-closes on this transition (`open && !locked`);
 *    this gives the re-prompt the same behaviour.
 *
 *  • The player changes elsewhere (e.g. the chip picker stacked on top of the
 *    re-prompt — the same qualifying tap can open both). The question is
 *    answered; a later ✕/backdrop/timeout dismissal of the re-prompt must not
 *    clobber that pick with Guest.
 */
export function useWhoPromptAutoClose({ open, close, videoActive, playing, currentUser }) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (open && (videoActive || playing)) closeRef.current();
  }, [open, videoActive, playing]);

  // Close on a CHANGE of player only — opening with a player already selected
  // (the normal case) must not self-dismiss.
  const userRef = useRef(currentUser);
  useEffect(() => {
    if (userRef.current === currentUser) return;
    userRef.current = currentUser;
    if (open) closeRef.current();
  }, [currentUser, open]);
}

export default useWhoPromptAutoClose;
