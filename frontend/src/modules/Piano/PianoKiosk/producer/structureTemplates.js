/**
 * structureTemplates — code-level song-structure prefabs for the Song view's
 * empty state (design §7: "Empty state offers structure templates").
 *
 * A template is pure STRUCTURE: named empty sections plus a play order.
 * Applying one (draftReducer APPLY_TEMPLATE) creates EMPTY sections — the
 * names ('Intro', 'Verse', …) are structural labels in the §3.1 sense, like
 * the auto 'A'/'B' rehearsal marks, not fabricated titles — and the slots
 * render as fillable cards. Data-file prefabs (sections WITH material) are
 * Task 9.1; these constants are deliberately code-level.
 *
 * Shape:
 *   { id, name, sections: [{ name, lengthBars }],
 *     arrangement: [{ section: <index into sections>, repeats }] }
 *
 * `arrangement[].section` is an INDEX into the template's own sections list;
 * APPLY_TEMPLATE resolves it to the freshly minted section ids. A section may
 * appear in several arrangement entries (pop's Verse/Chorus) — that is the
 * whole point: one section, many slots, edit once.
 */

export const STRUCTURE_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'pop',
    name: 'Pop',
    sections: Object.freeze([
      Object.freeze({ name: 'Intro', lengthBars: 4 }),
      Object.freeze({ name: 'Verse', lengthBars: 8 }),
      Object.freeze({ name: 'Chorus', lengthBars: 8 }),
      Object.freeze({ name: 'Outro', lengthBars: 4 }),
    ]),
    arrangement: Object.freeze([
      Object.freeze({ section: 0, repeats: 1 }), // Intro
      Object.freeze({ section: 1, repeats: 2 }), // Verse ×2
      Object.freeze({ section: 2, repeats: 2 }), // Chorus ×2
      Object.freeze({ section: 1, repeats: 1 }), // Verse
      Object.freeze({ section: 2, repeats: 1 }), // Chorus
      Object.freeze({ section: 3, repeats: 1 }), // Outro
    ]),
  }),
  Object.freeze({
    id: 'verse-chorus',
    name: 'Verse–Chorus',
    sections: Object.freeze([
      Object.freeze({ name: 'Verse', lengthBars: 8 }),
      Object.freeze({ name: 'Chorus', lengthBars: 8 }),
    ]),
    // V8×2 C8×2, the whole alternation twice.
    arrangement: Object.freeze([
      Object.freeze({ section: 0, repeats: 2 }),
      Object.freeze({ section: 1, repeats: 2 }),
      Object.freeze({ section: 0, repeats: 2 }),
      Object.freeze({ section: 1, repeats: 2 }),
    ]),
  }),
  Object.freeze({
    id: 'aaba',
    name: 'AABA',
    sections: Object.freeze([
      Object.freeze({ name: 'A', lengthBars: 8 }),
      Object.freeze({ name: 'B', lengthBars: 8 }),
    ]),
    // Four explicit slots (A A B A) so the rail reads as the classic form.
    arrangement: Object.freeze([
      Object.freeze({ section: 0, repeats: 1 }),
      Object.freeze({ section: 0, repeats: 1 }),
      Object.freeze({ section: 1, repeats: 1 }),
      Object.freeze({ section: 0, repeats: 1 }),
    ]),
  }),
  Object.freeze({
    id: 'twelve-bar',
    name: '12-bar',
    sections: Object.freeze([
      Object.freeze({ name: 'A', lengthBars: 12 }),
    ]),
    arrangement: Object.freeze([
      Object.freeze({ section: 0, repeats: 3 }),
    ]),
  }),
  Object.freeze({
    id: 'loop-jam',
    name: 'Loop jam',
    sections: Object.freeze([
      Object.freeze({ name: 'A', lengthBars: 4 }),
    ]),
    arrangement: Object.freeze([
      Object.freeze({ section: 0, repeats: 4 }),
    ]),
  }),
]);

export default STRUCTURE_TEMPLATES;
