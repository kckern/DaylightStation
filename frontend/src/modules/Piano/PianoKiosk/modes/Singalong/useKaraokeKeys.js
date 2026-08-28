// useKaraokeKeys.js — the karaoke keyboard vocabulary for SingalongPlayer.
//
// The shared Player installs a window-level BUBBLE-phase keydown handler
// (lib/keyboard/keyboardManager.js) whose defaults are wrong for karaoke:
// double-ArrowRight skips to the next track (a singer's over-eager seek must
// never kill the song) and ArrowUp/Down cycle shaders. We are forbidden from
// editing the shared Player, so this hook claims its keys in the CAPTURE
// phase and stops propagation — the Player never sees them. Keys we don't
// own (Space, Enter, Escape…) pass through untouched.
import { useEffect, useRef } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightMediaPath } from '../../../../../lib/api.mjs';
import { usePianoMix } from '../../usePianoMix.js';
import { stepToLevel, levelToStep, STEPS } from '../../volumeCurve.js';

// Applause pool: drop numbered mp3s (001.mp3, 002.mp3, … gaps fine) into
// media/audio/sfx/applause/ — Numpad0 picks one at random for variety. The
// frontend can't list directories, so we HEAD-probe the first 30 names once
// per mount and cache the hits. Empty folder → warn, silent, no crash.
export const APPLAUSE_SFX_DIR = '/media/audio/sfx/applause';
const APPLAUSE_MAX_PROBE = 30;
export const DOUBLE_PRESS_MS = 350;
const SEEK_SECONDS = 15; // matches the ±15 transport buttons

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'karaoke-keys' });
  return _logger;
}

/**
 * Karaoke keyboard shortcuts, active while the host player is mounted:
 * ←/→ seek ∓15s (double-→ is just another seek — never a skip) · double-←
 * restart · End end song · Home fullscreen · ↑/↓ key change · +/− volume
 * (top row or numpad, same five-step curve as the sheet) · Numpad0 applause.
 */
export default function useKaraokeKeys({
  onSkip,
  onRestart,
  onEndSong,
  onToggleFullscreen,
  keyControlRef,
}) {
  const { mediaLevel, setMediaLevel } = usePianoMix();
  // Refs so the one listener registration survives re-renders with fresh state.
  const cbRef = useRef({});
  cbRef.current = { onSkip, onRestart, onEndSong, onToggleFullscreen, keyControlRef, mediaLevel, setMediaLevel };
  const lastLeftRef = useRef(0);
  const applauseListRef = useRef(null); // Promise<string[]> — probe once per mount

  useEffect(() => {
    const stepVolume = (dir) => {
      const { mediaLevel: level, setMediaLevel: setLevel } = cbRef.current;
      const cur = levelToStep(level, 'log');
      const next = Math.max(0, Math.min(STEPS.length - 1, cur + dir));
      setLevel(stepToLevel(next, 'log'));
      logger().info('karaoke.volume-key', { fromStep: cur, toStep: next });
    };

    const discoverApplause = () => {
      if (!applauseListRef.current) {
        applauseListRef.current = Promise.all(
          Array.from({ length: APPLAUSE_MAX_PROBE }, (_, i) => {
            const name = `${String(i + 1).padStart(3, '0')}.mp3`;
            const url = DaylightMediaPath(`${APPLAUSE_SFX_DIR}/${name}`);
            return fetch(url, { method: 'HEAD' })
              .then((r) => (r.ok ? url : null))
              .catch(() => null);
          }),
        ).then((urls) => urls.filter(Boolean));
      }
      return applauseListRef.current;
    };

    const playApplause = () => {
      discoverApplause().then((urls) => {
        if (!urls.length) {
          logger().warn('karaoke.applause-missing', { dir: APPLAUSE_SFX_DIR });
          return;
        }
        const url = urls[Math.floor(Math.random() * urls.length)];
        const sfx = new Audio(url); // fresh element — overlapping applause is fine
        Promise.resolve(sfx.play()).then(
          () => logger().info('karaoke.applause', { file: url.split('/').pop(), poolSize: urls.length }),
          (e) => logger().warn('karaoke.applause-failed', { message: e?.message, file: url.split('/').pop() }),
        );
      });
    };

    const onKeyDown = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // Never swallow browser/OS chords — Ctrl/Cmd+= (zoom), Alt+ArrowLeft
      // (browser back/history) etc. must reach the browser untouched.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const cb = cbRef.current;
      let handled = true;
      if (e.key === 'ArrowRight') {
        // Deliberately no double-press branch: a fast second press is just
        // another seek. The Player's "double-right = next track" is the exact
        // behavior this hook exists to bury.
        cb.onSkip?.(SEEK_SECONDS);
        logger().debug('karaoke.seek-key', { direction: 'forward' });
      } else if (e.key === 'ArrowLeft') {
        const now = Date.now();
        if (now - lastLeftRef.current < DOUBLE_PRESS_MS) {
          lastLeftRef.current = 0;
          cb.onRestart?.();
          logger().info('karaoke.restart-key', {});
        } else {
          lastLeftRef.current = now;
          cb.onSkip?.(-SEEK_SECONDS);
          logger().debug('karaoke.seek-key', { direction: 'backward' });
        }
      } else if (e.key === 'End') {
        logger().info('karaoke.end-key', {});
        cb.onEndSong?.();
      } else if (e.key === 'Home') {
        logger().info('karaoke.fullscreen-key', {});
        cb.onToggleFullscreen?.();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const api = cb.keyControlRef?.current;
        if (api && !api.engineFailed) api.step(e.key === 'ArrowUp' ? 1 : -1);
        // Swallow even when gated — shader cycling mid-song is never wanted.
      } else if (e.key === '+' || e.key === '=') {
        stepVolume(1);
      } else if (e.key === '-' || e.key === '_') {
        stepVolume(-1);
      } else if (e.code === 'Numpad0') {
        playApplause();
      } else {
        handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    // Capture phase: fire before (and suppress) the Player's bubble listener.
    // The kiosk's screensaver/inactivity activity-bump listeners
    // (usePianoScreensaver, useInactivityReturn) are also capture-phase but
    // registered earlier, at app mount, so they still run before this
    // handler and see swallowed keys too — if their registration ever
    // churns to after this hook mounts, stopImmediatePropagation here would
    // starve them.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
