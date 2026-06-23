/** Match the body background to the charcoal kiosk theme while mounted; returns a restore fn. */
export function applyPianoBodyTheme() {
  const prev = document.body.style.backgroundColor;
  document.body.style.backgroundColor = '#16161b';
  return () => { document.body.style.backgroundColor = prev; };
}
