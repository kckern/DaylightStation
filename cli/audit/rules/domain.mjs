/**
 * Domain purity rules - no infrastructure in domain layer
 */

export const rules = [
  {
    id: 'domain-new-date',
    severity: 'high',
    description: 'Using new Date() in domain layer',
    pattern: /new Date\(\)/,
    scope: 'backend/src/1_domains/**/*.mjs',
    message: 'Pass timestamps as parameters instead of using new Date() in domain'
  },
  {
    id: 'domain-date-now',
    severity: 'high',
    description: 'Using Date.now() in domain layer',
    pattern: /Date\.now\(\)/,
    scope: 'backend/src/1_domains/**/*.mjs',
    message: 'Pass timestamps as parameters instead of using Date.now() in domain'
  },
  {
    id: 'domain-fs-import',
    severity: 'critical',
    description: 'Domain layer imports filesystem modules',
    pattern: /from ['"]fs|require\(['"]fs/,
    scope: 'backend/src/1_domains/**/*.mjs',
    message: 'Domain layer must not access filesystem - use repository pattern'
  },
  {
    id: 'domain-config-import',
    severity: 'high',
    description: 'Domain layer imports config service',
    pattern: /from ['"].*config|configService/,
    scope: 'backend/src/1_domains/**/*.mjs',
    message: 'Pass config values via constructor, don\'t import configService in domain'
  },
  {
    id: 'tojson-in-entity',
    severity: 'medium',
    description: 'Entity has toJSON method',
    pattern: /^\s+toJSON\s*\(\)\s*\{/,
    scope: 'backend/src/1_domains/**/entities/**/*.mjs',
    message: 'Consider moving serialization to repository layer'
  },
  {
    id: 'domain-console-log',
    severity: 'low',
    description: 'Console.log in domain layer',
    pattern: /console\.(log|warn|error)\(/,
    scope: 'backend/src/1_domains/**/*.mjs',
    message: 'Domain layer should not have direct console access - use injected logger'
  }
];
