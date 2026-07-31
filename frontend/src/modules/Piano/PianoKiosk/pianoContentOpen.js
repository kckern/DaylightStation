import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-content-open' });
  return _logger;
}

/**
 * True when a contentId carries an explicit `source:localId` prefix (e.g.
 * `hymn:12`, `files:docs/sheet-music/fur-elise.musicxml`) — the shape
 * SheetMusic's `sheetmusic/view/*` route opens directly, with no extra
 * lookup, via its own `splitSourceId`
 * (`modes/SheetMusic/SheetMusic.jsx`): "Split a content id into
 * {source, localId}. Bare ids default to plex (legacy)." A colon-less id
 * falls into that legacy-default branch — ambiguous across piano modes (it
 * could be any mode's bare numeric id, not reliably a score), so it is NOT
 * treated as reachable here; only an id with an explicit prefix is.
 */
export function isSheetMusicContentId(contentId) {
  if (typeof contentId !== 'string') return false;
  const s = contentId.trim();
  const i = s.indexOf(':');
  return i > 0 && i < s.length - 1;
}

/**
 * The SheetMusic view route for a content id — mirrors
 * `ScoreGridRoute`'s `onSelect` (`navigate('view/' + item.id)`) in
 * `SheetMusic.jsx`, absolute rather than relative. The id is used verbatim
 * (it may contain slashes, e.g. a file path) — SheetMusic's splat param
 * round-trips it unencoded, so this does the same.
 */
export function sheetMusicViewPath(basePath, contentId) {
  return `${basePath}/sheetmusic/view/${contentId}`;
}

/**
 * Resolve a DoNow `piano.launch` contentId to an in-kiosk navigation,
 * mirroring "the same path a menu tap takes" for the ONE piano mode that
 * can open a bare contentId with no extra lookup: SheetMusic. Every other
 * mode (Videos/Music/…) has its own bespoke route shape with no reachable
 * generic resolver (see `useKioskLaunchCommand`'s doc comment) — a contentId
 * that doesn't carry the `source:localId` shape stays unreachable: a
 * structured warn, no navigation, no guess.
 *
 * @param {object} args
 * @param {string} args.contentId
 * @param {string} args.basePath - this piano's route base (e.g. `/piano` or `/piano/:pianoId`)
 * @param {(path: string) => void} args.navigate
 * @returns {boolean} true when it navigated, false when it warned + no-op'd
 */
export function openPianoContent({ contentId, basePath, navigate }) {
  if (isSheetMusicContentId(contentId)) {
    logger().info('piano-content-open', { contentId, mode: 'sheetmusic' });
    navigate(sheetMusicViewPath(basePath, contentId));
    return true;
  }
  logger().warn('piano-launch-content-open-unreachable', { contentId });
  return false;
}

export default openPianoContent;
