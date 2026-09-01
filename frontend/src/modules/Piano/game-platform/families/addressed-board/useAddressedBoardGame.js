import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import MatchGateContext from '../../../PianoKiosk/modes/Games/MatchGateContext.js';

// How long a result waits for the ladder before being filed against the
// fallback rung. A slow network must not cost a child their record.
const LADDER_SETTLE_TIMEOUT_MS = 5000;

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
  // Whether the ladder read has ANSWERED — not whether it produced a ladder.
  // `level` falls back to 1 until it does, and a result filed in that window
  // is filed against a rung nobody is on. See the level:1 fingerprint in
  // docs/_wip/bugs/2026-09-01-connect-four-rematch-resumes-lost-game.md.
  const [ladderSettled, setLadderSettled] = useState(false);
  const [localPractice, setLocalPractice] = useState(false);
  const [seed, setSeed] = useState(() => Date.now() >>> 0);
  const [gameSessionId, setGameSessionId] = useState(() => createLocalSessionId(gameId));
  const matchGate = useContext(MatchGateContext);
  const matchGateRef = useRef(matchGate);
  matchGateRef.current = matchGate;

  const rankedRef = useRef(true);
  const savedRef = useRef(false);
  // The phantom we have already complained about, keyed `session:plies` — hence
  // "phantom" and not "session": a render storm collapses to one warning, while
  // a genuinely different phantom in the same session still speaks.
  const warnedPhantomRef = useRef(null);
  // A local restart, waiting for the new match's first playable render to take
  // effect. See the tracker effect.
  const pendingRestartRef = useRef(false);
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
    setLadderSettled(false);
    // FAIL OPEN. A read that never answers must cost a level, never a record —
    // so the wait is bounded and the result files against the fallback rung.
    const settle = setTimeout(() => {
      if (cancelled) return;
      logger.warn('game.ladder-read-slow', { gameId, timeoutMs: LADDER_SETTLE_TIMEOUT_MS });
      setLadderSettled(true);
    }, LADDER_SETTLE_TIMEOUT_MS);
    Promise.resolve(client.readLadder(userId))
      .then((value) => {
        if (cancelled || !value) return;
        setLadder(value);
        logger.info('game.ladder-loaded', {
          gameId, level: value.unlocked_through ?? null, opponent: value.current?.name ?? null,
        });
      })
      .catch((error) => logger.warn('game.ladder-read-failed', { gameId, error: error?.message }))
      .finally(() => {
        if (cancelled) return;
        clearTimeout(settle);
        setLadderSettled(true);
      });
    return () => { cancelled = true; clearTimeout(settle); };
  }, [client, gameId, logger, userId]);

  // HOW FAR THIS COMPONENT ACTUALLY WATCHED THE GAME GET, while it was still
  // playable. A match played out here passes through every ply but its last;
  // a transcript that arrived already finished never does. That difference is
  // the only thing that separates a real result from a phantom, and on
  // 2026-09-01 nothing was checking it — see
  // docs/_wip/bugs/2026-09-01-connect-four-rematch-resumes-lost-game.md.
  //
  // This effect is declared before the save effect below, so on any commit it
  // runs first and the save effect always sees a count that includes the render
  // it is judging. (The `useRef` placement carries no such meaning — only the
  // effect order does.)
  const watchedPliesRef = useRef(-1);
  useEffect(() => {
    if (result) return;
    if (pendingRestartRef.current) {
      // A RESTART TAKES EFFECT HERE, at the new match's first playable render,
      // rather than inside `restart()`. Between the two, the finished board is
      // still mounted for however many commits the async authority reset takes,
      // and leaving `savedRef` set through them is what makes those renders
      // ordinary already-filed repeats — caught by the early return below like
      // any other. Nothing downstream has to recognise and forgive them, so
      // every refusal that survives is unambiguously an incident.
      savedRef.current = false;
      watchedPliesRef.current = moves.length; // a NEW game: assign, never max
      pendingRestartRef.current = false;
      return;
    }
    watchedPliesRef.current = Math.max(watchedPliesRef.current, moves.length);
  }, [moves.length, result]);

  // A result the rung gate below deferred, held as the whole judgement-and-
  // filing of the render that produced it, so that whoever makes it
  // unreachable can still carry it out.
  const pendingFileRef = useRef(null);

  // Persist the finished game once. `savedRef` rather than a state flag: this
  // has to be closed the instant it fires, and a re-render is too late.
  useEffect(() => {
    // A DEFERRAL MEANS WAIT, NEVER LOSE. Two things can put a deferred result
    // beyond this effect's reach: a restart, handled here, and an unmount,
    // handled in the abandon cleanup below. Either way it is filed against the
    // rung we have — the fallback is the answer we would have written before
    // this gate existed, and it beats no record at all.
    const deferred = pendingFileRef.current;
    pendingFileRef.current = null;
    if (deferred && !result) {
      deferred();
      // The flush belonged to the match that just ENDED. `savedRef` is the
      // one-shot of the match now taking the seat, and that one has filed
      // nothing — leaving it closed would swallow the next real result.
      savedRef.current = false;
    }

    // WAIT FOR THE RUNG. Not a refusal and not a filing — the same result is
    // judged again the moment the ladder answers, so this must come before the
    // refusal branch and before the one-shot is spent.
    if (!result || savedRef.current) return;
    // CONTRACT: ONE PLY PER COMMIT. A match played here is committed a ply at a
    // time, so the render before its last leaves `watchedPlies` exactly one
    // short — that is the whole meaning of the `- 1`. Both current consumers
    // hold to it: the engine's reply is dispatched from an effect keyed on
    // committed state (`useOpponentReply`), so it lands in its own render. A
    // game that ever commits a player move AND an engine reply in the same
    // render breaks the assumption, and its legitimately-played results will be
    // refused — and then its abandon archive refused too, so the match vanishes
    // whole. See the KNOWN LIMITATION test before writing such a game.
    //
    // SNAPSHOTTED, not read when the filing happens: a flush can run after a
    // restart has already re-pointed the ref at the NEW match, and the
    // judgement has to stay the one this render deserved.
    const watchedPlies = watchedPliesRef.current;

    // The judgement and the filing of THIS render's result — the same code
    // whether the ladder answers or the child walks off, so there is one rule
    // and not two.
    const fileResult = (flushed = false) => {
      if (savedRef.current) return;
      if (watchedPlies < 0 || watchedPlies < moves.length - 1) {
        // A refusal is a judgement about the TRANSCRIPT in front of us on this
        // render, never about the session. `savedRef` means "this session's
        // result has been FILED", and a refusal files nothing, so it has no
        // business closing the one-shot: leave it open and a game that really is
        // played afterwards can still file.
        const phantom = `${gameSessionId}:${moves.length}`;
        if (warnedPhantomRef.current !== phantom) {
          warnedPhantomRef.current = phantom;
          logger.warn('game.result-refused', {
            gameId, gameSessionId, result, plies: moves.length,
            watchedPlies, reason: 'not-played-here',
          });
        }
        return;
      }
      savedRef.current = true;
      if (flushed) {
        // Filed by the way out rather than the front door: the ladder read was
        // still hanging when this match lost its screen, so the rung below is
        // the fallback and not the child's.
        logger.warn('game.result-flushed', {
          gameId, gameSessionId, result, level, plies: moves.length,
        });
      }
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
    };

    if (!ladderSettled) {
      pendingFileRef.current = () => fileResult(true);
      return;
    }
    fileResult();
  }, [client, gameId, gameSessionId, ladderSettled, level, logger, moves, result, userId]);

  // A game walked away from is still a game that happened. Mount-scoped so a
  // profile change cannot trip it — see userRef above.
  useEffect(() => () => {
    // A result still waiting on the ladder when the screen goes away. The match
    // gate unmounts this game on "play again", so this is an ordinary path and
    // not a curiosity, and filing it here is what keeps the premise below true:
    // a finished game has set `savedRef` by the time we reach the guard.
    pendingFileRef.current?.();
    pendingFileRef.current = null;
    if (savedRef.current || !movesRef.current.length) return;
    // ...but only a game this component actually played. A transcript it never
    // played is not a game it can report on, finished OR abandoned — refusing
    // the result and then filing the same phantom as `completed: false` on the
    // way out just trades a duplicate for a junk row.
    // (Strict, not `- 1`: no terminal ply is landing here. A component that
    // unmounted in the same commit as its final ply would be refused, but a
    // finished game sets `savedRef` — when it filed, or in the flush just
    // above — and returns before reaching this.)
    if (watchedPliesRef.current < movesRef.current.length) {
      logger.warn('game.abandon-refused', {
        gameId, plies: movesRef.current.length,
        watchedPlies: watchedPliesRef.current, reason: 'not-played-here',
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
    // Deferred, not applied here: the finished board stays mounted until the
    // authority reset lands, and reopening `savedRef` now would expose those
    // stale terminal renders to the save effect. See the tracker effect.
    pendingRestartRef.current = true;
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
