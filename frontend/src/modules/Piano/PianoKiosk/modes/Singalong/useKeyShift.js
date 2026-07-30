// useKeyShift.js — route the Player's media element through a Tone.PitchShift
// so karaoke songs can be transposed live (±semitones) without touching the
// shared Player. Attaches from the consumer side via the element resolved by
// useResolvedMediaEl, mirroring how SingalongPlayer already drives volume.
import { useEffect, useRef } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { clampKeyShift } from './keyShift.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'karaoke-keyshift' });
  return _logger;
}

// createMediaElementSource is ONE-SHOT per element — a second call throws, and
// once called the element's audio flows only through the Web Audio graph. Cache
// the source per element (module-wide, WeakMap so dead elements GC) so remounts
// and shifter rebuilds reuse it instead of exploding.
const sourceByEl = new WeakMap();

/**
 * Keep `mediaEl`'s audio pitch-shifted by `semitones` (clamped whole steps).
 *
 * Lazy on purpose: nothing is imported or routed until the user first moves
 * off the natural key, so songs played untransposed never pay for Tone.js nor
 * get their audio rerouted. Once engaged, returning to 0 bypasses the shifter
 * (wet 0) rather than tearing the graph down — un-routing isn't possible.
 */
export default function useKeyShift(mediaEl, semitones) {
  const chainRef = useRef(null); // { el, shifter }
  const engagedRef = useRef(false);

  useEffect(() => {
    const shift = clampKeyShift(semitones);
    if (!mediaEl) return undefined;
    if (!engagedRef.current && shift === 0) return undefined;
    engagedRef.current = true;
    let cancelled = false;
    (async () => {
      const Tone = await import('tone');
      if (cancelled) return;
      let chain = chainRef.current;
      if (!chain || chain.el !== mediaEl) {
        // Element appeared or was swapped (Player resilience reinit): rebuild.
        chain?.shifter?.dispose?.();
        let source = sourceByEl.get(mediaEl);
        if (!source) {
          source = Tone.getContext().createMediaElementSource(mediaEl);
          sourceByEl.set(mediaEl, source);
        }
        // windowSize 0.05: the shifter delays audio by roughly its window, and
        // Tone's 0.1 default is an audible lyric-sync offset on a karaoke video.
        const shifter = new Tone.PitchShift({ pitch: 0, wet: 0, windowSize: 0.05 }).toDestination();
        Tone.connect(source, shifter);
        chain = { el: mediaEl, shifter };
        chainRef.current = chain;
        // The stepper tap that engaged us satisfies gesture activation.
        await Tone.start();
        if (cancelled) return;
        logger().info('keyshift.chain-built', {});
      }
      chain.shifter.pitch = shift;
      chain.shifter.wet.value = shift === 0 ? 0 : 1;
      logger().debug('keyshift.set', { semitones: shift });
    })().catch((e) => {
      logger().warn('keyshift.error', { message: e?.message });
    });
    return () => { cancelled = true; };
  }, [mediaEl, semitones]);

  // Dispose only on unmount — the player, its element, and this hook tear down
  // together, so mid-session the chain must survive natural-key passages.
  useEffect(() => () => {
    try { chainRef.current?.shifter?.dispose?.(); } catch { /* torn down */ }
    chainRef.current = null;
  }, []);
}
