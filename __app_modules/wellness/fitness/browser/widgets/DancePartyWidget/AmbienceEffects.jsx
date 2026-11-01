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
  const lastAtRef = useRef(-Infinity);
  const timersRef = useRef([]);
  const audioRef = useRef(null);

  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    audioRef.current?.pause();
  }, []);

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

  return { active, trigger };
}

/** Wand popover: one big button per effect. */
export function EffectsBoard({ effects, active, onFire, onClose }) {
  return (
    <div className="amb-fx-board" role="dialog" aria-label="Effects">
      <div className="amb-fx-board__backdrop" onPointerDown={onClose} />
      <div className="amb-fx-board__row">
        {effects.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`amb-fx-board__btn${active?.id === e.id ? ' is-active' : ''}`}
            disabled={!!active}
            onClick={() => onFire(e)}
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
  onFire: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
