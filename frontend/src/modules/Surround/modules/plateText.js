// plateText.js — the work placard's headline/set-line decision, split out
// so Fast Refresh can hot-reload the placard component on its own.
import { trimmed } from '../typography.js';

/**
 * WHAT THE PLATE SAYS — the whole decision, as a pure function.
 *
 * Exported because it is the part worth asserting on its own: which of two
 * strings becomes the headline, and whether the set line has anything to say.
 * The component around it is measurement and wiring.
 *
 * @param {object} args
 * @param {object|null} args.piece the payload's `piece`.
 * @param {object|null} args.segment the sounding rail segment, or null.
 * @param {number} args.ordinal its 1-based place on the drawn rail.
 * @param {number} args.count how many segments the rail draws.
 * @param {boolean} [args.refused] the fit cannot set this segment's name whole.
 * @returns {{title:string, set:{name:string, ordinal:number, count:number}|null}}
 *   `title` is what the plate headlines; `set` is null when there is no set line
 *   to write (nothing sounding, or this is not a container).
 */
export function plateText({ piece, segment, ordinal, count, refused = false }) {
  const work = trimmed(piece?.title);
  const name = trimmed(segment?.name);
  // THE FALLBACK IS THE WORK, NOT A CUT NAME. A refused headline is one the fit
  // has certified cannot be set whole at the floor; showing it anyway — at any
  // size — is the ellipsis this wave exists to remove. Naming the set instead
  // is a smaller claim, and a true one.
  const title = name && !refused ? name : work;
  // `short_title` first: the set line is a standing label, and the corpus
  // authors the short form for exactly this use ("Chopin's Polonaises" against
  // the catalogue's "Polonaises"). Where none is authored the title serves.
  const label = trimmed(piece?.short_title) || work;
  const set = segment && count > 0 && label
    ? { name: label, ordinal, count }
    : null;
  return { title, set };
}
