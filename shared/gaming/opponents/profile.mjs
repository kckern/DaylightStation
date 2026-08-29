/** Normalize content-provided opponents without leaking mechanics into chrome. */
export function normalizeOpponentProfile(opponent = {}, {
  rosterPack = 'default', position = 1,
} = {}) {
  const level = Number(opponent.level ?? position);
  const id = String(opponent.id || `${rosterPack}:level-${position}`);
  const rawDialogue = opponent.dialogue || {};
  return {
    ...opponent,
    id,
    name: String(opponent.name || `Level ${position}`),
    art: opponent.art || null,
    theme: opponent.theme || null,
    level: Number.isFinite(level) ? level : position,
    dialogue: {
      persona: String(rawDialogue.persona || opponent.personality || 'A friendly, competitive opponent.'),
      // chess_voice is a read alias during the roster migration.
      voice: String(rawDialogue.voice || rawDialogue.chess_voice || 'React briefly to the immediate turn.'),
      lore: rawDialogue.lore || { type: [], references: [], known_references: [], use: 'never' },
    },
  };
}

export function normalizeOpponentRoster(roster = [], rosterPack = 'default') {
  return roster.map((opponent, index) => normalizeOpponentProfile(opponent, {
    rosterPack, position: index + 1,
  }));
}

export default { normalizeOpponentProfile, normalizeOpponentRoster };
