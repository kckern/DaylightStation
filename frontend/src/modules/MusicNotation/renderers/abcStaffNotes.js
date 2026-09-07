// abcStaffNotes.js — abcjs tune-object walking for AbcRenderer.jsx, split
// out so Fast Refresh can hot-reload the renderer component on its own.

/**
 * Walk an abcjs tune object and return, per staff, the ordered pitched-note
 * elements with their SVG nodes — so a caller can light up individual noteheads
 * (e.g. a MIDI follow-along). Index N within a staff maps 1:1 to the Nth played
 * note of that staff's voice (rests excluded), matching a flattened drill hand.
 *
 * `eventIndex` counts rests too, so alternating hands still reference the
 * original exercise event after one voice has waited through a rest.
 * @returns {Array<Array<{ midi:number|null, eventIndex:number, els: SVGElement[] }>>} notes per staff
 */
export function collectStaffNotes(tune) {
  const staves = []; // staffIndex → [{ midi, els }]
  const positions = new Map();
  const lines = tune?.lines || [];
  for (const line of lines) {
    const staff = line.staff;
    if (!Array.isArray(staff)) continue;
    staff.forEach((st, si) => {
      const bucket = staves[si] || (staves[si] = []);
      (st.voices || []).forEach((voice, vi) => {
        const key = `${si}:${vi}`;
        let eventIndex = positions.get(key) ?? 0;
        (voice || []).forEach((el) => {
          if (el.el_type !== 'note') return;
          const position = eventIndex++;
          if (el.rest) return;
          const abs = el.abselem;
          const els = (abs?.elemset && abs.elemset.length ? abs.elemset : abs?.heads) || [];
          const midi = el.midiPitches?.[0]?.pitch ?? null;
          bucket.push({ midi, eventIndex: position, els: Array.from(els).filter(Boolean) });
        });
        positions.set(key, eventIndex);
      });
    });
  }
  return staves;
}
