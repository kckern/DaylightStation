import { ValidationError } from '#domains/core/errors/index.mjs';

/** TriNet HTTP protocol adapter. */
export class TriNetPayrollGateway {
  #httpClient;
  #config;
  #wait;

  constructor({ httpClient, config, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    this.#httpClient = httpClient;
    this.#config = config ?? {};
    this.#wait = wait;
  }

  #connection(token) {
    const { baseUrl, authKey, authCookie, company, employeeId } = this.#config;
    if (!baseUrl || !company || !employeeId) {
      throw new ValidationError('Payroll not configured: missing base_url, company, or employee_id', {
        baseUrl,
        company,
        employeeId,
      });
    }
    const effectiveToken = token || authCookie;
    if (!effectiveToken) throw new ValidationError('Payroll auth token required', { field: 'token' });
    return {
      root: `https://${baseUrl}/${company}/${employeeId}`,
      headers: { cookie: `${authKey}=${effectiveToken}` },
    };
  }

  async #get(url, headers) {
    try {
      return await this.#httpClient.get(url, { headers });
    } catch (error) {
      if (error.response?.status === 401) {
        throw new ValidationError('Payroll auth expired - please provide a new token', { authExpired: true });
      }
      throw error;
    }
  }

  async listPaychecks({ token } = {}) {
    const { root, headers } = this.#connection(token);
    const response = await this.#get(`${root}/paychecks`, headers);
    const summaries = response.data?.data?.checkSummaries || [];
    return summaries.map((check) => ({
      id: check.id,
      payEndDate: check.checkKey?.payEndDt,
    }));
  }

  async getPaycheck(check, { token } = {}) {
    const { root, headers } = this.#connection(token);
    try {
      const response = await this.#get(`${root}/paycheck-details/${check.id}`, headers);
      const data = response.data?.data;
      const payEndDate = data?.header?.payEndDt;
      return payEndDate ? { id: check.id, payEndDate, data } : null;
    } finally {
      await this.#wait(2000);
    }
  }
}

export default TriNetPayrollGateway;
