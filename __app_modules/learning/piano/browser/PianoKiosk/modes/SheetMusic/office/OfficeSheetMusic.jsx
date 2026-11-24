import { useCallback, useEffect, useMemo, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
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
import { piecePage, STRIP_KEYS, STRIP_NOTES } from './officeKeys.js';
import './learnSurface.scss';
import './OfficeSheetMusic.scss';

const NO_PIECES = Object.freeze([]);
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
  const [pieces, setPieces] = useState(null); // null loading, [] none, false failed
  const [pageIndex, setPageIndex] = useState(0);
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
  // A new player starts on their own list.
  useEffect(() => { setScoreId(null); setPageIndex(0); }, [currentUser]);

  const page = useMemo(() => piecePage(pieces || NO_PIECES, pageIndex), [pieces, pageIndex]);
  useEffect(() => {
    if (page.unreachable > 0) logger.warn('office-sheet-music.pieces-unreachable', { userId: currentUser, count: page.unreachable });
  }, [page.unreachable, currentUser, logger]);
  const pickerSlots = useMemo(() => [
    ...page.slots.map((slot) => ({ ...slot, kind: 'piece' })),
    ...page.pageSlots.map((slot) => ({ ...slot, kind: 'page' })),
  ], [page]);
  const pickerOn = !askPlayer && !scoreId && Array.isArray(pieces);
  useNoteSelection({ activeNotes, slots: pickerSlots, enabled: pickerOn, onSelect: (item, slot) => {
    if (slot.kind === 'page') {
      logger.info('office-sheet-music.page', { page: item.page + 1, of: page.pageCount });
      setPageIndex(item.page);
      return;
    }
    logger.info('office-sheet-music.piece-opened', { userId: currentUser, scoreId: item.scoreId, badge: item.next?.skill ?? null });
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
  const config = useMemo(() => {
    const resolved = resolvePianoConfig(appConfig ?? {}, 'default', { timezone });
    // The office keyboard, not the tablet's: the exit gesture and key hints read this range.
    return { ...resolved, keyboard: resolveBoardRange(keyboard ?? resolved.keyboard) };
  }, [appConfig, timezone, keyboard]);
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
              : pieces === false ? <p className="office-sheet-music__status" role="status">Your pieces could not be loaded. Hold the lowest and highest keys to leave, then try again.</p>
                : pieces.length === 0 ? <p className="office-sheet-music__status" role="status">No pieces yet. Start a piece on the piano tablet, and it will be here.</p>
                  : <OfficePiecePicker playerName={playerName} page={page} />
          )}
          {scoreId && (
            <ActivePianoProvider pianoId="office" basePath="/" config={config}>
              <PianoUserContext.Provider value={userValue}>
                <OfficeMidiProvider activeNotes={activeNotes} subscribe={subscribe} subscribeRaw={subscribeRaw} claimed={stripActive ? STRIP_CLAIM : null}>
                  <PianoPlaybackProvider>
                    <MemoryRouter>
                      <div className="office-sheet-music__learn">
                        <NotationScore key={scoreId} contentId={scoreId} />
                      </div>
                    </MemoryRouter>
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
