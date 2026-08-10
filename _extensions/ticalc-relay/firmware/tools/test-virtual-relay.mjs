#!/usr/bin/env node
/** Hermetic production-session coverage for the Adaptive Study relay transaction. */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createSemanticFixture } from './test-tilem-wire-relay.mjs';
import {
  decodeTi86Envelope,
  decodeTi86StudyAcknowledgement,
  decodeTi86StudyPrescription,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';

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
        || values.writes !== 'DP7L3CWY,DSSTDNEW,DSSYNC') {
      throw new Error(`virtual relay report was incomplete: ${JSON.stringify(values)}`);
    }
    const artifact = decodeTi86Envelope(readFileSync(path.join(fixture.directory, 'SCP1.bin')), 'SCP1');
    const prescription = decodeTi86StudyPrescription(readFileSync(path.join(fixture.directory, 'SCSP.bin')));
    const acknowledgement = decodeTi86StudyAcknowledgement(readFileSync(path.join(fixture.directory, 'SCSA.bin')));
    if (prescription.sessionCode !== '001234' || prescription.requestId !== 77
        || prescription.artifactId !== artifact.artifactId
        || acknowledgement.sessionCode !== prescription.sessionCode
        || acknowledgement.prescriptionId !== prescription.prescriptionId
        || acknowledgement.artifactId !== artifact.artifactId) {
      throw new Error('adaptive transaction records do not identify the same immutable session and artifact');
    }
    process.stdout.write(`${JSON.stringify({
      schema: 'school.calc.virtual-relay/v1',
      flows: ['adaptive-artifact-download', 'adaptive-prescription', 'adaptive-commit'],
      state: values.state, writes: values.writes.split(','),
      study: { sessionCode: prescription.sessionCode, requestId: prescription.requestId,
        artifactId: prescription.artifactId },
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
