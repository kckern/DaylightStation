/**
 * Supplies camera job plans and semantic runtime capabilities. Deployment
 * config, credentials, endpoints, and concrete recording/rendering adapters
 * remain behind this gateway.
 */
export class ICameraJobRuntimeGateway {
  loadLedgerPlan(_householdId) { throw new Error('loadLedgerPlan must be implemented'); }
  loadArchivePlan(_householdId) { throw new Error('loadArchivePlan must be implemented'); }
  createLedgerRuntime(_args) { throw new Error('createLedgerRuntime must be implemented'); }
  createArchiveRuntime(_args) { throw new Error('createArchiveRuntime must be implemented'); }
}

export function isCameraJobRuntimeGateway(value) {
  return value != null
    && typeof value.loadLedgerPlan === 'function'
    && typeof value.loadArchivePlan === 'function'
    && typeof value.createLedgerRuntime === 'function'
    && typeof value.createArchiveRuntime === 'function';
}

export default ICameraJobRuntimeGateway;
