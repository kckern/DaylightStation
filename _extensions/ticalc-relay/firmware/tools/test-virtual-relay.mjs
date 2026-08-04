#!/usr/bin/env node
/** Hermetic production-session coverage for the semantic Catalog/quiz/progress fixture. */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createSemanticFixture } from './test-tilem-wire-relay.mjs';
import { commitTi86StagedSync, inspectTi86CommittedSync } from '../../../ti86-app/tools/lib/ti86-sync-commit.mjs';
import { acknowledgeTi86DeliveryQueueBatch } from '../../../ti86-app/tools/lib/ti86-delivery-queue.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIRMWARE = path.resolve(HERE, '..');

try {
  const workspace = mkdtempSync(path.join(tmpdir(), 'ticalc-virtual-relay-'));
  try {
    const fixture = createSemanticFixture(workspace);
    const executable = build(workspace);
    const report = path.join(workspace, 'report');
    const run = spawnSync(executable, ['--fixture-dir', fixture.directory, '--report', report], { encoding: 'utf8' });
    if (run.status !== 0 || !run.stdout.includes('TICALC_VIRTUAL_RELAY_PASS')) {
      throw new Error(`virtual relay failed: ${(run.stderr || run.stdout).trim()}`);
    }
    const values = Object.fromEntries(readFileSync(report, 'utf8').trim().split('\n').map((line) => line.split('=')));
    if (values.ok !== 'true' || values.state !== 'awaiting_calculator_commit'
        || values.writes !== 'DSUSRNEW,DSPRGNEW,DSTNEW,DSCATNEW,DP7L3CWY,DSACKNEW,DSSYNC') {
      throw new Error(`virtual relay report was incomplete: ${JSON.stringify(values)}`);
    }
    const variables = stagedCalculatorVariables(fixture.directory);
    const commit = commitTi86StagedSync(variables);
    const committed = inspectTi86CommittedSync(variables);
    const delivery = acknowledgeTi86DeliveryQueueBatch(readFileSync(path.join(fixture.directory, 'DSREQ.bin')),
      readFileSync(path.join(fixture.directory, 'SCM1.bin')));
    if (!commit.committed || variables.has('DSQ') || delivery !== null
        || committed.installed?.value.installedArtifacts[0]?.variableName !== 'DP7L3CWY') {
      throw new Error('calculator commit model did not atomically promote the staged semantic transaction');
    }
    process.stdout.write(`${JSON.stringify({
      schema: 'school.calc.virtual-relay/v1', flows: ['catalog-download', 'quiz-upload', 'reportable-progress'],
      state: values.state, writes: values.writes.split(','),
      calculatorCommit: { queueRetired: !variables.has('DSQ'), deliveryRequestRetired: delivery === null },
    })}\n`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
} catch (error) {
  process.stderr.write(`[ticalc:virtual] ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}

function build(workspace) {
  const output = path.join(workspace, 'virtual-relay');
  const source = (...parts) => path.join(FIRMWARE, ...parts);
  const compile = spawnSync(process.env.CXX ?? 'c++', [
    '-std=c++17', '-Wall', '-Wextra', '-Werror', '-I', source('src'),
    source('test', 'virtual', 'virtual_relay_main.cpp'),
    source('src', 'SchoolCalcWire.cpp'), source('src', 'SchoolCalcRelaySession.cpp'), '-o', output,
  ], { encoding: 'utf8' });
  if (compile.status !== 0) throw new Error(`could not compile virtual relay: ${(compile.stderr || compile.stdout).trim()}`);
  return output;
}

function stagedCalculatorVariables(directory) {
  const read = (name) => readFileSync(path.join(directory, `${name}.bin`));
  return new Map([
    ['DSID', read('DSID')], ['DSQ', read('DSQ')], ['DSREQ', read('DSREQ')],
    ['DSCATNEW', read('SCC1')], ['DP7L3CWY', read('SCP1')], ['DSACKNEW', read('SCA1')], ['DSSYNC', read('SCM1')],
  ]);
}
