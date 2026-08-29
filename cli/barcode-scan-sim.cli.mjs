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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import dotenv from 'dotenv';
import { parseArgv } from './_argv.mjs';

import { parseScanCode } from '#domains/scan/ScanCode.mjs';
import { ScanDispatcher } from '#apps/scan/ScanDispatcher.mjs';

import { evaluatePrintQuota, DEFAULT_PRINT_POLICY } from '#domains/school/index.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { shortId } from '#system/utils/id.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { BuildAgenda } from '#apps/school/usecases/BuildAgenda.mjs';
import { ResolveSubjectNext } from '#apps/school/usecases/ResolveSubjectNext.mjs';
import { ResolveScanAction } from '#apps/school/usecases/ResolveScanAction.mjs';
import { IssueDocument } from '#apps/school/usecases/IssueDocument.mjs';
import { CloseSessionOutcome } from '#apps/school/usecases/CloseSessionOutcome.mjs';
import { OpenRemediation } from '#apps/school/usecases/OpenRemediation.mjs';
import { ensureSession } from '#apps/school/usecases/offerSession.mjs';
import { RenderPrintDocument } from '#apps/school/documents/RenderPrintDocument.mjs';
import { createPrintDocumentRendering } from '#rendering/school/documents/PrintDocumentRendering.mjs';
import { createYamlBankReader } from '#adapters/school/documents/YamlBankReader.mjs';
import { ResolveCardScan } from '#apps/school/documents/ResolveCardScan.mjs';
import { RecordCardScanOutcome } from '#apps/school/documents/RecordCardScanOutcome.mjs';
import { YamlPrintDocumentRepository } from '#adapters/school/documents/YamlPrintDocumentRepository.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { YamlCurriculumDatastore } from '#adapters/persistence/yaml/YamlCurriculumDatastore.mjs';
import { YamlSchoolDatastore } from '#adapters/persistence/yaml/YamlSchoolDatastore.mjs';
import { YamlAssignmentStore } from '#adapters/persistence/yaml/YamlAssignmentStore.mjs';
import { YamlWorkSessionDatastore } from '#adapters/persistence/yaml/YamlWorkSessionDatastore.mjs';
import { YamlTokenRegistry } from '#adapters/persistence/yaml/YamlTokenRegistry.mjs';
import { YamlWorksheetInstanceStore } from '#adapters/persistence/yaml/YamlWorksheetInstanceStore.mjs';
import { YamlFormMapStore } from '#adapters/persistence/yaml/YamlFormMapStore.mjs';
import { createDocumentReceiptRenderer } from '#rendering/school/documents/DocumentReceiptRenderer.mjs';

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
export function validateDataDir(dataDir) {
  const errors = [];
  if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
    errors.push(`data directory not found: ${dataDir} — check --data-dir, DAYLIGHT_BASE_PATH (in .env or the environment), or that the data volume is mounted on this host`);
    return errors; // nothing downstream of a missing root is worth checking
  }
  const curriculumDir = path.join(dataDir, 'content', 'school', 'curriculum');
  let curriculumEntries = [];
  try {
    curriculumEntries = fs.readdirSync(curriculumDir).filter((name) => !name.startsWith('.'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (curriculumEntries.length === 0) {
    errors.push(`no curriculum content found under ${curriculumDir} — every card/lesson/flow/proof command reads real courses from here; an agenda built against this dataDir cannot be trusted as a report of what's actually assigned`);
  }
  const householdDir = path.join(dataDir, 'household');
  if (!fs.existsSync(householdDir)) {
    errors.push(`household config/data not found under ${householdDir} — assignments, sessions and tokens all read/write relative to this directory`);
  }
  return errors;
}

function loadYamlSafe(filePath) {
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8')) ?? {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

/**
 * Mirrors `schoolLifecycle.mjs`'s printer host/policy resolution exactly
 * (`school.yml printing.host` overrides the `kitchen-printer` device entry;
 * the print-quota policy keys sit next to `host`/`port`/`path` in the SAME
 * `printing:` block) — so this CLI never invents a second source of truth
 * for where the household's laser printer lives or how much it may print.
 */
function resolvePrinterConfig(dataDir, flags) {
  // Colocated (task-13). Phase E deleted the legacy config/ fallback.
  const schoolCfg = loadYamlSafe(path.join(dataDir, 'household/school/school.yml')) ?? {};
  const devicesCfg = loadYamlSafe(path.join(dataDir, 'household/hardware/devices.yml')) ?? {};
  const printing = schoolCfg.printing ?? {};
  // `devices.yml` nests every device under a top-level `devices:` key (see
  // `ConfigService#getDeviceConfig`'s own `devices?.devices?.[deviceId]`) —
  // NOT bare at the document root. Reading `devicesCfg['kitchen-printer']`
  // directly always misses, silently: `loadYamlSafe` returns a normal object
  // either way, so the fallback chain below just falls through to `null`
  // rather than throwing, and this simulator would report "no printer host
  // configured" against a household that has one.
  const host = valueFlag(flags['printer-host'], '--printer-host')
    ?? printing.host
    ?? devicesCfg?.devices?.['kitchen-printer']?.host
    ?? null;
  return {
    host,
    port: printing.port || 631,
    printPath: printing.path || '/ipp/print',
    policy: { ...DEFAULT_PRINT_POLICY, ...printing },
  };
}

/**
 * Read-only config shim for curriculum/assignments/banks: `getDataDir`
 * resolves against the REAL household data directory and nothing built with
 * this shim ever calls a `.put`/`.set`/write method in this file's use-case
 * graph — `BuildAgenda`, `ResolveSubjectNext` and `IssueDocument` only ever
 * `curriculum.getUnit`/`.getDocument`, `assignments.get`, `bankReader.getBank`
 * against it.
 */
function buildReadConfigService(dataDir) {
  return {
    getDataDir: () => dataDir,
    getHouseholdPath: (relative) => path.join(dataDir, 'household', relative),
  };
}

/**
 * Write-side config shim for sessions/tokens/worksheet-instances/form-maps:
 * `getHouseholdPath` resolves inside `--state-dir`, never inside the real
 * `data/household` tree — this is the whole mechanism that keeps `card`/
 * `scan`/`lesson`/`flow` runnable against a REAL learner (learner4) without
 * ever writing to learner4's real session/attempt/worksheet-instance history.
 */
function buildWriteConfigService(stateDir) {
  const root = path.join(stateDir, 'household');
  return {
    getDataDir: () => stateDir,
    getHouseholdPath: (relative) => path.join(root, relative),
  };
}

// ---------------------------------------------------------------------------
// Shared wiring
// ---------------------------------------------------------------------------

function buildCurriculumAccess(dataDir, clock) {
  const readConfig = buildReadConfigService(dataDir);
  const catalog = new YamlCurriculumDatastore({ configService: readConfig });
  const school = new YamlSchoolDatastore({ configService: readConfig });
  const assignments = new YamlAssignmentStore({ configService: readConfig });
  const curriculum = new CurriculumAccess({
    catalog, bankIds: () => school.listBankIds(), clock: () => clock().getTime(), logger: silentLogger,
  });
  return {
    catalog, school, assignments, curriculum,
  };
}

/** Sessions/tokens/worksheet-instances/form-maps/print-documents/allocations, all rooted at `stateDir`. */
function buildPersistentStores(stateDir) {
  const writeConfig = buildWriteConfigService(stateDir);
  const printDocumentsRoot = path.join(stateDir, 'artifacts/print');
  const printDocuments = new YamlPrintDocumentRepository({ directory: printDocumentsRoot });
  const allocationStore = new YamlAllocationStore({ directory: printDocumentsRoot });
  return {
    sessions: new YamlWorkSessionDatastore({ configService: writeConfig, logger: silentLogger }),
    tokens: new YamlTokenRegistry({ configService: writeConfig, logger: silentLogger }),
    worksheetInstances: new YamlWorksheetInstanceStore({ configService: writeConfig, logger: silentLogger }),
    formMaps: new YamlFormMapStore({ configService: writeConfig }),
    printDocuments,
    allocationStore,
  };
}

const silentLogger = { warn() {}, info() {}, error() {} };

/**
 * A printer double that captures the bytes IssueDocument would have sent —
 * used for EVERY command in this file, `proof` included. Physically sending
 * the captured bytes is a separate, explicit step (`maybePhysicallyPrint`
 * below), gated on `--print`, run AFTER the use case returns. This is what
 * makes "dry run by default" true without turning IssueDocument's own
 * printer-failure handling into dead code neither this file nor its tests
 * ever exercise: the use case always "prints" (to memory); only the
 * household's actual laser printer is optional.
 *
 * `confirmed: false` (IssueDocument's `#printConfirmed`, sessionEvents.mjs's
 * `issued`/`reprinted` SCHEMA): this double is, BY DESIGN, never a genuine
 * physical print at the moment IssueDocument calls it — `maybePhysicallyPrint`
 * runs entirely OUTSIDE this call, after `execute()` has already returned, so
 * from IssueDocument's own vantage point nothing has reached the tray yet
 * regardless of whether `--print` will later fire. Before `confirmed`
 * existed, every `lesson`/`card`/`flow` run — `--print` or not — silently
 * armed the SAME print-cooldown a real household scan uses, so running this
 * simulator against a session that a family member might rescan for real
 * could debounce their genuine print for no reason anyone watching could see
 * (no paper came out, yet the next real scan got silently refused). Setting
 * this false is what makes "dry run" true for the COOLDOWN too, not just for
 * the physical printer.
 */
function capturingPrinter() {
  const captured = { pdf: null, opts: null };
  return {
    captured,
    printer: {
      async printPdf(pdf, opts) {
        captured.pdf = pdf;
        captured.opts = opts;
        return { printed: true, confirmed: false };
      },
    },
  };
}

function buildIssueDocument({
  curriculum, school, assignments, sessions, tokens, formMaps, worksheetInstances, printDocuments, allocationStore, dataDir, clock, rng,
}) {
  const capture = capturingPrinter();
  const renderPrintDocument = new RenderPrintDocument({
    rendering: createPrintDocumentRendering(),
    repository: printDocuments,
    banks: createYamlBankReader({ dataDir }),
    allocationStore,
  });
  const issueDocument = new IssueDocument({
    curriculum,
    sessions,
    tokens,
    // The legacy `IDocumentRenderer` port is required by the constructor but
    // never reached by a bank-only (worksheet-instance) unit — see
    // `IssueDocument#execute`'s branch order. A unit whose `document` field
    // names a legacy catalog document WOULD reach it; this simulator has
    // none among learner4's atlas lessons, so a throwing stub surfaces that
    // mismatch loudly instead of silently rendering nothing.
    renderer: { async render() { throw new Error('legacy document renderer reached — this unit is not a bank-only or print/ lesson'); } },
    printer: capture.printer,
    formMaps,
    bankReader: { getBank: (id) => school.readBankRaw(id) },
    printDocuments,
    renderPrintDocument,
    allocationStore,
    assignments,
    worksheetInstances,
    clock,
    rng,
    logger: silentLogger,
  });
  return { issueDocument, capture };
}

// ---------------------------------------------------------------------------
// Printer: status + gated physical send
// ---------------------------------------------------------------------------

async function readPrinterStatus({
 host, port, printPath, skip,
}) {
  if (skip) return { checked: false, host, reachable: null, status: null, error: null };
  if (!host) return { checked: true, host: null, reachable: false, status: null, error: 'no printer host configured (school.yml printing.host or devices.yml kitchen-printer.host)' };
  const { LaserPrinterAdapter } = await import('#adapters/hardware/laser-printer/LaserPrinterAdapter.mjs');
  const laserPrinter = new LaserPrinterAdapter({
    host, port, path: printPath, logger: silentLogger,
  });
  const reachable = await laserPrinter.ping({ timeout: 3000 });
  if (!reachable) return { checked: true, host, reachable: false, status: null, error: 'TCP connect to IPP port failed' };
  try {
    const status = await laserPrinter.getStatus();
    return {
      checked: true, host, reachable: true, status, error: null,
    };
  } catch (err) {
    return {
      checked: true, host, reachable: true, status: null, error: err.message,
    };
  }
}

function printLogPath(stateDir) { return path.join(stateDir, 'print-log.json'); }

function readPrintLog(stateDir) {
  try {
    return JSON.parse(fs.readFileSync(printLogPath(stateDir), 'utf8'));
  } catch {
    return [];
  }
}

function appendPrintLog(stateDir, entry) {
  const log = [...readPrintLog(stateDir), entry];
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(printLogPath(stateDir), JSON.stringify(log, null, 2));
}

/**
 * The ONE place bytes may reach port 9100. Runs the IPP status check, the
 * household's OWN `evaluatePrintQuota` policy (against a rolling log this
 * simulator keeps under `--state-dir`, since it has no other job history to
 * consult), and `maxPagesPerJob` — refusing BEFORE the socket opens, never
 * after. An `approval`-decision quota verdict is treated as a refusal: this
 * script has no grown-up to ask.
 */
async function maybePhysicallyPrint({
  print, host, port, printPath, policy, stateDir, pdf, pageCount, jobName, user,
}) {
  if (!print) return { attempted: false, sent: false, reason: null };
  if (!host) return { attempted: true, sent: false, reason: 'no printer host configured' };
  if (!Number.isFinite(pageCount) || pageCount <= 0) {
    return { attempted: true, sent: false, reason: 'no page count reported by the render — refusing to print blind' };
  }
  if (pageCount > policy.maxPagesPerJob) {
    return { attempted: true, sent: false, reason: `${pageCount} pages exceeds maxPagesPerJob (${policy.maxPagesPerJob})` };
  }
  const { LaserPrinterAdapter } = await import('#adapters/hardware/laser-printer/LaserPrinterAdapter.mjs');
  const laserPrinter = new LaserPrinterAdapter({
    host,
    port,
    path: printPath,
    // `policy` is `{...DEFAULT_PRINT_POLICY, ...schoolCfg.printing}` (see
    // resolvePrinterConfig) — `renderPageLimit` rides along in the same
    // object as `host`/`port`/`maxPagesPerJob`, but until this line it was
    // never actually forwarded to the adapter that does the real send. That
    // made `school.yml`'s own documented safety valve ("set ONLY for a
    // supervised hardware test") a no-op for the ONE tool that IS a
    // supervised hardware test: this simulator's `--print` would have
    // rasterized and sent every page `maxPagesPerJob` allowed (up to 20),
    // not the single page an operator set `renderPageLimit: 1` to guarantee.
    // `evaluatePrintQuota`'s `maxPagesPerJob` check above refuses an
    // OVERSIZED job outright; it does not and should not TRIM a job that's
    // within quota — trimming is `renderPageLimit`'s job alone, and it only
    // does that job if it reaches the adapter.
    renderPageLimit: policy.renderPageLimit ?? null,
    logger: silentLogger,
  });
  const reachable = await laserPrinter.ping({ timeout: 3000 });
  if (!reachable) return { attempted: true, sent: false, reason: 'printer unreachable (IPP TCP ping failed)' };
  let status;
  try {
    status = await laserPrinter.getStatus();
  } catch (err) {
    return { attempted: true, sent: false, reason: `printer status check failed: ${err.message}` };
  }
  if (status.accepting === false) {
    return {
      attempted: true, sent: false, reason: `printer is not accepting jobs (state: ${status.state})`, status,
    };
  }
  const verdict = evaluatePrintQuota({
    recentJobs: readPrintLog(stateDir), pages: pageCount, now: Date.now(), policy,
  });
  if (verdict.decision !== 'allow') {
    return {
      attempted: true, sent: false, reason: verdict.reason ?? 'over the household print quota', status, quota: verdict,
    };
  }
  const result = await laserPrinter.printPdf(pdf, { jobName, user, copies: 1 });
  appendPrintLog(stateDir, { at: new Date().toISOString(), pages: pageCount, jobName });
  return {
    attempted: true, sent: true, status, quota: verdict, result,
  };
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

/**
 * `artifactId` is not always a bare filename — a worksheet-instance's own id
 * is `<subject>/<courseId>/ws-<sessionId>` (see `IssueDocument#issueWorksheetInstance`,
 * which builds it with `slugify` and literal `/` joins), because it doubles
 * as that lesson's print-document lineage key, not a file-naming convention.
 * Joining it into `outDir` unsanitized used to try to `writeFileSync` into
 * subdirectories `mkdirSync(outDir)` never created (`ENOENT`, not a pipeline
 * failure) — flattening every `/` to `-` keeps the name recognisable while
 * guaranteeing it is a single path segment.
 */
function writeArtifacts(outDir, baseName, pdf) {
  const flatName = String(baseName).replace(/[/\\]+/g, '-');
  fs.mkdirSync(outDir, { recursive: true });
  const pdfPath = path.join(outDir, `${flatName}.pdf`);
  fs.writeFileSync(pdfPath, pdf);
  let pngPath = null;
  const conv = spawnSync('pdftoppm', ['-png', '-f', '1', '-singlefile', pdfPath, path.join(outDir, flatName)]);
  if (conv.status === 0) pngPath = `${path.join(outDir, flatName)}.png`;
  return { pdfPath, pngPath };
}

function titleCase(id) {
  return String(id).split(/[-_\s]+/).filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

// ---------------------------------------------------------------------------
// card
// ---------------------------------------------------------------------------

export async function runCard({
  learnerId, learnerName, dataDir, stateDir, clock = () => new Date(), rng = Math.random,
}) {
  const { curriculum, assignments } = buildCurriculumAccess(dataDir, clock);
  const { sessions, tokens } = buildPersistentStores(stateDir);
  const agendaBuilder = new BuildAgenda({
    curriculum, assignments, sessions, tokens,
    clock, rng, newSessionId: () => `ses_${shortId(8)}`, logger: silentLogger,
  });
  const agenda = await agendaBuilder.execute({ learnerId, learnerName: learnerName ?? titleCase(learnerId) });
  return {
    ok: true,
    mode: 'card',
    learnerId,
    sections: agenda.sections.length,
    offers: agenda.offers.map((o) => ({
      subject: o.subject, unitId: o.unitId, sessionId: o.sessionId, token: o.token, tokenClass: o.tokenClass, label: o.label,
    })),
    createdSessions: agenda.createdSessions,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

/**
 * A namespace handler that tells the truth: this simulator has no live
 * `content`/`command`/`nutrition`/`product` console to hand a claimed code
 * to, and would rather say so than pretend a Trigger fired or a fridge scan
 * logged food that never happened. Mirrors `scanDispatch.mjs`'s own
 * `{ status: 'unwired', ok: false, ... }` shape for a school console that
 * failed to build — the SAME vocabulary a real, partially-configured
 * household would see, not a CLI-only invention.
 */
function unwiredHandler(namespace) {
  return async ({ raw, form }) => ({
    status: 'unwired',
    ok: false,
    message: `"${namespace}" was correctly classified (form: ${form}) but has no live handler in this simulator — school is the only wired namespace today.`,
  });
}

/**
 * The REAL dispatch graph: `parseScanCode` (via `ScanDispatcher` internally)
 * classifies the code's namespace exactly as the household's own barcode
 * relay does, then routes to a handler. Only `school` is live — wired to the
 * SAME `ResolveScanAction` use-case graph `schoolLifecycle.mjs` composes,
 * built here against the `--state-dir` scratch stores so a scan in one CLI
 * invocation can resolve a token minted by an earlier one. `content`/
 * `command`/`nutrition`/`product` are registered (so a `go:`/`nut:`/ISBN/
 * garbage code still gets a real, honest classification) but degrade to
 * `unwired` — see `unwiredHandler` above.
 */
function buildScanDispatcher({
  curriculum, school, assignments, sessions, tokens, formMaps, worksheetInstances, printDocuments, allocationStore, dataDir, clock, rng,
}) {
  const { issueDocument, capture } = buildIssueDocument({
    curriculum, school, assignments, sessions, tokens, formMaps, worksheetInstances, printDocuments, allocationStore, dataDir, clock, rng,
  });
  const subjectResolver = new ResolveSubjectNext({
    curriculum, assignments, sessions, clock, newSessionId: () => `ses_${shortId(8)}`, logger: silentLogger,
  });
  let lastReceipt = null;
  const resolveScanAction = new ResolveScanAction({
    tokens,
    sessions,
    curriculum,
    issueDocument,
    resolveSubjectNext: subjectResolver,
    resolvePersonalCard: { async execute() { throw new Error('personal-card path not wired — use the `card` command instead'); } },
    dispatchMedia: { async execute() { throw new Error('media dispatch not wired in this simulator'); } },
    openRemediation: new OpenRemediation({
      curriculum, sessions, clock, newSessionId: () => `ses_${shortId(8)}`, logger: silentLogger,
    }),
    receipts: {
      async print(document) { lastReceipt = document; return { printed: true }; },
    },
    clock,
    logger: silentLogger,
  });

  const dispatcher = new ScanDispatcher({
    handlers: [
      {
        namespace: 'school',
        // `raw`, not `body`: school's token registry looks tokens up by the
        // FULL `sch:<body>` string (see ScanCode's own "Note: school's
        // handler needs the RAW code" docstring) — the exact same field
        // `scanDispatch.mjs`'s real `handleSchool` reads.
        async handle({ raw, device }) {
          const result = await resolveScanAction.execute({ code: raw, device });
          return {
            status: result.status,
            ok: !['unknown', 'failed', 'not_school'].includes(result.status),
            physical: result.physical,
            printed: result.printed,
            message: result.message,
            // `sessionId`/`tokenClass` alongside `result.effect`'s own
            // artifactId/pageCount/tokens — flat, not `result` re-wrapped a
            // second time, so a caller reads `pageCount` at one path instead
            // of guessing how deep ResolveScanAction nested it.
            effect: {
              sessionId: result.sessionId, tokenClass: result.tokenClass, ...(result.effect ?? {}),
            },
          };
        },
      },
      { namespace: 'content', handle: unwiredHandler('content') },
      { namespace: 'command', handle: unwiredHandler('command') },
      { namespace: 'nutrition', handle: unwiredHandler('nutrition') },
      { namespace: 'product', handle: unwiredHandler('product') },
    ],
    logger: silentLogger,
  });

  return {
    dispatcher, capture, getReceipt: () => lastReceipt,
  };
}

export async function runScan({
  code, device = 'cli-scan-sim', dataDir, stateDir, clock = () => new Date(), rng = Math.random,
}) {
  const {
    curriculum, school, assignments,
  } = buildCurriculumAccess(dataDir, clock);
  const {
    sessions, tokens, formMaps, worksheetInstances, printDocuments, allocationStore,
  } = buildPersistentStores(stateDir);
  const { dispatcher, capture, getReceipt } = buildScanDispatcher({
    curriculum, school, assignments, sessions, tokens, formMaps, worksheetInstances, printDocuments, allocationStore, dataDir, clock, rng,
  });
  // Reported alongside the dispatch outcome so an operator can see the
  // classification itself (namespace/form), not just what the handler did
  // with it — the two are independent: `unwired` still means the code WAS
  // correctly classified.
  const parsed = parseScanCode(code);
  const outcome = await dispatcher.dispatch({ code, device });
  return {
    ok: true,
    mode: 'scan',
    code,
    namespace: outcome.domain,
    form: parsed.form,
    status: outcome.status,
    claimed: outcome.domain !== null,
    physical: outcome.physical,
    printed: outcome.printed,
    message: outcome.message,
    effect: outcome.effect,
    receipt: outcome.physical === 'receipt' ? getReceipt() : null,
    pdf: outcome.physical === 'worksheet' ? capture.captured.pdf : null,
    pageCount: outcome.effect?.pageCount ?? null,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// lesson
// ---------------------------------------------------------------------------

export async function runLesson({
  learnerId, lessonId, dataDir, stateDir, clock = () => new Date(), rng = Math.random,
}) {
  const {
    curriculum, school, assignments,
  } = buildCurriculumAccess(dataDir, clock);
  const {
    sessions, tokens, formMaps, worksheetInstances, printDocuments, allocationStore,
  } = buildPersistentStores(stateDir);

  const unit = await curriculum.getUnit(lessonId);
  if (!unit) {
    return {
      ok: false, mode: 'lesson', learnerId, lessonId, errors: [`no unit found for lessonId "${lessonId}"`],
    };
  }

  const nowIso = clock().toISOString();
  // `ensureSession` only reuses a session it is HANDED one (`entry.sessionId`)
  // — that is BuildAgenda's contract, where the plan entry already carries
  // the session it means. This command has no plan entry, only a bare
  // lessonId, so without looking one up first, every `lesson` call minted a
  // BRAND NEW session — silently breaking this command's own advertised
  // "a second run is a REPRINT of the same artifact" (see HELP above) and
  // making the print-debounce impossible to reach through this command,
  // since debounce is keyed per SESSION. Find the learner's existing
  // non-terminal session for this unit first, the same way the school
  // lifecycle test harness's `sessionIdFor` does, and only mint a fresh one
  // when none exists.
  const existing = (await sessions.listForLearner(learnerId))
    .find((row) => row.unitId === lessonId && !row.terminal);
  const { sessionId, created } = await ensureSession({
    entry: { unitId: lessonId, sessionId: existing?.sessionId ?? null },
    learnerId,
    nowIso,
    sessions,
    newSessionId: () => `ses_${shortId(8)}`,
  });

  const { issueDocument, capture } = buildIssueDocument({
    curriculum, school, assignments, sessions, tokens, formMaps, worksheetInstances, printDocuments, allocationStore, dataDir, clock, rng,
  });
  const result = await issueDocument.execute({ sessionId });
  return {
    ok: true,
    mode: 'lesson',
    learnerId,
    lessonId,
    sessionId,
    sessionCreated: created,
    status: result.status,
    artifactId: result.artifactId,
    pageCount: result.pageCount,
    tokens: result.tokens ?? {},
    allocation: result.allocation ?? null,
    message: result.message,
    pdf: capture.captured.pdf,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// flow — card -> pick an offer -> scan it
// ---------------------------------------------------------------------------

export async function runFlow({
  learnerId, learnerName, subject = null, device = 'cli-scan-sim', dataDir, stateDir, clock = () => new Date(), rng = Math.random,
}) {
  const card = await runCard({
    learnerId, learnerName, dataDir, stateDir, clock, rng,
  });
  if (!card.offers.length) {
    return {
      ok: false, mode: 'flow', learnerId, card, scan: null, errors: ['agenda has no offers — nothing to scan'],
    };
  }
  const offer = subject ? card.offers.find((o) => o.subject === subject) : card.offers[0];
  if (!offer) {
    return {
      ok: false, mode: 'flow', learnerId, card, scan: null, errors: [`no agenda offer for subject "${subject}"`],
    };
  }
  if (!offer.token) {
    return {
      ok: false,
      mode: 'flow',
      learnerId,
      card,
      scan: null,
      errors: [`offer for subject "${offer.subject}" has no scannable token (tokenClass=${offer.tokenClass})`],
    };
  }
  const scan = await runScan({
    code: offer.token, device, dataDir, stateDir, clock, rng,
  });
  return {
    ok: true, mode: 'flow', learnerId, offer, card, scan, errors: [],
  };
}

// ---------------------------------------------------------------------------
// printer-status
// ---------------------------------------------------------------------------

export async function runPrinterStatus({ dataDir, flags = {} }) {
  const { host, port, printPath } = resolvePrinterConfig(dataDir, flags);
  const status = await readPrinterStatus({
    host, port, printPath, skip: false,
  });
  return { ok: status.reachable !== false, mode: 'printer-status', ...status };
}

// ---------------------------------------------------------------------------
// proof — the old school.mjs sim lifecycle, generalized
// ---------------------------------------------------------------------------

class MemorySessions {
  logs = new Map();

  async appendEvent(sessionId, event) {
    const events = this.logs.get(sessionId) ?? [];
    const stored = { ...event, sessionId, seq: events.length + 1 };
    events.push(stored); this.logs.set(sessionId, events); return stored;
  }

  async readEvents(sessionId) { return [...(this.logs.get(sessionId) ?? [])]; }

  async listForLearner(learnerId) {
    return [...this.logs.entries()].map(([sessionId, events]) => {
      const state = reduceSession(events);
      return {
        sessionId, learnerId: state.learnerId, unitId: state.unitId, state: state.state, terminal: state.terminal, outcome: state.outcome, updatedAt: events.at(-1)?.at ?? null,
      };
    }).filter((row) => row.learnerId === learnerId);
  }
}

class MemoryTokens {
  records = new Map();

  async put(record) { this.records.set(record.token, record); return record; }

  async get(token) { return this.records.get(token) ?? null; }

  async revoke(token, { at } = {}) {
    const record = this.records.get(token);
    if (record) this.records.set(token, { ...record, revokedAt: at ?? null });
    return record ?? null;
  }
}

class MemoryWorksheetInstances {
  records = new Map();

  async findBySession(sessionId) {
    return [...this.records.values()].find((record) => record.sessionId === sessionId) ?? null;
  }

  async put(record) { this.records.set(record.id, structuredClone(record)); return record; }
}

class MemoryAttempts {
  records = [];

  async appendAttempt(learnerId, attempt) { this.records.push({ ...attempt, learnerId }); return attempt; }

  readAllAttempts(learnerId) { return this.records.filter((record) => record.learnerId === learnerId); }

  readAttemptsInRange(learnerId) { return this.readAllAttempts(learnerId); }
}

/**
 * The full in-memory lifecycle proof (spec: keep the existing proof working
 * as a preset, generalized to arguments). Mirrors `school.mjs sim`
 * step for step — agenda -> scan the agenda QR -> issue -> simulate an OMR
 * scan (perfect or deliberately half-wrong per `--outcome`) -> record ->
 * close -> rescan the result QR -> verify the next worksheet reused the SAME
 * answer sheet at its next free row — just reading `learnerId`/`courseId`/
 * `subject` off the call instead of a hardcoded course-root file walk. This
 * module never constructs a printer adapter for this command.
 */
export async function runProof({
  learnerId, learnerName, courseId, subject = null, outcome = 'pass', dataDir, outDir,
  clock = () => new Date('2026-08-13T06:00:00.000Z'),
}) {
  if (!['pass', 'fail'].includes(outcome)) throw new Error('--outcome must be pass or fail');
  const readConfig = buildReadConfigService(dataDir);
  const catalog = new YamlCurriculumDatastore({ configService: readConfig });
  const school = new YamlSchoolDatastore({ configService: readConfig });
  const assignments = new YamlAssignmentStore({ configService: readConfig });
  const curriculum = new CurriculumAccess({
    catalog, bankIds: () => school.listBankIds(), clock: () => clock().getTime(), logger: silentLogger,
  });

  const sessions = new MemorySessions();
  const tokens = new MemoryTokens();
  let sessionSeq = 0;
  let tokenDraw = 0;
  const rng = () => ((++tokenDraw * 0.61803398875) % 1);
  const newSessionId = () => `sim-${++sessionSeq}`;

  const agendaBuilder = new BuildAgenda({
    curriculum, assignments, sessions, tokens, rng, newSessionId, clock, logger: silentLogger,
  });
  const agenda = await agendaBuilder.execute({ learnerId, learnerName: learnerName ?? titleCase(learnerId) });

  const units = await curriculum.listUnits();
  const unitsById = new Map(units.map((u) => [u.unitId, u]));
  const offer = agenda.offers.find((o) => {
    if (subject && o.subject !== subject) return false;
    const unit = unitsById.get(o.unitId);
    return unit?.courseId === courseId;
  });
  if (!offer) {
    throw new Error(`no agenda offer matched learnerId=${learnerId} courseId=${courseId} subject=${subject ?? '*'} — check the assignment is active and the course has published units`);
  }
  if (!offer.token) throw new Error(`agenda offer for subject "${offer.subject}" has no scannable token (tokenClass=${offer.tokenClass})`);

  const printDocumentsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-barcode-scan-sim-proof-'));
  try {
    const repository = new YamlPrintDocumentRepository({ directory: printDocumentsRoot });
    const allocationStore = new YamlAllocationStore({ directory: printDocumentsRoot });
    const worksheetInstances = new MemoryWorksheetInstances();
    const renderPrintDocument = new RenderPrintDocument({
      rendering: createPrintDocumentRendering(), repository, allocationStore,
    });
    let worksheetPdf = null;
    const issueDocument = new IssueDocument({
      curriculum,
      sessions,
      tokens,
      renderer: { async render() { throw new Error('legacy renderer should not run for a bank-only proof lesson'); } },
      printer: { async printPdf(bytes) { worksheetPdf = bytes; return { printed: true }; } },
      formMaps: { async put() {} },
      bankReader: { getBank: (id) => school.readBankRaw(id) },
      printDocuments: repository,
      renderPrintDocument,
      allocationStore,
      assignments,
      worksheetInstances,
      clock,
      rng,
      logger: silentLogger,
    });
    const subjectResolver = new ResolveSubjectNext({
      curriculum, assignments, sessions, clock, newSessionId, logger: silentLogger,
    });
    const scanRouter = new ResolveScanAction({
      tokens,
      sessions,
      curriculum,
      issueDocument,
      resolveSubjectNext: subjectResolver,
      resolvePersonalCard: { async execute() { throw new Error('personal-card path should not run'); } },
      dispatchMedia: { async execute() { throw new Error('media path should not run'); } },
      openRemediation: new OpenRemediation({
        curriculum, sessions, clock, newSessionId, logger: silentLogger,
      }),
      receipts: { async print() { return { printed: false }; } },
      clock,
      logger: silentLogger,
    });

    const scanIssue = await scanRouter.execute({ code: offer.token, device: 'proof-agenda-scanner' });
    if (scanIssue.status !== 'issued' || scanIssue.physical !== 'worksheet' || !worksheetPdf) {
      throw new Error(`agenda QR did not issue the worksheet: ${JSON.stringify(scanIssue)}`);
    }
    const instance = await worksheetInstances.findBySession(offer.sessionId);
    if (!instance) throw new Error('no worksheet instance was recorded for the issuing session');

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'worksheet.pdf'), worksheetPdf);

    const answers = {};
    instance.questions.forEach((question, index) => {
      const shouldMiss = outcome === 'fail' && index >= Math.floor(instance.questions.length / 2);
      const letters = question.options.filter((option) => (shouldMiss ? !option.correct : option.correct)).map((option) => option.letter);
      if (shouldMiss) letters.splice(1);
      answers[instance.omr.rowRange.start + index] = question.type === 'multi_select' ? letters : letters[0];
    });
    const grade = await new ResolveCardScan({ allocationStore, repository }).execute({ testId: instance.omr.cardId, answers });
    const card = grade.results[0];
    const expectedCorrect = outcome === 'pass' ? card?.totalPoints : Math.floor(card?.totalPoints / 2);
    if (!card || card.earnedPoints !== expectedCorrect) throw new Error(`simulated OMR grade did not produce ${expectedCorrect} correct`);

    const attempts = new MemoryAttempts();
    const recorded = await new RecordCardScanOutcome({
      datastore: attempts, sessions, clock, logger: silentLogger,
    }).execute({ testId: instance.omr.cardId, card });
    if (recorded.session?.advancedTo !== 'graded') throw new Error('paper grade did not advance session to graded');

    let printedResultDocument = null;
    const closed = await new CloseSessionOutcome({
      curriculum,
      sessions,
      tokens,
      assignments,
      worksheetInstances,
      grownUps: { assert() {} },
      receipts: { async print(document) { printedResultDocument = document; return { printed: true }; } },
      clock,
      rng,
      logger: silentLogger,
    }).execute({ sessionId: instance.sessionId });

    const passed = outcome === 'pass';
    const continuationToken = passed ? closed.nextSubjectToken : closed.retryToken;
    if (passed && (closed.result !== 'passed' || !continuationToken)) {
      throw new Error(`passed grade did not mint the next-lesson QR: ${JSON.stringify(closed)}`);
    }
    if (!passed && (closed.result !== 'needs_remediation' || !continuationToken)) {
      throw new Error(`failed grade did not mint a retry QR: ${JSON.stringify(closed)}`);
    }

    worksheetPdf = null;
    const nextScanIssue = await scanRouter.execute({ code: continuationToken, device: 'proof-result-receipt-scanner' });
    if (nextScanIssue.status !== 'issued' || nextScanIssue.physical !== 'worksheet' || !worksheetPdf) {
      throw new Error(`result QR did not issue the next worksheet: ${JSON.stringify(nextScanIssue)}`);
    }
    const nextInstance = await worksheetInstances.findBySession(nextScanIssue.sessionId);
    if (!nextInstance) throw new Error('no worksheet instance was recorded for the continuation session');
    const sameAnswerSheetReused = nextInstance.omr.cardId === instance.omr.cardId
      && nextInstance.omr.rowRange.start === instance.omr.rowRange.end + 1;

    const continuationName = passed ? 'next-worksheet' : 'retry-worksheet';
    fs.writeFileSync(path.join(outDir, `${continuationName}.pdf`), worksheetPdf);

    return {
      ok: true,
      mode: 'proof',
      learnerId,
      courseId,
      subject: offer.subject,
      outcome,
      worksheetInstanceId: instance.id,
      cardId: instance.omr.cardId,
      score: `${card.earnedPoints}/${card.totalPoints}`,
      result: closed.result,
      continuation: { kind: passed ? 'next_lesson' : 'retry', status: nextScanIssue.status, sameAnswerSheetReused },
      out: outDir,
      errors: [],
    };
  } finally {
    fs.rmSync(printDocumentsRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// dispatcher
// ---------------------------------------------------------------------------

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
