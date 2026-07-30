// useKeyShift.js — route the Player's media element through Signalsmith Stretch
// (WASM AudioWorklet) so karaoke songs can be transposed live (±semitones)
// without touching the shared Player. Attaches from the consumer side via the
// element resolved by useResolvedMediaEl, mirroring how SingalongPlayer already
// drives volume. Signalsmith replaced Tone.PitchShift after spectrum
// measurement showed the delay-line shifter smearing energy across neighboring
// semitones (audibly discordant on a full mix); Signalsmith concentrates
// essentially all output at the target pitch.
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
// and chain rebuilds reuse it instead of exploding. One shared context serves
// every chain; a captured element can never be un-captured, only re-routed.
const sourceByEl = new WeakMap();
let sharedCtx = null;
function ctx() {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

/**
 * Keep `mediaEl`'s audio pitch-shifted by `semitones` (clamped whole steps).
 *
 * Lazy on purpose: nothing is imported or routed until the user first moves
 * off the natural key, so songs played untransposed never pay for the WASM
 * engine nor get their audio rerouted. Once engaged, the graph holds BOTH
 * paths — source → dry gain → destination and source → stretch → wet gain →
 * destination — and flips gains: the dry path keeps natural-key playback at
 * zero added latency; the stretch path (~120ms) only sounds while shifted.
 */
export default function useKeyShift(mediaEl, semitones) {
  const chainRef = useRef(null); // { el, source, stretch, dry, wet }
  const engagedRef = useRef(false);

  useEffect(() => {
    const shift = clampKeyShift(semitones);
    if (!mediaEl) return undefined;
    if (!engagedRef.current && shift === 0) return undefined;
    engagedRef.current = true;
    let cancelled = false;
    (async () => {
      const { default: SignalsmithStretch } = await import('signalsmith-stretch');
      if (cancelled) return;
      let chain = chainRef.current;
      if (!chain || chain.el !== mediaEl) {
        // Element appeared or was swapped (Player resilience reinit): rebuild.
        teardown(chainRef.current);
        const ac = ctx();
        let source = sourceByEl.get(mediaEl);
        if (!source) {
          source = ac.createMediaElementSource(mediaEl);
          sourceByEl.set(mediaEl, source);
        } else {
          source.disconnect(); // drop the bypass edge a previous teardown left
        }
        const stretch = await SignalsmithStretch(ac);
        if (cancelled) { source.connect(ac.destination); return; }
        const dry = ac.createGain();
        const wet = ac.createGain();
        source.connect(dry);
        dry.connect(ac.destination);
        source.connect(stretch);
        stretch.connect(wet);
        wet.connect(ac.destination);
        chain = { el: mediaEl, source, stretch, dry, wet };
        chainRef.current = chain;
        // The stepper tap that engaged us satisfies gesture activation.
        await ac.resume();
        logger().info('keyshift.chain-built', { engine: 'signalsmith-stretch' });
      }
      if (shift === 0) {
        chain.dry.gain.value = 1;
        chain.wet.gain.value = 0;
        chain.stretch.schedule({ active: false });
      } else {
        chain.dry.gain.value = 0;
        chain.wet.gain.value = 1;
        chain.stretch.schedule({ active: true, semitones: shift });
      }
      logger().debug('keyshift.set', { semitones: shift });
    })().catch((e) => {
      logger().warn('keyshift.error', { message: e?.message });
    });
    return () => { cancelled = true; };
  }, [mediaEl, semitones]);

  // Teardown only on unmount — mid-session the chain must survive natural-key
  // passages. The captured element may outlive this hook (Player teardown is
  // async), so the source is rerouted straight to the speakers, never orphaned.
  useEffect(() => () => {
    teardown(chainRef.current);
    chainRef.current = null;
  }, []);
}

function teardown(chain) {
  if (!chain) return;
  try { chain.stretch.stop?.(); } catch { /* torn down */ }
  try { chain.stretch.disconnect?.(); } catch { /* torn down */ }
  try { chain.dry.disconnect(); } catch { /* torn down */ }
  try { chain.wet.disconnect(); } catch { /* torn down */ }
  try {
    chain.source.disconnect();
    chain.source.connect(ctx().destination);
  } catch { /* torn down */ }
}
