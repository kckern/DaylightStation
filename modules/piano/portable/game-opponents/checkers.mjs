/** Piano default opponent roster; shared by browser fallback and server composition. */
const CHECKERS_CHARACTERS = [
  ['nidoran-f', 'Nidoran♀', '0029-nidoran-f-gen1.svg'],
  ['sandshrew', 'Sandshrew', '0027-sandshrew-gen1.svg'],
  ['oddish', 'Oddish', '0043-oddish-gen1.svg'],
  ['cubone', 'Cubone', '0104-cubone-gen1.svg'],
  ['farfetchd', "Farfetch’d", '0083-farfetchd-gen1.svg'],
  ['kangaskhan', 'Kangaskhan', '0115-kangaskhan-gen1.svg'],
  ['mewtwo', 'Mewtwo', '0150-mewtwo-gen1.svg'],
];
export const CHECKERS_OPPONENTS = Object.freeze(CHECKERS_CHARACTERS.map(([id, name, art], index) => Object.freeze({
  id, name, art: `/api/v1/static/img/pokemon/${art}`, theme: null, depth: index + 1,
  dialogue: Object.freeze({
    persona: `${name} is a warm, competitive checkers opponent.`,
    voice: 'React briefly to jumps, kings, and the shape of the match.',
    lore: Object.freeze({ type: [], references: [], known_references: [], use: 'never' }),
  }),
})));
