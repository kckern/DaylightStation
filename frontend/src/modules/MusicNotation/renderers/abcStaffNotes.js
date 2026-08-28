// abcStaffNotes.js — abcjs tune-object walking for AbcRenderer.jsx, split
// out so Fast Refresh can hot-reload the renderer component on its own.

/**
 * Walk an abcjs tune object and return, per staff, the ordered pitched-note
 * elements with their SVG nodes — so a caller can light up individual noteheads
 * (e.g. a MIDI follow-along). Index N within a staff maps 1:1 to the Nth played
 * note of that staff's voice (rests excluded), matching a flattened drill hand.
 *
 * @returns {Array<Array<{ midi:number|null, els: SVGElement[] }>>} notes per staff
 */
export function collectStaffNotes(tune) {
  const staves = []; // staffIndex → [{ midi, els }]
  const lines = tune?.lines || [];
  for (const line of lines) {
    const staff = line.staff;
    if (!Array.isArray(staff)) continue;
    staff.forEach((st, si) => {
      const bucket = staves[si] || (staves[si] = []);
      (st.voices || []).forEach((voice) => {
        (voice || []).forEach((el) => {
          if (el.el_type !== 'note' || el.rest) return;
          const abs = el.abselem;
          const els = (abs?.elemset && abs.elemset.length ? abs.elemset : abs?.heads) || [];
          const midi = el.midiPitches?.[0]?.pitch ?? null;
          bucket.push({ midi, els: Array.from(els).filter(Boolean) });
        });
      });
    });
  }
  return staves;
}
