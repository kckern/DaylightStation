#!/usr/bin/env node
/**
 * One-shot hardware probe: print a single minimal page and report the job-state
 * sequence the printer actually exposes.
 *
 * Not a test — a question to the hardware. Phase 2 of the physical-events
 * design depends on the answer: if a terminal state is never observed, then
 * `indeterminate` is the steady state and the Portal retry affordance in that
 * phase must be reconsidered rather than built.
 *
 *   node scripts/probe-printer-jobstate.mjs <printer-host>
 */
import { LaserPrinterAdapter } from '../backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs';

const host = process.argv[2];
if (!host) {
  console.error('usage: node scripts/probe-printer-jobstate.mjs <printer-host>');
  process.exit(2);
}

// Smallest legal one-page PDF, inline so the probe needs no fixture file.
const PDF = Buffer.from(
  '%PDF-1.4\n'
  + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
  + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n'
  + 'trailer<</Root 1 0 R>>\n', 'utf8',
);

const adapter = new LaserPrinterAdapter({ host, port: 631 });
const sent = await adapter.printPdf(PDF, { jobName: 'daylight-jobstate-probe' });
process.stdout.write(`submitted: jobId=${sent.jobId}\n`);
if (!Number.isInteger(sent.jobId)) {
  process.stdout.write('VERDICT: printer returned no job-id. Polling is impossible.\n');
  process.exit(1);
}

const observed = [];
const started = Date.now();
while (Date.now() - started < 60000) {
  try {
    const s = await adapter.getJobState(sent.jobId);
    observed.push(`${Date.now() - started}ms state=${s.state} (${s.classification}) reasons=${s.stateReasons.join(',')}`);
    if (['completed', 'failed'].includes(s.classification)) break;
  } catch (err) {
    observed.push(`${Date.now() - started}ms QUERY FAILED: ${err.message}`);
  }
  await new Promise((r) => { setTimeout(r, 1000); });
}

process.stdout.write(`${observed.join('\n')}\n`);
const sawTerminal = observed.some((line) => /\((completed|failed)\)/.test(line));
process.stdout.write(sawTerminal
  ? 'VERDICT: terminal state observable. Phase 2 may rely on job outcomes.\n'
  : 'VERDICT: no terminal state within 60s. `indeterminate` is the steady state — '
    + 'Phase 2 retry affordance must be reconsidered before it is built.\n');
