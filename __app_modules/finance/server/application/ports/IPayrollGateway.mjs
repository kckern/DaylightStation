/** Semantic access to an external payroll provider. */
export class IPayrollGateway {
  async listPaychecks(_options) { throw new Error('IPayrollGateway.listPaychecks must be implemented'); }
  async getPaycheck(_check, _options) { throw new Error('IPayrollGateway.getPaycheck must be implemented'); }
}

export function isPayrollGateway(value) {
  return value != null
    && typeof value.listPaychecks === 'function'
    && typeof value.getPaycheck === 'function';
}

export default IPayrollGateway;
