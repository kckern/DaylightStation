/**
 * Security/persistence port for device-bound opaque lesson-action tokens.
 * Implementations own key material and registry I/O; applications see only
 * stable action bindings and opaque `sch:` values.
 */
export class ISchoolActionTokenIssuer {
  /**
   * @param {{deviceId:string,address:string,actionId:string,tokenVersion:number}} binding
   * @returns {Promise<{token:string,status:'accepted'|'duplicate',record:object}>}
   */
  async issue(binding) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolActionTokenIssuer.issue must be implemented');
  }
}

export default ISchoolActionTokenIssuer;
