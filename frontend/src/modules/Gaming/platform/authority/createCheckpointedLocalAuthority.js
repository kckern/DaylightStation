import { CheckpointedLocalAuthority, GameRuntime, GameSessionCoordinator, SESSION_STATUSES, SessionActorAuthorization } from '@shared-gaming/kernel/index.mjs';
import { BrowserSessionJournal, BrowserSnapshotRepository } from './BrowserCheckpointPorts.js';
import { stableSha256 } from '@shared-gaming/kernel/canonical.mjs';

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
 * docs/_wip/bugs/2026-09-01-connect-four-rematch-resumes-lost-game.md.
 */
export function isResumableSession(session) {
  return Boolean(session) && !TERMINAL_STATUSES.has(session.header?.status);
}

export function createCheckpointedLocalAuthority({ ruleset, definition, namespace, storage = window.localStorage, actorId = 'local-player', clock = { now: () => new Date() } }) {
  const hash = stableSha256(definition);
  const snapshots = new BrowserSnapshotRepository({ storage, namespace }); const journal = new BrowserSessionJournal({ storage, namespace });
  const definitions = { getCurrent: async () => ({ definition, hash }), pin: async () => ({ definition, hash }), getPinned: async (value) => value === hash ? definition : null };
  const coordinator = new GameSessionCoordinator({ runtime: new GameRuntime({ rulesets: [ruleset] }), snapshots, journal, definitions, authorization: new SessionActorAuthorization(), ids: { session: () => `local:${crypto.randomUUID()}`, command: () => `local:${crypto.randomUUID()}`, seed: () => crypto.getRandomValues(new Uint32Array(1))[0] }, clock });
  return new CheckpointedLocalAuthority({ coordinator, actorId });
}
