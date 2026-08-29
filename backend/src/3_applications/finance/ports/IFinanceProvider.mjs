export class IFinanceProvider {
  isConfigured() { throw new Error('IFinanceProvider.isConfigured must be implemented'); }
  async getAccountBalances() { throw new Error('IFinanceProvider.getAccountBalances must be implemented'); }
  async findByCategory(_category, _start, _end) { throw new Error('IFinanceProvider.findByCategory must be implemented'); }
  async findByAccount(_account) { throw new Error('IFinanceProvider.findByAccount must be implemented'); }
  async findInRange(_start, _end) { throw new Error('IFinanceProvider.findInRange must be implemented'); }
  async updateTransaction(_id, _patch) { throw new Error('IFinanceProvider.updateTransaction must be implemented'); }
  getMetrics() { throw new Error('IFinanceProvider.getMetrics must be implemented'); }
}
