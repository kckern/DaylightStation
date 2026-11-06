/**
 * useContentFilter — applies a resolved content-filter EDL to a playing media
 * element in real time (the consumer of the 3-layer cascade; see
 * ops:docs/_wip/plans/2026-06-30-content-filter-layer-design.md).
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
import { getChildLogger } from "../../../../../frontend/src/lib/logging/singleton.js";
import { resolveEffectiveCues, cuesActiveAt } from "./contentFilter.js";
import { getEffectHandler, EFFECT_KINDS, SKIP_EPSILON } from "./filterEffects.js";
import { setSkipCardPaused } from "./skipCardState.js";
import { createBleepTone } from "./bleepTone.js";

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'content-filter' }));

// Overlay effects (blur/censor-bar/…) fade in and out over this window (blur
// radius / opacity ramp) instead of hard-cutting. On exit we keep the overlay
// mounted this long with `visible:false` so it can ramp to 0 before unmount.
const FILTER_FADE_MS = 300;

// Cue entries that do not bump fireCount in the generic enter path.
const NOT_A_FIRE = new Set(['title-card', 'skip-card']);

const logBleepDegraded = (reason) =>
  logger().sampled?.('content-filter.bleep.degraded', { reason }, { maxPerMinute: 5 });

/**
 * Default SFX player: named sounds from profile.sounds, else the synthesized 1 kHz
 * bleep. A named sound that cannot play falls back to the tone and is logged.
 * `tone` is injectable for tests.
 */
export function createSfxPlayer(sounds, { tone = createBleepTone({ onDegraded: logBleepDegraded }) } = {}) {
  let audio = null;
  const stopAudio = () => { try { audio?.pause?.(); } catch (_) { /* ignore */ } audio = null; };
  const fallBack = (reason, opts) => { logBleepDegraded(reason); tone.start(opts); };
  return {
    play(name, opts = {}) {
      stopAudio(); // never orphan a looping sound
      const url = sounds?.[name];
      if (!url) { fallBack('unknown-sound', opts); return; }
      if (typeof Audio === 'undefined') { fallBack('no-audio-element', opts); return; }
      let a;
      try {
        a = new Audio(url);
        a.loop = true;
        if (Number.isFinite(opts.volume)) a.volume = Math.min(1, Math.max(0, opts.volume));
      } catch (_) { fallBack('audio-error', opts); return; }
      audio = a;
      try {
        a.play?.()?.catch?.(() => {
          if (audio !== a) return; // stopped or replaced before the rejection landed
          audio = null;
          fallBack('play-rejected', opts);
        });
      } catch (_) { audio = null; fallBack('play-error', opts); }
    },
    tone(opts) { tone.start(opts); },
    stop() { stopAudio(); tone.stop(); },
  };
}

/**
 * @param {object} args
 * @param {() => HTMLMediaElement} args.getMediaEl
 * @param {{seek: (s:number)=>void}} args.transport
 * @param {{cues: Array}} args.edl        L1 base EDL
 * @param {object} args.profile           L2 profile/theme
 * @param {object} [args.override]        L3 per-title override
 * @param {string|null} [args.part]       media part being played (refined cue times bind to a part)
 * @param {{play:Function, tone:Function, stop:Function}} [args.sfx]  SFX player (injectable for tests).
 *   Must be memoized: it is a dependency of the main effect, so a new object each
 *   render tears the filter down (exitAll) and re-attaches on every render.
 * @param {boolean} [args.enabled=true]
 * @returns {{activeOverlays: Array<{effect:string,cue:object}>, activeCard: {text:string}|null, effectiveCues: Array, fireCount: number}}
 */
export function useContentFilter({ getMediaEl, transport, edl, profile, override, part = null, sfx, enabled = true } = {}) {
  const effectiveCues = useMemo(
    () => (edl && profile ? resolveEffectiveCues({ edl, profile, override, part }) : []),
    [edl, profile, override, part]
  );
  const defaultSfx = useMemo(() => createSfxPlayer(profile?.sounds), [profile?.sounds]);
  const sfxPlayer = sfx || defaultSfx;

  // Latest-value refs: callers may pass a fresh getMediaEl/transport each render.
  // Re-running the main effect on identity alone would exitAll() mid-cue (unmute,
  // stop the bleep) and re-enter on the next tick, so the effect reads these refs.
  const getMediaElRef = useRef(getMediaEl);
  getMediaElRef.current = getMediaEl;
  const transportRef = useRef(transport);
  transportRef.current = transport;

  const [activeOverlays, setActiveOverlays] = useState([]);
  const [activeCard, setActiveCard] = useState(null);
  // Bumped once per cue entry so the filter-active badge can pulse on each fire.
  const [fireCount, setFireCount] = useState(0);

  // Cues currently "entered" (id -> cue), so we can fire onExit exactly once.
  const enteredRef = useRef(new Map());
  const memRef = useRef({});
  // Overlay fade lifecycle: cueId -> { effect, cue, visible }. Entries linger with
  // visible:false for FILTER_FADE_MS after a cue exits so the blur can ramp to 0.
  const overlayLifeRef = useRef(new Map());
  const overlayTimersRef = useRef(new Map()); // cueId -> removal timeout
  // skip-card state: cues already fired (so we don't re-trigger) + the real-time
  // resume timer (rVFC is paused during the card, so resume can't be frame-driven).
  const skipCardRef = useRef({ doneIds: new Set(), timer: null });

  // Clear a pending skip-card resume timer only on true unmount (not on every
  // effect re-run — see the main effect's cleanup note). Also release the paused
  // flag so the loading spinner isn't left suppressed if we unmount mid-card.
  useEffect(() => () => {
    if (skipCardRef.current.timer) { clearTimeout(skipCardRef.current.timer); skipCardRef.current.timer = null; }
    setSkipCardPaused(false);
  }, []);

  // The element the main effect is attached to, and a generation bumped when the
  // host swaps it out from under a stable getMediaEl (see the rebind check below).
  const boundElRef = useRef(null);
  const [elGen, setElGen] = useState(0);
  const elGenRef = useRef(0);

  useEffect(() => {
    const el = getMediaElRef.current?.();
    boundElRef.current = enabled ? (el || null) : null;
    const transport = { seek: (s) => transportRef.current?.seek?.(s) };

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
    const scenes = effectiveCues.sceneSummary;
    if (scenes?.scenes) {
      logger().info?.('content-filter.scene.resolved', { scenes: scenes.scenes, effects: scenes.byEffect, untrusted: scenes.untrusted });
      if (scenes.untrusted.length) logger().warn?.('content-filter.scene.fallback', { untrusted: scenes.untrusted, scenes: scenes.scenes });
    }

    // Per-session apply tally (emitted at teardown).
    const session = { applied: {}, blurAudioSec: 0 };

    const tick = () => {
      // While a skip-card is showing, the element is PAUSED (rVFC won't fire) and a
      // real-time timer drives the resume — so ignore any stray ticks here.
      if (skipCardRef.current.timer) return;
      const t = el.currentTime;
      if (!Number.isFinite(t)) return;
      const active = cuesActiveAt(effectiveCues, t);

      // skip-card: seek to the resume point and PAUSE so the seek buffers behind the
      // card; show the card; resume (play) after holdSec so playback is instant.
      const sc = active.find((c) => c.effect === 'skip-card' && !skipCardRef.current.doneIds.has(c.id));
      if (sc) {
        skipCardRef.current.doneIds.add(sc.id);
        setFireCount((n) => n + 1);
        transport?.seek?.(sc.out + SKIP_EPSILON);
        try { el.pause?.(); } catch (_) { /* ignore */ }
        setSkipCardPaused(true); // suppress the buffering spinner during the deliberate pause
        setActiveCard({ text: sc.text || 'Scene skipped.' });
        const holdMs = (typeof sc.holdSec === 'number' ? sc.holdSec : 2.5) * 1000;
        if (skipCardRef.current.timer) clearTimeout(skipCardRef.current.timer);
        skipCardRef.current.timer = setTimeout(() => {
          skipCardRef.current.timer = null;
          try { el.play?.(); } catch (_) { /* ignore */ }
          setSkipCardPaused(false);
          setActiveCard(null);
        }, holdMs);
        logger().info?.('content-filter.skip-card', { cue: sc.id, in: +sc.in.toFixed(2), out: +sc.out.toFixed(2), holdSec: sc.holdSec });
        return;
      }

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
          // A title-card only informs; skip-cards are counted in their own branch above.
          // A scene split across sync segments counts once.
          if (!NOT_A_FIRE.has(cue.effect) && cue.firstPiece !== false) setFireCount((n) => n + 1);
          if (cue.scene) logger().debug?.('content-filter.scene.enter', { scene: cue.scene, effect: cue.effect });
          if (cue.effect === 'blackout' && cue.firstPiece) logger().info?.('content-filter.blackout.shown', { scene: cue.scene, sec: +(cue.out - cue.in).toFixed(1) });
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

      // Card: only cues carrying an explicit `.card` annotation (legacy skip+card).
      // NOT `.text`, because title-card cues carry `.text` and already render via
      // activeOverlays — matching on `.text` here double-rendered the card.
      const carded = active.find((c) => c.card && c.effect !== 'title-card');
      const cardText = carded ? carded.card : null;
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

    // A bleep must not keep sounding over a paused or stalled picture. On
    // pause/waiting stop the sound (the video stays muted); on playing, after
    // tick() has run (registered later, so it fires later), restart it for the
    // first bleep cue still entered.
    const enteredBleep = () => [...enteredRef.current.values()].find((c) => c.effect === 'bleep');
    const onHalt = () => { if (enteredBleep()) sfxPlayer.stop?.(); };
    const onResume = () => {
      const cue = enteredBleep();
      if (!cue) return;
      const opts = { volume: el.volume };
      if (cue.sound) sfxPlayer.play?.(cue.sound, opts);
      else sfxPlayer.tone?.(opts);
    };
    const haltEvents = ['pause', 'waiting'];
    haltEvents.forEach((ev) => el.addEventListener(ev, onHalt));
    el.addEventListener('playing', onResume);

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
      // NOTE: do NOT clear the skip-card timer here — this cleanup also runs on
      // effect re-runs that are not unmounts (enabled toggled, cues or sfx player
      // changed), which would cancel an in-flight resume. It's cleared only on
      // true unmount (the effect above).
      if (hasRvfc && rvfcHandle != null && typeof el.cancelVideoFrameCallback === 'function') {
        try { el.cancelVideoFrameCallback(rvfcHandle); } catch (_) { /* ignore */ }
      }
      reactEvents.forEach((ev) => el.removeEventListener(ev, tick));
      el.removeEventListener('seeking', onSeeking);
      haltEvents.forEach((ev) => el.removeEventListener(ev, onHalt));
      el.removeEventListener('playing', onResume);
      exitAll();
      clearOverlayLife();
      // Session summary (info): what actually fired this segment + blur-with-audio
      // exposure (seconds where video was hidden but audio kept — leak surface).
      logger().info?.('content-filter.session', {
        applied: session.applied, blurAudioSec: +session.blurAudioSec.toFixed(1),
      });
    };
  // override?.sync?.offsetSec is read only for the 'content-filter.resolved' log
  // payload above; the real dependency is effectiveCues, which already
  // incorporates override — adding override directly would re-run this
  // timer/listener-setup effect on unrelated override field changes.
  // getMediaEl/transport are read through latest-value refs (see above), so a new
  // identity alone does not tear the filter down.
  // elGen: the element was replaced (see below), so release the old one and attach anew.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, effectiveCues, sfxPlayer, elGen]);

  // Rebind check, after every commit. VideoPlayer re-keys the media element (a
  // resilience re-mint, a bitrate-cap move, a soft reinit) while getMediaEl keeps
  // its identity, and a <dash-video>'s inner <video> can appear after commit.
  // Without this the listeners stay on the detached element and every later cue
  // goes unfiltered. The host re-renders about once a second, which bounds the gap.
  useEffect(() => {
    if (!enabled) return;
    const current = getMediaElRef.current?.() || null;
    if (current === boundElRef.current) return;
    const from = boundElRef.current ? 'detached' : 'none';
    boundElRef.current = current; // don't bump again before the main effect re-attaches
    elGenRef.current += 1;
    logger().info?.('content-filter.element.rebound', { from, gen: elGenRef.current });
    setElGen(elGenRef.current);
  });

  return { activeOverlays, activeCard, effectiveCues, fireCount };
}
