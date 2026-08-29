import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import MatchGateContext from '../../../PianoKiosk/modes/Games/MatchGateContext.js';

let localSessionSequence = 0;

function createLocalSessionId(gameId) {
  localSessionSequence = (localSessionSequence + 1) >>> 0;
  return `${gameId}-${Date.now()}-${localSessionSequence}`;
}

/**
 * The session a board game keeps around its rules.
 *
 * Checkers and Connect Four each wrote this out longhand and arrived at the same
 * seven pieces of state, the same two persistence effects, the same restart, and
 * the same `userIdOf` — verbatim, down to the comments. None of it is about
 * checkers or about connect four; it is about being a ranked, laddered, archived
 * board game on this kiosk. So it lives here once, and a third game inherits it
 * instead of copying it a third time.
 *
 * What stays with the game: its rules, its board, its input grammar, and its
 * language. The hook never sees a move — it holds the transcript, and the game
 * says what a transcript means.
 *
 * The game keeps its own transcript and passes it in. Two owners of one `moves`
 * array is two sources of truth, and the one that matters here is the one the
 * board is drawn from — so the hook reads it and never writes it.
 *
 * `result` is the caller's own reading of its game state: 'win' | 'loss' |
 * 'draw' while finished, null while playing. The hook watches it rather than a
 * game object, because "is this over, and how" is the one question every board
 * game answers differently and none of them should have to explain to a shell.
 */
export function useAddressedBoardGame({
  gameId,
  client,
  currentUser = null,
  defaultConfig = {},
  ladderLevels = 7,
  moves = [],
  result = null,
}) {
  const userId = userIdOf(currentUser);
  const logger = useMemo(() => getLogger().child({ component: `piano-${gameId}` }), [gameId]);

  const [config, setConfig] = useState(defaultConfig);
  const [ladder, setLadder] = useState(null);
  const [localPractice, setLocalPractice] = useState(false);
  const [seed, setSeed] = useState(() => Date.now() >>> 0);
  const [gameSessionId, setGameSessionId] = useState(() => createLocalSessionId(gameId));

  const rankedRef = useRef(true);
  const savedRef = useRef(false);
  const archiveContextRef = useRef({});
  const movesRef = useRef(moves);
  movesRef.current = moves;
  // The unmount archive fires from a cleanup that must NOT re-run when the
  // player identity changes mid-game: keying the effect on `userId` made a
  // profile switch file the game as abandoned while it was still being played.
  // The id is read through a ref at the moment the archive actually happens.
  const userRef = useRef(userId);
  userRef.current = userId;

  const level = ladder?.unlocked_through ?? config.default_level ?? 1;

  useEffect(() => {
    let cancelled = false;
    logger.info('game.mount', { gameId, userId: userId ?? 'guest' });
    client.readConfig(userId).then((value) => {
      if (cancelled || !value) return;
      setConfig((old) => ({ ...old, ...value }));
      logger.debug('game.config-loaded', { gameId });
    });
    client.readLadder(userId).then((value) => {
      if (cancelled || !value) return;
      setLadder(value);
      logger.info('game.ladder-loaded', {
        gameId, level: value.unlocked_through ?? null, opponent: value.current?.name ?? null,
      });
    });
    return () => { cancelled = true; };
  }, [client, gameId, logger, userId]);

  // Persist the finished game once. `savedRef` rather than a state flag: this
  // has to be closed the instant it fires, and a re-render is too late.
  useEffect(() => {
    if (!result || savedRef.current) return;
    savedRef.current = true;
    const { prepareTerminal, ...baseContext } = archiveContextRef.current;
    // This runs before persistence so the result card, archive, and rivalry
    // memory all receive the same final displayed line.
    const preparedContext = prepareTerminal?.() || {};
    const record = {
      moves, result, level, ranked: rankedRef.current, completed: true,
      played_on: new Date().toISOString().slice(0, 10),
      game_id: gameSessionId,
      ...baseContext,
      ...preparedContext,
    };
    logger.info('game.over', {
      gameId, result, level, ranked: rankedRef.current, plies: moves.length,
    });
    if (userId) {
      client.saveGame(userId, record).then((response) => {
        if (!response?.ladder) return;
        setLadder(response.ladder);
        logger.info('game.ladder-advanced', {
          gameId, level: response.ladder.unlocked_through ?? null,
        });
      });
    }
    client.archiveGame({ ...record, user_id: userId });
  }, [client, gameId, gameSessionId, level, logger, moves, result, userId]);

  // A game walked away from is still a game that happened. Mount-scoped so a
  // profile change cannot trip it — see userRef above.
  useEffect(() => () => {
    if (savedRef.current || !movesRef.current.length) return;
    logger.info('game.abandoned', { gameId, plies: movesRef.current.length });
    client.archiveGame({
      moves: movesRef.current, completed: false, user_id: userRef.current, ended_by: 'exit',
    });
  }, [client, gameId, logger]);

  const updateConfig = useCallback((patch) => {
    setConfig((value) => ({ ...value, ...patch }));
    logger.debug('game.config-changed', { gameId, keys: Object.keys(patch) });
    if (userRef.current) client.writeConfig(userRef.current, patch);
  }, [client, gameId, logger]);

  /**
   * The server had nothing to say, so the bundled engine answered instead. The
   * game is still playable and still archived — it is simply not ranked, because
   * a dropped kiosk WiFi must never turn offline engine help into ladder
   * advancement.
   */
  const noteLocalPractice = useCallback(() => {
    rankedRef.current = false;
    setLocalPractice((already) => {
      if (!already) logger.warn('game.local-practice', { gameId, gameSessionId });
      return true;
    });
  }, [gameId, gameSessionId, logger]);

  // Who, if anyone, owns the boundary between one match and the next. Read
  // through a ref so `restart` keeps its stable identity — it is passed to
  // `useAnyKeyToContinue`, and a callback that changes identity every render
  // there re-arms the key listener under a player's fingers.
  const matchGate = useContext(MatchGateContext);
  const matchGateRef = useRef(matchGate);
  matchGateRef.current = matchGate;

  // The transcript belongs to the game, so clearing it does too — restart resets
  // everything ranked-ness depends on and hands back the new session id.
  //
  // Unless a gate stands at this boundary (D11): then the host unmounts this
  // game and mounts the challenge, and the next match arrives as a REMOUNT with
  // fresh state of its own. Resetting here first would mint a seed and a
  // session id for a match nobody plays, and the unmount archive above would
  // then file that phantom as abandoned. `null` from the context — the office
  // screen, PianoVisualizer, anywhere outside the kiosk — is the ordinary case
  // and restarts exactly as before.
  const restart = useCallback(() => {
    const gate = matchGateRef.current;
    if (gate?.armed) {
      gate.requestRematch();
      return null;
    }
    setLocalPractice(false);
    rankedRef.current = true;
    savedRef.current = false;
    setSeed((value) => (value + 1) >>> 0);
    const next = createLocalSessionId(gameId);
    setGameSessionId(next);
    logger.info('game.restart', { gameId, gameSessionId: next });
    return next;
  }, [gameId, logger]);

  return {
    userId,
    logger,
    config,
    updateConfig,
    ladder,
    level,
    ladderLevels,
    seed,
    gameSessionId,
    localPractice,
    noteLocalPractice,
    restart,
    opponentName: ladder?.current?.name ?? null,
    archiveContextRef,
  };
}

/** A guest plays, and is not recorded. Anyone else is. */
export function userIdOf(currentUser) {
  const value = typeof currentUser === 'string' ? currentUser : currentUser?.id;
  return value && value !== 'guest' ? value : null;
}

export default useAddressedBoardGame;
