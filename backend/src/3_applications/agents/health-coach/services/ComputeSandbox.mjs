// backend/src/3_applications/agents/health-coach/services/ComputeSandbox.mjs
import vm from 'node:vm';

/**
 * Sandboxed JS expression evaluator. No I/O, no async, no imports.
 * Whitelist scope: Math, parseFloat, parseInt, isFinite, isNaN, Array.isArray
 * + the caller's named inputs.
 */
export class ComputeSandbox {
  #timeoutMs;

  constructor({ timeoutMs = 50 } = {}) {
    this.#timeoutMs = timeoutMs;
  }

  evaluate(expression, inputs = {}) {
    const startedAt = Date.now();
    const scope = Object.freeze({
      ...inputs,
      Math,
      parseFloat,
      parseInt,
      isFinite,
      isNaN,
      Array: { isArray: Array.isArray },
    });
    const context = vm.createContext(scope, { codeGeneration: { strings: false, wasm: false } });
    try {
      const value = vm.runInContext(`(${expression})`, context, {
        timeout: this.#timeoutMs,
        displayErrors: true,
      });
      return {
        value,
        type: typeOf(value),
        expression,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      const isTimeout = /Script execution timed out/.test(err.message);
      const isSyntax = err instanceof SyntaxError || err.name === 'SyntaxError';
      return {
        error: isTimeout ? 'timeout' : (isSyntax ? 'syntax' : 'runtime'),
        message: err.message,
        expression,
        durationMs: Date.now() - startedAt,
      };
    }
  }
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export default ComputeSandbox;
