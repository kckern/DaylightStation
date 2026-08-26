#!/usr/bin/env node
/**
 * Agenda tools — get the picture the thermal printer printed.
 *
 *   school agenda list [learner]        what agendas were printed, newest first
 *   school agenda show <artifact>       the captured document, as YAML
 *   school agenda render --from <artifact> [--out FILE]   re-render a captured page
 *   school agenda render <learner> [--out FILE]           render TODAY, live
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A child taps their card, `ResolvePersonalCard` builds an agenda, rasterises
 * it, prints it, and — until 2026-08-25 — deleted the PNG. The only trace of a
 * page a child was holding was one log line saying a page had existed. So the
 * first question anyone asks about a layout bug ("show me the page") had no
 * answer short of standing at the printer with a camera, and by the time anyone
 * asked, the state that produced the page had moved on.
 *
 * Printed agendas are now archived to the issued-artifact store as
 * `agenda/<learner>/<issuedAt>` — a YAML manifest carrying the renderer's INPUT
 * document, beside the exact PNG bytes.
 *
 * `--from` is the point of the whole thing: it re-renders a captured document
 * through TODAY'S renderer. Change a layout, re-render the page that actually
 * went wrong, look at it. That is a real fix verified against real content,
 * rather than a guess checked against invented test data.
 *
 * A renderer you have since changed will NOT reproduce the original pixels, and
 * that is the intended behaviour, not a defect — the guarantee here is that the
 * DATA and STATE as of the printout survive faithfully. When you want the
 * original pixels instead, they are the `.png` sitting next to the manifest.
 *
 * This reads the household data tree directly, the same way `school omr` does.
 * No server and no teacher PIN: it is a debugging aid, and one that stops
 * working when the backend is down is useless exactly when it is needed.
 *
 * @module cli/school/agenda
 */

import dotenv from 'dotenv';
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

const HELP = `school agenda — the page the thermal printer printed

Usage:
  school agenda list [learner] [--limit N]
  school agenda show <artifact> [--field document|manifest]
  school agenda render --from <artifact> [--out FILE]
  school agenda render <learner> [--out FILE] [--base-url URL]

  --from        re-render a CAPTURED page through today's renderer — the loop
                for fixing a layout against the page that actually went wrong
  --out         where to write the PNG (default derived from the artifact)
  --original    with --from, copy the archived bytes instead of re-rendering

Artifacts are captured on every printed agenda as agenda/<learner>/<issuedAt>.
Re-rendering through a CHANGED renderer will not reproduce the original pixels;
that is intended. For the original pixels use --original.
`;

const opt = (argv, name, fallback = undefined) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const positional = (argv) => {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { if (argv[i + 1] && !argv[i + 1].startsWith('--')) i++; continue; }
    out.push(argv[i]);
  }
  return out;
};

function dataDir(argv) {
  const i = argv.indexOf('--data-dir');
  if (i !== -1) return path.resolve(argv[i + 1]);
  return process.env.DAYLIGHT_BASE_PATH ? join(process.env.DAYLIGHT_BASE_PATH, 'data') : null;
}

// Mirrors YamlIssuedArtifactStore: one flat directory, the id percent-encoded
// into the filename, `<stem>.yml` for the manifest and `<stem>.<ext>` beside it.
const issuedRoot = (dir) => join(dir, 'household', 'school', 'artifacts', 'issued');
const stem = (artifactId) => encodeURIComponent(artifactId);

function readManifest(dir, artifactId) {
  const file = join(issuedRoot(dir), `${stem(artifactId)}.yml`);
  if (!existsSync(file)) return null;
  return yaml.load(readFileSync(file, 'utf8'));
}

function listAgendaArtifacts(dir, learner = null) {
  const root = issuedRoot(dir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => decodeURIComponent(f.slice(0, -4)))
    .filter((id) => id.startsWith('agenda/'))
    .filter((id) => !learner || id.startsWith(`agenda/${learner}/`))
    // The id ends in an ISO timestamp, so lexical order IS chronological —
    // which is the whole reason the convention puts it last.
    .sort()
    .reverse();
}

function requireDataDir(argv) {
  const dir = dataDir(argv);
  if (!dir) {
    process.stderr.write('ERROR: pass --data-dir or set DAYLIGHT_BASE_PATH in .env\n');
    return null;
  }
  return dir;
}

// --- commands --------------------------------------------------------------

async function list(argv) {
  const dir = requireDataDir(argv);
  if (!dir) return 1;
  const [learner] = positional(argv);
  const limit = Number(opt(argv, '--limit', '20'));
  const ids = listAgendaArtifacts(dir, learner);

  if (!ids.length) {
    process.stdout.write(learner
      ? `No captured agendas for ${learner}.\n`
      : 'No captured agendas.\n');
    // Worth saying plainly: capture began 2026-08-25, so an empty list for an
    // older date means nothing was ever kept, not that nothing was printed.
    process.stdout.write('(Agenda capture began 2026-08-25; nothing printed before that was retained.)\n');
    return 0;
  }
  for (const id of ids.slice(0, limit)) {
    const m = readManifest(dir, id);
    const rep = m?.representation ?? {};
    process.stdout.write(`${id}  ${rep.width ?? '?'}x${rep.height ?? '?'}  ${m?.byteLength ?? '?'}B\n`);
  }
  if (ids.length > limit) process.stdout.write(`… ${ids.length - limit} more\n`);
  return 0;
}

async function show(argv) {
  const dir = requireDataDir(argv);
  if (!dir) return 1;
  const [artifactId] = positional(argv);
  if (!artifactId) { process.stderr.write('ERROR: show requires an artifact id\n'); return 2; }
  const manifest = readManifest(dir, artifactId);
  if (!manifest) { process.stderr.write(`ERROR: no artifact ${artifactId}\n`); return 1; }

  const field = opt(argv, '--field', 'document');
  const body = field === 'manifest' ? manifest : manifest.sourceDocument;
  if (!body) {
    process.stderr.write(`ERROR: artifact ${artifactId} has no sourceDocument (captured before v3?)\n`);
    return 1;
  }
  process.stdout.write(yaml.dump(body, { lineWidth: -1, noRefs: true }));
  return 0;
}

async function render(argv) {
  const dir = requireDataDir(argv);
  if (!dir) return 1;
  const from = opt(argv, '--from');

  if (!from) return renderLive(argv);

  const manifest = readManifest(dir, from);
  if (!manifest) { process.stderr.write(`ERROR: no artifact ${from}\n`); return 1; }
  const out = path.resolve(opt(argv, '--out', `${from.replace(/\//g, '_')}.png`));

  if (argv.includes('--original')) {
    const ext = manifest.representation?.extension ?? 'png';
    const bytes = readFileSync(join(issuedRoot(dir), `${stem(from)}.${ext}`));
    writeFileSync(out, bytes);
    process.stdout.write(`${JSON.stringify({
      schema: 'school.agenda-render/v1', from, mode: 'original-bytes', file: out, bytes: bytes.length,
    }, null, 2)}\n`);
    return 0;
  }

  const document = manifest.sourceDocument;
  if (!document) { process.stderr.write(`ERROR: ${from} has no sourceDocument to re-render\n`); return 1; }

  // The same renderer the thermal path uses. Imported rather than reimplemented
  // so this cannot drift into rendering something the printer never would.
  const { createDocumentReceiptRenderer } = await import('#rendering/school/documents/DocumentReceiptRenderer.mjs');
  const renderer = createDocumentReceiptRenderer({ scanCodes: 'qr' });
  const { canvas, width, height } = await renderer.createCanvas(document, { tokens: {} });
  const bytes = canvas.toBuffer('image/png');
  writeFileSync(out, bytes);

  process.stdout.write(`${JSON.stringify({
    schema: 'school.agenda-render/v1',
    from,
    mode: 're-rendered',
    issuedAt: manifest.issuedAt ?? null,
    learnerId: manifest.learnerId ?? null,
    file: out,
    bytes: bytes.length,
    width, height,
    // Say it every time. A re-render quietly mistaken for the original is how a
    // layout gets "fixed" against the wrong picture.
    note: 'Re-rendered through the CURRENT renderer. Pixels differ from the original if the layout changed since; use --original for the archived bytes.',
    originalBytes: manifest.byteLength ?? null,
  }, null, 2)}\n`);
  return 0;
}

const DEFAULT_BASE = process.env.SCHOOL_BASE_URL || 'http://localhost:3111/api/v1/school';

async function renderLive(argv, { fetchImpl = fetch } = {}) {
  const [learnerId] = positional(argv);
  if (!learnerId) {
    process.stderr.write('ERROR: render requires a learner id, or --from <artifact>\n');
    return 2;
  }
  const base = opt(argv, '--base-url', DEFAULT_BASE).replace(/\/+$/, '');
  const out = path.resolve(opt(argv, '--out', `${learnerId}-agenda.png`));
  const url = new URL(`${base}/lifecycle/learners/${encodeURIComponent(learnerId)}/agenda`);
  const studyDay = opt(argv, '--study-day');
  if (studyDay) url.searchParams.set('studyDay', studyDay);

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    process.stderr.write(`ERROR: ${response.status} ${response.statusText} from ${url}\n`);
    if (response.status === 501) process.stderr.write('       agenda rendering is not configured on that host.\n');
    return 1;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(out, bytes);
  process.stdout.write(`${JSON.stringify({
    schema: 'school.agenda-render/v1', learnerId, mode: 'live-preview', file: out, bytes: bytes.length,
    caveats: [
      'dry run: no session opened, no ticket minted — the scan block reads "Preview only", not a real QR',
      'renders CURRENT progress — it cannot reproduce a page printed before something was completed',
    ],
  }, null, 2)}\n`);
  return 0;
}

const SUBCOMMANDS = { list, show, render };

export async function main(argv = process.argv.slice(2)) {
  const [sub, ...rest] = argv;
  if (!sub || sub === '--help' || sub === '-h' || sub === 'help') {
    process.stdout.write(HELP);
    return sub ? 0 : 2;
  }
  const fn = SUBCOMMANDS[sub];
  if (!fn) { process.stderr.write(`Unknown agenda command: ${sub}\n\n${HELP}`); return 2; }
  return fn(rest);
}

export { listAgendaArtifacts, stem };

const ENTRYPOINT = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main().then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exit(1);
  });
}
