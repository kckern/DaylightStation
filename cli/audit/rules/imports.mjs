/**
 * Import rules - wrong-layer imports, path traversal
 */

export const rules = [
  {
    id: 'domain-imports-adapter',
    severity: 'critical',
    description: 'Domain layer imports from adapters',
    pattern: /from ['"]#adapters/,
    scope: 'backend/src/1_domains/**/*.mjs',
    message: 'Domain layer must not import from adapters - use dependency injection'
  },
  {
    id: 'domain-imports-application',
    severity: 'critical',
    description: 'Domain layer imports from applications',
    pattern: /from ['"]#apps/,
    scope: 'backend/src/1_domains/**/*.mjs',
    message: 'Domain layer must not import from applications - dependency flows inward'
  },
  {
    id: 'adapter-imports-application-non-port',
    severity: 'high',
    description: 'Adapter layer imports non-port from applications',
    pattern: /from ['"]#apps\/(?![^'"]*\/ports\/)/,
    scope: 'backend/src/2_adapters/**/*.mjs',
    message: 'Adapter layer should only import ports from applications (use #apps/*/ports/)'
  },
  {
    id: 'relative-path-traversal',
    severity: 'medium',
    description: 'Using relative paths to cross layer boundaries',
    pattern: /from ['"]\.\.\/(\.\.\/)*[0-4]_/,
    scope: 'backend/src/**/*.mjs',
    message: 'Use #aliases instead of relative paths across layers'
  },
  {
    id: 'explicit-index-import',
    severity: 'low',
    description: 'Importing index.mjs explicitly',
    pattern: /from ['"][^'"]+\/index\.mjs['"]/,
    scope: 'backend/src/**/*.mjs',
    message: 'Import from directory, not index.mjs explicitly'
  },
  {
    id: 'reaching-into-internals',
    severity: 'medium',
    description: 'Importing from internal paths instead of barrel',
    pattern: /from ['"]#domains\/[^'"]+\/entities\//,
    scope: 'backend/src/**/*.mjs',
    message: 'Import from domain barrel (#domains/fitness), not internal paths'
  }
];
