import { IStateGatesAdministrationAuthorizer } from '#apps/state-gates/ports/IStateGatesAdministrationAuthorizer.mjs';

export class RoleStateGatesAdministrationAuthorizer extends IStateGatesAdministrationAuthorizer {
  constructor({ administrativeRoles = ['sysadmin', 'admin'], attestationRoles = ['sysadmin', 'admin', 'parent'] } = {}) {
    super();
    this.administrativeRoles = new Set(administrativeRoles);
    this.attestationRoles = new Set(attestationRoles);
  }
  async authorize(actor, action) {
    if (!actor?.id) return { allowed: false };
    const roles = actor.roles ?? [];
    const allowed = action === 'attest' || action === 'retract_attestation'
      ? roles.some(role => this.attestationRoles.has(role))
      : roles.some(role => this.administrativeRoles.has(role));
    return { allowed };
  }
}
export default RoleStateGatesAdministrationAuthorizer;
