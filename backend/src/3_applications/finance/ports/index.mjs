/**
 * Finance Application Ports
 *
 * Port interfaces that define how the finance application layer
 * communicates with external systems.
 */

export { IFinanceProvider } from './IFinanceProvider.mjs';
export { IFinanceStore } from './IFinanceStore.mjs';
export { IPayrollGateway, isPayrollGateway } from './IPayrollGateway.mjs';
export { IPayrollRepository, isPayrollRepository } from './IPayrollRepository.mjs';
