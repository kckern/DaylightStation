/**
 * PythonWordAligner - forced alignment of known words via align_words.py.
 *
 * The python command is configurable because the environment differs per
 * host: `["uv", "run", "--script"]` (default; uv builds the env from the
 * script's inline dependencies) or a python that already has torch/torchaudio,
 * e.g. `["python3"]` via CONTENT_FILTER_ALIGN_PY.
 */

import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const HELPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../cli/contentfilter/align_words.py');

export class PythonWordAligner {
  /**
   * @param {{ src: string, command?: string[] }} opts
   */
  constructor({ src, command = null }) {
    this.src = src;
    const env = process.env.CONTENT_FILTER_ALIGN_PY;
    this.command = command || (env ? env.split(/\s+/) : ['uv', 'run', '--script']);
  }

  /**
   * @param {Array<{ id: string, t0: number, t1: number, words: string[], target: number }>} items
   * @returns {Promise<Array<{ id: string, start?: number, end?: number, score?: number, error?: string }>>}
   */
  align(items) {
    const [cmd, ...pre] = this.command;
    return new Promise((resolve, reject) => {
      const child = execFile(cmd, [...pre, HELPER], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`align_words failed: ${String(stderr).slice(-300) || err.message}`));
        try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error(`align_words output: ${e.message}`)); }
      });
      child.stdin.end(JSON.stringify({ src: this.src, items }));
    });
  }
}

export default PythonWordAligner;
