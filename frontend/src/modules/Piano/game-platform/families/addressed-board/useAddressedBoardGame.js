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
  const matchGate = useContext(MatchGateContext);
  const matchGateRef = useRef(matchGate);
  matchGateRef.current = matchGate;

  const rankedRef = useRef(true);
  const savedRef = useRef(false);
  // The session whose phantom result we have already complained about, so a
  // terminal transcript sitting across many renders is one warning, not a storm.
  const refusedRef = useRef(null);
  // Set by a local restart, consumed by the next refusal: it tells the two
  // cases apart. See the refusal site.
  const justRestartedRef = useRef(false);
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

  // HOW FAR THIS COMPONENT ACTUALLY WATCHED THE GAME GET, while it was still
  // playable. A match played out here passes through every ply but its last;
  // a transcript that arrived already finished never does. That difference is
  // the only thing that separates a real result from a phantom, and on
  // 2026-09-01 nothing was checking it — see
  // docs/_wip/bugs/2026-09-01-connect-four-rematch-resumes-lost-game.md.
  //
  // Declared before the save effect so it has already run for every earlier
  // render by the time a terminal one is being filed.
  const playedThroughRef = useRef(-1);
  useEffect(() => {
    if (!result) playedThroughRef.current = Math.max(playedThroughRef.current, moves.length);
  }, [moves.length, result]);

  // Persist the finished game once. `savedRef` rather than a state flag: this
  // has to be closed the instant it fires, and a re-render is too late.
  useEffect(() => {
    if (!result || savedRef.current) return;
    // CONTRACT: ONE PLY PER COMMIT. A match played here is committed a ply at a
    // time, so the render before its last leaves `playedThrough` exactly one
    // short — that is the whole meaning of the `- 1`. Both current consumers
    // hold to it: the engine's reply is dispatched from an effect keyed on
    // committed state (`useOpponentReply`), so it lands in its own render. A
    // game that ever commits a player move AND an engine reply in the same
    // render breaks the assumption, and its legitimately-played results will be
    // refused — and then its abandon archive refused too, so the match vanishes
    // whole. There is a named test pinning that case in
    // useAddressedBoardGame.result.test.jsx; read it before writing such a game.
    // (A zero-ply terminal files rather than refuses: -1 < -1 is false. No
    // consumer can reach it, and refusing an empty transcript buys nothing.)
    if (playedThroughRef.current < moves.length - 1) {
      if (justRestartedRef.current) {
        // THE ORDINARY REMATCH, not an incident. `restart()` mints a session id
        // while the finished board is still mounted, so one commit carries the
        // new session and the old terminal transcript. Routine, and it must not
        // spend the warning below: an alarm that fires on every "Play again" is
        // one everybody learns to scroll past, which is how the original bug
        // stayed invisible for weeks.
        justRestartedRef.current = false;
        logger.debug('game.result-refused', {
          gameId, gameSessionId, result, plies: moves.length,
          playedThrough: playedThroughRef.current, reason: 'restart-stale-render',
        });
        return;
      }
      // Anything else means a transcript arrived from somewhere it should not
      // have. That is the one worth waking up for.
      //
      // A refusal is a judgement about the TRANSCRIPT in front of us on this
      // render, never about the session. `savedRef` means "this session's
      // result has been FILED", and a refusal files nothing, so it has no
      // business closing the one-shot: leave it open and a game that really is
      // played afterwards can still file. Closing it here is what left the
      // non-gated "Play again" path unable to record its next game at all —
      // restart mints a session id, this effect re-runs on the still-terminal
      // props, and the one shot was spent before a single new ply was played.
      if (refusedRef.current !== gameSessionId) {
        refusedRef.current = gameSessionId;
        logger.warn('game.result-refused', {
          gameId, gameSessionId, result, plies: moves.length,
          playedThrough: playedThroughRef.current, reason: 'not-played-here',
        });
      }
      return;
    }
    savedRef.current = true;
    const { prepareTerminal, ...baseContext } = archiveContextRef.current;
    // This runs before persistence so the result card, archive, and rivalry
    // memory all receive the same final displayed line.
    const preparedContext = prepareTerminal?.() || {};
    const record = {
      game_id: gameSessionId, moves, result, level, ranked: rankedRef.current, completed: true,
      played_on: new Date().toISOString().slice(0, 10),
      ...baseContext,
      ...preparedContext,
    };
    logger.info('game.over', {
      gameId, result, level, ranked: rankedRef.current, plies: moves.length,
    });
    if (userId) {
      const request = client.saveGame(userId, record);
      matchGateRef.current?.registerCompletion?.(request);
      request.then((response) => {
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
    // ...but only a game this component actually played. A transcript it never
    // played is not a game it can report on, finished OR abandoned — refusing
    // the result and then filing the same phantom as `completed: false` on the
    // way out just trades a duplicate for a junk row.
    // (Strict, not `- 1`: no terminal ply is landing here. A component that
    // unmounted in the same commit as its final ply would be refused, but a
    // finished game sets `savedRef` and returns above before reaching this.)
    if (playedThroughRef.current < movesRef.current.length) {
      logger.warn('game.abandon-refused', {
        gameId, plies: movesRef.current.length,
        playedThrough: playedThroughRef.current, reason: 'not-played-here',
      });
      return;
    }
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
    playedThroughRef.current = -1;
    justRestartedRef.current = true;
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
