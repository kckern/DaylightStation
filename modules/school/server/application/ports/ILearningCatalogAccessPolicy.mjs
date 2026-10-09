/**
 * Operational visibility policy for the shared School Catalog.
 *
 * Authored curriculum says what exists; this port says which published
 * lessons a learner or Guest may browse. Implementations may translate
 * assignments, cohorts, or household configuration, but never a client or
 * calculator family.
 */
export class ILearningCatalogAccessPolicy {
  /**
   * @param {{learners: Array<{learnerId:string}>, lessons: Array<{address:string, context:object}>}} query
   * @returns {Promise<{learners:Array<{learnerId:string, lessonAddresses:string[]}>, guest:{lessonAddresses:string[]}}>} 
   */
  async resolve(query) { // eslint-disable-line no-unused-vars
    throw new Error('ILearningCatalogAccessPolicy.resolve must be implemented');
  }
}

export default ILearningCatalogAccessPolicy;
