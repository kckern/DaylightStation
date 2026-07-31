// useKeyShift.js — route the Player's media element through Signalsmith Stretch
// (WASM AudioWorklet) so karaoke songs can be transposed live (±semitones)
// without touching the shared Player. Attaches from the consumer side via the
// element resolved by useResolvedMediaEl, mirroring how SingalongPlayer already
// drives volume. Signalsmith replaced Tone.PitchShift after spectrum
// measurement showed the delay-line shifter smearing energy across neighboring
// semitones (audibly discordant on a full mix); Signalsmith concentrates
// essentially all output at the target pitch.
import { useEffect, useRef, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import loadStretchEngine from './loadStretchEngine.js';
import { clampKeyShift } from './keyShift.js';

// A stretch-engine init that neither resolves nor rejects is heard as dead
// silence (the element is already captured). Convert hangs into rejections.
export const STRETCH_INIT_TIMEOUT_MS = 6000;

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
  if (!sharedCtx) {
    sharedCtx = new AudioContext();
    // A suspended/interrupted context silences every captured element, so any
    // state flip is telemetry-worthy on its own.
    sharedCtx.onstatechange = () => logger().info('keyshift.ctx-state', { state: sharedCtx.state });
  }
  return sharedCtx;
}

// Everything about the element that can explain silence: a cross-origin src
// without crossOrigin="anonymous" makes createMediaElementSource output pure
// zeros (CORS taint — silent, no error); blob:/data: (MSE) are exempt.
function describeEl(el) {
  let srcScheme = null;
  let sameOrigin = null;
  try {
    const src = el.currentSrc || el.src || '';
    if (src) {
      const u = new URL(src, window.location.href);
      srcScheme = u.protocol.replace(':', '');
      sameOrigin = u.protocol === 'blob:' || u.protocol === 'data:' || u.origin === window.location.origin;
    }
  } catch { /* unparseable src — report nulls */ }
  return {
    srcScheme,
    sameOrigin,
    crossOrigin: el.crossOrigin ?? null,
    readyState: el.readyState,
    paused: el.paused,
    muted: el.muted,
    volume: el.volume,
  };
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
  const [engineFailed, setEngineFailed] = useState(false);

  useEffect(() => {
    const shift = clampKeyShift(semitones);
    if (!mediaEl) return undefined;
    if (!engagedRef.current && shift === 0) return undefined;
    engagedRef.current = true;
    let cancelled = false;
    let stage = 'start'; // which await we're inside — the watchdog reports it
    const t0 = Date.now();
    const elInfo = describeEl(mediaEl);
    logger().info('keyshift.engage', {
      semitones: shift,
      rebuild: !chainRef.current || chainRef.current.el !== mediaEl,
      ctxState: sharedCtx?.state ?? null,
      ...elInfo,
    });
    if (elInfo.sameOrigin === false && !elInfo.crossOrigin) {
      logger().warn('keyshift.cors-taint-risk', {
        srcScheme: elInfo.srcScheme,
        note: 'cross-origin media without crossOrigin attr — element source will output silence',
      });
    }
    // From source-capture onward the element is audible ONLY through the graph;
    // a hang before chain-built is heard as dead silence. If we're still
    // in-flight after 4s, say so and name the stage that never finished.
    const watchdog = setTimeout(() => {
      logger().warn('keyshift.stalled', {
        stage,
        semitones: shift,
        elapsedMs: Date.now() - t0,
        ctxState: sharedCtx?.state ?? null,
      });
    }, 4000);
    (async () => {
      stage = 'import';
      const SignalsmithStretch = await loadStretchEngine();
      if (cancelled) { logger().info('keyshift.cancelled', { stage }); return; }
      let chain = chainRef.current;
      if (!chain || chain.el !== mediaEl) {
        // Element appeared or was swapped (Player resilience reinit): rebuild.
        teardown(chainRef.current);
        const ac = ctx();
        let source = sourceByEl.get(mediaEl);
        const reused = Boolean(source);
        if (!source) {
          source = ac.createMediaElementSource(mediaEl);
          sourceByEl.set(mediaEl, source);
        } else {
          source.disconnect(); // drop the bypass edge a previous teardown left
        }
        logger().info('keyshift.source-captured', { reused, ctxState: ac.state ?? null });
        stage = 'stretch-load';
        const stretch = await Promise.race([
          SignalsmithStretch(ac),
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error(`engine init timed out after ${STRETCH_INIT_TIMEOUT_MS}ms`)),
              STRETCH_INIT_TIMEOUT_MS,
            );
          }),
        ]);
        if (cancelled) {
          source.connect(ac.destination);
          logger().info('keyshift.cancelled', { stage, rerouted: true });
          return;
        }
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
        stage = 'resume';
        await ac.resume();
        logger().info('keyshift.chain-built', {
          engine: 'signalsmith-stretch',
          buildMs: Date.now() - t0,
          ctxState: ac.state ?? null,
        });
      }
      stage = 'schedule';
      if (shift === 0) {
        chain.dry.gain.value = 1;
        chain.wet.gain.value = 0;
        chain.stretch.schedule({ active: false });
      } else {
        chain.dry.gain.value = 0;
        chain.wet.gain.value = 1;
        chain.stretch.schedule({ active: true, semitones: shift });
      }
      stage = 'done';
      clearTimeout(watchdog);
      logger().info('keyshift.set', {
        semitones: shift,
        path: shift === 0 ? 'dry' : 'wet',
        ctxState: sharedCtx?.state ?? null,
        elapsedMs: Date.now() - t0,
      });
    })().catch((e) => {
      clearTimeout(watchdog);
      if (cancelled) {
        // A superseded run (e.g. the user tapped again before this run's
        // engine settled) failing late — often its own leaked init-timeout
        // finally firing — must be a no-op. A later run may already have
        // built a healthy chain for this element; touching the source or
        // the failure flag here would silently break working audio.
        logger().info('keyshift.cancelled-error', { stage, message: e?.message });
        return;
      }
      // Fail AUDIBLE: if this element was captured but its chain never
      // finished, the graph is source → nothing. Reroute straight to the
      // speakers and flag the engine so the stepper greys out instead of
      // muting the song.
      const chain = chainRef.current;
      if (!chain || chain.el !== mediaEl) {
        const source = sourceByEl.get(mediaEl);
        if (source) {
          try {
            source.disconnect();
            source.connect(ctx().destination);
            logger().info('keyshift.failed-audible-reroute', {});
          } catch { /* context torn down */ }
        }
      }
      setEngineFailed(true);
      logger().warn('keyshift.error', {
        stage,
        message: e?.message,
        name: e?.name,
        stack: e?.stack?.split('\n').slice(0, 4).join(' <- '),
      });
    });
    return () => { cancelled = true; clearTimeout(watchdog); };
  }, [mediaEl, semitones]);

  // Teardown only on unmount — mid-session the chain must survive natural-key
  // passages. The captured element may outlive this hook (Player teardown is
  // async), so the source is rerouted straight to the speakers, never orphaned.
  useEffect(() => () => {
    if (chainRef.current) logger().info('keyshift.teardown', {});
    teardown(chainRef.current);
    chainRef.current = null;
  }, []);

  return engineFailed;
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
