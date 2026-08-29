export class IFinanceStore {
  getBudgetConfig(_householdId) { throw new Error('IFinanceStore.getBudgetConfig must be implemented'); }
  getCompiledFinances(_householdId) { throw new Error('IFinanceStore.getCompiledFinances must be implemented'); }
  getAccountBalances(_householdId) { throw new Error('IFinanceStore.getAccountBalances must be implemented'); }
  getTransactions(_period, _householdId) { throw new Error('IFinanceStore.getTransactions must be implemented'); }
  listBudgetPeriods(_householdId) { throw new Error('IFinanceStore.listBudgetPeriods must be implemented'); }
  saveMemo(_id, _value, _householdId) { throw new Error('IFinanceStore.saveMemo must be implemented'); }
  getMemos(_householdId) { throw new Error('IFinanceStore.getMemos must be implemented'); }
  getPairs(_householdId) { throw new Error('IFinanceStore.getPairs must be implemented'); }
  addPair(_pair, _householdId) { throw new Error('IFinanceStore.addPair must be implemented'); }
  removePair(_debit, _credit, _householdId) { throw new Error('IFinanceStore.removePair must be implemented'); }
}
