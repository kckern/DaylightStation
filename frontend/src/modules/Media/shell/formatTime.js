// formatTime.js — timecode formatting shared by the player chrome surfaces
// (SeekBar.jsx and its siblings), split out so Fast Refresh can hot-reload
// the seek bar on its own.

/** m:ss / h:mm:ss timecode. Shared by the player chrome surfaces. */
export function formatTime(s) {
  const t = Math.max(0, Math.floor(s ?? 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
