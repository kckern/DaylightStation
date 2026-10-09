import { useCallback, useEffect, useRef, useState } from 'react';
import { chessRuleModule } from '@shared-gaming/rulesets/chess/ruleModule.mjs';
import { createCheckpointedLocalAuthority, isResumableSession } from '../../Gaming/platform/authority/createCheckpointedLocalAuthority.js';
import getLogger from '../../../lib/logging/Logger.js';
import { fetchResumableGame } from './chessApi.js';
import { chooseResumeSource, replayArchivedGame } from './chessResume.js';

const ACTOR = 'piano-player';

/**
 * How long an unfinished game stays resumable after its last move.
 *
 * The saved session is a reload's safety net — the tablet reloads itself many
 * times a day — not a save slot. It lives in ONE screen's localStorage, so a
 * game left on the office display waits there, invisible from the tablet,
 * until the same player next opens chess on that screen. On 2026-09-27 that
 * was a month: a child who had just left a game on the tablet was handed a
 * different, 30-day-old board, already filed as abandoned, with 739 hours on
 * the clock. Six hours covers an afternoon away; it does not cover tomorrow.
 */
export const RESUME_MAX_IDLE_MS = 6 * 60 * 60 * 1000;

/**
 * THE SERVER IS THE SOURCE OF TRUTH FOR AN UNFINISHED GAME; this checkpoint is
 * a fast path. On 2026-10-09 the six-hour rule below discarded the only copy
 * of a won position (`chess.resume.stale-discarded {idleMs:45776902}`). The
 * rule now decides only whether the LOCAL checkpoint is used, and only gives
 * way to a server copy that is confirmed to exist — see `chooseResumeSource`.
 */
const SERVER_ASK_TIMEOUT_MS = 3000;

function askServer(fetchResumable, userId) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve({ outcome: 'timeout' }), SERVER_ASK_TIMEOUT_MS); });
  const ask = Promise.resolve().then(() => fetchResumable(userId))
    .then((body) => (body ? { outcome: 'answered', body } : { outcome: 'error' }))
    .catch(() => ({ outcome: 'error' }));
  return Promise.race([ask, deadline]).finally(() => clearTimeout(timer));
}

let cachedLogger;
function logger() {
  if (!cachedLogger) cachedLogger = getLogger().child({ component: 'chess-authority' });
  return cachedLogger;
}

/** Ms since the last move landed, or null for a board nobody has moved on. */
export function sessionIdleMs(session, now = Date.now()) {
  const last = Number(session?.state?.history?.at?.(-1)?.logical_time);
  return Number.isFinite(last) ? Math.max(0, now - last) : null;
}

export function useChessAuthority({
  userId = 'household', initialFen, seed, playerColor = 'w', fetchResumable = fetchResumableGame,
} = {}) {
  const authorityRef = useRef(null);
  const sessionRef = useRef(null);
  const startPromiseRef = useRef(null);
  const generationRef = useRef(0);
  const [session, setSession] = useState(null);
  const [resumeInfo, setResumeInfo] = useState(null);
  const definition = { id: 'chess-standard', variant: 'standard', initial_fen: initialFen };
  const definitionKey = String(initialFen);
  const indexKey = `gaming:piano-chess:active:${userId}`;

  const start = useCallback(async ({ fresh = false, nextSeed = seed } = {}) => {
    const authority = createCheckpointedLocalAuthority({
      ruleset: chessRuleModule,
      definition,
      namespace: 'gaming:piano-chess',
    });
    const generation = ++generationRef.current;
    authorityRef.current = authority;
    let resumed = null;
    let info = null;
    let decision = null;
    const prior = fresh ? null : localStorage.getItem(indexKey);
    if (!fresh) {
      const persistent = Boolean(userId) && userId !== 'household';
      const serverAsk = persistent ? askServer(fetchResumable, userId) : Promise.resolve({ outcome: 'not-asked' });
      // A FINISHED GAME IS NOT A GAME IN PROGRESS — see `isResumableSession` and
      // the identical guard in the other two board games.
      let local = { present: false };
      let priorSession = null;
      if (prior) {
        try {
          priorSession = await authority.resume(prior, { participant_id: ACTOR });
          local = {
            present: true,
            unreadable: false,
            finished: !isResumableSession(priorSession),
            idleMs: sessionIdleMs(priorSession),
            maxIdleMs: RESUME_MAX_IDLE_MS,
          };
        } catch { local = { present: true, unreadable: true }; }
      }
      const asked = await serverAsk;
      let server = asked.outcome === 'answered' ? asked.body : null;
      let serverKind = asked.outcome === 'answered' ? (server?.game ? 'game' : 'none') : asked.outcome;
      if (serverKind === 'timeout') logger().warn('chess.resume.server-timeout', { userId, timeoutMs: SERVER_ASK_TIMEOUT_MS });
      if (serverKind === 'error') logger().warn('chess.resume.server-error', { userId });
      let replay = null;
      if (server?.game) {
        const record = server.game.record;
        replay = replayArchivedGame(record);
        const unusable = !replay.ok ? `replay-${replay.reason}`
          : replay.gameOver ? 'game-over'
            : (record.player_color && record.player_color !== playerColor) ? 'player-color-mismatch'
              : null;
        if (unusable) {
          logger().warn('chess.resume.server-copy-unusable', { userId, gameId: server.game.game_id, reason: unusable, ply: replay.ply ?? null });
          server = null;
          serverKind = 'none';
          replay = null;
        } else if (replay.fenMatches === false) {
          logger().warn('chess.resume.server-copy-fen-mismatch', { userId, gameId: server.game.game_id });
        }
      }
      if (local.present && !local.unreadable && server?.game && replay?.ok) {
        const localMoves = priorSession?.state?.history || [];
        local.continuesServer = replay.moves.length <= localMoves.length
          && replay.moves.every((m, i) => m.from === localMoves[i]?.from && m.to === localMoves[i]?.to);
      }
      const choice = chooseResumeSource({ local, server });
      const plies = priorSession?.state?.history?.length ?? null;
      if (choice.discardLocal) {
        logger().info('chess.resume.local-discarded', {
          userId, reason: choice.discardLocal, idleMs: local.idleMs ?? null, plies,
          serverGameId: server?.game?.game_id ?? null,
        });
      }
      if (choice.keptStale) {
        logger().info('chess.resume.stale-kept', { userId, reason: choice.keptStale, idleMs: local.idleMs ?? null, plies });
      }
      if (choice.source === 'server') {
        const record = server.game.record;
        try {
          // ONE PASS, not 74 dispatches: each dispatch replays the whole journal
          // (O(n^3) overall — ~18s for this game), see createWithHistory.
          const rebuilt = await authority.createWithHistory({
            ruleset: { id: 'chess', version: 1 },
            definitionId: 'chess-standard',
            participants: [{ id: ACTOR }],
            viewer: { participant_id: ACTOR },
            seed: Number.isFinite(Number(record.seed)) ? Number(record.seed) >>> 0 : Number(nextSeed) >>> 0,
          }, replay.moves.map((step) => ({
            actor_id: ACTOR,
            logical_time: Date.now(),
            command: { type: 'chess.move', from: step.from, to: step.to, promotion: step.promotion },
          })));
          resumed = rebuilt;
          info = {
            source: 'server', gameId: server.game.game_id, plies: replay.moves.length,
            ageMs: server.game.age_ms ?? null, pinned: Boolean(server.game.pinned),
          };
          logger().info('chess.resume.from-server', {
            userId, gameId: info.gameId, plies: info.plies, ageMs: info.ageMs, pinned: info.pinned,
            seedKnown: Number.isFinite(Number(record.seed)),
          });
        } catch (error) {
          logger().error('chess.resume.server-replay-failed', { userId, gameId: server.game.game_id, error: error.message });
          // Nothing is lost by failing here: the server copy is untouched, and a
          // usable local checkpoint is still taken below.
          if (local.present && !local.unreadable && !local.finished) resumed = priorSession;
        }
      } else if (choice.source === 'local') {
        resumed = priorSession;
      }
      if (!resumed && prior) localStorage.removeItem(indexKey);
      decision = {
        userId, persistent, localPresent: local.present, localAgeMs: local.idleMs ?? null,
        server: serverKind,
        notAskedReason: persistent ? null : (userId === 'household' ? 'household-identity' : 'no-user'),
        chosen: !resumed ? 'new' : (resumed === priorSession ? 'local'
          : (server?.game?.pinned ? 'pinned' : 'server')),
        gameId: resumed === priorSession ? (priorSession?.header?.session_id ?? null) : (info?.gameId ?? null),
        plies: resumed?.state?.history?.length ?? 0,
      };
    }
    // A newer start() (identity arrived) owns the board; this one stands down.
    if (generation !== generationRef.current) {
      logger().info('chess.resume.superseded', { userId });
      return null;
    }
    if (!decision) {
      decision = { userId, persistent: Boolean(userId) && userId !== 'household', localPresent: false, localAgeMs: null,
        server: 'not-asked', notAskedReason: 'fresh-start', chosen: 'new', gameId: null, plies: 0 };
    }
    logger().info('chess.resume.decision', decision);
    setResumeInfo(info);
    if (!resumed) {
      resumed = await authority.create({
        ruleset: { id: 'chess', version: 1 },
        definitionId: 'chess-standard',
        participants: [{ id: ACTOR }],
        viewer: { participant_id: ACTOR },
        seed: Number(nextSeed) >>> 0,
      });
      localStorage.setItem(indexKey, resumed.header.session_id);
    }
    sessionRef.current = resumed;
    setSession(resumed);
    return resumed;
  // definitionKey captures the authored initial position without depending on
  // a freshly allocated definition object. The seed is run setup, not definition.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionKey, indexKey]);

  const firstUserRef = useRef(userId);
  useEffect(() => {
    // A board with moves on it is never replaced by a late identity.
    if (firstUserRef.current !== userId && sessionRef.current?.state?.history?.length > 0) {
      logger().warn('chess.resume.late-identity-ignored', { from: firstUserRef.current, to: userId });
      return;
    }
    firstUserRef.current = userId;
    startPromiseRef.current = start();
  }, [start, userId]);

  const dispatch = useCallback(async (command) => {
    const current = sessionRef.current || await startPromiseRef.current;
    if (!current) throw new Error('Chess authority is unavailable');
    const result = await authorityRef.current.dispatch(current.header.session_id, {
      command_id: `piano:${crypto.randomUUID()}`,
      actor_id: ACTOR,
      expected_revision: current.header.revision,
      logical_time: Date.now(),
      command,
    }, { participant_id: ACTOR });
    sessionRef.current = result;
    setSession(result);
    return result;
  }, []);

  const move = useCallback((value) => dispatch({
    type: 'chess.move', from: value.from, to: value.to, promotion: value.promotion || 'q',
  }), [dispatch]);
  const takeback = useCallback((plies) => dispatch({ type: 'chess.takeback', plies }), [dispatch]);
  const reset = useCallback(async (nextSeed) => {
    // A FINISHED SESSION CANNOT BE CLOSED, AND DOES NOT NEED TO BE. The kernel
    // refuses every command on a terminal session — `session.close` included
    // (`runtime.dispatch`: "Session … is complete") — so after a checkmate this
    // close ALWAYS throws. Left unhandled it aborted the reset before the fresh
    // start: "Play again" swapped the board but never minted a new authority
    // session, and every move in the new game died `authority-move-failed:
    // Session is complete` — a zombie board until remount. Complete is already
    // closed in every sense that matters; a genuinely live session still gets
    // its close, and a close that fails for any reason must not cost the
    // player their next game.
    if (sessionRef.current) {
      try { await authorityRef.current.close(sessionRef.current.header.session_id); }
      catch { /* terminal already, or close raced — start fresh regardless */ }
    }
    localStorage.removeItem(indexKey);
    return start({ fresh: true, nextSeed });
  }, [indexKey, start]);

  return { session, ready: Boolean(session), move, takeback, reset, resumeInfo };
}

export default useChessAuthority;
