/** Force a light body background while the Piano kiosk is mounted; returns a restore fn. */
export function applyPianoBodyTheme() {
  const prev = document.body.style.backgroundColor;
  document.body.style.backgroundColor = '#ffffff';
  return () => { document.body.style.backgroundColor = prev; };
}
