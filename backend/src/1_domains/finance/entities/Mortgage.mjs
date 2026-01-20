/**
 * Mortgage Entity - Represents a mortgage loan
 */

export class Mortgage {
  constructor({
    id,
    principal,
    interestRate,
    termYears,
    startDate,
    currentBalance = null,
    monthlyPayment = null,
    escrow = 0,
    metadata = {}
  }) {
    this.id = id;
    this.principal = principal;
    this.interestRate = interestRate;
    this.termYears = termYears;
    this.startDate = startDate;
    this.currentBalance = currentBalance ?? principal;
    this.monthlyPayment = monthlyPayment;
    this.escrow = escrow;
    this.metadata = metadata;
  }

  /**
   * Calculate monthly payment (principal + interest)
   */
  calculateMonthlyPayment() {
    const monthlyRate = this.interestRate / 100 / 12;
    const numPayments = this.termYears * 12;

    if (monthlyRate === 0) {
      return this.principal / numPayments;
    }

    const payment = this.principal *
      (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
      (Math.pow(1 + monthlyRate, numPayments) - 1);

    return Math.round(payment * 100) / 100;
  }

  /**
   * Get total monthly payment (including escrow)
   */
  getTotalMonthlyPayment() {
    const base = this.monthlyPayment ?? this.calculateMonthlyPayment();
    return base + this.escrow;
  }

  /**
   * Calculate payoff date
   */
  getPayoffDate() {
    const start = new Date(this.startDate);
    start.setFullYear(start.getFullYear() + this.termYears);
    return start.toISOString().split('T')[0];
  }

  /**
   * Calculate remaining term in months
   */
  getRemainingMonths() {
    const payoffDate = new Date(this.getPayoffDate());
    const now = new Date();
    const months = (payoffDate.getFullYear() - now.getFullYear()) * 12 +
      (payoffDate.getMonth() - now.getMonth());
    return Math.max(0, months);
  }

  /**
   * Get loan-to-value ratio
   */
  getLTV(homeValue) {
    return Math.round((this.currentBalance / homeValue) * 100);
  }

  /**
   * Calculate total interest paid over life of loan
   */
  getTotalInterest() {
    const payment = this.monthlyPayment ?? this.calculateMonthlyPayment();
    const totalPayments = payment * this.termYears * 12;
    return Math.round((totalPayments - this.principal) * 100) / 100;
  }

  /**
   * Make a payment
   */
  makePayment(principalAmount) {
    this.currentBalance -= principalAmount;
    if (this.currentBalance < 0) this.currentBalance = 0;
  }

  toJSON() {
    return {
      id: this.id,
      principal: this.principal,
      interestRate: this.interestRate,
      termYears: this.termYears,
      startDate: this.startDate,
      currentBalance: this.currentBalance,
      monthlyPayment: this.monthlyPayment,
      escrow: this.escrow,
      metadata: this.metadata
    };
  }

  static fromJSON(data) {
    return new Mortgage(data);
  }
}

export default Mortgage;
