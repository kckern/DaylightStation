// dispatchRowPhase.js — lifecycle-phase derivation for DispatchProgressTray.jsx,
// split out so Fast Refresh can hot-reload the tray component on its own.

/** Which lifecycle phase a dispatch entry is in, for rendering. */
export function rowPhase(d) {
  if (d.status === 'failed') return 'failed';
  if (d.status !== 'success') return 'running';
  const outcome = d.outcome ?? d.playback;
  if (outcome === 'confirmed') return 'confirmed';
  if (outcome === 'timeout') return 'unconfirmed';
  return 'sent';
}
