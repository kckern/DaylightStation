import { describe, expect, it, vi } from 'vitest';
import { PayrollSyncService } from './PayrollSyncService.mjs';

describe('PayrollSyncService', () => {
  it('orchestrates semantic payroll gateway and repository capabilities', async () => {
    const paycheck = {
      id: 'check-1',
      payEndDate: '2026-08-15',
      data: { header: { payEndDt: '2026-08-15' }, detail: {} },
    };
    const payrollGateway = {
      listPaychecks: vi.fn(async () => [{ id: 'check-1', payEndDate: '2026-08-15' }]),
      getPaycheck: vi.fn(async () => paycheck),
    };
    const record = vi.fn();
    const commit = vi.fn();
    const payrollRepository = {
      beginSync: vi.fn(() => ({
        pendingChecks: [{ id: 'check-1', payEndDate: '2026-08-15' }],
        record,
        commit,
        getPaychecks: () => ({ '2026-08-15': paycheck.data }),
        getNewCount: () => 1,
      })),
      getMapping: () => [],
      getTransactionEntries: () => [],
    };
    const service = new PayrollSyncService({ payrollGateway, payrollRepository, householdId: 'home' });

    await expect(service.sync({ token: 'override' })).resolves.toEqual({
      status: 'success',
      paychecksFound: 1,
      newPaychecks: 1,
      transactionsUploaded: 0,
      uploadFailures: [],
    });
    expect(payrollGateway.listPaychecks).toHaveBeenCalledWith({ token: 'override' });
    expect(record).toHaveBeenCalledWith(paycheck);
    expect(commit).toHaveBeenCalled();
  });
});
