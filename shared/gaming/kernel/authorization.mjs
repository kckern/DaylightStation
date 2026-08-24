import { GamingKernelError } from './errors.mjs';

const idsFor = (entries = []) => new Set(entries.flatMap((entry) => [
  entry?.id,
  entry?.participant_id,
  entry?.user_id,
].filter(Boolean).map(String)));

/**
 * Kernel authorization policy for semantic actors. HTTP/device authentication
 * remains an adapter concern; this policy accepts only identities established
 * by that adapter. Request payloads are never an authority source.
 */
export class SessionActorAuthorization {
  authorizeView({ session, viewer = {} }) {
    if (viewer.role === 'host' || viewer.role === 'system') return;
    const actors = idsFor([...(session.header.participants || []), ...(session.header.seats || [])]);
    if (viewer.participant_id && actors.has(String(viewer.participant_id))) return;
    throw new GamingKernelError('authorization_denied', 'Viewer is not bound to this session');
  }

  authorizeCommand({ session, envelope, viewer = {} }) {
    const actorId = String(envelope.actor_id || '');
    const actors = idsFor([...(session.header.participants || []), ...(session.header.seats || [])]);
    // A server-established host may operate the host seat or act for a player
    // already bound to this session. This supports supervised household play
    // where the authenticated kiosk owner and the selected player are distinct,
    // without turning the command payload into an identity authority.
    const host = viewer.role === 'host'
      && (actorId === viewer.participant_id || actorId === 'host' || actors.has(actorId));
    const system = viewer.role === 'system' && actorId === 'system';
    const self = actors.has(actorId) && viewer.participant_id === actorId;
    if (!host && !system && !self) {
      throw new GamingKernelError('authorization_denied', `Actor ${actorId || '(missing)'} is not authorized for this session`);
    }
  }
}
