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
  // A ghost id is `ghost:<raceId>:<sourceId>`. A ghost recorded from a race that
  // itself contained a ghost nests (`ghost:R2:ghost:R1:user`); the real source is
  // always the FINAL segment (source slugs — incl. hyphenated guests — never
  // contain a colon), so dereference straight to it rather than blindly taking [2].
  // If the id is malformed (only 2 segments), fall back to the whole id.
  const ghostParts = isGhost ? id.split(':') : [];
  const sourceId = isGhost ? (ghostParts.length >= 3 ? (ghostParts.pop() || id) : id) : id;
  return {
    id,
    isGhost,
    sourceId,
    displayName: displayName || sourceId,
    avatarSrc: `${AVATAR_BASE}/${sourceId}`
  };
}

export default resolveParticipantIdentity;
