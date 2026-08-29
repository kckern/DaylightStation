/**
 * Owns persisted payroll records and their legacy-to-current addressing rules.
 * A sync session exposes semantic pending checks and the resulting paycheck set.
 */
export class IPayrollRepository {
  beginSync(_householdId, _checks) { throw new Error('IPayrollRepository.beginSync must be implemented'); }
  getMapping(_householdId) { throw new Error('IPayrollRepository.getMapping must be implemented'); }
  getTransactionEntries(_householdId) { throw new Error('IPayrollRepository.getTransactionEntries must be implemented'); }
}

export function isPayrollRepository(value) {
  return value != null
    && typeof value.beginSync === 'function'
    && typeof value.getMapping === 'function'
    && typeof value.getTransactionEntries === 'function';
}

export default IPayrollRepository;
