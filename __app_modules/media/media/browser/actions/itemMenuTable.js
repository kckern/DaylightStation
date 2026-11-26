// actions/itemMenuTable.js
// Addendum item 7 (2026-11-26): one menu table. Every item menu — a search
// row's ⋯ (desktop dropdown and phone sheet), a Browse row's ⋯, the ⋯ on a
// start-page tile / Played earlier / Now-on card (household/ItemMenu.jsx) and
// Move to… (shell/MoveToMenu.jsx) and the info view's More ⋯
// (browse/DetailView.jsx) — takes its entries and their words from
// here, keyed by the item's kind and the surface, so a label can never drift
// between two menus again ("Play now" on a tile vs "Play Now" on a row).
//
// Pure data: each surface renders the entries with its own Menu chrome and
// fires `kind` through its own verb runner.

/** The words for each verb, once. `on` is " on <screen>" when the verbs go there. */
export const MENU_LABELS = Object.freeze({
  playNow: 'Play Now',
  playHere: 'Play here',
  shuffle: 'Shuffle',
  playNext: (on = '') => `Play Next${on}`,
  playNextFront: 'At the very front',
  playFirst: (on = '') => `Play First${on}`,
  add: (on = '') => `Add to Queue${on}`,
  playOn: 'Play on…',
  showOn: 'Show on…',
  showBrieflyOn: 'Show briefly on…',
  more: 'More',
  addOn: 'Add on…',
  quality: 'Quality…',
  details: 'Open detail',
  openScreen: (name) => `Open ${name}`,
  favourite: 'Add to favourites',
  unfavourite: 'Remove from favourites',
  watched: 'Mark watched',
  unwatched: 'Mark unwatched',
  hide: 'Remove from household list',
  moveHeading: 'Move this playback to',
  moveHere: 'This device',
});

/** The kinds the table knows: a playable leaf, a collection, or a still to show. */
export function menuItemKind({ collection = false, show = false } = {}) {
  if (show) return 'show';
  return collection ? 'collection' : 'leaf';
}

// Which verbs each surface offers, in order. '|' is a divider. Entries whose
// condition fails are dropped (below), so one row serves every kind.
const SURFACES = Object.freeze({
  // A search or Browse result row's ⋯ (the row itself only ever opens).
  row: ['continue', 'openScreen', 'playNow', 'playHere', 'shuffle', 'playNext', 'playFirst', 'add', 'playOn', 'addOn', '|', 'details', 'quality', '|', 'favourite', 'watched', 'unwatched', 'hide'],
  // A tile, Played earlier row or Now-on card (household/ItemMenu.jsx).
  tile: ['continue', 'openScreen', 'playNow', 'playHere', 'shuffle', 'playNext', 'playFirst', 'add', 'playOn', 'addOn', 'quality', 'details', '|', 'favourite', 'watched', 'unwatched', 'hide'],
  // The info view's More ⋯ (owner ruling 2026-11-26): row 1 there is PLAY,
  // Play here and Play on…, so More holds everything else — the queue verbs
  // (named for the screen they go to; this replaces the old caption line),
  // Show briefly on…, Quality…, then the household verbs.
  detail: ['shuffleOn', 'playNext', 'playFirst', 'add', 'addOn', '|', 'showBriefly', '|', 'quality', '|', 'favourite', 'watched', 'unwatched'],
});

/**
 * The entries of one item menu.
 * @param {object} p
 * @param {'row'|'tile'|'detail'} p.surface
 * @param {'leaf'|'collection'|'show'} p.kind
 * @param {{ elsewhere?: boolean, short?: string|null, sentence?: string|null, ask?: boolean }} [p.where]
 *   where ▶ goes: `sentence` is the Play Now words when it goes to a screen
 * @param {{ name: string }|null} [p.playingOn] the screen this item is on right now (item 5)
 * @param {string|null} [p.continueLabel] "Continue S2E7", when there is a next part
 * @param {boolean} [p.favourite]
 * @param {boolean|null} [p.watched] true/false when known, null when not
 * @param {boolean} [p.removable] shown in a household list
 * @param {boolean} [p.quality] the item takes quality overrides
 * @param {boolean} [p.household] offer the household verbs at all (favourite, watched, hide)
 * @returns {Array<{ kind: string, label: string, hold?: string }|{ divider: true }>}
 */
export function itemMenuEntries({
  surface, kind = 'leaf', where = {}, playingOn = null, continueLabel = null,
  favourite = false, watched = null, removable = false, quality = false, household = true,
}) {
  const order = SURFACES[surface];
  if (!order) throw new Error(`itemMenuEntries: unknown surface ${surface}`);
  const elsewhere = !!where.elsewhere && !!where.short;
  const on = elsewhere ? ` on ${where.short}` : '';
  const collection = kind === 'collection';
  const entry = {
    continue: continueLabel ? { kind: 'continue', label: continueLabel } : null,
    openScreen: playingOn?.name ? { kind: 'openScreen', label: MENU_LABELS.openScreen(playingOn.name) } : null,
    playNow: { kind: 'playNow', label: elsewhere && where.sentence ? where.sentence : MENU_LABELS.playNow },
    playHere: elsewhere ? { kind: 'playHere', label: MENU_LABELS.playHere } : null,
    shuffle: collection ? { kind: 'shuffle', label: MENU_LABELS.shuffle } : null,
    // The info view names its Shuffle's destination like its queue verbs.
    shuffleOn: collection ? { kind: 'shuffle', label: `${MENU_LABELS.shuffle}${on}` } : null,
    playNext: { kind: 'playNext', label: MENU_LABELS.playNext(on), hold: 'playFirst' },
    playFirst: { kind: 'playFirst', label: MENU_LABELS.playFirst(on) },
    add: { kind: 'add', label: MENU_LABELS.add(on) },
    playOn: { kind: 'playOn', label: kind === 'show' ? MENU_LABELS.showOn : MENU_LABELS.playOn },
    addOn: { kind: 'addOn', label: MENU_LABELS.addOn },
    showBriefly: { kind: 'showBrieflyOn', label: MENU_LABELS.showBrieflyOn },
    quality: quality ? { kind: 'quality', label: MENU_LABELS.quality } : null,
    details: { kind: 'details', label: MENU_LABELS.details },
    favourite: household ? { kind: favourite ? 'unfavourite' : 'favourite', label: favourite ? MENU_LABELS.unfavourite : MENU_LABELS.favourite } : null,
    watched: household && !collection && watched !== true ? { kind: 'watched', label: MENU_LABELS.watched } : null,
    unwatched: household && !collection && watched !== false ? { kind: 'unwatched', label: MENU_LABELS.unwatched } : null,
    hide: household && removable ? { kind: 'hide', label: MENU_LABELS.hide } : null,
  };
  const out = [];
  for (const key of order) {
    if (key === '|') {
      if (out.length && !out[out.length - 1].divider) out.push({ divider: true });
      continue;
    }
    if (entry[key]) out.push(entry[key]);
  }
  while (out.length && out[out.length - 1].divider) out.pop();
  return out;
}

/** Move to…: the heading and this device's row (the screens follow, by name). */
export function moveMenuEntries(screens = []) {
  return {
    heading: MENU_LABELS.moveHeading,
    entries: [{ kind: 'local', label: MENU_LABELS.moveHere }, ...screens.map((s) => ({ kind: s.id, label: s.label }))],
  };
}

export default itemMenuEntries;
