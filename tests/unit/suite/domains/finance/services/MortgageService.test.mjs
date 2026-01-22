// tests/unit/domains/finance/services/MortgageService.test.mjs
import { jest } from '@jest/globals';
import { MortgageService } from '#backend/src/1_domains/finance/services/MortgageService.mjs';

describe('MortgageService', () => {
  let service;
  let mockStore;

  beforeEach(() => {
    mockStore = {
      findById: jest.fn(),
      findAll: jest.fn(),
      save: jest.fn()
    };
    service = new MortgageService({ mortgageStore: mockStore });
  });

  describe('getMortgage', () => {
    test('returns mortgage by ID', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'm1',
        principal: 300000,
        interestRate: 6.5,
        termYears: 30,
        startDate: '2024-01-01'
      });

      const mortgage = await service.getMortgage('m1');
      expect(mortgage.principal).toBe(300000);
    });
  });

  describe('createMortgage', () => {
    test('creates mortgage and calculates payment', async () => {
      const mortgage = await service.createMortgage({
        id: 'new',
        principal: 200000,
        interestRate: 5.0,
        termYears: 30,
        startDate: '2026-01-01'
      });

      expect(mortgage.monthlyPayment).toBeDefined();
      expect(mortgage.monthlyPayment).toBeGreaterThan(0);
      expect(mockStore.save).toHaveBeenCalled();
    });
  });

  describe('updateBalance', () => {
    test('updates mortgage balance', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'm1',
        principal: 300000,
        currentBalance: 290000,
        interestRate: 6.5,
        termYears: 30,
        startDate: '2024-01-01'
      });

      const mortgage = await service.updateBalance('m1', 285000);
      expect(mortgage.currentBalance).toBe(285000);
    });
  });

  describe('recordPayment', () => {
    test('reduces balance by principal', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'm1',
        principal: 300000,
        currentBalance: 290000,
        interestRate: 6.5,
        termYears: 30,
        startDate: '2024-01-01'
      });

      const mortgage = await service.recordPayment('m1', 1000);
      expect(mortgage.currentBalance).toBe(289000);
    });
  });

  describe('calculateAmortizationSchedule', () => {
    test('generates schedule', () => {
      const mortgage = {
        interestRate: 6,
        monthlyPayment: 1200,
        currentBalance: 200000,
        getRemainingMonths: () => 12
      };

      const schedule = service.calculateAmortizationSchedule(mortgage, 12);
      expect(schedule).toHaveLength(12);
      expect(schedule[0].principal).toBeGreaterThan(0);
      expect(schedule[0].interest).toBeGreaterThan(0);
    });

    test('balance decreases over time', () => {
      const mortgage = {
        interestRate: 6,
        monthlyPayment: 2000,
        currentBalance: 100000,
        getRemainingMonths: () => 60
      };

      const schedule = service.calculateAmortizationSchedule(mortgage, 12);
      expect(schedule[11].balance).toBeLessThan(schedule[0].balance);
    });
  });

  describe('getMortgageSummary', () => {
    test('returns summary data', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'm1',
        principal: 300000,
        currentBalance: 280000,
        interestRate: 6.5,
        termYears: 30,
        startDate: '2024-01-01',
        monthlyPayment: 1896,
        escrow: 500
      });

      const summary = await service.getMortgageSummary('m1');
      expect(summary.currentBalance).toBe(280000);
      expect(summary.monthlyPayment).toBe(2396);
      expect(summary.principalPaid).toBe(20000);
    });
  });
});
