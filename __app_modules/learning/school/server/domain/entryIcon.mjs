/**
 * An assignment's own disc icon (pure domain).
 *
 * A shelf can carry several assignments on one day (piano and a coloring page,
 * both `arts`), and the status board draws one disc per assignment. `icon:` on
 * an enrollment names the picture for THAT disc. It is a NAME in the browser's
 * School icon registry (`browser/home/icons/`), which the server cannot see,
 * so this only checks the shape: a non-empty string, trimmed. A name the
 * registry does not know falls back to the shelf icon on the board.
 */

/**
 * Program defaults, for enrollments that name no icon. Kept here, in one
 * place, so an existing enrollment changes picture with no data edit. Piano's
 * disc is the music note (`piano` stays the launch card's glyph); the debrief's
 * is the keyboard.
 */
export const DEFAULT_PROGRAM_ICONS = Object.freeze({
  'piano-course': 'music',
  // The debrief is typed (or spoken) on the writing shelf, whose own icon is
  // the pencil; the keyboard tells the two apart.
  'school-debrief': 'keyboard',
});

/**
 * @param {unknown} value the raw `icon` field
 * @returns {{errors: string[], icon: string|null}} `icon` null when absent
 */
export function validateEntryIcon(value) {
  if (value === undefined || value === null) return { errors: [], icon: null };
  if (typeof value !== 'string' || !value.trim()) {
    return { errors: ['icon must be a non-empty string naming a School icon'], icon: null };
  }
  return { errors: [], icon: value.trim() };
}

/** The icon a plan entry for `programId` carries: its own, else the program default, else null. */
export function programEntryIcon(programId, icon) {
  return validateEntryIcon(icon).icon ?? DEFAULT_PROGRAM_ICONS[programId] ?? null;
}
