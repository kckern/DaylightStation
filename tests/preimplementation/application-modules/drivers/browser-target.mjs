/** Candidate selection for browser cases; no product path is named by the cases. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const required = ['Gratitude', 'FamilySelector', 'GratitudeConfig', 'dispatchPortalHidMessage', 'usePortalKeys', 'usePianoBridgeNotes', 'ScreenVolumeContext', 'resolveParamOptions', 'getApp'];

export function browserCandidatePreflight(environment = process.env) {
  if ((environment.PRE_TARGET || 'baseline') !== 'candidate') return { state: 'ready', target: 'baseline' };
  if (!environment.PRE_CANDIDATE_BROWSER_DRIVER) return { state: 'not-run', target: 'candidate', reason: 'PRE_CANDIDATE_BROWSER_DRIVER is required; baseline fallback is forbidden' };
  if (!environment.PRE_BASELINE_EVIDENCE) return { state: 'not-run', target: 'candidate', reason: 'PRE_BASELINE_EVIDENCE is required; a standalone candidate result is not parity' };
  return { state: 'ready', target: 'candidate' };
}

export async function loadBrowserImplementation(environment = process.env) {
  const preflight = browserCandidatePreflight(environment);
  if (preflight.state !== 'ready') throw new Error('CANDIDATE_NOT_IMPLEMENTED: ' + preflight.reason);
  if (preflight.target === 'baseline') return (await import('./browser-baseline.mjs')).implementation;
  const root = fs.realpathSync(new URL('../../../../', import.meta.url));
  const resolved = fs.realpathSync(path.resolve(environment.PRE_CANDIDATE_BROWSER_DRIVER));
  if (!resolved.startsWith(root + path.sep)) throw new Error('CANDIDATE_DRIVER_OUTSIDE_WORKTREE');
  if (resolved === fs.realpathSync(new URL('./browser-baseline.mjs', import.meta.url))) throw new Error('CANDIDATE_DRIVER_BASELINE_REFUSED');
  const candidate = (await import(pathToFileURL(resolved).href)).implementation;
  if (!candidate || required.some(name => candidate[name] == null)) throw new Error('CANDIDATE_DRIVER_SHAPE_INVALID: browser entry missing');
  return candidate;
}
