/** Fail-closed static review for the Gratitude target-selection contract. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root, emit } from './census.mjs';

const files = [
  'tests/preimplementation/application-modules/drivers/gratitude-target.mjs',
  'tests/preimplementation/application-modules/drivers/gratitude-baseline.mjs',
  'tests/preimplementation/application-modules/drivers/gratitude.mjs',
  'tests/preimplementation/application-modules/drivers/browser-target.mjs',
  'tests/preimplementation/application-modules/drivers/browser-baseline.mjs',
  'tests/preimplementation/application-modules/cases/gratitude.case.mjs',
  'tests/preimplementation/application-modules/cases/browser.case.mjs',
  'tests/preimplementation/application-modules/tooling/run-node.mjs'
];
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const text = Object.fromEntries(files.map(name => [name, read(name)]));
const target = text[files[0]], baseline = text[files[1]], browserTarget = text[files[3]], browserBaseline = text[files[4]], cases = text[files[5]], browserCases = text[files[6]], runner = text[files[7]];
const requiredBlock = target.match(/const required = \[([\s\S]*?)\];/)?.[1] || '';
const requiredNames = [...requiredBlock.matchAll(/'([A-Za-z][A-Za-z0-9]+)'/g)].map(match => match[1]);
const checks = {
  candidatePreflightOutsideTest: runner.includes("const candidate = pack === 'browser' ? browserCandidatePreflight() : candidatePreflight()") && runner.includes("result: 'No test process was started; candidate parity was not claimed.'"),
  absentCandidateIsNotRun: target.includes("state: 'not-run'") && target.includes('baseline fallback is forbidden'),
  candidateMustStayInWorktree: target.includes('CANDIDATE_DRIVER_OUTSIDE_WORKTREE') && target.includes('CANDIDATE_DRIVER_BASELINE_REFUSED') && browserTarget.includes('CANDIDATE_DRIVER_BASELINE_REFUSED'),
  candidateShapeIsFailClosed: target.includes('CANDIDATE_DRIVER_SHAPE_INVALID') && requiredNames.every(name => baseline.includes(name)),
  baselineOnlyPathsAreCentralized: !/\.\.\/\.\.\/\.\.\/backend\/src\//.test(cases) && baseline.includes('../../../../backend/src/'),
  fixtureUsesSelectedImplementation: text[files[2]].includes('await loadGratitudeImplementation()'),
  sameNodeCasesUseSelectedSurface: cases.includes('await loadGratitudeImplementation()') && cases.includes('CASE-CANDIDATE-REFUSAL target selection never falls back to baseline'),
  browserPreflightOutsideTest: runner.includes("pack === 'browser' ? browserCandidatePreflight() : candidatePreflight()") && browserTarget.includes("state: 'not-run'"),
  browserPathsAreCentralized: !/\.\.\/\.\.\/\.\.\/frontend\/src\//.test(browserCases) && browserBaseline.includes('../../../../frontend/src/'),
  sameBrowserCasesUseSelectedSurface: browserCases.includes('await loadBrowserImplementation()') && browserTarget.includes('CANDIDATE_DRIVER_SHAPE_INVALID'),
  candidateRequiresComparableBaseline: target.includes('PRE_BASELINE_EVIDENCE is required') && browserTarget.includes('PRE_BASELINE_EVIDENCE is required') && runner.includes("parity.state === 'mismatch'") && runner.includes("? 'matched' : 'mismatch'")
};
emit('candidate-driver-review.json', {
  schema: 'daylight.preimplementation.candidate-driver-review/v1',
  inputs: files.map(name => ({ name, sha256: createHash('sha256').update(read(name)).digest('hex') })),
  requiredNames, checks,
  result: Object.values(checks).every(Boolean) ? 'pass' : 'fail',
  limitations: [
    'This proves only the dedicated Gratitude Node pack is target-selectable; browser, rendering, original-suite and package-resolution candidates remain separate work.',
    'No candidate exists or has run. A candidate must still prove public-entry resolution and parity using this interface.'
  ],
  toolHash: createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex')
});
process.stdout.write(JSON.stringify(checks) + '\n');
