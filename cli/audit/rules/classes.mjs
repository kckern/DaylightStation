/**
 * Class pattern rules - public fields, constructor validation
 */

export const rules = [
  {
    id: 'public-mutable-field-assignment',
    severity: 'high',
    description: 'Assigning to public field in constructor',
    // Matches: this.foo = but not this.#foo =
    pattern: /this\.(?!#)\w+\s*=\s*[^;]+;/,
    scope: 'backend/src/1_domains/**/entities/**/*.mjs',
    message: 'Use #private fields with getters instead of public fields in entities'
  },
  {
    id: 'missing-required-validation',
    severity: 'medium',
    description: 'Constructor without required parameter validation',
    // This is heuristic - constructors that take config but don't throw
    pattern: /constructor\s*\(\s*\{[^}]+\}\s*\)\s*\{[^}]*\}/,
    scope: 'backend/src/**/*.mjs',
    message: 'Validate required constructor parameters with throw',
    _needsPostProcess: true
  },
  {
    id: 'anemic-entity-setter',
    severity: 'medium',
    description: 'Entity with direct property setter',
    pattern: /set\s+\w+\s*\(\s*\w+\s*\)\s*\{\s*this\.\w+\s*=\s*\w+;?\s*\}/,
    scope: 'backend/src/1_domains/**/entities/**/*.mjs',
    message: 'Entities should have behavior methods, not plain setters'
  }
];
