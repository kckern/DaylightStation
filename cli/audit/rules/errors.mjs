/**
 * Error handling rules - generic errors, silent swallow
 */

export const rules = [
  {
    id: 'generic-error-throw',
    severity: 'high',
    description: 'Throwing generic Error instead of domain error',
    pattern: /throw new Error\(/,
    scope: 'backend/src/1_domains/**/*.mjs',
    message: 'Use ValidationError, DomainInvariantError, or EntityNotFoundError'
  },
  {
    id: 'silent-catch-swallow',
    severity: 'high',
    description: 'Empty catch block swallows errors',
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
    scope: 'backend/src/**/*.mjs',
    message: 'Never silently swallow errors - log or re-throw'
  },
  {
    id: 'catch-ignore-variable',
    severity: 'medium',
    description: 'Catch with unused error variable',
    pattern: /catch\s*\(\s*e\s*\)\s*\{[^}]*\}/,
    scope: 'backend/src/**/*.mjs',
    message: 'If ignoring error intentionally, use catch (_e) or catch { }',
    _needsPostProcess: true // May have false positives
  },
  {
    id: 'validation-error-missing-code',
    severity: 'medium',
    description: 'ValidationError without error code',
    pattern: /new ValidationError\s*\(\s*['"][^'"]+['"]\s*\)/,
    scope: 'backend/src/**/*.mjs',
    message: 'ValidationError should include { code: "ERROR_CODE" }'
  },
  {
    id: 'handler-catch-block',
    severity: 'medium',
    description: 'Express handler with try/catch instead of letting middleware handle',
    pattern: /catch\s*\([^)]*\)\s*\{[^}]*res\.status/,
    scope: 'backend/src/4_api/**/*.mjs',
    message: 'Let errors propagate to error middleware, don\'t catch in handlers'
  }
];
