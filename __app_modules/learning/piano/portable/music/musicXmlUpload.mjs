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
 * coded errors. This screens uploads, it does not render them. Every scan is
 * linear in the text (indexOf passes, regexes only on bounded prefixes): the
 * input is an untrusted upload and the backend's event loop runs it.
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

/** Header reads look only at the text before the first part, at most this much. */
const HEADER_MAX = 256 * 1024;
/**
 * The root element sits at the top: root checks read at most this much. A file
 * with more than 64 KiB of prolog, DOCTYPE or comments before `<score-partwise`
 * is therefore refused: not-partwise when some element shows in the prefix,
 * not-xml when nothing but prolog and comments does.
 */
const ROOT_PREFIX_MAX = 64 * 1024;
const TAG_ATTRS_MAX = 512;
const TAG_TEXT_MAX = 4096;

const isTagEnd = (ch) => ch === '>' || ch === '/' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

/** Index of the next `token` whose following character ends the tag name (so `</note` is not `</notehead`), or -1. */
function tagAt(text, token, from) {
  for (let at = text.indexOf(token, from); at !== -1; at = text.indexOf(token, at + token.length)) {
    if (isTagEnd(text[at + token.length])) return at;
  }
  return -1;
}

/** ASCII-lowercased copy, same length, so indexes carry over to the original. */
const asciiLower = (text) => text.replace(/[A-Z]+/g, (run) => run.toLowerCase());

/** Readable text of an element's content: CDATA literal, tags stripped, entities decoded. */
function contentText(raw) {
  // CDATA content is literal: pull it out before tags are stripped and entities decoded.
  const parts = raw.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/);
  const text = parts.map((part) => (part.startsWith('<![CDATA[')
    ? part.slice(9, -3)
    : decodeXml(part.replace(/<[^>]*>/g, '')))).join('').replace(/\s+/g, ' ').trim();
  return text || null;
}

/**
 * Text of the first `<name …>…</name>` whose attributes pass `attrsOk`.
 * Linear: each indexOf result is kept while later opens lie before it, so no
 * stretch of text is scanned twice. Attributes over 512 characters or content
 * over 4096 characters skip that element.
 */
function tagText(text, lower, name, attrsOk = () => true) {
  const open = `<${name}`;
  const close = `</${name}`;
  let gt = -1;
  let closeAt = -1;
  for (let at = lower.indexOf(open); at !== -1; at = lower.indexOf(open, at + open.length)) {
    const after = at + open.length;
    if (!isTagEnd(lower[after])) continue;
    if (gt < after) gt = lower.indexOf('>', after);
    if (gt === -1) return null;
    if (gt - after > TAG_ATTRS_MAX || lower[gt - 1] === '/') continue;
    if (!attrsOk(lower.slice(after, gt))) continue;
    const contentStart = gt + 1;
    if (closeAt < contentStart) closeAt = tagAt(lower, close, contentStart);
    if (closeAt === -1) return null;
    if (closeAt - contentStart > TAG_TEXT_MAX) continue;
    const value = contentText(text.slice(contentStart, closeAt));
    if (value) return value;
  }
  return null;
}

/** The text before the first part (where the header lives), capped. */
function headerOf(text) {
  const capped = text.length > HEADER_MAX ? text.slice(0, HEADER_MAX) : text;
  const lower = asciiLower(capped);
  let end = lower.indexOf('<part-list');
  if (end === -1) {
    for (let at = lower.indexOf('<part'); at !== -1; at = lower.indexOf('<part', at + 5)) {
      if (isTagEnd(lower[at + 5])) { end = at; break; }
    }
  }
  return end === -1 ? { text: capped, lower } : { text: capped.slice(0, end), lower: lower.slice(0, end) };
}

const COMPOSER_ATTR = /\btype\s*=\s*["']composer["']/;

/** Title and composer from the MusicXML header; null where absent. Linear in the text. */
export function scoreHeader(xml) {
  const { text, lower } = headerOf(String(xml || ''));
  return {
    title: tagText(text, lower, 'work-title') ?? tagText(text, lower, 'movement-title'),
    composer: tagText(text, lower, 'creator', (attrs) => COMPOSER_ATTR.test(attrs)),
  };
}

/**
 * True when some `<note>…</note>` has no `<rest`: the score sounds at least
 * once. One forward pass with indexOf; each search result is reused until the
 * scan passes it, so the cost is linear in the text.
 */
function hasSoundingNote(xml) {
  let gt = -1;
  let closeAt = -1;
  let restAt = -2;
  for (let at = xml.indexOf('<note'); at !== -1; at = xml.indexOf('<note', at + 5)) {
    const after = at + 5;
    if (!isTagEnd(xml[after])) continue;
    if (gt < after) gt = xml.indexOf('>', after);
    if (gt === -1) return false;
    if (xml[gt - 1] === '/') continue; // <note/> is empty
    const contentStart = gt + 1;
    if (closeAt < contentStart) closeAt = tagAt(xml, '</note', contentStart);
    if (closeAt === -1) return false;
    if (restAt !== -1 && restAt < contentStart) restAt = tagAt(xml, '<rest', contentStart);
    if (restAt === -1 || restAt > closeAt) return true;
    at = closeAt; // continue after this note
  }
  return false;
}

/** The text from the first non-space character (after a BOM), at most `max` long. */
function trimmedPrefix(text, max) {
  const NON_SPACE = /\S/g;
  NON_SPACE.lastIndex = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  const start = NON_SPACE.exec(text)?.index ?? text.length;
  return text.slice(start, start + max);
}

/**
 * Whether the text is a partwise MusicXML score with at least one sounding note.
 * @returns {{ ok: true, title: string|null, composer: string|null } | { ok: false, code: string }}
 */
export function checkUploadXml(xml) {
  const text = typeof xml === 'string' ? xml : String(xml ?? '');
  const head = trimmedPrefix(text, ROOT_PREFIX_MAX);
  if (!head.startsWith('<') || !/<[A-Za-z_][\w.:-]*[\s/>]/.test(head)) return { ok: false, code: 'not-xml' };
  if (/<score-timewise(?=[\s>])/.test(head)) return { ok: false, code: 'timewise' };
  if (!/<score-partwise(?=[\s>])/.test(head)) return { ok: false, code: 'not-partwise' };
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

/** The folders an upload may name: each configured single-segment library folder, once, in config order. */
export function allowedUploadFolders(collectionRefs = []) {
  const out = [];
  for (const ref of collectionRefs || []) {
    const folder = refFolder(ref);
    if (folder != null && !out.includes(folder)) out.push(folder);
  }
  return out;
}

/** A single path segment naming one of the configured library folders. */
export function isAllowedFolder(folder, collectionRefs = []) {
  if (!isFolderSegment(folder)) return false;
  return (collectionRefs || []).some((ref) => refFolder(ref) === folder);
}
