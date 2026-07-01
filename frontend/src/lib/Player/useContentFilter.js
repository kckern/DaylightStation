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

// Overlay effects (blur/censor-bar/…) fade in and out over this window (blur
// radius / opacity ramp) instead of hard-cutting. On exit we keep the overlay
// mounted this long with `visible:false` so it can ramp to 0 before unmount.
const FILTER_FADE_MS = 300;

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
  // Overlay fade lifecycle: cueId -> { effect, cue, visible }. Entries linger with
  // visible:false for FILTER_FADE_MS after a cue exits so the blur can ramp to 0.
  const overlayLifeRef = useRef(new Map());
  const overlayTimersRef = useRef(new Map()); // cueId -> removal timeout

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

    // Tear down the overlay fade lifecycle (timers + tracked entries).
    const clearOverlayLife = () => {
      overlayTimersRef.current.forEach((to) => clearTimeout(to));
      overlayTimersRef.current.clear();
      overlayLifeRef.current.clear();
    };

    // Publish the current overlay lifecycle (active + fading-out) to React, only
    // when the visible set changed (key includes `visible` so a fade toggle renders).
    const commitOverlays = () => {
      const list = [...overlayLifeRef.current.values()]
        .map((e) => ({ effect: e.effect, cue: e.cue, visible: e.visible }));
      setActiveOverlays((prev) => {
        const key = (arr) => arr.map((o) => `${o.effect}:${o.cue.id}:${o.visible ? 1 : 0}`).join('|');
        return key(prev) === key(list) ? prev : list;
      });
    };

    if (!enabled || !el) {
      exitAll();
      clearOverlayLife();
      setActiveOverlays((p) => (p.length ? [] : p));
      setActiveCard((p) => (p ? null : p));
      return undefined;
    }

    // Resolved summary (info, prod-visible): the ACTUAL filter shape after the
    // cascade — effect breakdown, ms-vs-approx precision split, and the sync
    // offset. One line answers "what filter is really applied to this title?".
    const byEffect = {};
    let msCount = 0; let approxCount = 0;
    for (const c of effectiveCues) {
      byEffect[c.effect] = (byEffect[c.effect] || 0) + 1;
      if (c.precision === 'ms') msCount += 1; else approxCount += 1;
    }
    logger().info?.('content-filter.resolved', {
      effects: byEffect, ms: msCount, approx: approxCount,
      syncOffset: override?.sync?.offsetSec ?? 0,
    });

    // Per-session apply tally (emitted at teardown).
    const session = { applied: {}, blurAudioSec: 0 };

    const tick = () => {
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
        // Unsampled debug trace: the CLEAR half of each cue. Pairs with the enter
        // trace below for a complete arm→fire→clear record during a QA/debug pass.
        // debug level is filtered in prod (default info), so this never spams there.
        logger().debug?.('content-filter.exit', {
          effect: cue.effect, cue: id, category: cue.category,
          in: +cue.in.toFixed(2), out: +cue.out.toFixed(2), at: +t.toFixed(2),
        });
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
          session.applied[cue.effect] = (session.applied[cue.effect] || 0) + 1;
          if (cue.effect === 'full-blur') session.blurAudioSec += Math.max(0, cue.out - cue.in);
          // Rate-limited so it's visible in prod without spamming per-cue (mute is
          // the leak-prone effect — this is how we confirm a mute actually fired).
          logger().sampled?.('content-filter.applied',
            { effect: cue.effect, cue: cue.id, in: +cue.in.toFixed(2), out: +cue.out.toFixed(2) },
            { maxPerMinute: 40 });
          // Unsampled debug trace: the ARM/FIRE half. Unlike the rate-limited
          // `.applied` info above, this never drops a cue — so the debug HUD's
          // ◀/▶ scrubbing produces a complete, gap-free trace. Carries category
          // + the exact playhead time the cue fired at.
          logger().debug?.('content-filter.enter', {
            effect: cue.effect, cue: cue.id, category: cue.category,
            in: +cue.in.toFixed(2), out: +cue.out.toFixed(2), at: +t.toFixed(2),
          });
        }
        // Transport effects act every tick while active (e.g. keep seeking past).
        if (h.kind === EFFECT_KINDS.TRANSPORT && h.onActive) h.onActive(ctxFor(cue));
        if (h.kind === EFFECT_KINDS.OVERLAY) overlays.push({ effect: cue.effect, cue });
      }

      // Overlay fade lifecycle: mark active overlays visible (cancel any pending
      // removal); mark exited ones visible:false and schedule removal after the
      // fade so <FilterOverlay> can ramp the blur radius to 0 before unmount.
      const life = overlayLifeRef.current;
      const timers = overlayTimersRef.current;
      const activeOverlayIds = new Set(overlays.map((o) => o.cue.id));
      for (const o of overlays) {
        const pending = timers.get(o.cue.id);
        if (pending) { clearTimeout(pending); timers.delete(o.cue.id); }
        life.set(o.cue.id, { effect: o.effect, cue: o.cue, visible: true });
      }
      life.forEach((entry, id) => {
        if (activeOverlayIds.has(id) || !entry.visible) return;
        life.set(id, { ...entry, visible: false }); // begin fade-out
        if (!timers.has(id)) {
          timers.set(id, setTimeout(() => {
            life.delete(id);
            timers.delete(id);
            commitOverlays(); // unmount once faded
          }, FILTER_FADE_MS));
        }
      });
      commitOverlays();

      // Card: any active cue carrying plot text (skip cards, title-cards).
      const carded = active.find((c) => c.card || c.text);
      const cardText = carded ? (carded.card || carded.text) : null;
      setActiveCard((prev) => (prev?.text === cardText ? prev : (cardText ? { text: cardText } : null)));
    };

    // Driver: react to the playhead moving, and — critically — to jumps/stalls.
    // - timeupdate: coarse (~4Hz) baseline, always present.
    // - seeked/ratechange/playing/waiting: re-evaluate immediately after a
    //   jump/rate change/stall so we never apply late or leave a stale effect.
    // - seeking: RELEASE active effects before the playhead jumps (a seek can
    //   land past a short mute window; releasing avoids a stuck mute).
    // - requestVideoFrameCallback: per-displayed-frame (~16-42ms) precision,
    //   ~10x tighter than timeupdate and immune to timeupdate throttling/jank.
    const reactEvents = ['timeupdate', 'seeked', 'ratechange', 'playing', 'waiting'];
    reactEvents.forEach((ev) => el.addEventListener(ev, tick));
    const onSeeking = () => { exitAll(); };
    el.addEventListener('seeking', onSeeking);

    let stopped = false;
    let rvfcHandle = null;
    const hasRvfc = typeof el.requestVideoFrameCallback === 'function';
    if (hasRvfc) {
      const frame = () => {
        if (stopped) return;
        tick();
        rvfcHandle = el.requestVideoFrameCallback(frame);
      };
      rvfcHandle = el.requestVideoFrameCallback(frame);
    }

    logger().debug?.('content-filter.mounted', { cues: effectiveCues.length, driver: hasRvfc ? 'rvfc' : 'timeupdate' });
    return () => {
      stopped = true;
      if (hasRvfc && rvfcHandle != null && typeof el.cancelVideoFrameCallback === 'function') {
        try { el.cancelVideoFrameCallback(rvfcHandle); } catch (_) { /* ignore */ }
      }
      reactEvents.forEach((ev) => el.removeEventListener(ev, tick));
      el.removeEventListener('seeking', onSeeking);
      exitAll();
      clearOverlayLife();
      // Session summary (info): what actually fired this segment + blur-with-audio
      // exposure (seconds where video was hidden but audio kept — leak surface).
      logger().info?.('content-filter.session', {
        applied: session.applied, blurAudioSec: +session.blurAudioSec.toFixed(1),
      });
    };
  }, [enabled, getMediaEl, transport, effectiveCues, sfxPlayer]);

  return { activeOverlays, activeCard, effectiveCues };
}
