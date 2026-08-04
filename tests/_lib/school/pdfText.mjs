/**
 * Extract real text (and, where needed, exact draw positions) from a School
 * PDF — for assertions that a structural fragment/node check cannot make:
 * "does this string actually appear on the printed page", "is this run's
 * left edge where furniture says the content box starts".
 *
 * Text drawn through an embedded, subsetted TrueType face (every School PDF)
 * is NOT literal ASCII in the raw PDF bytes — pdfkit emits Identity-H/CID
 * glyph indices, so `bytes.toString('latin1').includes('some prose')` never
 * matches. These helpers decode the real content stream instead: `pdfText`
 * via poppler's `pdftotext` (same tool the acceptance suite already uses for
 * prose assertions), `pdfTextItems` via `pdfjs-dist` (already a project
 * dependency) for per-run x/y positions poppler's plain-text output cannot
 * give.
 *
 * @module tests/_lib/school/pdfText
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Verify poppler is on PATH, with an actionable message when it is not. */
export function requirePdftotext() {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'pipe' });
  } catch (err) {
    throw new Error(
      'This suite needs poppler\'s `pdftotext` to extract real text from a rendered PDF, and '
      + 'it is not on PATH. Install it (macOS: `brew install poppler`; Debian/Ubuntu: `apt '
      + `install poppler-utils\`) and re-run. (${err.message})`,
    );
  }
}

/**
 * Layout-preserving text extraction via poppler's `pdftotext -layout` — real
 * ink, not a structural guess.
 *
 * @param {Buffer} pdf
 * @returns {string}
 */
export function pdfText(pdf) {
  requirePdftotext();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-pdftext-'));
  try {
    const pdfPath = path.join(dir, 'doc.pdf');
    fs.writeFileSync(pdfPath, pdf);
    return execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Per-run text items with their PDF-space draw position, via `pdfjs-dist`
 * (legacy Node build, no worker/canvas needed for text-only extraction).
 *
 * `transform[4]`/`transform[5]` are the item's x/y in PDF user space
 * (origin bottom-left) — directly comparable to the `xPt` pdfkit's own
 * `.text(str, xPt, yPt)` calls were given, since pdfkit translates its
 * top-down y internally but never touches x.
 *
 * @param {Buffer} pdf
 * @returns {Promise<Array<{page: number, str: string, xPt: number, yPt: number}>>}
 */
export async function pdfTextItems(pdf) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdf) }).promise;
  const items = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    // eslint-disable-next-line no-await-in-loop
    const page = await doc.getPage(pageNumber);
    // eslint-disable-next-line no-await-in-loop
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!item.str) continue;
      items.push({
        page: pageNumber, str: item.str, xPt: item.transform[4], yPt: item.transform[5],
      });
    }
  }
  await doc.destroy();
  return items;
}

export default { requirePdftotext, pdfText, pdfTextItems };
