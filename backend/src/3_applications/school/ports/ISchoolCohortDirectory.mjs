/** Resolve learner, household, classroom, or other configured cohort scopes. */
export class ISchoolCohortDirectory {
  listLearners() { throw new Error('ISchoolCohortDirectory.listLearners must be implemented'); }
  listScopes() { throw new Error('ISchoolCohortDirectory.listScopes must be implemented'); }
  resolveScope(query) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCohortDirectory.resolveScope must be implemented');
  }
  hasLearner(learnerId) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCohortDirectory.hasLearner must be implemented');
  }
}

export default ISchoolCohortDirectory;

