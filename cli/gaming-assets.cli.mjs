#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildInventory,
  buildOrganizationPlan,
  applyOrganizationPlan,
  verifyOrganizationPlan,
  auditTerrainMetadataSweep,
  parseFrames,
  parsePair,
  renderAnimation,
  renderContactSheet,
  renderFrameGrid,
  measureFrameGrid,
  renderLayout,
  renderScene,
  renderLegacyScene,
  renderSceneQa,
  renderSceneQaSet,
  approveSceneQaBaseline,
  renderTerrainTopologyQa,
  renderTerrainTopologyQaSet,
  renderConnectorQa,
  renderConnectorQaSet,
  renderHeightQa,
  renderHeightQaSet,
  renderComponentQa,
  explainPrefab,
  renderPrefabPreview,
  deriveAtlas,
  deriveBlobAutotile,
  deriveBlobAutotileSet,
  deriveBlobAutotileCatalog,
  deriveFenceConnectorCatalog,
  validateManifest,
  writeYaml,
  migratePresentationCatalog,
} from './gaming-assets/lib.mjs';

const HELP = `gaming-assets — audit and preview private game-art catalogs

Usage:
  node cli/gaming-assets.cli.mjs <command> [options]

Commands:
  inventory  --root <common-dir> --out <inventory.yml> [--source sprites] [--reports-dir <dir>]
  organize-plan  --root <common-dir> --out <plan.yml> [--source sprites] [--target assets]
  organize-apply --root <common-dir> --plan <plan.yml>
  organize-verify --root <common-dir> --plan <plan.yml>
  terrain-sweep --root <common-dir> --manifest <sweep.yml>
  validate   --root <common-dir> --manifest <pack.yml>
  sheet      --root <common-dir> --out <sheet.png> [--source sprites] [--catalog <pack.yml>] [--columns 6] [--limit 60] [--scale 3]
  frames     --root <common-dir> --source <relative.png> --cell 16x16 --out <grid.png> [--scale 4]
  measure    --root <common-dir> --source <relative.png> --cell 16x16
  animate    --root <common-dir> --source <relative.png> --cell 16x16 --frames 0,0;1,0 --out <clip.gif> [--fps 8] [--scale 4]
  render     --root <common-dir> --manifest <layout.yml> --out <layout.png>
  scene      --root <common-dir> --catalog <pack.yml> --manifest <scene.yml> --out <scene.png>
  scene-legacy --root <common-dir> --catalog <v1-pack.yml> --manifest <v1-scene.yml> --out <scene.png>
  scene-qa   --root <common-dir> --catalog <pack.yml> --manifest <scene.yml> --out-dir <directory>
  scene-qa-set --root <common-dir> --manifest <set.yml> --out-dir <directory> [--candidate true]
  scene-qa-approve --root <common-dir> --manifest <set.yml> --report <report.yml> --artifacts-dir <directory>
  topology-qa --root <common-dir> --catalog <pack.yml> --asset <asset-id> --out <matrix.png> [--scale 4]
  topology-qa-set --root <common-dir> --catalog <pack.yml> --out-dir <directory> [--scale 4]
  connector-qa --root <common-dir> --catalog <pack.yml> --asset <asset-id> --out <matrix.png> [--scale 3]
  connector-qa-set --root <common-dir> --catalog <pack.yml> --out-dir <directory> [--scale 3]
  height-qa --root <common-dir> --catalog <pack.yml> --asset <asset-id> --out <matrix.png> [--scale 4]
  height-qa-set --root <common-dir> --catalog <pack.yml> --out-dir <directory> [--scale 4]
  component-qa --root <common-dir> --catalog <pack.yml> --asset <asset-id> --out <matrix.png> [--scale 3]
  prefab-explain --root <common-dir> --catalog <pack.yml> --id <prefab> [--params size=large,garden=false]
  prefab-render --root <common-dir> --catalog <pack.yml> --id <prefab> --out <png> [--params size=large] [--viewport 320x240] [--scale 1]
  derive     --root <common-dir> --recipe <recipe.yml> --out <atlas.png>
  derive-blob --root <common-dir> --recipe <recipe.yml> --out <atlas.png>
  derive-blob-set --root <common-dir> --manifest <derivations.yml>
  derive-blob-catalog --root <common-dir> --manifest <derivations.yml> --catalog-out <catalog.yml>
  derive-fence-catalog --root <common-dir> --manifest <derivations.yml> --catalog-out <catalog.yml>
  migrate-v2 --root <common-dir> --catalog <v1-pack.yml> --scenes <v1-scenes-dir> --out-dir <v2-directory>

All source paths are relative to --root. The commands never alter raw source images.
Set DAYLIGHT_BASE_PATH to omit --root; it defaults to $DAYLIGHT_BASE_PATH/media/games/_common.
`;

function parse(argv) {
  const [command, ...rest] = argv;
  if (command === '--help' || command === '-h') return { command: null, flags: {}, help: true };
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--help' || token === '-h') return { command, flags, help: true };
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[++index];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    flags[key] = value;
  }
  return { command, flags, help: false };
}

function rootFor(flags, env) {
  const value = flags.root ?? (env.DAYLIGHT_BASE_PATH && path.join(env.DAYLIGHT_BASE_PATH, 'media', 'games', '_common'));
  if (!value) throw new Error('--root is required when DAYLIGHT_BASE_PATH is not set');
  return path.resolve(value);
}

function required(flags, name) {
  if (!flags[name]) throw new Error(`--${name} is required`);
  return flags[name];
}

function integer(flags, name, fallback) {
  const value = flags[name] === undefined ? fallback : Number(flags[name]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
}

function boolean(flags, name, fallback = false) {
  if (flags[name] === undefined) return fallback;
  if (!['true', 'false'].includes(flags[name])) throw new Error(`--${name} must be true or false`);
  return flags[name] === 'true';
}

function params(value) {
  if (!value) return {};
  return Object.fromEntries(String(value).split(',').map((part) => {
    const [name, raw] = part.split('=');
    if (!name || raw === undefined) throw new Error('--params must use name=value,name=value');
    const parsed = raw === 'true' ? true : raw === 'false' ? false : raw;
    return [name, parsed];
  }));
}

export async function main(argv = process.argv.slice(2), { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  let parsed;
  try { parsed = parse(argv); } catch (error) { stderr.write(`ERROR: ${error.message}\n`); stdout.write(HELP); return 2; }
  if (parsed.help || !parsed.command) { stdout.write(HELP); return parsed.help ? 0 : 2; }
  try {
    const root = rootFor(parsed.flags, env);
    let report;
    switch (parsed.command) {
      case 'inventory': {
        report = await buildInventory({ root, sourceDir: parsed.flags.source ?? 'sprites' });
        await writeYaml(required(parsed.flags, 'out'), report);
        const reports = {};
        if (parsed.flags['reports-dir']) {
          const reportsDir = path.resolve(parsed.flags['reports-dir']);
          reports.duplicates = path.join(reportsDir, 'duplicates.yml');
          reports.issues = path.join(reportsDir, 'issues.yml');
          reports.non_images = path.join(reportsDir, 'non-images.yml');
          await Promise.all([
            writeYaml(reports.duplicates, { schema_version: report.schema_version, duplicates: report.duplicates }),
            writeYaml(reports.issues, { schema_version: report.schema_version, issues: report.issues }),
            writeYaml(reports.non_images, { schema_version: report.schema_version, files: report.non_images }),
          ]);
        }
        report = { out: required(parsed.flags, 'out'), reports, ...report.summary };
        break;
      }
      case 'organize-plan': {
        const plan = await buildOrganizationPlan({ root, sourceDir: parsed.flags.source ?? 'sprites', targetDir: parsed.flags.target ?? 'assets' });
        await writeYaml(required(parsed.flags, 'out'), plan);
        report = { out: required(parsed.flags, 'out'), ...plan.summary, source_dir: plan.source_dir, target_dir: plan.target_dir };
        break;
      }
      case 'organize-apply': {
        report = await applyOrganizationPlan({ root, planPath: required(parsed.flags, 'plan') });
        break;
      }
      case 'organize-verify': {
        report = await verifyOrganizationPlan({ root, planPath: required(parsed.flags, 'plan') });
        break;
      }
      case 'terrain-sweep':
        report = await auditTerrainMetadataSweep({ root, manifestPath: required(parsed.flags, 'manifest') });
        break;
      case 'validate':
        report = await validateManifest({ root, manifestPath: required(parsed.flags, 'manifest') });
        break;
      case 'sheet':
        report = await renderContactSheet({
          root, sourceDir: parsed.flags.source ?? 'sprites', out: required(parsed.flags, 'out'),
          columns: integer(parsed.flags, 'columns', 6), limit: integer(parsed.flags, 'limit', Number.MAX_SAFE_INTEGER), scale: integer(parsed.flags, 'scale', 3),
          catalogPath: parsed.flags.catalog ?? null,
        });
        break;
      case 'frames':
        report = await renderFrameGrid({
          root, source: required(parsed.flags, 'source'), cell: parsePair(required(parsed.flags, 'cell'), '--cell'),
          out: required(parsed.flags, 'out'), scale: integer(parsed.flags, 'scale', 4),
        });
        break;
      case 'measure':
        report = await measureFrameGrid({
          root, source: required(parsed.flags, 'source'), cell: parsePair(required(parsed.flags, 'cell'), '--cell'),
        });
        break;
      case 'animate':
        report = await renderAnimation({
          root, source: required(parsed.flags, 'source'), cell: parsePair(required(parsed.flags, 'cell'), '--cell'),
          frames: parseFrames(required(parsed.flags, 'frames')), out: required(parsed.flags, 'out'),
          fps: integer(parsed.flags, 'fps', 8), scale: integer(parsed.flags, 'scale', 4),
        });
        break;
      case 'render':
        report = await renderLayout({ root, manifestPath: required(parsed.flags, 'manifest'), out: required(parsed.flags, 'out') });
        break;
      case 'scene':
        report = await renderScene({ root, catalogPath: required(parsed.flags, 'catalog'), manifestPath: required(parsed.flags, 'manifest'), out: required(parsed.flags, 'out') });
        break;
      case 'scene-legacy':
        report = await renderLegacyScene({ root, catalogPath: required(parsed.flags, 'catalog'), manifestPath: required(parsed.flags, 'manifest'), out: required(parsed.flags, 'out') });
        break;
      case 'scene-qa':
        report = await renderSceneQa({ root, catalogPath: required(parsed.flags, 'catalog'), manifestPath: required(parsed.flags, 'manifest'), outDir: required(parsed.flags, 'out-dir') });
        break;
      case 'scene-qa-set':
        report = await renderSceneQaSet({ root, manifestPath: required(parsed.flags, 'manifest'), outDir: required(parsed.flags, 'out-dir'), candidate: boolean(parsed.flags, 'candidate') });
        break;
      case 'scene-qa-approve':
        report = await approveSceneQaBaseline({ manifestPath: required(parsed.flags, 'manifest'), reportPath: required(parsed.flags, 'report'), artifactsDir: required(parsed.flags, 'artifacts-dir') });
        break;
      case 'topology-qa':
        report = await renderTerrainTopologyQa({
          root, catalogPath: required(parsed.flags, 'catalog'), assetId: required(parsed.flags, 'asset'),
          out: required(parsed.flags, 'out'), scale: integer(parsed.flags, 'scale', 4),
        });
        break;
      case 'topology-qa-set':
        report = await renderTerrainTopologyQaSet({
          root, catalogPath: required(parsed.flags, 'catalog'), outDir: required(parsed.flags, 'out-dir'),
          scale: integer(parsed.flags, 'scale', 4),
        });
        break;
      case 'connector-qa':
        report = await renderConnectorQa({ root, catalogPath: required(parsed.flags, 'catalog'), assetId: required(parsed.flags, 'asset'), out: required(parsed.flags, 'out'), scale: integer(parsed.flags, 'scale', 3) });
        break;
      case 'connector-qa-set':
        report = await renderConnectorQaSet({ root, catalogPath: required(parsed.flags, 'catalog'), outDir: required(parsed.flags, 'out-dir'), scale: integer(parsed.flags, 'scale', 3) });
        break;
      case 'height-qa':
        report = await renderHeightQa({ root, catalogPath: required(parsed.flags, 'catalog'), assetId: required(parsed.flags, 'asset'), out: required(parsed.flags, 'out'), scale: integer(parsed.flags, 'scale', 4) });
        break;
      case 'height-qa-set':
        report = await renderHeightQaSet({ root, catalogPath: required(parsed.flags, 'catalog'), outDir: required(parsed.flags, 'out-dir'), scale: integer(parsed.flags, 'scale', 4) });
        break;
      case 'component-qa':
        report = await renderComponentQa({ root, catalogPath: required(parsed.flags, 'catalog'), assetId: required(parsed.flags, 'asset'), out: required(parsed.flags, 'out'), scale: integer(parsed.flags, 'scale', 3) });
        break;
      case 'prefab-explain':
        report = await explainPrefab({ catalogPath: required(parsed.flags, 'catalog'), id: required(parsed.flags, 'id'), params: params(parsed.flags.params) });
        break;
      case 'prefab-render':
        report = await renderPrefabPreview({
          root, catalogPath: required(parsed.flags, 'catalog'), id: required(parsed.flags, 'id'), params: params(parsed.flags.params), out: required(parsed.flags, 'out'),
          viewport: parsePair(parsed.flags.viewport ?? '320x240', '--viewport'), scale: integer(parsed.flags, 'scale', 1), background: parsed.flags.background ?? '#171923',
        });
        break;
      case 'derive':
        report = await deriveAtlas({ root, recipePath: required(parsed.flags, 'recipe'), out: required(parsed.flags, 'out') });
        break;
      case 'derive-blob':
        report = await deriveBlobAutotile({ root, recipePath: required(parsed.flags, 'recipe'), out: required(parsed.flags, 'out') });
        break;
      case 'derive-blob-set':
        report = await deriveBlobAutotileSet({ root, manifestPath: required(parsed.flags, 'manifest') });
        break;
      case 'derive-blob-catalog':
        report = await deriveBlobAutotileCatalog({
          root, manifestPath: required(parsed.flags, 'manifest'), catalogOut: required(parsed.flags, 'catalog-out'),
        });
        break;
      case 'derive-fence-catalog':
        report = await deriveFenceConnectorCatalog({ root, manifestPath: required(parsed.flags, 'manifest'), catalogOut: required(parsed.flags, 'catalog-out') });
        break;
      case 'migrate-v2':
        report = await migratePresentationCatalog({ root, catalogPath: required(parsed.flags, 'catalog'), scenesDir: required(parsed.flags, 'scenes'), outDir: required(parsed.flags, 'out-dir') });
        break;
      default:
        stderr.write(`ERROR: unknown command: ${parsed.command}\n`); stdout.write(HELP); return 2;
    }
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.valid === false ? 1 : 0;
  } catch (error) {
    stderr.write(`ERROR: ${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; });
}
