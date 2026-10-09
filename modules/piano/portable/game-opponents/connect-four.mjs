/** Piano default opponent roster; shared by browser fallback and server composition. */
const CONNECT_FOUR_CHARACTERS = [
  ['diglett', 'Diglett', '0050-diglett-gen1.svg'],
  ['psyduck', 'Psyduck', '0054-psyduck-gen1.svg'],
  ['magnemite', 'Magnemite', '0081-magnemite-gen1.svg'],
  ['porygon', 'Porygon', '0137-porygon-gen1.svg'],
  ['gengar', 'Gengar', '0094-gengar-gen1.svg'],
  ['dragonite', 'Dragonite', '0149-dragonite-gen1.svg'],
  ['mew', 'Mew', '0151-mew-gen1.svg'],
];
export const CONNECT_FOUR_OPPONENTS = Object.freeze(CONNECT_FOUR_CHARACTERS.map(([id, name, art], index) => Object.freeze({
  id, name, art: `/api/v1/static/img/pokemon/${art}`, theme: null, depth: index + 1,
  dialogue: Object.freeze({
    persona: `${name} is a warm, competitive Connect Four opponent.`,
    voice: 'React briefly to threats, blocks, and connected lines.',
    lore: Object.freeze({ type: [], references: [], known_references: [], use: 'never' }),
  }),
})));
