/**
 * Logging utilities for consistent error serialization
 */

/**
 * Serialize an error for logging with full context
 * @param {Error|Object|string} error - Error to serialize
 * @returns {Object|null} Serialized error object
 */
export const serializeError = (error) => {
  if (!error) return null;

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code ?? null,
      ...(error.statusCode ? { statusCode: error.statusCode } : {}),
      ...(error.errno ? { errno: error.errno } : {}),
      ...(error.syscall ? { syscall: error.syscall } : {})
    };
  }

  if (typeof error === 'object') {
    return {
      name: error.name ?? null,
      message: error.message ?? error.shortMessage ?? String(error),
      stack: error.stack ?? null,
      code: error.code ?? null,
      response: error.response?.data ?? null,
      statusCode: error.statusCode ?? error.status ?? null
    };
  }

  return { message: String(error) };
};

/**
 * Extract relevant HTTP error details
 * @param {Error} error - HTTP error from axios or fetch
 * @returns {Object} Extracted details
 */
export const extractHttpErrorDetails = (error) => {
  const serialized = serializeError(error);

  return {
    ...serialized,
    url: error.config?.url ?? error.request?.url ?? null,
    method: error.config?.method ?? error.request?.method ?? null,
    statusCode: error.response?.status ?? null,
    statusText: error.response?.statusText ?? null,
    responseData: error.response?.data ?? null
  };
};
