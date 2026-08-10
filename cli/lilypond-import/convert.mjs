/**
 * convert — run the canonical LilyPond through a MusicXML converter.
 *
 * This is THE SWAPPABLE SEAM of the pipeline. Today it shells out to python-ly
 * (`ly musicxml`), which is a build-time-only dependency — nothing here ever
 * ships in the Docker image, because importing public-domain scores is an
 * offline batch job, not a runtime concern.
 *
 * When a hand-written LilyPond parser replaces it, only this module changes:
 * everything upstream (normalize) and downstream (validate, enrich, install)
 * speaks canonical `.ly` in and MusicXML out.
 *
 * NOTE ON EXIT CODES: python-ly exits 0 when it fails. Its return code carries
 * no information and is deliberately not consulted — validate.mjs inspects the
 * emitted document instead.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

export const CONVERTER_VERSION = 'ly2xml/0.1.0 (python-ly)';

/** Locate the `ly` binary: explicit env wins, then PATH. */
export function resolveLyBin() {
  return process.env.LY_BIN || 'ly';
}

/** True when the converter backend is actually callable. */
export async function backendAvailable(bin = resolveLyBin()) {
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 15000 });
    return { ok: true, version: String(stdout).trim() };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * @param {string} canonicalLy  a normalized single-movement LilyPond document
 * @returns {Promise<{xml: string, stderr: string, backendError: string|null}>}
 */
export async function convertToMusicXml(canonicalLy, opts = {}) {
  const bin = opts.bin || resolveLyBin();
  const timeout = opts.timeoutMs ?? 180000;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ly2xml-'));
  const inFile = path.join(dir, `${crypto.randomBytes(6).toString('hex')}.ly`);
  const outFile = `${inFile.slice(0, -3)}.xml`;
  try {
    await fs.writeFile(inFile, canonicalLy, 'utf8');
    let stderr = '';
    let backendError = null;
    try {
      const r = await execFileAsync(bin, ['musicxml', inFile, '-o', outFile], { timeout, maxBuffer: 64 * 1024 * 1024 });
      stderr = r.stderr || '';
    } catch (err) {
      // A crash still may have written a partial file; keep going and let the
      // validator decide. Only record why, for the ledger.
      backendError = err?.message || String(err);
      stderr = err?.stderr || '';
    }
    let xml = '';
    try { xml = await fs.readFile(outFile, 'utf8'); } catch { xml = ''; }
    return { xml, stderr, backendError };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export default { convertToMusicXml, backendAvailable, resolveLyBin, CONVERTER_VERSION };
