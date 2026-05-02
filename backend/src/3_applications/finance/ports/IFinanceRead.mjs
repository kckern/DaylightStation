/**
 * IFinanceRead
 *   accountBalances(): Promise<Array<{ accountId, name, balance, currency }>>
 *   recentTransactions({ days?, account?, limit?, tag? }):
 *     Promise<Array<{ date, amount, description, account, tag? }>>
 *   budgetSummary({ periodStart? }): Promise<{ income, byCategory, asOf }>
 */
export function isFinanceRead(obj) {
  return !!obj
    && typeof obj.accountBalances === 'function'
    && typeof obj.recentTransactions === 'function'
    && typeof obj.budgetSummary === 'function';
}

export function assertFinanceRead(obj) {
  if (!isFinanceRead(obj)) throw new Error('Object does not implement IFinanceRead');
}

export default { isFinanceRead, assertFinanceRead };
