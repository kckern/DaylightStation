import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import lottie from 'lottie-web';
import { DaylightAPI, DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ambience-effects' });
  return _logger;
}

const DEFAULT_DURATION_S = 4.5;
const COOLDOWN_MS = 3000;
const DUCK_FACTOR = 0.35;

const mediaUrl = (path) => DaylightMediaPath(`/media/${String(path).replace(/^\/+/, '')}`);

// One fetch per Lottie file per page load; effects replay many times a night.
const lottieCache = new Map();
function loadLottie(path) {
  if (!lottieCache.has(path)) {
    lottieCache.set(path, fetch(mediaUrl(path)).then((r) => {
      if (!r.ok) throw new Error(`lottie ${r.status}`);
      return r.json();
    }).catch((err) => { lottieCache.delete(path); throw err; }));
  }
  return lottieCache.get(path);
}

/** Normalize the ambience `effects` config; drops entries with no id/label. */
export function resolveEffects(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((e) => e && e.id && e.label)
    .map((e) => ({
      id: String(e.id),
      label: String(e.label),
      sound: typeof e.sound === 'string' ? e.sound : null,
      lottie: typeof e.lottie === 'string' ? e.lottie : null,
      motion: ['center', 'float-across', 'walk-bottom', 'flock'].includes(e.motion) ? e.motion : 'center',
      screen: ['flash', 'confetti'].includes(e.screen) ? e.screen : null,
      lights: typeof e.lights === 'string' ? e.lights : null,
      duration: Number.isFinite(Number(e.duration)) && Number(e.duration) > 0 ? Number(e.duration) : DEFAULT_DURATION_S,
    }));
}

function LottieSprite({ path, className, style }) {
  const ref = useRef(null);
  useEffect(() => {
    let anim = null;
    let cancelled = false;
    loadLottie(path).then((data) => {
      if (cancelled || !ref.current) return;
      anim = lottie.loadAnimation({ container: ref.current, renderer: 'svg', loop: true, autoplay: true, animationData: data });
    }).catch((err) => logger().warn('fitness.ambience.lottie_failed', { path, error: err?.message ?? null }));
    return () => { cancelled = true; anim?.destroy(); };
  }, [path]);
  return <div ref={ref} className={className} style={style} aria-hidden="true" />;
}

LottieSprite.propTypes = { path: PropTypes.string.isRequired, className: PropTypes.string, style: PropTypes.object };

const CONFETTI_COLORS = ['#ff8a00', '#8a2be2', '#ffd24a', '#3ddc84', '#ff2d95'];

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.8,
    duration: 2.2 + Math.random() * 1.6,
    rotate: Math.random() * 360,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  })), []);
  return (
    <div className="amb-fx-confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span key={i} style={{
          left: `${p.left}%`, background: p.color,
          animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`,
          transform: `rotate(${p.rotate}deg)`,
        }} />
      ))}
    </div>
  );
}

/** The visual half of one running effect, laid over the video. */
export function EffectOverlay({ effect }) {
  if (!effect) return null;
  const style = { '--amb-fx-dur': `${effect.duration}s` };
  return (
    <div className="amb-fx-layer" style={style} data-effect={effect.id}>
      {effect.screen === 'flash' && <div className="amb-fx-flash" />}
      {effect.screen === 'confetti' && <Confetti />}
      {effect.lottie && effect.motion === 'flock' && [0, 1, 2, 3, 4].map((i) => (
        <LottieSprite key={i} path={effect.lottie} className="amb-fx-sprite amb-fx-flock"
          style={{ top: `${6 + i * 14}%`, animationDelay: `${i * 0.3}s`, '--amb-fx-scale': 0.6 + (i % 3) * 0.2 }} />
      ))}
      {effect.lottie && effect.motion !== 'flock' && (
        <LottieSprite path={effect.lottie} className={`amb-fx-sprite amb-fx-${effect.motion}`} />
      )}
    </div>
  );
}

EffectOverlay.propTypes = { effect: PropTypes.object };

/**
 * useAmbienceEffects — fires soundboard effects: plays the sound (music ducked
 * underneath), shows the overlay for the effect's duration, and asks the
 * backend for the room's light burst. One effect at a time, 3 s apart.
 *
 * @param {object} opts
 * @param {string|null} opts.ambienceId
 * @param {Array} opts.effects — resolved effects
 * @param {object} opts.musicRef — Player ref for the music (ducked during a sound)
 */
export function useAmbienceEffects({ ambienceId, effects, musicRef }) {
  const [active, setActive] = useState(null);
  // Armed: { effect, fireAt } — fires on its own after the delay so the
  // operator can step away from the screen first.
  const [armed, setArmed] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const lastAtRef = useRef(-Infinity);
  const timersRef = useRef([]);
  const armTimerRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    clearTimeout(armTimerRef.current);
    audioRef.current?.pause();
  }, []);

  // 1 s tick only while something is armed (drives the countdown).
  useEffect(() => {
    if (!armed) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [armed]);

  // Warm the Lottie cache so the first press isn't a blank beat.
  useEffect(() => {
    effects.forEach((e) => { if (e.lottie) loadLottie(e.lottie).catch(() => {}); });
  }, [effects]);

  const trigger = useCallback((effect) => {
    const now = Date.now();
    if (active || now - lastAtRef.current < COOLDOWN_MS) {
      logger().debug('fitness.ambience.effect_cooldown', { id: effect.id });
      return false;
    }
    lastAtRef.current = now;
    setActive(effect);
    logger().info('fitness.ambience.effect_fire', { ambienceId, id: effect.id, lights: effect.lights });

    if (effect.lights && ambienceId) {
      DaylightAPI(`api/v1/fitness/ambience/${encodeURIComponent(ambienceId)}/effect/${encodeURIComponent(effect.id)}`, {}, 'POST')
        .catch((err) => logger().warn('fitness.ambience.effect_post_failed', { id: effect.id, message: err?.message ?? null }));
    }

    const music = musicRef?.current?.getMediaElement?.() ?? null;
    const musicVolume = music ? music.volume : null;
    if (effect.sound) {
      try {
        const audio = new Audio(mediaUrl(effect.sound));
        audioRef.current = audio;
        if (music) music.volume = musicVolume * DUCK_FACTOR;
        audio.play().catch((err) => logger().warn('fitness.ambience.sound_failed', { id: effect.id, error: err?.message ?? null }));
      } catch (err) {
        logger().warn('fitness.ambience.sound_failed', { id: effect.id, error: err?.message ?? null });
      }
    }
    timersRef.current.push(setTimeout(() => {
      setActive(null);
      if (music && musicVolume != null) music.volume = musicVolume;
    }, effect.duration * 1000));
    return true;
  }, [active, ambienceId, musicRef]);

  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;

  const arm = useCallback((effect, delayMs) => {
    clearTimeout(armTimerRef.current);
    const fireAt = Date.now() + delayMs;
    setArmed({ effect, fireAt });
    setNow(Date.now());
    logger().info('fitness.ambience.effect_armed', { ambienceId, id: effect.id, delayMs });
    const fire = () => {
      // A running effect or the cooldown would drop it; try again shortly.
      if (!triggerRef.current(effect)) {
        armTimerRef.current = setTimeout(fire, 1000);
        return;
      }
      setArmed(null);
    };
    armTimerRef.current = setTimeout(fire, delayMs);
  }, [ambienceId]);

  const cancelArm = useCallback(() => {
    clearTimeout(armTimerRef.current);
    setArmed((prev) => {
      if (prev) logger().info('fitness.ambience.effect_disarmed', { ambienceId, id: prev.effect.id });
      return null;
    });
  }, [ambienceId]);

  const armedRemainingS = armed ? Math.max(0, Math.ceil((armed.fireAt - now) / 1000)) : null;
  return { active, trigger, armed, armedRemainingS, arm, cancelArm };
}

/**
 * Armed indicator: tiny, low-contrast, bottom-right — readable by the
 * operator up close, not by the people watching the screen. Tap to cancel.
 */
export function ArmedIndicator({ armed, remainingS, onCancel }) {
  if (!armed) return null;
  return (
    <button type="button" className="amb-fx-armed" onClick={onCancel} aria-label={`Cancel ${armed.effect.label}`}>
      <span className="amb-fx-armed__dot" />
      {armed.effect.label} · {remainingS}s
    </button>
  );
}

ArmedIndicator.propTypes = { armed: PropTypes.object, remainingS: PropTypes.number, onCancel: PropTypes.func.isRequired };

/**
 * Operator panel: a slim, dim column on the right edge with small text, so
 * spectators don't read it as part of the show. "Now" fires on tap; the
 * delayed mode arms the effect and closes the panel so you can walk away.
 */
export function EffectsBoard({ effects, active, delaySeconds, onFire, onArm, onClose }) {
  const [delayed, setDelayed] = useState(false);
  return (
    <div className="amb-fx-board" role="dialog" aria-label="Effects">
      <div className="amb-fx-board__backdrop" onPointerDown={onClose} />
      <div className="amb-fx-board__col">
        <div className="amb-fx-board__mode" role="group" aria-label="When">
          <button type="button" className={delayed ? '' : 'is-on'} aria-pressed={!delayed} onClick={() => setDelayed(false)}>Now</button>
          <button type="button" className={delayed ? 'is-on' : ''} aria-pressed={delayed} onClick={() => setDelayed(true)}>{delaySeconds}s</button>
        </div>
        {effects.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`amb-fx-board__btn${active?.id === e.id ? ' is-active' : ''}`}
            disabled={!delayed && !!active}
            onClick={() => {
              if (delayed) onArm(e); else onFire(e);
              onClose();
            }}
          >
            {e.label}
          </button>
        ))}
      </div>
    </div>
  );
}

EffectsBoard.propTypes = {
  effects: PropTypes.array.isRequired,
  active: PropTypes.object,
  delaySeconds: PropTypes.number,
  onFire: PropTypes.func.isRequired,
  onArm: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
