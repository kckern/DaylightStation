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
    logger?.info?.('piano-game.dialogue.planned', { ...event, source: 'pending', fallbackReason: null });
    pending.promise = Promise.resolve().then(request).then((reaction) => {
      pending.settled = true;
      pending.reaction = reaction?.quip ? reaction : null;
      pending.fallbackReason = reaction?.fallbackReason || reaction?.fallback_reason || null;
      if (pendingRef.current !== pending && reaction?.quip) logger?.info?.('piano-game.dialogue.late-discarded', {
        ...event, source: reaction.source || 'ai', fallbackReason: 'late_result',
      });
    }).catch((error) => {
      pending.settled = true;
      pending.fallbackReason = 'generation_error';
      logger?.warn?.('piano-game.dialogue.fallback', { ...event, source: 'fallback', fallbackReason: 'generation_error', reason: error.message });
    });
    return pending;
  }, [logger]);

  const display = useCallback((reaction, event, reason = null) => {
    const shown = { ...reaction, fallbackReason: reaction.fallbackReason || reason };
    setSpeech(shown);
    dialogueRef.current = [...dialogueRef.current, { ...event, ...shown, shownAt: new Date().toISOString() }];
    logger?.info?.('piano-game.dialogue.displayed', { ...event, source: shown.source, fallbackReason: shown.fallbackReason });
    return shown;
  }, [logger]);

  const commitReaction = useCallback((pending = pendingRef.current) => {
    if (!pending || pendingRef.current !== pending) return null;
    pendingRef.current = null;
    const fallback = typeof pending.fallback === 'function' ? pending.fallback() : pending.fallback;
    return display(
      pending.reaction || { ...fallback, source: 'fallback' },
      pending.event,
      pending.fallbackReason || (pending.settled ? 'generation_error' : 'timeout'),
    );
  }, [display]);

  const showTerminalReaction = useCallback(({ reaction, event }) => {
    pendingRef.current = null;
    return display({ ...reaction, source: reaction.source || 'fallback' }, event, 'terminal');
  }, [display]);

  const reset = useCallback(() => { pendingRef.current = null; dialogueRef.current = []; setSpeech(null); }, []);
  return { prepareReaction, commitReaction, showTerminalReaction, speech, dialogueRef, reset };
}

export default useOpponentDialogue;
