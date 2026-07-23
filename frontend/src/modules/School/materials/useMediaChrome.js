/**
 * useMediaChrome — the shared brains behind the School player chrome (audio and
 * video). Mirrors the resolved media element's state into React and exposes the
 * transport commands the chrome buttons call, plus an auto-hide `visible` flag
 * for the video overlay. Reuses the shared `usePlayerController` (from
 * modules/Player) for the ref-based commands; the state mirroring and the
 * vanishing timer are lifted from the Piano video player's proven pattern, kept
 * School-local (a module is not an export surface).
 *
 * @param {object} playerRef - the ref given to <Player ref={…} />
 * @param {{ autoHide?: boolean, idleMs?: number }} [opts] - autoHide=true fades
 *   the chrome after idle while playing (video); false keeps it always visible
 *   (audio).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import usePlayerController from '../../Player/usePlayerController.js';

export default function useMediaChrome(playerRef, { autoHide = false, idleMs = 3500 } = {}) {
  const ctrl = usePlayerController(playerRef);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [mediaEl, setMediaEl] = useState(null);

  // Resolve the media element once the Player mounts it (poll briefly — the
  // element appears a tick or two after the lazy Player renders).
  useEffect(() => {
    let raf;
    let tries = 0;
    const find = () => {
      const el = ctrl.getMediaEl();
      if (el) { setMediaEl(el); return; }
      if (tries++ < 120) raf = requestAnimationFrame(find); // ~2s of frames
    };
    find();
    return () => cancelAnimationFrame(raf);
  }, [ctrl]);

  // Mirror element state into React for the chrome (Piano's mirror pattern).
  useEffect(() => {
    if (!mediaEl) return undefined;
    const onTime = () => setCurrentTime(mediaEl.currentTime || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onMeta = () => setDuration(mediaEl.duration || 0);
    const onVol = () => setVolumeState(mediaEl.muted ? 0 : (mediaEl.volume ?? 1));
    mediaEl.addEventListener('timeupdate', onTime);
    mediaEl.addEventListener('play', onPlay);
    mediaEl.addEventListener('pause', onPause);
    mediaEl.addEventListener('loadedmetadata', onMeta);
    mediaEl.addEventListener('volumechange', onVol);
    onMeta(); onVol();
    setIsPlaying(!mediaEl.paused);
    return () => {
      mediaEl.removeEventListener('timeupdate', onTime);
      mediaEl.removeEventListener('play', onPlay);
      mediaEl.removeEventListener('pause', onPause);
      mediaEl.removeEventListener('loadedmetadata', onMeta);
      mediaEl.removeEventListener('volumechange', onVol);
    };
  }, [mediaEl]);

  const toggle = useCallback(() => ctrl.toggle(), [ctrl]);
  const seek = useCallback((t) => ctrl.seek(t), [ctrl]);
  const skip = useCallback((delta) => {
    const cur = ctrl.getCurrentTime() || 0;
    const max = duration > 0 ? duration : cur + Math.abs(delta);
    ctrl.seek(Math.max(0, Math.min(max, cur + delta)));
  }, [ctrl, duration]);
  const restart = useCallback(() => ctrl.seek(0), [ctrl]);
  const setVolume = useCallback((v) => {
    const el = ctrl.getMediaEl();
    if (!el) return;
    const clamped = Math.max(0, Math.min(1, v));
    el.muted = clamped === 0;
    el.volume = clamped;
    setVolumeState(clamped);
  }, [ctrl]);

  // Auto-hide (video only): controls reveal on activity and fade after idle
  // WHILE playing; always visible when paused or when autoHide is off (audio).
  const [visible, setVisible] = useState(true);
  const timer = useRef(null);
  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (autoHide && isPlaying) timer.current = setTimeout(() => setVisible(false), idleMs);
  }, [autoHide, isPlaying, idleMs]);
  const reveal = useCallback(() => { setVisible(true); arm(); }, [arm]);
  useEffect(() => { arm(); return () => timer.current && clearTimeout(timer.current); }, [arm]);
  useEffect(() => { if (!autoHide || !isPlaying) setVisible(true); }, [autoHide, isPlaying]);

  return { isPlaying, currentTime, duration, volume, toggle, seek, skip, restart, setVolume, visible, reveal };
}
