/**
 * Finance Domain
 */

// Entities
export { Budget } from './entities/Budget.mjs';
export { Transaction } from './entities/Transaction.mjs';
export { Account } from './entities/Account.mjs';
export { Mortgage } from './entities/Mortgage.mjs';

// Services
export { BudgetService } from './services/BudgetService.mjs';
export { MortgageService } from './services/MortgageService.mjs';
export { TransactionClassifier } from './services/TransactionClassifier.mjs';
export { MortgageCalculator } from './services/MortgageCalculator.mjs';

// Ports (re-exported from application layer for backward compatibility)
export { ITransactionSource } from '#apps/finance/ports/ITransactionSource.mjs';
