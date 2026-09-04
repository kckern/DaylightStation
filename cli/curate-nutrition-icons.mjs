#!/usr/bin/env node
// curate-nutrition-icons.mjs — one-time curation pass that turns the hi-res
// nutrition icon tree into the single icon vocabulary the health app uses
// (PRD F5.1: "one icon vocabulary", manifest-owned filenames, no hardcoded
// asset paths in code).
//
// It emits a DRAFT for human review. The reviewed file is installed into the
// data mount at `data/household/apps/health/icon-manifest.yml`, which is what
// IconManifestStore reads at runtime. Nothing here writes to the data volume,
// and nothing here writes into `media/`.
//
// Two inputs, deliberately:
//
//   media/img/nutrition/icons/**   the hi-res set, ~29 themed subdirectories.
//                                  Becomes the PRIMARY vocabulary: the slugs
//                                  offered to the parse agent and to the
//                                  icon picker.
//   media/img/icons/food/*.png     nutribot's original flat set. Its basenames
//                                  are ALREADY STORED on rows as
//                                  `FoodItem.icon`, so every one of them must
//                                  keep resolving forever. Those that the
//                                  hi-res set does not already provide become
//                                  ALIASES — resolvable, but not offered.
//
// Traps this script encodes, each verified against the real tree on 2026-09-03:
//
//   * `foo (Case Conflict)` / `foo (Case Conflict 1)` are DIRECTORIES, not
//     files — Dropbox's resolution of a case collision. Every file inside one
//     also exists in its properly-named twin (checked exhaustively), so they
//     are skipped wholesale by directory name. Do not spend time reconciling
//     them.
//   * `contact-sheet.jpg` appears once per themed directory. It is a grid
//     PREVIEW of that directory, not a food icon, and would otherwise win a
//     `contact-sheet` slug that means nothing.
//   * `.DS_Store` is everywhere.
//
// Slug collisions across subdirectories are EXPECTED (`red-onion` is in both
// `mexican` and `vegetables`). The shallower path wins; ties break on the
// lexicographically smaller relative path, so the result is deterministic
// regardless of readdir order. Every loser is reported.
//
// Usage:
//   node cli/curate-nutrition-icons.mjs                      # draft to docs/_wip/
//   node cli/curate-nutrition-icons.mjs --out /tmp/draft.yml
//   node cli/curate-nutrition-icons.mjs --media-root /path/to/media

import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** The shape a manifest key may take — the SAME allowlist the serving route
 *  applies to a URL segment. A file whose basename cannot produce one of
 *  these could never be requested, so it is dropped with a reason. */
export const ICON_SLUG_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const SKIP_BASENAMES = new Set(['.ds_store', 'contact-sheet.jpg', 'thumbs.db']);
const isCaseConflictDir = (name) => name.includes('(Case Conflict');

/** basename -> slug. Lowercase, non-alphanumerics collapse to a single dash. */
export function slugify(basename) {
  return basename
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Recursively collect image files, skipping the Dropbox conflict directories. */
export function collectIconFiles(rootDir) {
  const found = [];
  const walk = (dir, relative) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = relative ? `${relative}/${name}` : name;
      if (statSync(full).isDirectory()) {
        if (isCaseConflictDir(name)) continue;
        walk(full, rel);
        continue;
      }
      if (SKIP_BASENAMES.has(name.toLowerCase())) continue;
      if (!IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
      found.push(rel);
    }
  };
  walk(rootDir, '');
  return found;
}

/**
 * Build the manifest from the two icon trees.
 *
 * @param {object} io - injected filesystem reads, so this is exercisable without a disk
 * @returns {{ icons: object, aliases: object, report: object }}
 */
export function buildManifest({ hiResFiles, flatFiles, hiResPrefix, flatPrefix }) {
  const icons = {};
  const owners = {};              // slug -> winning relative path (inside hiResPrefix)
  const collisions = [];
  const rejected = [];

  for (const rel of hiResFiles) {
    const slug = slugify(path.basename(rel));
    if (!ICON_SLUG_PATTERN.test(slug)) {
      rejected.push({ path: rel, reason: `basename yields no usable slug (${JSON.stringify(slug)})` });
      continue;
    }
    const incumbent = owners[slug];
    if (!incumbent) { owners[slug] = rel; continue; }
    // Shallower wins; a tie breaks on the lexicographically smaller path so
    // the outcome does not depend on directory-read order.
    const depth = (p) => p.split('/').length;
    const challengerWins = depth(rel) < depth(incumbent)
      || (depth(rel) === depth(incumbent) && rel < incumbent);
    collisions.push({ slug, kept: challengerWins ? rel : incumbent, dropped: challengerWins ? incumbent : rel });
    owners[slug] = challengerWins ? rel : incumbent;
  }

  for (const slug of Object.keys(owners).sort()) {
    icons[slug] = { path: `${hiResPrefix}/${owners[slug]}` };
  }

  // ── Aliases ────────────────────────────────────────────────────────────
  // Every basename in the flat set is a slug ALREADY WRITTEN to rows. Losing
  // one breaks a stored `FoodItem.icon` silently (the row renders its
  // fallback glyph and nothing logs), so each is preserved: pointed at the
  // hi-res counterpart where one exists (underscores in the old names
  // correspond to dashes in the new), else at the original flat file.
  const aliases = {};
  const aliasReport = { toHiRes: 0, toFlatFile: 0, alreadyPrimary: 0, rejected: 0 };
  for (const file of flatFiles) {
    const legacySlug = file.replace(/\.[a-z0-9]+$/i, '');
    if (!ICON_SLUG_PATTERN.test(legacySlug)) {
      rejected.push({ path: `${flatPrefix}/${file}`, reason: 'legacy basename is not a requestable slug' });
      aliasReport.rejected += 1;
      continue;
    }
    if (icons[legacySlug]) { aliasReport.alreadyPrimary += 1; continue; }
    const hyphenated = legacySlug.replace(/_/g, '-');
    if (icons[hyphenated]) {
      aliases[legacySlug] = { path: icons[hyphenated].path, note: `hi-res counterpart of ${hyphenated}` };
      aliasReport.toHiRes += 1;
    } else {
      aliases[legacySlug] = { path: `${flatPrefix}/${file}` };
      aliasReport.toFlatFile += 1;
    }
  }

  const sortedAliases = {};
  for (const slug of Object.keys(aliases).sort()) sortedAliases[slug] = aliases[slug];

  return {
    icons,
    aliases: sortedAliases,
    report: {
      hiResScanned: hiResFiles.length,
      iconCount: Object.keys(icons).length,
      collisions,
      rejected,
      flatScanned: flatFiles.length,
      aliasCount: Object.keys(sortedAliases).length,
      aliasReport,
    },
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────

function resolveMediaRoot(explicit) {
  if (explicit) return explicit;
  const base = process.env.DAYLIGHT_BASE_PATH || (() => {
    const envFile = path.join(REPO_ROOT, '.env');
    if (!existsSync(envFile)) return null;
    const m = readFileSync(envFile, 'utf8').match(/^DAYLIGHT_BASE_PATH=(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  })();
  if (!base) throw new Error('No media root: pass --media-root, or set DAYLIGHT_BASE_PATH (env or repo .env)');
  return path.join(base, 'media');
}

function main(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
  };
  const mediaRoot = resolveMediaRoot(arg('--media-root', null));
  const outPath = path.resolve(arg('--out', path.join(REPO_ROOT, 'docs/_wip/2026-09-03-icon-manifest-draft.yml')));

  const hiResPrefix = 'img/nutrition/icons';
  const flatPrefix = 'img/icons/food';
  const hiResDir = path.join(mediaRoot, hiResPrefix);
  const flatDir = path.join(mediaRoot, flatPrefix);
  if (!existsSync(hiResDir)) throw new Error(`Hi-res icon tree not found: ${hiResDir}`);

  const hiResFiles = collectIconFiles(hiResDir);
  const flatFiles = existsSync(flatDir)
    ? readdirSync(flatDir).sort().filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
    : [];

  const { icons, aliases, report } = buildManifest({ hiResFiles, flatFiles, hiResPrefix, flatPrefix });

  const header = [
    '# Food icon manifest — the SINGLE icon vocabulary for the health app.',
    '#',
    '# Drafted by cli/curate-nutrition-icons.mjs; reviewed by hand; installed at',
    '# data/household/apps/health/icon-manifest.yml. Paths are relative to the',
    '# MEDIA root (ConfigService.getMediaDir()), never to the repo.',
    '#',
    '# `icons` is the offered vocabulary: the parse agent chooses from these and',
    '# the picker lists them. `aliases` are legacy nutribot slugs already stored',
    '# on rows — they still resolve, but are never offered. Renames happen HERE,',
    '# by editing a path, never by moving files and hoping the code follows.',
    `#`,
    `# ${report.iconCount} icons, ${report.aliasCount} aliases.`,
    '',
  ].join('\n');
  const body = yaml.dump({ icons, aliases }, { lineWidth: 200, sortKeys: false });
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, header + body);

  process.stdout.write([
    `hi-res files scanned : ${report.hiResScanned}`,
    `primary icons        : ${report.iconCount}`,
    `slug collisions      : ${report.collisions.length}`,
    ...report.collisions.map((c) => `    ${c.slug}: kept ${c.kept} — dropped ${c.dropped}`),
    `flat legacy files    : ${report.flatScanned}`,
    `aliases              : ${report.aliasCount}`,
    `    already primary  : ${report.aliasReport.alreadyPrimary}`,
    `    -> hi-res icon   : ${report.aliasReport.toHiRes}`,
    `    -> legacy file   : ${report.aliasReport.toFlatFile}`,
    `rejected             : ${report.rejected.length}`,
    ...report.rejected.map((r) => `    ${r.path}: ${r.reason}`),
    `draft written        : ${outPath}`,
    '',
  ].join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
