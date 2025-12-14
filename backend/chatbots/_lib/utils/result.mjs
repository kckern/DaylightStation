/**
 * Result monad for error handling without exceptions
 * @module _lib/utils/result
 */

/**
 * @template T, E
 * @typedef {Object} ResultSuccess
 * @property {true} ok - Success indicator
 * @property {T} value - Success value
 */

/**
 * @template T, E
 * @typedef {Object} ResultFailure
 * @property {false} ok - Failure indicator
 * @property {E} error - Error value
 */

/**
 * @template T, E
 * @typedef {ResultSuccess<T, E> | ResultFailure<T, E>} Result
 */

/**
 * Create a success result
 * @template T
 * @param {T} value - Success value
 * @returns {ResultSuccess<T, never>}
 */
export function ok(value) {
  return { ok: true, value };
}

/**
 * Create a failure result
 * @template E
 * @param {E} error - Error value
 * @returns {ResultFailure<never, E>}
 */
export function err(error) {
  return { ok: false, error };
}

/**
 * Check if a result is successful
 * @template T, E
 * @param {Result<T, E>} result
 * @returns {result is ResultSuccess<T, E>}
 */
export function isOk(result) {
  return result.ok === true;
}

/**
 * Check if a result is a failure
 * @template T, E
 * @param {Result<T, E>} result
 * @returns {result is ResultFailure<T, E>}
 */
export function isErr(result) {
  return result.ok === false;
}

/**
 * Unwrap a result, throwing if it's an error
 * @template T, E
 * @param {Result<T, E>} result
 * @returns {T}
 * @throws {E}
 */
export function unwrap(result) {
  if (result.ok) {
    return result.value;
  }
  throw result.error;
}

/**
 * Unwrap a result, returning a default value if it's an error
 * @template T, E
 * @param {Result<T, E>} result
 * @param {T} defaultValue
 * @returns {T}
 */
export function unwrapOr(result, defaultValue) {
  return result.ok ? result.value : defaultValue;
}

/**
 * Map a success value to a new value
 * @template T, U, E
 * @param {Result<T, E>} result
 * @param {(value: T) => U} fn
 * @returns {Result<U, E>}
 */
export function map(result, fn) {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Map an error to a new error
 * @template T, E, F
 * @param {Result<T, E>} result
 * @param {(error: E) => F} fn
 * @returns {Result<T, F>}
 */
export function mapErr(result, fn) {
  return result.ok ? result : err(fn(result.error));
}

/**
 * Chain results together (flatMap)
 * @template T, U, E
 * @param {Result<T, E>} result
 * @param {(value: T) => Result<U, E>} fn
 * @returns {Result<U, E>}
 */
export function andThen(result, fn) {
  return result.ok ? fn(result.value) : result;
}

/**
 * Try an operation and return a Result
 * @template T
 * @param {() => T} fn - Function that might throw
 * @returns {Result<T, Error>}
 */
export function tryCatch(fn) {
  try {
    return ok(fn());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Try an async operation and return a Result
 * @template T
 * @param {() => Promise<T>} fn - Async function that might throw
 * @returns {Promise<Result<T, Error>>}
 */
export async function tryCatchAsync(fn) {
  try {
    return ok(await fn());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Combine multiple results into a single result with an array of values
 * @template T, E
 * @param {Result<T, E>[]} results
 * @returns {Result<T[], E>}
 */
export function all(results) {
  const values = [];
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Get the first successful result, or all errors
 * @template T, E
 * @param {Result<T, E>[]} results
 * @returns {Result<T, E[]>}
 */
export function any(results) {
  const errors = [];
  for (const result of results) {
    if (result.ok) {
      return result;
    }
    errors.push(result.error);
  }
  return err(errors);
}

export default {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  andThen,
  tryCatch,
  tryCatchAsync,
  all,
  any,
};
