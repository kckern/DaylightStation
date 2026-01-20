// tests/unit/domains/finance/entities/Mortgage.test.mjs
import { Mortgage } from '../../../../../backend/src/1_domains/finance/entities/Mortgage.mjs';

describe('Mortgage', () => {
  let mortgage;

  beforeEach(() => {
    mortgage = new Mortgage({
      id: 'mortgage-001',
      principal: 300000,
      interestRate: 6.5,
      termYears: 30,
      startDate: '2024-01-01',
      escrow: 500
    });
  });

  describe('constructor', () => {
    test('creates mortgage with properties', () => {
      expect(mortgage.principal).toBe(300000);
      expect(mortgage.interestRate).toBe(6.5);
      expect(mortgage.termYears).toBe(30);
    });

    test('defaults currentBalance to principal', () => {
      expect(mortgage.currentBalance).toBe(300000);
    });
  });

  describe('calculateMonthlyPayment', () => {
    test('calculates correct payment', () => {
      const payment = mortgage.calculateMonthlyPayment();
      // Expected ~$1896 for 300k at 6.5% for 30 years
      expect(payment).toBeGreaterThan(1800);
      expect(payment).toBeLessThan(2000);
    });

    test('handles 0% interest', () => {
      mortgage.interestRate = 0;
      const payment = mortgage.calculateMonthlyPayment();
      expect(payment).toBe(300000 / 360);
    });
  });

  describe('getTotalMonthlyPayment', () => {
    test('includes escrow', () => {
      mortgage.monthlyPayment = 1896;
      const total = mortgage.getTotalMonthlyPayment();
      expect(total).toBe(2396);
    });
  });

  describe('getPayoffDate', () => {
    test('returns date 30 years from start', () => {
      const payoff = mortgage.getPayoffDate();
      expect(payoff).toBe('2054-01-01');
    });
  });

  describe('getRemainingMonths', () => {
    test('returns positive number for future payoff', () => {
      const remaining = mortgage.getRemainingMonths();
      expect(remaining).toBeGreaterThan(0);
    });
  });

  describe('getLTV', () => {
    test('calculates loan-to-value ratio', () => {
      const ltv = mortgage.getLTV(400000);
      expect(ltv).toBe(75);
    });
  });

  describe('getTotalInterest', () => {
    test('calculates total interest over loan life', () => {
      mortgage.monthlyPayment = mortgage.calculateMonthlyPayment();
      const interest = mortgage.getTotalInterest();
      // Should be significant for 30-year mortgage
      expect(interest).toBeGreaterThan(200000);
    });
  });

  describe('makePayment', () => {
    test('reduces balance', () => {
      mortgage.makePayment(1000);
      expect(mortgage.currentBalance).toBe(299000);
    });

    test('does not go negative', () => {
      mortgage.currentBalance = 500;
      mortgage.makePayment(1000);
      expect(mortgage.currentBalance).toBe(0);
    });
  });

  describe('toJSON/fromJSON', () => {
    test('round-trips mortgage data', () => {
      const json = mortgage.toJSON();
      const restored = Mortgage.fromJSON(json);
      expect(restored.principal).toBe(mortgage.principal);
      expect(restored.interestRate).toBe(mortgage.interestRate);
    });
  });
});
