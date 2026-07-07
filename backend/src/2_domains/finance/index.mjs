/**
 * Finance Domain
 *
 * Only the classes actually consumed by the application layer
 * (BudgetCompilationService) and adapters (BuxferAdapter) live here.
 */

// Entities
export { Transaction } from './entities/Transaction.mjs';
export { Account } from './entities/Account.mjs';

// Services
export { TransactionClassifier } from './services/TransactionClassifier.mjs';
export { MortgageCalculator } from './services/MortgageCalculator.mjs';
