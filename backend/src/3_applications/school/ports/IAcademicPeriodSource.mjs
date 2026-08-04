/** Configured academic calendar; period kind is data (term/semester/season/etc.). */
export class IAcademicPeriodSource {
  listPeriods() { throw new Error('IAcademicPeriodSource.listPeriods must be implemented'); }
  getPeriod(periodId) { // eslint-disable-line no-unused-vars
    throw new Error('IAcademicPeriodSource.getPeriod must be implemented');
  }
}

export default IAcademicPeriodSource;

