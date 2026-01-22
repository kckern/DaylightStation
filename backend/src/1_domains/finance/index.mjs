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

// Migrated legacy services
export {
  compileBudget,
  refreshFinancialData,
  processMortgage,
  processMortgagePaymentPlans,
  payrollSyncJob
} from './services/BudgetCompiler.mjs';

export {
  getTransactions,
  processTransactions,
  processMortgageTransactions,
  getAccountBalances,
  updateTransaction,
  addTransaction,
  deleteTransaction,
  deleteTransactions
} from './services/BuxferClient.mjs';

export {
  loadTable as loadInfinityTable,
  saveItem as saveInfinityItem,
  updateItem as updateInfinityItem,
  loadData as loadInfinityData
} from './services/InfinityClient.mjs';

export {
  default as harvestShopping,
  loadShoppingConfig,
  buildReceiptQuery,
  parseEmailContent,
  identifyRetailer,
  extractReceiptData,
  generateReceiptId,
  mergeReceipts,
  formatLocalTimestamp
} from './services/ShoppingHarvester.mjs';

// Ports
export { ITransactionSource } from './ports/ITransactionSource.mjs';
