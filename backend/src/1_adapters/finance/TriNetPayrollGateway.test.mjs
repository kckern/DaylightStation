import { describe, expect, it, vi } from 'vitest';
import { TriNetPayrollGateway } from './TriNetPayrollGateway.mjs';

const config = {
  baseUrl: 'identity.example',
  authKey: 'sid',
  authCookie: 'cookie',
  company: 'company',
  employeeId: 'employee',
};

describe('TriNetPayrollGateway', () => {
  it('owns URL, cookie, response projection, and detail rate limiting', async () => {
    const httpClient = { get: vi.fn() };
    httpClient.get
      .mockResolvedValueOnce({ data: { data: { checkSummaries: [{ id: '1', checkKey: { payEndDt: '2026-08-15' } }] } } })
      .mockResolvedValueOnce({ data: { data: { header: { payEndDt: '2026-08-15' }, detail: {} } } });
    const wait = vi.fn(async () => {});
    const gateway = new TriNetPayrollGateway({ httpClient, config, wait });

    const checks = await gateway.listPaychecks({ token: 'override' });
    const paycheck = await gateway.getPaycheck(checks[0], { token: 'override' });

    expect(checks).toEqual([{ id: '1', payEndDate: '2026-08-15' }]);
    expect(paycheck).toEqual({
      id: '1',
      payEndDate: '2026-08-15',
      data: { header: { payEndDt: '2026-08-15' }, detail: {} },
    });
    expect(httpClient.get).toHaveBeenNthCalledWith(
      1,
      'https://identity.example/company/employee/paychecks',
      { headers: { cookie: 'sid=override' } },
    );
    expect(wait).toHaveBeenCalledWith(2000);
  });

  it('normalizes a vendor 401 into the existing auth-expired validation error', async () => {
    const error = Object.assign(new Error('unauthorized'), { response: { status: 401 } });
    const gateway = new TriNetPayrollGateway({
      httpClient: { get: async () => { throw error; } },
      config,
    });
    await expect(gateway.listPaychecks()).rejects.toMatchObject({
      message: 'Payroll auth expired - please provide a new token',
      context: { authExpired: true },
    });
  });
});
