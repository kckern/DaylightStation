// polishAwards.js — how a piece's Polish gem and diamond are drawn wherever
// they are shown (run summary, home strip, passage board).

// The gem is the Gem Board's School colour, the piece gems' area; the diamond is a pale stone.
export const POLISH_GEM_COLOR = '#f2c94c';
export const POLISH_DIAMOND_COLOR = '#cfe8f7';

/**
 * The one stone a piece shows for its Polish awards (`{ gem, diamond }`): the
 * diamond once earned, else the gem, else nothing.
 */
export function polishStone(awards) {
  if (awards?.diamond === true) return { kind: 'diamond', color: POLISH_DIAMOND_COLOR, label: 'Polish diamond' };
  if (awards?.gem === true) return { kind: 'gem', color: POLISH_GEM_COLOR, label: 'Polish gem' };
  return null;
}
