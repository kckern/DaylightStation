export const failureStatus = Object.freeze({
  BROWSER_INVALID_REQUEST: 400,
  BROWSER_ORIGIN_REJECTED: 400,
  BROWSER_OPERATION_UNKNOWN: 404,
  BROWSER_BUSY: 409,
  BROWSER_UNSUPPORTED_FULFILLMENT: 422,
  BROWSER_CANCELLED: 502,
  BROWSER_FAILED: 502,
  BROWSER_TIMEOUT: 504,
});

export function failure(code) {
  const safeCode = Object.hasOwn(failureStatus, code) ? code : 'BROWSER_FAILED';
  return Object.assign(new Error(safeCode), { code: safeCode });
}

export function safeFailure(error) {
  return failure(error?.name === 'TimeoutError' ? 'BROWSER_TIMEOUT' : error?.code);
}

export function createOperationRegistry(operations = []) {
  const entries = new Map();
  for (const operation of operations) {
    if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(operation.name) || entries.has(operation.name)
      || typeof operation.validate !== 'function' || typeof operation.execute !== 'function') {
      throw failure('BROWSER_INVALID_REQUEST');
    }
    entries.set(operation.name, Object.freeze({ ...operation }));
  }
  return Object.freeze({
    prepare(name, input) {
      const operation = entries.get(name);
      if (!operation) throw failure('BROWSER_OPERATION_UNKNOWN');
      let validated;
      try { validated = operation.validate(input); } catch (error) { throw safeFailure(error); }
      const operationId = typeof validated?.operationId === 'string' ? validated.operationId : null;
      return Object.freeze({
        operationId,
        async execute(options) {
          try { return await operation.execute(validated, options); }
          catch (error) { throw safeFailure(error); }
        },
      });
    },
    async dispatch(name, input, options) {
      return this.prepare(name, input).execute(options);
    },
  });
}
