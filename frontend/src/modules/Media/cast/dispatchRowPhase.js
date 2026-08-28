// dispatchRowPhase.js — lifecycle-phase derivation for DispatchProgressTray.jsx,
// split out so Fast Refresh can hot-reload the tray component on its own.

/** Which lifecycle phase a dispatch entry is in, for rendering. */
export function rowPhase(d) {
  if (d.status === 'failed') return 'failed';
  if (d.status !== 'success') return 'running';
  if (d.playback === 'confirmed') return 'confirmed';
  if (d.playback === 'timeout') return 'unconfirmed';
  return 'sent';
}
