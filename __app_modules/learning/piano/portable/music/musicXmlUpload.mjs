/**
 * The checks a MusicXML/MXL upload passes before it joins the sheet music
 * library (`files:docs/sheet-music/<folder>/<file>`): what the XML must hold, the
 * filename it is stored under, and the ids it must not collide with. Also the
 * header reader (title, composer) the admin library rows use.
 *
 * Collision matters beyond the filesystem: practice records and Learn files are
 * keyed by `practiceKeyOfScore(id)`, a slug truncated to 120 characters, so two
 * ids with the same slug would share a child's progress.
 *
 * Every check returns a code rather than throwing; the service turns codes into
 * coded errors. Regex-level parsing: this screens uploads, it does not render them.
 *
 * Layer: PORTABLE (no I/O).
 */
import { practiceKeyOfScore } from './practiceKey.mjs';

export const LIBRARY_REF_PREFIX = 'files:docs/sheet-music/';
/** Upload size limits, matching what SheetMusicScoreReader will read back. */
export const MAX_UPLOAD_MXL_BYTES = 16 * 1024 * 1024;
export const MAX_UPLOAD_MUSICXML_BYTES = 32 * 1024 * 1024;
export const PRACTICE_KEY_MAX = 120;
const STEM_MAX = 80;
const FALLBACK_STEM = 'untitled-score';
const FILENAME_RE = /^[a-z0-9][a-z0-9-]*\.(musicxml|mxl)$/;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function tagText(xml, re) {
  const match = re.exec(xml);
  if (!match) return null;
  // CDATA content is literal: pull it out before tags are stripped and entities decoded.
  const parts = match[1].split(/(<!\[CDATA\[[\s\S]*?\]\]>)/);
  const text = parts.map((part) => (part.startsWith('<![CDATA[')
    ? part.slice(9, -3)
    : decodeXml(part.replace(/<[^>]*>/g, '')))).join('').replace(/\s+/g, ' ').trim();
  return text || null;
}

/** Title and composer from the MusicXML header; null where absent. */
export function scoreHeader(xml) {
  const text = String(xml || '');
  return {
    title: tagText(text, /<work-title\b[^>]*>([\s\S]*?)<\/work-title>/i)
      ?? tagText(text, /<movement-title\b[^>]*>([\s\S]*?)<\/movement-title>/i),
    composer: tagText(text, /<creator\b[^>]*\btype\s*=\s*["']composer["'][^>]*>([\s\S]*?)<\/creator>/i),
  };
}

/** True when some `<note>…</note>` has no `<rest`: the score sounds at least once. */
function hasSoundingNote(xml) {
  const re = /<note(?=[\s>])[^>]*>([\s\S]*?)<\/note\s*>/g;
  for (let match = re.exec(xml); match; match = re.exec(xml)) {
    if (!/<rest(?=[\s>/])/.test(match[1])) return true;
  }
  return false;
}

/**
 * Whether the text is a partwise MusicXML score with at least one sounding note.
 * @returns {{ ok: true, title: string|null, composer: string|null } | { ok: false, code: string }}
 */
export function checkUploadXml(xml) {
  const text = String(xml ?? '').replace(/^﻿/, '').trim();
  if (!text.startsWith('<') || !/<[A-Za-z_][\w.:-]*[\s/>]/.test(text)) return { ok: false, code: 'not-xml' };
  if (/<score-timewise(?=[\s>])/.test(text)) return { ok: false, code: 'timewise' };
  if (!/<score-partwise(?=[\s>])/.test(text)) return { ok: false, code: 'not-partwise' };
  if (!hasSoundingNote(text)) return { ok: false, code: 'no-notes' };
  return { ok: true, ...scoreHeader(text) };
}

/** Lower-kebab-case ASCII: diacritics dropped, anything else non-alphanumeric a dash. */
function kebab(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeExt(ext) {
  const bare = String(ext ?? '').toLowerCase().replace(/^\./, '');
  return bare === 'mxl' ? '.mxl' : '.musicxml';
}

/** At most STEM_MAX characters, cut back to a dash so no word is split. */
function capStem(stem) {
  if (stem.length <= STEM_MAX) return stem;
  const cut = stem.slice(0, STEM_MAX);
  const atBoundary = stem[STEM_MAX] === '-';
  const lastDash = cut.lastIndexOf('-');
  const capped = atBoundary || lastDash <= 0 ? cut : cut.slice(0, lastDash);
  return capped.replace(/-+$/g, '');
}

/**
 * `<title>-<composer>.<ext>` in lower-kebab-case: `Für Élise` by `Ludwig van
 * Beethoven` → `fur-elise-ludwig-van-beethoven.musicxml`. A title with no ASCII
 * letters or digits becomes `untitled-score`.
 */
export function suggestFilename({ title, composer, ext } = {}) {
  const titlePart = kebab(title) || FALLBACK_STEM;
  const composerPart = kebab(composer);
  const stem = capStem(composerPart ? `${titlePart}-${composerPart}` : titlePart) || FALLBACK_STEM;
  return `${stem}${normalizeExt(ext)}`;
}

/** null when the name is a lower-kebab `.musicxml`/`.mxl` filename. */
export function checkFilename(filename) {
  return typeof filename === 'string' && FILENAME_RE.test(filename) ? null : { code: 'bad-filename' };
}

const stemOf = (file) => String(file).replace(/\.(musicxml|mxl)$/i, '').toLowerCase();

/**
 * Whether `<folder>/<filename>` may join the library alongside `existingIds`:
 * `basename-exists` (same folder, same stem in either format), `slug-too-long`
 * (the practice key reaches the 120-character cap, so a longer future id could
 * share it), `slug-collides` (another id in any folder has the same practice key).
 */
export function checkCollision({ folder, filename, existingIds = [] } = {}) {
  const newId = `${LIBRARY_REF_PREFIX}${folder}/${filename}`;
  const stem = stemOf(filename);
  const sameFolder = `${LIBRARY_REF_PREFIX}${folder}/`.toLowerCase();
  for (const id of existingIds) {
    const lower = String(id).toLowerCase();
    if (!lower.startsWith(sameFolder)) continue;
    const rest = lower.slice(sameFolder.length);
    if (!rest.includes('/') && /\.(musicxml|mxl)$/.test(rest) && stemOf(rest) === stem) return { code: 'basename-exists' };
  }
  const key = practiceKeyOfScore(newId);
  if (key.length >= PRACTICE_KEY_MAX) return { code: 'slug-too-long' };
  if (existingIds.some((id) => practiceKeyOfScore(id) === key)) return { code: 'slug-collides' };
  return null;
}

/**
 * The library folders the household config names, as `files:docs/sheet-music/…`
 * refs: the grouped `sheetmusic.collections: [{ label, ref }]` or the legacy
 * single `sheetmusic.collection` (the same reading as the kiosk's scoreGroups).
 */
export function sheetMusicCollectionRefs(sheetmusic) {
  const raw = sheetmusic != null && typeof sheetmusic === 'object' && !Array.isArray(sheetmusic) ? sheetmusic : {};
  if (Array.isArray(raw.collections)) {
    return raw.collections.map((g) => (g && typeof g === 'object' ? g.ref : g)).filter(Boolean).map(String);
  }
  return raw.collection ? [String(raw.collection)] : [];
}

/** The folder a ref names when it is exactly `files:docs/sheet-music/<folder>`; else null. */
function refFolder(ref) {
  const value = typeof ref === 'object' && ref != null ? ref.ref : ref;
  const text = String(value ?? '').replace(/\/+$/, '');
  if (!text.startsWith(LIBRARY_REF_PREFIX)) return null;
  const folder = text.slice(LIBRARY_REF_PREFIX.length);
  return isFolderSegment(folder) ? folder : null;
}

const isFolderSegment = (folder) => typeof folder === 'string'
  && folder !== '' && folder !== '.' && folder !== '..'
  && !/[/\\]/.test(folder);

/** A single path segment naming one of the configured library folders. */
export function isAllowedFolder(folder, collectionRefs = []) {
  if (!isFolderSegment(folder)) return false;
  return (collectionRefs || []).some((ref) => refFolder(ref) === folder);
}
