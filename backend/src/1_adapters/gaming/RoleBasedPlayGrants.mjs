import { IPlayTimeGrant } from '#apps/gaming/ports/IPlayTimeGrant.mjs';

/** Roles that play without a ceiling. Mirrors the gaming API's host roles. */
const DEFAULT_ADMIN_ROLES = Object.freeze(['sysadmin', 'parent', 'gaming-host']);

/**
 * Grants unlimited play to adults, and nothing to anyone else — yet.
 *
 * This exists so shared and family play works before the economy issues real
 * grants. Several children on a couch with a parent present is attributed to
 * the adult, who plays without a ceiling; that is what removes the need to work
 * out who is holding which controller.
 *
 * An unlimited grant is a grant with NO CEILING, not a bypass: it travels the
 * same path, is recorded the same way, and is metered the same way. The session
 * is still observed and still billed to a person — there is simply nothing to
 * run out.
 *
 * Everyone else gets `null`, meaning NO grant, which is deliberately not the
 * same as unlimited: nothing counts down and nothing is ever stopped. A child's
 * play is measured and recorded from day one and starts costing only when a real
 * grant source is wired in beside this.
 */
export class RoleBasedPlayGrants extends IPlayTimeGrant {
  #profileFor; #adminRoles; #logger;

  constructor({ profileFor, adminRoles = DEFAULT_ADMIN_ROLES, logger = console }) {
    super();
    if (typeof profileFor !== 'function') throw new Error('RoleBasedPlayGrants requires profileFor()');
    this.#profileFor = profileFor;
    this.#adminRoles = new Set(adminRoles);
    this.#logger = logger;
  }

  async forSession(session) {
    const userId = session?.userId;
    if (!userId) return null;

    let profile;
    try {
      profile = await this.#profileFor(userId);
    } catch (error) {
      // Cannot establish who this is ⇒ no grant. Never fall back to unlimited.
      this.#logger.warn?.('play.grant.profile_unavailable', { userId, error: error.message });
      return null;
    }
    if (!profile) return null;

    const roles = Array.isArray(profile.roles) ? profile.roles.map(String) : [];
    const isAdmin = profile.type === 'owner' || roles.some((role) => this.#adminRoles.has(role));
    if (!isAdmin) return null;

    return { grantedMs: null, grantRef: `admin:${userId}` };
  }
}

export default RoleBasedPlayGrants;
