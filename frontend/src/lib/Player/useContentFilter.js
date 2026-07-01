/**
 * useContentFilter — applies a resolved content-filter EDL to a playing media
 * element in real time (the consumer of the 3-layer cascade; see
 * docs/_wip/plans/2026-06-30-content-filter-layer-design.md).
 *
 * Effects are dispatched through the registry in filterEffects.js. On each
 * `timeupdate` the hook diffs the set of active cues and fires each cue's
 * handler lifecycle:
 *   - onEnter/onExit  (audio effects: mute, bleep, duck)  — bracket the range
 *   - onActive        (transport effects: skip)           — every tick while active
 *   - overlay effects (blur, censor-bar, title-card, …)   — exposed for <FilterOverlay>
 *
 * Pure resolution lives in contentFilter.js; this hook only wires it to the DOM.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getChildLogger } from '../logging/singleton.js';
import { resolveEffectiveCues, cuesActiveAt } from './contentFilter.js';
import { getEffectHandler, EFFECT_KINDS } from './filterEffects.js';

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'content-filter' }));

/** Default SFX player for bleep sounds; maps a sound name -> URL via profile.sounds. */
function createSfxPlayer(sounds) {
  let audio = null;
  return {
    play(name) {
      const url = sounds?.[name];
      if (!url || typeof Audio === 'undefined') return;
      try { audio = new Audio(url); audio.loop = true; audio.play?.().catch(() => {}); } catch (_) { /* ignore */ }
    },
    stop() { try { audio?.pause?.(); } catch (_) { /* ignore */ } audio = null; },
  };
}

/**
 * @param {object} args
 * @param {() => HTMLMediaElement} args.getMediaEl
 * @param {{seek: (s:number)=>void}} args.transport
 * @param {{cues: Array}} args.edl        L1 base EDL
 * @param {object} args.profile           L2 profile/theme
 * @param {object} [args.override]        L3 per-title override
 * @param {{play:Function, stop:Function}} [args.sfx]  SFX player (injectable for tests)
 * @param {boolean} [args.enabled=true]
 * @returns {{activeOverlays: Array<{effect:string,cue:object}>, activeCard: {text:string}|null, effectiveCues: Array}}
 */
export function useContentFilter({ getMediaEl, transport, edl, profile, override, sfx, enabled = true } = {}) {
  const effectiveCues = useMemo(
    () => (edl && profile ? resolveEffectiveCues({ edl, profile, override }) : []),
    [edl, profile, override]
  );
  const defaultSfx = useMemo(() => createSfxPlayer(profile?.sounds), [profile?.sounds]);
  const sfxPlayer = sfx || defaultSfx;

  const [activeOverlays, setActiveOverlays] = useState([]);
  const [activeCard, setActiveCard] = useState(null);

  // Cues currently "entered" (id -> cue), so we can fire onExit exactly once.
  const enteredRef = useRef(new Map());
  const memRef = useRef({});

  useEffect(() => {
    const el = getMediaEl?.();

    const exitAll = () => {
      const prev = enteredRef.current;
      prev.forEach((cue) => {
        const h = getEffectHandler(cue.effect);
        if (h?.onExit) { try { h.onExit({ el, transport, cue, sfx: sfxPlayer, mem: memRef.current }); } catch (_) { /* ignore */ } }
      });
      prev.clear();
    };

    if (!enabled || !el) {
      exitAll();
      setActiveOverlays((p) => (p.length ? [] : p));
      setActiveCard((p) => (p ? null : p));
      return undefined;
    }

    const onTime = () => {
      const t = el.currentTime;
      if (!Number.isFinite(t)) return;
      const active = cuesActiveAt(effectiveCues, t);
      const activeIds = new Set(active.map((c) => c.id));
      const entered = enteredRef.current;
      const ctxFor = (cue) => ({ el, transport, cue, sfx: sfxPlayer, mem: memRef.current });

      // Exits: previously-entered cues no longer active.
      entered.forEach((cue, id) => {
        if (activeIds.has(id)) return;
        const h = getEffectHandler(cue.effect);
        if (h?.onExit) { try { h.onExit(ctxFor(cue)); } catch (e) { logger().warn?.('content-filter.exit-error', { effect: cue.effect, error: e?.message }); } }
        entered.delete(id);
      });

      const overlays = [];
      for (const cue of active) {
        const h = getEffectHandler(cue.effect);
        if (!h) {
          logger().sampled?.('content-filter.unknown-effect', { effect: cue.effect }, { maxPerMinute: 5 });
          continue;
        }
        // Enter (once).
        if (!entered.has(cue.id)) {
          entered.set(cue.id, cue);
          if (h.onEnter) { try { h.onEnter(ctxFor(cue)); } catch (e) { logger().warn?.('content-filter.enter-error', { effect: cue.effect, error: e?.message }); } }
          logger().debug?.('content-filter.enter', { cue: cue.id, effect: cue.effect, at: t });
        }
        // Transport effects act every tick while active (e.g. keep seeking past).
        if (h.kind === EFFECT_KINDS.TRANSPORT && h.onActive) h.onActive(ctxFor(cue));
        if (h.kind === EFFECT_KINDS.OVERLAY) overlays.push({ effect: cue.effect, cue });
      }

      // Overlays: only update state when the active set changes (avoid re-renders).
      setActiveOverlays((prev) => {
        const key = (arr) => arr.map((o) => `${o.effect}:${o.cue.id}`).join('|');
        return key(prev) === key(overlays) ? prev : overlays;
      });

      // Card: any active cue carrying plot text (skip cards, title-cards).
      const carded = active.find((c) => c.card || c.text);
      const cardText = carded ? (carded.card || carded.text) : null;
      setActiveCard((prev) => (prev?.text === cardText ? prev : (cardText ? { text: cardText } : null)));
    };

    el.addEventListener('timeupdate', onTime);
    logger().debug?.('content-filter.mounted', { cues: effectiveCues.length });
    return () => {
      el.removeEventListener('timeupdate', onTime);
      exitAll();
    };
  }, [enabled, getMediaEl, transport, effectiveCues, sfxPlayer]);

  return { activeOverlays, activeCard, effectiveCues };
}
