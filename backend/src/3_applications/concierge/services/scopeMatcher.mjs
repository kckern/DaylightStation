// backend/src/3_applications/concierge/services/scopeMatcher.mjs

/**
 * Match a scope string against a glob pattern. The scope vocabulary uses
 * `:` as the segment separator; wildcards inside a segment are not supported.
 *
 *   *   matches exactly one segment
 *   **  matches one or more segments
 *
 * Examples:
 *   matchesScope('data:fitness:strava.yml', 'data:fitness:*') → true
 *   matchesScope('data:fitness:cardio:peloton.yml', 'data:fitness:*') → false
 *   matchesScope('data:fitness:cardio:peloton.yml', 'data:fitness:**') → true
 */
export function matchesScope(scope, pattern) {
  if (typeof scope !== 'string' || typeof pattern !== 'string') return false;
  if (scope === pattern) return true;
  const scopeSegs = scope.split(':');
  const patSegs = pattern.split(':');
  return walk(scopeSegs, 0, patSegs, 0);
}

function walk(scopeSegs, si, patSegs, pi) {
  if (pi === patSegs.length) return si === scopeSegs.length;
  const pat = patSegs[pi];
  if (pat === '**') {
    // ** must consume at least one segment
    for (let consume = 1; si + consume <= scopeSegs.length; consume++) {
      if (walk(scopeSegs, si + consume, patSegs, pi + 1)) return true;
    }
    return false;
  }
  if (pat === '*') {
    if (si >= scopeSegs.length) return false;
    return walk(scopeSegs, si + 1, patSegs, pi + 1);
  }
  if (si >= scopeSegs.length) return false;
  if (scopeSegs[si] !== pat) return false;
  return walk(scopeSegs, si + 1, patSegs, pi + 1);
}

/**
 * Validate a glob pattern at boot time. Throws on anything we don't intend
 * to support — catches regex artifacts, character classes, etc. before they
 * silently never-match at runtime.
 */
export function validateGlob(pattern) {
  if (typeof pattern !== 'string') throw new Error('invalid scope: must be string');
  if (pattern.length === 0) throw new Error('invalid scope: empty pattern');
  // Allowed chars per segment: a-z A-Z 0-9 _ . - (segment separator is :)
  // Allowed wildcards: * and ** as full segment values
  const segs = pattern.split(':');
  for (const seg of segs) {
    if (seg === '*' || seg === '**') continue;
    if (!/^[A-Za-z0-9_.\-]+$/.test(seg)) {
      throw new Error(`invalid scope segment '${seg}' in pattern '${pattern}'`);
    }
  }
}

export default { matchesScope, validateGlob };
