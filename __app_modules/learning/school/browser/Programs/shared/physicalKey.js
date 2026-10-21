/**
 * The map's name for a physical key, from `event.code`. A Bluetooth keyboard
 * may be on a Korean layout, where `event.key` for H is `ㅗ` — the physical key
 * is what an on-screen hint means, so it wins; `key` is the caller's fallback.
 */
export function keyFromCode(code) {
  if (typeof code !== 'string') return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === 'Space') return ' ';
  if (code === 'Enter' || code === 'NumpadEnter') return 'enter';
  if (code === 'Tab') return 'tab';
  if (code === 'Backslash') return '\\';
  if (code === 'ArrowLeft') return 'arrowleft';
  return null;
}
export default keyFromCode;
