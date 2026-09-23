import { useCallback } from 'react';
import { languageLog } from './languageLog.js';
import { useInputStall } from '../shared/useInputStall.js';

/**
 * `rung.stalled` — a sentence on a rung with no key or touch for 45 s, and
 * again at 120 s. The word ladder's `item.stalled`, for the sentence ladder:
 * "they sat there" is otherwise indistinguishable in the store from "they
 * left", and both read as a gap.
 *
 * `phaseRef` is the rung's own phase when it reports one (the recording rung
 * does: idle, prompting, recording, playback, review, joining), read at the
 * moment of the stall. `screen` says whether the page was even visible —
 * a hidden tab stalls by definition.
 */
export function useRungStall({ rung, seq, phaseRef = null }) {
  const onStall = useCallback((ms) => {
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    languageLog.rungStalled({
      rung, seq, phase: phaseRef?.current ?? null, ms, screen: hidden ? 'hidden' : 'visible',
    });
  }, [rung, seq, phaseRef]);
  useInputStall(`${rung}:${seq}`, onStall, { enabled: rung != null && seq != null });
}

export default useRungStall;
