// keyShift.js — pure key-shift math for the karaoke transposer.
//
// ±6 semitones (half an octave each way) covers every practical karaoke key
// change while staying inside the range where delay-line pitch shifting
// (Tone.PitchShift) still sounds natural; beyond ~±7 it turns robotic.
export const KEY_SHIFT_MIN = -6;
export const KEY_SHIFT_MAX = 6;

/** Coerce any input to a whole semitone offset inside the supported range. */
export function clampKeyShift(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(KEY_SHIFT_MAX, Math.max(KEY_SHIFT_MIN, Math.trunc(value)));
}

/**
 * Transport label for the current offset. ASCII only — the kiosk WebView
 * renders many Unicode glyphs (♭/♯/−) as tofu, so signs stay plain +/-.
 */
export function keyShiftLabel(value) {
  const v = clampKeyShift(value);
  if (v === 0) return 'Key';
  return v > 0 ? `+${v}` : String(v);
}
