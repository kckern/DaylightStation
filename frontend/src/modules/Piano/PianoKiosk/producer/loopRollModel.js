const BEATS_PER_BAR = 4;

/** Prefer a declared loop length; otherwise derive whole bars from note ends. */
export function loopBars(notes, ppq, barSpan) {
  const declared = Math.round(barSpan);
  if (declared > 0) return declared;
  if (!Array.isArray(notes) || notes.length === 0 || !(ppq > 0)) return 1;
  let end = 0;
  for (const note of notes) end = Math.max(end, note.ticks + (note.durationTicks || 0));
  return Math.max(1, Math.ceil(end / (BEATS_PER_BAR * ppq)));
}
