import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import IsolatedMemoryRouter from './IsolatedMemoryRouter.jsx';
import getLogger from '../../../../../../../../frontend/src/lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../../../../frontend/src/lib/api.mjs';
import { ActivePianoProvider } from '../../../PianoConfig.jsx';
import PianoUserContext from '../../../PianoUserContext.jsx';
import { PianoPlaybackProvider } from '../../../PianoPlaybackContext.jsx';
import { resolvePianoConfig } from '../../../pianoConfigModel.js';
import { resolveProfile } from '../../../pianoUser.js';
import { resolveBoardRange } from '../../../../noteUtils.js';
import NoteLauncher from '../../../../game-platform/launcher/NoteLauncher.jsx';
import { bindNoteSlots, useNoteSelection, SELECTION_NOTES } from '../../../../game-platform/input/useNoteSelection.js';
import { NotationScore } from '../SheetMusic.jsx';
import KeyboardOnlyContext from './KeyboardOnlyContext.js';
import OfficeMidiProvider from './OfficeMidiProvider.jsx';
import OfficePiecePicker from './OfficePiecePicker.jsx';
import KeyStrip from './KeyStrip.jsx';
import { listPage, browseSlots, PIECE_NOTES, SHELF_NOTES, STRIP_KEYS, STRIP_NOTES } from './officeKeys.js';
import { resolveScoreGroups } from '../scoreGroups.js';
import { collectionListPath, isNotationId } from '../sheetMusicModel.js';
import './learnSurface.scss';
import './OfficeSheetMusic.scss';

const NO_PIECES = Object.freeze([]);
/** Where the way out (and every other navigation) is, said once at the end of the picker's footer. */
const MENU_HINT = 'Hold the lowest and highest keys for the menu';
/** Strip sources in the order their actions win when two name one key. */
const STRIP_SOURCES = ['host', 'coach', 'lab'];
const STRIP_CLAIM = new Set(STRIP_NOTES);

/**
 * Sheet Music on the office piano screen, run entirely from the keyboard.
 *
 * Mounted by PianoVisualizer from the launcher like a game. It is the host the
 * tablet's Learn needs and the office screen does not otherwise have: the piano
 * config, the player, a MIDI surface over the office's own note stream, and a
 * router for Learn's URL state. Inside it runs the same ScorePlayer and
 * LearnCoach the tablet runs, told by KeyboardOnlyContext that there is no touch.
 *
 * Three screens, each answered on keys:
 *   1. who is playing, when the launcher's pick is from another day (practice saves per player);
 *   2. the player's pieces, newest first, one per key (pages on the octave below);
 *   3. the piece, opened on the coach's next step, with the key strip under it.
 * Holding the lowest and highest keys leaves to the launcher (the launcher's own gesture).
 */
export default function OfficeSheetMusic({
  activeNotes, subscribe = null, subscribeRaw = null, appConfig = null, timezone = null, keyboard = null,
  currentUser = null, playerName = null, users = NO_PIECES, identityStale = false, onPickUser = null,
}) {
  const logger = useMemo(() => getLogger().child({ component: 'office-sheet-music' }), []);
  // ── Who is playing ────────────────────────────────────────────────────────
  // A pick from another day is not good enough to file practice under: ask first.
  const [confirmedUser, setConfirmedUser] = useState(null);
  const askPlayer = Boolean(onPickUser) && users.length > 0 && (!currentUser || (identityStale && confirmedUser !== currentUser));
  const userSlots = useMemo(() => bindNoteSlots(users, SELECTION_NOTES).slots.map((slot) => ({
    ...slot, userId: slot.item.id, label: slot.item.group_label || slot.item.name, sharpAfter: false,
  })), [users]);
  useNoteSelection({ activeNotes, slots: userSlots, enabled: askPlayer, onSelect: (item) => {
    logger.info('office-sheet-music.player-picked', { userId: item.id, stale: identityStale });
    setConfirmedUser(item.id);
    onPickUser?.(item.id);
  } });

  // ── Pieces ────────────────────────────────────────────────────────────────
  const config = useMemo(() => {
    const resolved = resolvePianoConfig(appConfig ?? {}, 'default', { timezone });
    // The office keyboard, not the tablet's: the exit gesture and key hints read this range.
    return { ...resolved, keyboard: resolveBoardRange(keyboard ?? resolved.keyboard) };
  }, [appConfig, timezone, keyboard]);
  const [pieces, setPieces] = useState(null); // null loading, [] none, false failed
  const [scoreId, setScoreId] = useState(null);
  const [openCount, setOpenCount] = useState(0);
  useEffect(() => {
    if (!currentUser || askPlayer) return undefined;
    let live = true;
    setPieces(null);
    DaylightAPI(`api/v1/piano/activity/desk/${encodeURIComponent(currentUser)}`)
      .then((res) => {
        if (!live) return;
        const list = Array.isArray(res?.pieces) ? res.pieces : [];
        setPieces(list);
        logger.info('office-sheet-music.pieces-loaded', { userId: currentUser, count: list.length });
      })
      .catch((error) => {
        if (!live) return;
        setPieces(false);
        logger.warn('office-sheet-music.pieces-failed', { userId: currentUser, error: error?.message });
      });
    return () => { live = false; };
  // A piece finished or set aside sends the player back here: re-read the list so its badge is fresh.
  }, [currentUser, askPlayer, openCount, logger]);

  // ── Browsing: your pieces, the shelves, one shelf ────────────────────────
  // `level` is 'mine' (the player's pieces, newest first: where Sheet Music opens),
  // 'shelves' (the catalog's collections) or 'shelf' (one collection, six a page).
  const shelves = useMemo(() => resolveScoreGroups(config.sheetmusic)
    .map((group, index) => ({ label: group.label ?? `Shelf ${index + 1}`, listPath: collectionListPath(group.ref) }))
    .filter((shelf) => shelf.listPath), [config.sheetmusic]);
  const [browse, setBrowse] = useState({ level: 'mine', shelf: 0, page: 0, shelvesPage: 0 });
  const [shelfItems, setShelfItems] = useState({}); // listPath → items | false
  // A new player starts on their own list.
  useEffect(() => { setScoreId(null); setBrowse({ level: 'mine', shelf: 0, page: 0, shelvesPage: 0 }); }, [currentUser]);

  const openShelf = browse.level === 'shelf' ? shelves[browse.shelf] ?? null : null;
  // The open shelf, or — on the shelves — every shelf, so each face can show its cover and count.
  const wanted = useMemo(() => (browse.level === 'shelves' ? shelves : openShelf ? [openShelf] : []), [browse.level, shelves, openShelf]);
  const requested = useRef(new Set());
  useEffect(() => {
    for (const shelf of wanted) {
      if (requested.current.has(shelf.listPath)) continue;
      requested.current.add(shelf.listPath);
      DaylightAPI(shelf.listPath)
        .then((res) => {
          // Only engraved scores open here (keyboard-only Learn); page-image scores stay on the tablet.
          const items = (Array.isArray(res?.items) ? res.items : [])
            .filter((item) => isNotationId(item?.id))
            .map((item) => ({ scoreId: item.id, cover: item.thumbnail || item.image || null }));
          setShelfItems((current) => ({ ...current, [shelf.listPath]: items }));
          logger.info('office-sheet-music.shelf-loaded', { shelf: shelf.label, count: items.length });
        })
        .catch((error) => {
          requested.current.delete(shelf.listPath); // the next visit tries again
          setShelfItems((current) => ({ ...current, [shelf.listPath]: false }));
          logger.warn('office-sheet-music.shelf-failed', { shelf: shelf.label, error: error?.message });
        });
    }
  }, [wanted, logger]);
  const shelfFaces = useMemo(() => shelves.map((shelf) => {
    const items = shelfItems[shelf.listPath];
    return { ...shelf, count: Array.isArray(items) ? items.length : null, cover: Array.isArray(items) ? items.find((item) => item.cover)?.cover ?? null : null };
  }), [shelves, shelfItems]);

  // A catalog piece the player has started shows its desk badge and passage map.
  const deskById = useMemo(() => new Map((pieces || []).map((piece) => [piece.scoreId, piece])), [pieces]);
  const shelfList = openShelf ? shelfItems[openShelf.listPath] : undefined;
  const listed = browse.level === 'mine' ? pieces
    : browse.level === 'shelf' ? (Array.isArray(shelfList) ? shelfList.map((item) => ({ ...item, ...(deskById.get(item.scoreId) || {}), cover: deskById.get(item.scoreId)?.cover || item.cover })) : shelfList)
      : null;
  const page = useMemo(() => (browse.level === 'shelves'
    ? listPage(shelfFaces, browse.shelvesPage, SHELF_NOTES)
    : listPage(Array.isArray(listed) ? listed : NO_PIECES, browse.page, PIECE_NOTES)), [browse, shelfFaces, listed]);
  // No pieces of their own yet: Sheet Music opens on the shelves, and says why, rather than on an empty page.
  const hasOwn = !(Array.isArray(pieces) && pieces.length === 0);
  useEffect(() => {
    if (!hasOwn) setBrowse((current) => (current.level === 'mine' ? { ...current, level: 'shelves' } : current));
  }, [hasOwn]);
  const browseRow = useMemo(() => browseSlots(browse.level, page, { hasOwn }), [browse.level, page, hasOwn]);
  const pickerSlots = useMemo(() => [
    ...page.slots.map((slot) => ({ ...slot, kind: browse.level === 'shelves' ? 'shelf' : 'piece' })),
    ...browseRow.filter((slot) => slot.enabled).map((slot) => ({ ...slot, kind: 'browse' })),
  ], [page, browseRow, browse.level]);
  // Browsing works even when the player's own list could not be read.
  const pickerOn = !askPlayer && !scoreId && pieces !== null;
  const pickerTitle = browse.level === 'shelves' ? 'All music'
    : browse.level === 'shelf' ? openShelf?.label ?? 'All music'
      : playerName ? `${playerName}’s pieces` : 'Your pieces';
  const pickerStatus = browse.level === 'mine'
    ? (pieces === false ? 'Your pieces could not be loaded. Play C3 for all music.'
      : null)
    : browse.level === 'shelves'
      ? (shelves.length === 0 ? 'No music shelves are set up.' : null)
      : shelfList === undefined ? 'Opening the shelf…'
        : shelfList === false ? 'This shelf could not be loaded. Play C3 to go back.'
          : shelfList.length === 0 ? 'Nothing on this shelf opens here. Play C3 to go back.' : null;
  useNoteSelection({ activeNotes, slots: pickerSlots, enabled: pickerOn, onSelect: (item, slot) => {
    if (slot.kind === 'browse') {
      const turn = item.browse === 'next' ? 1 : item.browse === 'previous' ? -1 : 0;
      logger.info('office-sheet-music.browse', { key: item.browse, level: browse.level, page: page.page + 1 + turn, of: page.pageCount });
      setBrowse((current) => {
        if (turn) return current.level === 'shelves'
          ? { ...current, shelvesPage: current.shelvesPage + turn } : { ...current, page: current.page + turn };
        return current.level === 'shelves' ? { ...current, level: 'mine', page: 0 } : { ...current, level: 'shelves' };
      });
      return;
    }
    if (slot.kind === 'shelf') {
      const index = shelves.findIndex((shelf) => shelf.listPath === item.listPath);
      logger.info('office-sheet-music.shelf-opened', { shelf: item.label });
      setBrowse((current) => ({ ...current, level: 'shelf', shelf: index, page: 0 }));
      return;
    }
    logger.info('office-sheet-music.piece-opened', { userId: currentUser, scoreId: item.scoreId, badge: item.next?.skill ?? null, from: browse.level });
    setScoreId(item.scoreId);
  } });

  const backToPieces = useCallback((reason = 'back') => {
    logger.info('office-sheet-music.back-to-pieces', { scoreId, reason });
    setScoreId(null);
    setOpenCount((count) => count + 1);
  }, [logger, scoreId]);

  // ── The key strip ─────────────────────────────────────────────────────────
  // Learn publishes what its touch controls did; the host draws one strip of
  // keys for all of it and claims those keys away from the music while it shows.
  const [strip, setStrip] = useState({});
  const publishStrip = useCallback((source, entry) => {
    setStrip((current) => {
      if (!entry) { if (!(source in current)) return current; const { [source]: _gone, ...rest } = current; return rest; }
      if (current[source]?.signature === entry.signature) return current;
      return { ...current, [source]: entry };
    });
  }, []);
  const hostActions = useMemo(() => ({ pieces: { onSelect: () => backToPieces('strip') } }), [backToPieces]);
  const stripActions = useMemo(() => {
    const merged = {};
    for (const key of STRIP_KEYS) {
      for (const source of STRIP_SOURCES) {
        const action = source === 'host' ? hostActions[key.id] : strip[source]?.actionsRef.current?.[key.id];
        if (typeof action?.onSelect === 'function') { merged[key.id] = { label: action.label, source, onSelect: action.onSelect }; break; }
      }
    }
    return merged;
  }, [strip, hostActions]);
  const stripActive = Boolean(scoreId) && Object.values(strip).every((entry) => entry.active !== false);
  const onStripKey = useCallback((id) => {
    const action = stripActions[id];
    if (!action) return;
    // Read the handler at press time: a published entry keeps its ref current.
    const live = action.source === 'host' ? hostActions[id] : strip[action.source]?.actionsRef.current?.[id];
    logger.info('office-sheet-music.strip-key', { key: id, source: action.source, scoreId });
    live?.onSelect?.();
  }, [stripActions, hostActions, strip, logger, scoreId]);

  // ── The kiosk surfaces Learn reads ───────────────────────────────────────
  const userValue = useMemo(() => ({
    users, currentUser, currentProfile: resolveProfile(users, currentUser), setCurrentUser: (id) => onPickUser?.(id),
  }), [users, currentUser, onPickUser]);
  // `canListen`: the office piano's recorder only reads the keyboard; there is no note OUTPUT to play a
  // passage through (OfficeMidiProvider's sends are no-ops), so Listen is not drawn (owner ruling).
  const keyboardOnly = useMemo(() => ({
    input: 'keyboard-only', canListen: false, onExit: backToPieces, publishStrip,
  }), [backToPieces, publishStrip]);

  useEffect(() => {
    logger.info('office-sheet-music.mounted', { userId: currentUser, stale: identityStale });
    return () => logger.info('office-sheet-music.unmounted', {});
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one mount line per launch
  }, []);

  if (askPlayer) {
    return (
      <div className="office-sheet-music office-sheet-music--who">
        <NoteLauncher slots={userSlots} variant="users" showTimer={false} title="Who's practising? · play their key"
          showPlayer={false} />
      </div>
    );
  }

  return (
    <KeyboardOnlyContext.Provider value={keyboardOnly}>
      <div className="office-sheet-music" data-view={scoreId ? 'piece' : 'pieces'}>
        <div className="office-sheet-music__body">
          {!scoreId && (
            pieces === null ? <p className="office-sheet-music__status" role="status">Finding your pieces…</p>
              : <OfficePiecePicker title={pickerTitle} status={pickerStatus}
                  notice={browse.level === 'shelves' && !hasOwn ? 'No pieces started yet. Pick a shelf.' : null} kind={browse.level === 'shelves' ? 'shelves' : 'pieces'}
                  slots={page.slots} browse={browseRow} page={page} hint={MENU_HINT} />
          )}
          {scoreId && (
            <ActivePianoProvider pianoId="office" basePath="/" config={config}>
              <PianoUserContext.Provider value={userValue}>
                <OfficeMidiProvider activeNotes={activeNotes} subscribe={subscribe} subscribeRaw={subscribeRaw} claimed={stripActive ? STRIP_CLAIM : null}>
                  <PianoPlaybackProvider>
                    <IsolatedMemoryRouter>
                      <div className="office-sheet-music__learn">
                        <NotationScore key={scoreId} contentId={scoreId} />
                      </div>
                    </IsolatedMemoryRouter>
                  </PianoPlaybackProvider>
                </OfficeMidiProvider>
              </PianoUserContext.Provider>
            </ActivePianoProvider>
          )}
        </div>
        {scoreId && (
          <footer className="office-sheet-music__strip">
            <KeyStrip activeNotes={activeNotes} actions={stripActions} active={stripActive} canListen={keyboardOnly.canListen} onSelect={onStripKey} />
          </footer>
        )}
      </div>
    </KeyboardOnlyContext.Provider>
  );
}
