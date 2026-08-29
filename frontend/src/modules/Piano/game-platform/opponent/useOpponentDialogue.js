import { useCallback, useRef, useState } from 'react';

/** Cosmetic dialogue transaction with a hard display deadline. */
export function useOpponentDialogue({ logger = null } = {}) {
  const [speech, setSpeech] = useState(null);
  const dialogueRef = useRef([]);
  const pendingRef = useRef(null);

  const prepareReaction = useCallback(({ request, fallback, event }) => {
    const token = Symbol('reaction');
    const pending = { token, fallback, event, settled: false, reaction: null };
    pendingRef.current = pending;
    logger?.info?.('opponent.dialogue.planned', event);
    Promise.resolve().then(request).then((reaction) => {
      pending.settled = true;
      pending.reaction = reaction?.quip ? reaction : null;
      if (pendingRef.current !== pending && reaction?.quip) logger?.info?.('opponent.dialogue.late-discarded', event);
    }).catch((error) => {
      pending.settled = true;
      logger?.warn?.('opponent.dialogue.generation-failed', { ...event, reason: error.message });
    });
    return pending;
  }, [logger]);

  const display = useCallback((reaction, event, reason = null) => {
    const shown = { ...reaction, fallbackReason: reaction.fallbackReason || reason };
    setSpeech(shown);
    dialogueRef.current = [...dialogueRef.current, { ...event, ...shown, shownAt: new Date().toISOString() }];
    logger?.info?.('opponent.dialogue.displayed', { ...event, source: shown.source, fallbackReason: shown.fallbackReason });
    return shown;
  }, [logger]);

  const commitReaction = useCallback((pending = pendingRef.current) => {
    if (!pending || pendingRef.current !== pending) return null;
    pendingRef.current = null;
    const fallback = typeof pending.fallback === 'function' ? pending.fallback() : pending.fallback;
    return display(pending.reaction || { ...fallback, source: 'fallback' }, pending.event, pending.settled ? 'generation_error' : 'timeout');
  }, [display]);

  const showTerminalReaction = useCallback(({ reaction, event }) => {
    pendingRef.current = null;
    return display({ ...reaction, source: reaction.source || 'fallback' }, event, 'terminal');
  }, [display]);

  const reset = useCallback(() => { pendingRef.current = null; dialogueRef.current = []; setSpeech(null); }, []);
  return { prepareReaction, commitReaction, showTerminalReaction, speech, dialogueRef, reset };
}

export default useOpponentDialogue;
