// Saved race participants can be ghosts, persisted with a synthetic id of the
// form `ghost:<sourceRaceId>:<sourceUserId>`. Building an avatar URL straight
// from that id 404s and falls back to the generic guest face. Resolve such ids
// back to the underlying real user so the records rail / pickers show the right
// face and name, and flag ghosts so callers can apply the grayscale+tint
// treatment.
const AVATAR_BASE = '/api/v1/static/img/users';

/**
 * @param {string} id           participant id (real slug or `ghost:<raceId>:<sourceId>`)
 * @param {string} [displayName] persisted display name (already the source's name)
 * @returns {{ id: string, isGhost: boolean, sourceId: string, displayName: string, avatarSrc: string }}
 */
export function resolveParticipantIdentity(id, displayName) {
  const isGhost = typeof id === 'string' && id.startsWith('ghost:');
  const sourceId = isGhost ? (id.split(':')[2] || id) : id;
  return {
    id,
    isGhost,
    sourceId,
    displayName: displayName || sourceId,
    avatarSrc: `${AVATAR_BASE}/${sourceId}`
  };
}

export default resolveParticipantIdentity;
