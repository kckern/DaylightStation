/**
 * Budget - Legacy Re-export Shim
 *
 * This module re-exports from the new domain location for backwards compatibility.
 * All new code should import from:
 *   #backend/src/1_domains/finance/services/BudgetCompiler.mjs
 *
 * This shim will be removed in a future release.
 */

export {
  processMortgagePaymentPlans,
  processMortgage,
  compileBudget,
  refreshFinancialData,
  payrollSyncJob
} from '../../src/1_domains/finance/services/BudgetCompiler.mjs';

export { default } from '../../src/1_domains/finance/services/BudgetCompiler.mjs';
