/**
 * The note map behind the office-screen game launcher.
 *
 * One combo opens the launcher; one white key picks a game. The nine keys are
 * middle C up to D5 — the span a hand finds without looking, and enough for
 * every released game in the registry.
 */

/** The nine white keys, C4 through D5. */
export const LAUNCHER_NOTES = Object.freeze([60, 62, 64, 65, 67, 69, 71, 72, 74]);

const NOTE_NAMES = Object.freeze(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5']);

/**
 * Pair each released game with a launcher key, in registry order.
 *
 * Unreleased games are omitted rather than greyed: a key that does nothing is
 * worse than a key that isn't there, because the player has no way to tell a
 * dead tile from a missed note.
 *
 * Games past the ninth are dropped and returned in `dropped` so the caller can
 * log it. Silent truncation would read as "everything is here" when it isn't —
 * that list is the signal to widen LAUNCHER_NOTES.
 *
 * @param {Array<{id: string, label?: string, icon?: string, status?: string}>} games
 * @returns {{slots: Array<Object>, dropped: string[]}}
 */
export function buildLauncherSlots(games) {
  if (!Array.isArray(games)) return { slots: [], dropped: [] };

  const released = games.filter((g) => g?.status === 'released');
  const dropped = released.slice(LAUNCHER_NOTES.length).map((g) => g.id);

  const slots = released.slice(0, LAUNCHER_NOTES.length).map((g, i) => ({
    gameId: g.id,
    label: g.label ?? g.id,
    icon: g.icon ?? 'game',
    note: LAUNCHER_NOTES[i],
    noteName: NOTE_NAMES[i],
    // Whether a black key sits between this white key and the next. Derived
    // from the interval, not hardcoded: a whole step has a sharp between, a
    // half step (E-F, B-C) does not. The last key has no "next".
    sharpAfter: i < LAUNCHER_NOTES.length - 1 && LAUNCHER_NOTES[i + 1] - LAUNCHER_NOTES[i] === 2,
  }));

  return { slots, dropped };
}

/** The slot bound to `note`, or null. Notes outside the map are ignorable noise. */
export function slotForNote(slots, note) {
  return slots?.find((s) => s.note === note) ?? null;
}
