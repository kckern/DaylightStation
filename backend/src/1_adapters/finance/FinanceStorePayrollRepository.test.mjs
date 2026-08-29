import { describe, expect, it, vi } from 'vitest';
import { FinanceStorePayrollRepository } from './FinanceStorePayrollRepository.mjs';

describe('FinanceStorePayrollRepository', () => {
  it('owns legacy check-ID migration and duplicate-date storage keys', () => {
    const savePayrollData = vi.fn();
    const repository = new FinanceStorePayrollRepository({
      financeStore: {
        getPayrollData: () => ({ paychecks: { '2026-08-15': { header: { payEndDt: '2026-08-15' } } } }),
        savePayrollData,
      },
      logger: {},
    });

    const session = repository.beginSync('home', [
      { id: 'regular', payEndDate: '2026-08-15' },
      { id: 'rsu', payEndDate: '2026-08-15' },
    ]);
    expect(session.pendingChecks).toEqual([{ id: 'rsu', payEndDate: '2026-08-15' }]);
    session.record({ id: 'rsu', payEndDate: '2026-08-15', data: { header: { payEndDt: '2026-08-15' } } });
    session.commit();

    expect(session.getPaychecks()).toEqual({
      '2026-08-15': { header: { payEndDt: '2026-08-15' }, _checkId: 'regular' },
      '2026-08-15-rsu': { header: { payEndDt: '2026-08-15' }, _checkId: 'rsu' },
    });
    expect(savePayrollData).toHaveBeenCalledWith('home', { paychecks: session.getPaychecks() });
  });

  it('projects persisted vendor paycheck shape into semantic transaction entries', () => {
    const repository = new FinanceStorePayrollRepository({
      financeStore: {
        getPayrollData: () => ({ paychecks: {
          '2026-08-15': {
            header: { checkDt: '2026-08-20' },
            detail: {
              preTaxDedns: [{ desc: '401k', curDedns: '50.00' }],
              taxWithholdings: [{ taxDesc: 'Federal', curTaxes: '100.00' }],
              earns: [{ curEarnsDesc: 'Salary', curEarnsEarn: '1000.00' }],
              totals: { curNetPay: '850.00' },
            },
          },
        } }),
      },
    });

    expect(repository.getTransactionEntries('home')).toEqual([{
      date: '2026-08-20',
      netPay: 850,
      deductions: [
        { description: '401k', amount: 50 },
        { description: 'Federal', amount: 100 },
      ],
      earnings: [{ description: 'Salary', amount: 1000 }],
    }]);
  });
});
