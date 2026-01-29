/**
 * Naming rules - underscore privates, generic names
 */

export const rules = [
  {
    id: 'underscore-private-field',
    severity: 'medium',
    description: 'Using underscore prefix for private fields',
    pattern: /this\._\w+\s*=/,
    scope: 'backend/src/**/*.mjs',
    message: 'Use ES2022 #private fields instead of _underscore prefix'
  },
  {
    id: 'underscore-private-method',
    severity: 'medium',
    description: 'Using underscore prefix for private methods',
    pattern: /^\s+_\w+\s*\([^)]*\)\s*\{/,
    scope: 'backend/src/**/*.mjs',
    message: 'Use ES2022 #private methods instead of _underscore prefix'
  },
  {
    id: 'static-underscore-method',
    severity: 'low',
    description: 'Static method with underscore prefix',
    pattern: /static\s+_\w+\s*\(/,
    scope: 'backend/src/**/*.mjs',
    message: 'Use #private for static private methods'
  },
  {
    id: 'generic-variable-data',
    severity: 'low',
    description: 'Generic variable name "data"',
    pattern: /\bconst data\s*=/,
    scope: 'backend/src/**/*.mjs',
    message: 'Use descriptive names instead of generic "data"'
  },
  {
    id: 'abbreviated-config',
    severity: 'low',
    description: 'Using abbreviated "cfg" instead of "config"',
    pattern: /\bcfg[,\s\.\)]/,
    scope: 'backend/src/**/*.mjs',
    message: 'Use "config" instead of abbreviated "cfg"'
  }
];
