import { CheckpointedLocalAuthority, GameRuntime, GameSessionCoordinator, SESSION_STATUSES, SessionActorAuthorization } from "../../../portable/kernel/index.mjs";
import { BrowserSessionJournal, BrowserSnapshotRepository, reclaimCheckpoints } from "./BrowserCheckpointPorts.js";
import { stableSha256 } from "../../../portable/kernel/canonical.mjs";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";

let cachedLogger;
function logger() {
  if (!cachedLogger) cachedLogger = getLogger().child({ component: 'gaming-checkpoints' });
  return cachedLogger;
}

const TERMINAL_STATUSES = new Set([SESSION_STATUSES.COMPLETE, SESSION_STATUSES.ABANDONED]);

/**
 * Is this session one a player can still be handed back?
 *
 * Every piano board game remembers its live session id and resumes it on mount,
 * so that a reload mid-match returns the board the player was on. A FINISHED
 * session is not that: resuming one hands the player the game they already
 * lost, on every mount, and the host's archive files the same result again.
 * The kernel refuses commands on a terminal session, so a resumed one is not
 * even playable — a fresh game is the only honest answer. See
 * ops:docs/_wip/bugs/2026-09-01-connect-four-rematch-resumes-lost-game.md.
 */
export function isResumableSession(session) {
  return Boolean(session) && !TERMINAL_STATUSES.has(session.header?.status);
}

export function createCheckpointedLocalAuthority({ ruleset, definition, namespace, storage = window.localStorage, actorId = 'local-player', clock = { now: () => new Date() } }) {
  const hash = stableSha256(definition);
  // Each authority is made at game start, so this is where finished games are
  // swept — see `reclaimCheckpoints`. A sweep that fails must never cost the
  // player their board: the quota path in the ports is the second chance.
  const onReclaim = (result, cause) => {
    if (result.removed.length) logger().info('gaming.checkpoints.reclaimed', { namespace, cause, removed: result.removed.length, kept: result.kept.length });
    // Full, and none of it ours to free: the space belongs to live games or to
    // other apps on this origin. Without this line the only trace is the
    // failed move that follows.
    else if (cause === 'quota') logger().warn('gaming.checkpoints.full-nothing-reclaimable', { namespace, kept: result.kept.length });
  };
  try { onReclaim(reclaimCheckpoints({ storage, namespace }), 'startup'); }
  catch (error) { logger().warn('gaming.checkpoints.reclaim-failed', { namespace, error: error.message }); }
  const snapshots = new BrowserSnapshotRepository({ storage, namespace, onReclaim }); const journal = new BrowserSessionJournal({ storage, namespace, onReclaim });
  const definitions = { getCurrent: async () => ({ definition, hash }), pin: async () => ({ definition, hash }), getPinned: async (value) => value === hash ? definition : null };
  const coordinator = new GameSessionCoordinator({ runtime: new GameRuntime({ rulesets: [ruleset] }), snapshots, journal, definitions, authorization: new SessionActorAuthorization(), ids: { session: () => `local:${crypto.randomUUID()}`, command: () => `local:${crypto.randomUUID()}`, seed: () => crypto.getRandomValues(new Uint32Array(1))[0] }, clock });
  return new CheckpointedLocalAuthority({ coordinator, actorId });
}
