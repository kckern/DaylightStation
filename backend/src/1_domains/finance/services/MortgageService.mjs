/**
 * MortgageService - Mortgage calculation and tracking
 */

import { Mortgage } from '../entities/Mortgage.mjs';

export class MortgageService {
  constructor({ mortgageStore }) {
    this.mortgageStore = mortgageStore;
  }

  /**
   * Get mortgage by ID
   */
  async getMortgage(id) {
    const data = await this.mortgageStore.findById(id);
    return data ? Mortgage.fromJSON(data) : null;
  }

  /**
   * Get all mortgages
   */
  async getAllMortgages() {
    const mortgages = await this.mortgageStore.findAll();
    return mortgages.map(m => Mortgage.fromJSON(m));
  }

  /**
   * Create a mortgage
   */
  async createMortgage(data) {
    const mortgage = new Mortgage(data);
    mortgage.monthlyPayment = mortgage.calculateMonthlyPayment();
    await this.mortgageStore.save(mortgage);
    return mortgage;
  }

  /**
   * Update mortgage balance
   */
  async updateBalance(id, newBalance) {
    const mortgage = await this.getMortgage(id);
    if (!mortgage) throw new Error(`Mortgage not found: ${id}`);

    mortgage.currentBalance = newBalance;
    await this.mortgageStore.save(mortgage);
    return mortgage;
  }

  /**
   * Record a payment
   */
  async recordPayment(id, principalPaid) {
    const mortgage = await this.getMortgage(id);
    if (!mortgage) throw new Error(`Mortgage not found: ${id}`);

    mortgage.makePayment(principalPaid);
    await this.mortgageStore.save(mortgage);
    return mortgage;
  }

  /**
   * Calculate amortization schedule
   */
  calculateAmortizationSchedule(mortgage, numPayments = null) {
    const schedule = [];
    const monthlyRate = mortgage.interestRate / 100 / 12;
    const payment = mortgage.monthlyPayment ?? mortgage.calculateMonthlyPayment();
    let balance = mortgage.currentBalance;
    const months = numPayments ?? mortgage.getRemainingMonths();

    for (let i = 1; i <= months && balance > 0; i++) {
      const interestPayment = balance * monthlyRate;
      const principalPayment = Math.min(payment - interestPayment, balance);
      balance -= principalPayment;

      schedule.push({
        month: i,
        principal: Math.round(principalPayment * 100) / 100,
        interest: Math.round(interestPayment * 100) / 100,
        balance: Math.round(Math.max(0, balance) * 100) / 100
      });
    }

    return schedule;
  }

  /**
   * Get mortgage summary
   */
  async getMortgageSummary(id) {
    const mortgage = await this.getMortgage(id);
    if (!mortgage) throw new Error(`Mortgage not found: ${id}`);

    return {
      id: mortgage.id,
      currentBalance: mortgage.currentBalance,
      monthlyPayment: mortgage.getTotalMonthlyPayment(),
      remainingMonths: mortgage.getRemainingMonths(),
      payoffDate: mortgage.getPayoffDate(),
      totalInterest: mortgage.getTotalInterest(),
      principalPaid: mortgage.principal - mortgage.currentBalance
    };
  }
}

export default MortgageService;
