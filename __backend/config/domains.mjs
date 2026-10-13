/**
 * Domain → household mapping for subdomain routing.
 *
 * Configure explicit mappings and fallback patterns for
 * multi-household deployments with different subdomains.
 */

export default {
  // Explicit mappings (checked first)
  domain_mapping: {
    'daylight.example.com': 'default',
    'localhost:3111': 'default',
    'localhost:3112': 'default',
    // Add more explicit mappings as needed:
    // 'daylight-jones.example.com': 'jones',
    // 'smithfamily.example.com': 'smith',
  },

  // Fallback patterns (checked if no explicit match)
  // Uses named capture group (?<household>...) to extract household ID
  patterns: [
    { regex: '^daylight-(?<household>\\w+)\\.' },
    // Matches: daylight-jones.example.com → jones

    { regex: '^(?<household>\\w+)\\.daylight\\.' },
    // Matches: jones.daylight.example.com → jones
  ],
};
