#!/usr/bin/env node
/**
 * `barcode-scan-sim` — a simulator for ANY scannable code in the house, not a
 * school tool that happens to live in `cli/`. `#domains/scan/ScanCode.mjs` is
 * the domain-prefix registry every scannable code in the building shares —
 * school tokens (`sch:`), nutrition (`nut:`/`dl:`/`ct:`/`rs:`), books
 * (ISBN-13 by shape), content/commands (`go:`/`cmd:`, and the legacy
 * positional forms). They share one physical namespace because any reader
 * can be handed any code, and the prefix names the OWNER, not the reader.
 * `sch:` is merely the school-scoped prefix this file happens to have a LIVE
 * handler for today.
 *
 * `scan <code>` is the generic entry point and the reason this file exists:
 * it feeds a code through the REAL dispatch path —
 * `#domains/scan/ScanCode.mjs`'s `parseScanCode` plus
 * `#apps/scan/ScanDispatcher.mjs`'s `ScanDispatcher`, the exact classes
 * `#composition/modules/scanDispatch.mjs` wires at boot — and reports which
 * namespace claimed it and what happened. `card`/`lesson`/`flow`/`proof` are
 * SUGAR on top of that: convenience commands for driving school's full
 * agenda -> issue -> render -> print lifecycle, because school is the one
 * namespace this file wires a LIVE handler for. `content`/`command`/
 * `nutrition`/`product` are registered too (so classification is real for
 * every code shape a scanner could ever see — a `go:`, a `dl:4`, an ISBN, an
 * unrecognised string) but each answers `status: 'unwired'` — see
 * `buildScanDispatcher` below — the SAME honest "not wired in this
 * environment" shape `scanDispatch.mjs`'s own `handleSchool` returns when
 * `schoolLifecycle` is null. Widening any of those beyond classification
 * (actually dispatching a `go:` code to a Trigger, or a `dl:` code into the
 * nutrition ledger) is future work, not a thing this file quietly fakes.
 *
 * GENERALIZED from `school.mjs sim`, now deleted (spec: the atlas
 * course was a fixture baked into that file's variable names, not a feature
 * of the pipeline it proved — everything identifying became a parameter).
 * That file's full single-run lifecycle proof (agenda -> scan -> issue ->
 * grade -> close -> rescan -> answer-sheet reuse) still runs, unmodified in
 * shape, as the `proof` command below — same in-memory doubles, same
 * invariants, just fed a learner/course/subject instead of Learner3/Learner4/
 * civilization baked in as constants. `proof learner4 young-peoples-atlas-us`
 * reproduces the original atlas run.
 *
 * TWO KINDS OF STATE, ON PURPOSE:
 *
 *  - `proof` keeps sessions/tokens/worksheet-instances/attempts entirely IN
 *    MEMORY (this module never constructs a printer adapter for that
 *    command) — a repeatable, one-process, leaves-nothing-behind full-loop
 *    check, exactly like the file it replaces.
 *  - `card`/`scan`/`lesson`/`flow` persist sessions/tokens/worksheet-
 *    instances/form-maps/print-documents/allocations to a `--state-dir`
 *    scratch root (default under the OS tmp dir) using the REAL `Yaml*`
 *    adapters the backend itself uses — so `card learner4` in one process and
 *    `scan sch:XXXX` in a LATER process see the same minted token, the way a
 *    printed QR code and a scanner really would. This is what makes `scan`
 *    and `lesson` independently reproducible commands rather than only
 *    reachable through `flow`.
 *
 * Both kinds read curriculum/assignments straight off the REAL household
 * data directory (read-only in this whole flow — `BuildAgenda`,
 * `IssueDocument` and friends never call `assignments.put` or edit the
 * catalog) and write NOTHING there. `--state-dir`'s Yaml stores are pointed
 * at a scratch root via a second, write-only `configService` shim whose
 * `getHouseholdPath` never resolves inside the real `data/household` tree —
 * see `#buildWriteConfigService` below. **Never mutate household data.**
 *
 * LASER PRINTING (Part 1 of the task this file exists for): the adapter is
 * `#adapters/hardware/laser-printer/LaserPrinterAdapter.mjs` — this file
 * writes no socket code of its own. Host resolution mirrors
 * `schoolLifecycle.mjs` exactly: `school.yml`'s `printing.host` overrides,
 * else the `kitchen-printer` device entry in `devices.yml`. Physical
 * printing is OFF by default; `--print` is required, and even then a
 * printer-status check (IPP, port 631) and the household's own
 * `evaluatePrintQuota` policy (`school.yml` printing.windowMinutes/
 * pagesPerWindow/maxPagesPerJob/printCooldownMinutes) both run before a
 * single byte reaches port 9100. Without `--print`, the PDF is written to
 * `--out` and the printer's IPP status is still reported (read-only) so an
 * operator can see whether a real print would even reach the printer.
 */
import fs from 'node:fs';
import os from 'node:os';
import { createSchoolBarcodeWorkflows } from '../__app_modules/school/cli/barcode-workflows.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


import dotenv from 'dotenv';
import { parseArgv } from './_argv.mjs';


import { ScanDispatcher } from '#apps/scan/ScanDispatcher.mjs';




























const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;
const ENTRYPOINT = fileURLToPath(import.meta.url);

// This file previously loaded no .env at all — unlike every sibling CLI that
// reads real household data (see `exercise-library.cli.mjs`,
// `school.mjs catalog`, etc.), which all call `dotenv.config()` for
// exactly this reason. Without it, `resolveScanSimPaths` below fell through
// to the Docker-only default (`/usr/src/app/data`) on any host where
// `DAYLIGHT_BASE_PATH` wasn't ALREADY exported in the calling shell — which a
// plain `node cli/barcode-scan-sim.cli.mjs card learner4` never does. The
// nonexistent directory then fed every Yaml adapter down the line, each of
// which treats a missing directory as "legitimately nothing here yet" (an
// empty shelf is valid data — see `YamlCurriculumDatastore#curriculumWorks`),
// so the whole pipeline "succeeded" with an empty agenda instead of erroring.
// That is the exact failure this CLI exists to catch, happening to itself.
// `dotenv.config` never overwrites a variable already in the environment, so
// a real shell export (Docker, CI, an operator who already set it) still
// wins over the file, and `--data-dir` still wins over both.
dotenv.config({ path: path.join(path.dirname(ENTRYPOINT), '..', '.env'), quiet: true });

const DEFAULT_STATE_DIR = path.join(os.tmpdir(), 'daylight-barcode-scan-sim-state');
const DEFAULT_OUT_DIR = path.join(os.tmpdir(), 'daylight-barcode-scan-sim-out');

const HELP = `barcode-scan-sim — feed ANY scannable code in the house through the
REAL ScanCode/ScanDispatcher dispatch path and see what claims it. School
(sch:) is the one namespace with a live handler; card/lesson/flow are sugar
for driving its agenda -> issue -> render -> print lifecycle end to end.
Physical printing is opt-in (--print).

Usage:
  barcode-scan-sim.cli.mjs scan <code> [options]
  barcode-scan-sim.cli.mjs card <learnerId> [options]
  barcode-scan-sim.cli.mjs lesson <learnerId> <lessonId> [options]
  barcode-scan-sim.cli.mjs flow <learnerId> [options]
  barcode-scan-sim.cli.mjs proof <learnerId> <courseId> [options]
  barcode-scan-sim.cli.mjs printer-status [options]

Commands:
  scan <code>                 THE GENERIC PRIMITIVE. Feed any code — sch:...,
                               go:..., cmd:..., nut:.../dl:.../ct:.../rs:...,
                               a 13-digit ISBN, or garbage — through the real
                               parseScanCode + ScanDispatcher classification
                               and report which namespace claimed it and what
                               happened. Only 'school' has a live handler
                               here; the rest answer 'unwired' (same honest
                               shape composition itself returns when a
                               namespace's console isn't built) — that is a
                               true report of what this simulator can drive
                               today, not a placeholder pretending to work. A
                               'school' code needs a token minted by an
                               earlier card/flow run against the SAME
                               --state-dir.
  card <learnerId>            simulate the personal-card scan: build the
                               learner's real agenda and list every
                               subject_next token it minted.
  lesson <learnerId> <lessonId>
                               issue one specific lesson's document directly
                               (no token derivation) — reproducible even when
                               agenda/token minting is broken. A second run
                               with the same args is a REPRINT of the same
                               artifact.
  flow <learnerId>             card -> pick a subject's offer -> scan it
                               (through the SAME generic 'scan' dispatch
                               above, which issues + renders through the same
                               path a scanner triggers) -> optionally print.
  proof <learnerId> <courseId> the full in-memory lifecycle proof the old
                               school.mjs sim ran (now deleted,
                               superseded by this file): agenda -> scan ->
                               issue -> simulated OMR grade -> close ->
                               rescan the result QR -> verify answer-sheet
                               reuse. Leaves no learner history — sessions,
                               tokens, worksheet instances and attempts stay
                               in memory for this one process only.
                               'proof learner4 young-peoples-atlas-us' reproduces
                               the original atlas run.
  printer-status                read-only IPP ping + Get-Printer-Attributes
                               against the configured laser printer. Never
                               prints anything.

Options:
  --data-dir <path>           data root (default: $DAYLIGHT_BASE_PATH/data)
  --state-dir <path>          scratch root for sessions/tokens/worksheet-
                               instances/print-documents (default:
                               ${DEFAULT_STATE_DIR})
  --fresh                     wipe --state-dir before running
  --learner-name <name>       printed name (default: capitalized learnerId)
  --subject <id>              (flow) restrict to one subject's agenda offer
  --subject <id>              (proof) restrict to one subject's agenda offer
                               (default: the course's own offer)
  --outcome <pass|fail>       (proof) simulate a passing or failing OMR scan
                               (default: pass)
  --device <id>               scanner device label recorded in logs
                               (default: cli-scan-sim)
  --out <dir>                 output directory for rendered PDFs/PNGs
                               (default: ${DEFAULT_OUT_DIR})
  --print                     physically send the rendered PDF to the laser
                               printer. Off by default — everything else
                               (issue, render, form-map/allocation write)
                               still happens; only the network send to port
                               9100 is gated behind this flag.
  --printer-host <host>       override the resolved printer host
  --skip-printer-check        skip the read-only IPP ping/status report
  --help, -h                  show this message

Exit codes: 0 ok, 1 pipeline/print failure, 2 usage error.
`;

// ---------------------------------------------------------------------------
// Paths, config, printer resolution
// ---------------------------------------------------------------------------

function valueFlag(value, name) {
  if (value === undefined) return undefined;
  if (value === true || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

export function resolveScanSimPaths({ flags = {}, env = process.env } = {}) {
  const dataDir = path.resolve(
    valueFlag(flags['data-dir'], '--data-dir')
      ?? (env.DAYLIGHT_BASE_PATH ? path.join(env.DAYLIGHT_BASE_PATH, 'data') : '/usr/src/app/data'),
  );
  const stateDir = path.resolve(valueFlag(flags['state-dir'], '--state-dir') ?? DEFAULT_STATE_DIR);
  const outDir = path.resolve(valueFlag(flags.out, '--out') ?? DEFAULT_OUT_DIR);
  return { dataDir, stateDir, outDir };
}

/**
 * A loud gate on `dataDir` for every command that reads real household
 * curriculum/assignments (`card`/`scan`/`lesson`/`flow`/`proof` — NOT
 * `printer-status`, which never touches this tree).
 *
 * Why this needs its own check, separate from just fixing the dotenv miss
 * above: every Yaml adapter downstream (`YamlCurriculumDatastore`,
 * `YamlAssignmentStore`, ...) treats a missing directory as "an empty shelf,
 * legitimately" — that's the correct behavior FOR THEM, because a household
 * really can have a subject with no work published yet. But it means an
 * entirely absent or wrong `dataDir` (a bad `--data-dir`, a host where the
 * data volume isn't mounted, a future regression that reintroduces the
 * dotenv gap this file just fixed) produces the SAME shape as "nothing
 * assigned today": `sections: 0, offers: [], errors: []`. That shape is
 * indistinguishable from truth without this check — which is precisely the
 * failure that sent an operator down a wrong path trusting `card learner4`'s
 * "empty agenda" as fact. This function is what makes "no data reachable"
 * fail LOUD instead of quietly resolving to "nothing to do".
 */
function unwiredHandler(namespace) {
  return async ({ raw, form }) => ({
    status: 'unwired',
    ok: false,
    message: `"${namespace}" was correctly classified (form: ${form}) but has no live handler in this simulator — school is the only wired namespace today.`,
  });
}
function createScanDispatcher({ schoolHandler, logger }) {
 return new ScanDispatcher({ handlers: [schoolHandler, { namespace: 'content', handle: unwiredHandler('content') }, { namespace: 'command', handle: unwiredHandler('command') }, { namespace: 'nutrition', handle: unwiredHandler('nutrition') }, { namespace: 'product', handle: unwiredHandler('product') }], logger });
}
const { validateDataDir, resolvePrinterConfig, readPrinterStatus, maybePhysicallyPrint, writeArtifacts, runCard, runScan, runLesson, runFlow, runPrinterStatus, runProof } = createSchoolBarcodeWorkflows({ createDispatcher: createScanDispatcher, valueFlag });
export { validateDataDir, runCard, runScan, runLesson, runFlow, runPrinterStatus, runProof };

function usageResult(errors) {
  return {
    exitCode: EXIT_USAGE, report: { ok: false, mode: 'usage', errors },
  };
}

export async function runBarcodeScanSim(argv = [], deps = {}) {
  const {
    subcommand, positional, flags, help,
  } = parseArgv(argv);
  if (help || !subcommand) {
    return { exitCode: help ? EXIT_OK : EXIT_USAGE, report: { ok: !!help, mode: 'help', errors: [] } };
  }
  const KNOWN = new Set(['card', 'scan', 'lesson', 'flow', 'proof', 'printer-status']);
  if (!KNOWN.has(subcommand)) return usageResult([`Unknown command: ${subcommand}`]);

  let paths;
  try {
    paths = resolveScanSimPaths({ flags, env: deps.env ?? process.env });
  } catch (error) {
    return usageResult([error.message]);
  }
  if (flags.fresh === true) fs.rmSync(paths.stateDir, { recursive: true, force: true });

  // `printer-status` never reads curriculum/assignments — everything else
  // does, and a bad/absent dataDir must fail here, loudly, rather than let
  // BuildAgenda et al. quietly report "nothing assigned" (see
  // `validateDataDir`'s docstring for why that shape is indistinguishable
  // from truth otherwise).
  if (subcommand !== 'printer-status') {
    const dataDirErrors = validateDataDir(paths.dataDir);
    if (dataDirErrors.length) {
      return { exitCode: EXIT_FAIL, report: { ok: false, mode: subcommand, errors: dataDirErrors } };
    }
  }

  const clock = deps.clock ?? (() => new Date());
  const device = valueFlag(flags.device, '--device') ?? 'cli-scan-sim';

  let result;
  try {
    if (subcommand === 'card') {
      if (positional.length !== 1) return usageResult(['card requires exactly one <learnerId> argument']);
      result = await runCard({
        learnerId: positional[0], learnerName: valueFlag(flags['learner-name'], '--learner-name'), dataDir: paths.dataDir, stateDir: paths.stateDir, clock,
      });
    } else if (subcommand === 'scan') {
      if (positional.length !== 1) return usageResult(['scan requires exactly one <code> argument']);
      result = await runScan({
        code: positional[0], device, dataDir: paths.dataDir, stateDir: paths.stateDir, clock,
      });
    } else if (subcommand === 'lesson') {
      if (positional.length !== 2) return usageResult(['lesson requires exactly two arguments: <learnerId> <lessonId>']);
      result = await runLesson({
        learnerId: positional[0], lessonId: positional[1], dataDir: paths.dataDir, stateDir: paths.stateDir, clock,
      });
    } else if (subcommand === 'flow') {
      if (positional.length !== 1) return usageResult(['flow requires exactly one <learnerId> argument']);
      result = await runFlow({
        learnerId: positional[0],
        learnerName: valueFlag(flags['learner-name'], '--learner-name'),
        subject: valueFlag(flags.subject, '--subject') ?? null,
        device,
        dataDir: paths.dataDir,
        stateDir: paths.stateDir,
        clock,
      });
    } else if (subcommand === 'proof') {
      if (positional.length !== 2) return usageResult(['proof requires exactly two arguments: <learnerId> <courseId>']);
      result = await runProof({
        learnerId: positional[0],
        courseId: positional[1],
        learnerName: valueFlag(flags['learner-name'], '--learner-name'),
        subject: valueFlag(flags.subject, '--subject') ?? null,
        outcome: valueFlag(flags.outcome, '--outcome') ?? 'pass',
        dataDir: paths.dataDir,
        outDir: paths.outDir,
        clock,
      });
    } else {
      result = await runPrinterStatus({ dataDir: paths.dataDir, flags });
    }
  } catch (error) {
    return { exitCode: EXIT_FAIL, report: { ok: false, mode: subcommand, errors: [error.message] } };
  }

  if (!result.ok) return { exitCode: EXIT_FAIL, report: result };

  // Any PDF this command rendered gets written to disk and, on request,
  // physically printed. `printer-status` and a `scan`/`lesson`/`flow` whose
  // status wasn't `issued`/`reprinted` (e.g. `already_done`) carry no pdf.
  //
  // `flow`'s own return has no top-level `pdf` — the render lives one level
  // down, at `result.scan.pdf` (that IS what `flow` calls the generic `scan`
  // primitive for) — so this reads `result.pdf ?? result.scan?.pdf` rather
  // than `result.pdf` alone. Without the fallback, `flow learner4 --print`
  // silently never reached the printer: the pdf existed, but this whole
  // block short-circuited on an always-undefined top-level field, so
  // `--print` was accepted, produced no error, and nothing came out of the
  // laser — the exact "no output and no explanation" failure mode this
  // simulator exists to catch, in itself.
  const printerCfg = resolvePrinterConfig(paths.dataDir, flags);
  const pdf = result.pdf ?? result.scan?.pdf ?? null;
  if (pdf) {
    const baseName = result.artifactId ?? result.scan?.effect?.artifactId ?? `${subcommand}-${Date.now()}`;
    const { pdfPath, pngPath } = writeArtifacts(paths.outDir, baseName, pdf);
    result.artifacts = { pdfPath, pngPath };
    const pageCount = result.pageCount ?? result.effect?.pageCount ?? result.scan?.pageCount ?? null;
    if (!flags['skip-printer-check']) {
      result.printerStatus = await readPrinterStatus({
        host: printerCfg.host, port: printerCfg.port, printPath: printerCfg.printPath, skip: false,
      });
    }
    result.print = await maybePhysicallyPrint({
      print: flags.print === true,
      host: printerCfg.host,
      port: printerCfg.port,
      printPath: printerCfg.printPath,
      policy: printerCfg.policy,
      stateDir: paths.stateDir,
      pdf,
      pageCount,
      jobName: `barcode-scan-sim-${baseName}`,
      user: result.learnerId ?? 'cli-scan-sim',
    });
  }
  delete result.pdf;
  if (result.scan?.pdf) delete result.scan.pdf;

  return { exitCode: EXIT_OK, report: result };
}

export function formatReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function main(argv = process.argv.slice(2), io = process) {
  const { exitCode, report } = await runBarcodeScanSim(argv);
  if (report.mode === 'help') {
    io.stdout.write(HELP);
    return exitCode;
  }
  if (report.mode === 'usage') {
    io.stderr.write(formatReport(report));
    io.stdout.write(HELP);
    return exitCode;
  }
  io.stdout.write(formatReport(report));
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = EXIT_FAIL;
    });
}
