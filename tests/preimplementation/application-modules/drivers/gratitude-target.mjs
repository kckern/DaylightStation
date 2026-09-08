/**
 * Test-only target selector.  A candidate is deliberately opt-in and must
 * supply the same narrow construction surface as the baseline; it cannot
 * silently inherit a baseline constructor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const required = [
  'createGratitudeRouter', 'createApiRouter', 'errorHandlerMiddleware',
  'permissionGate', 'GratitudeService', 'GratitudeHouseholdService',
  'GratitudeCardPrintService', 'GratitudeEvents', 'YamlGratitudeDatastore',
  'GratitudeFeedAdapter', 'TemporaryImagePrintGateway', 'DataService',
  'ConfigService', 'YamlAdminConfigStore', 'YamlConfigFileService',
  'createAdminConfigRouter'
];

export function candidatePreflight(environment = process.env) {
  if ((environment.PRE_TARGET || 'baseline') !== 'candidate') return { state: 'ready', target: 'baseline' };
  if (!environment.PRE_CANDIDATE_GRATITUDE_DRIVER) return {
    state: 'not-run', target: 'candidate', reason: 'PRE_CANDIDATE_GRATITUDE_DRIVER is required; baseline fallback is forbidden'
  };
  if (!environment.PRE_BASELINE_EVIDENCE) return {
    state: 'not-run', target: 'candidate', reason: 'PRE_BASELINE_EVIDENCE is required; a standalone candidate result is not parity'
  };
  return { state: 'ready', target: 'candidate' };
}

export async function loadGratitudeImplementation(environment = process.env) {
  const preflight = candidatePreflight(environment);
  if (preflight.state !== 'ready') throw new Error('CANDIDATE_NOT_IMPLEMENTED: ' + preflight.reason);
  if (preflight.target === 'baseline') return (await import('./gratitude-baseline.mjs')).implementation;

  const root = fs.realpathSync(new URL('../../../../', import.meta.url));
  const requested = path.resolve(environment.PRE_CANDIDATE_GRATITUDE_DRIVER);
  const resolved = fs.realpathSync(requested);
  if (!resolved.startsWith(root + path.sep)) throw new Error('CANDIDATE_DRIVER_OUTSIDE_WORKTREE');
  if (resolved === fs.realpathSync(new URL('./gratitude-baseline.mjs', import.meta.url))) throw new Error('CANDIDATE_DRIVER_BASELINE_REFUSED');
  const candidate = (await import(pathToFileURL(resolved).href)).implementation;
  if (!candidate || required.some(name => typeof candidate[name] !== 'function')) {
    throw new Error('CANDIDATE_DRIVER_SHAPE_INVALID: required constructor or factory missing');
  }
  return candidate;
}
