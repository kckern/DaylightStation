import { useEffect, useRef } from 'react';
import { languageLog } from '../languageLog.js';
import { findPauses } from './pauses.js';

/**
 * The model sentence's pauses, decoded once per sentence, so a live cut can
 * snap to the phrase break the learner meant (see `pauses.js`).
 *
 * A ref, not state: nothing renders from it, and a cut reads it at the moment
 * of the key press. Empty until decoded, and empty for good on a browser
 * without Web Audio or when the fetch fails — then a cut simply lands where
 * the learner pressed, which is still a working cut.
 */
export default function useModelPauses(url) {
  const pauses = useRef([]);
  useEffect(() => {
    pauses.current = [];
    const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!Ctx || !url) return undefined;
    let live = true;
    (async () => {
      let ctx;
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        ctx = new Ctx();
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        if (!live) return;
        pauses.current = findPauses(buffer.getChannelData(0), buffer.sampleRate);
        languageLog.audio('pauses', { url, pauses: pauses.current });
      } catch (err) {
        // Raw cuts still work; nothing to tell the learner. Logged so a cut
        // that never snaps can be traced to a decode that never happened.
        languageLog.audio('pauses-failed', { url, error: err?.message || String(err) });
      } finally {
        ctx?.close?.().catch?.(() => {});
      }
    })();
    return () => { live = false; };
  }, [url]);
  return pauses;
}
