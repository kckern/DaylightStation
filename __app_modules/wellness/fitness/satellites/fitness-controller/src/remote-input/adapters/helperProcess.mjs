/**
 * Runs remote_keys_helper.py in one mode and hands each JSON line it prints to
 * `onLine`. Restarts it if it exits (1 s, doubling to 60 s; reset after a run
 * of a minute or more). Shared plumbing for the Linux adapters only.
 */
import { spawn as nodeSpawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

export const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'remote_keys_helper.py');

/**
 * @param {object} opts
 * @param {string} opts.mode                 helper mode ('kernel' | 'gatt')
 * @param {(msg: object) => void} opts.onLine parsed JSON line
 * @param {(info: {code, signal, restartInMs}) => void} [opts.onExit]
 * @param {() => void} [opts.onStart]         each (re)launch
 * @param {Function} [opts.spawn]
 * @param {object} [opts.logger]
 * @returns {{ stop(): void }}
 */
export function runHelper({ mode, onLine, onExit, onStart, spawn = nodeSpawn, logger = console }) {
  let child = null;
  let stopped = false;
  let delay = 1000;
  let timer = null;

  const launch = () => {
    if (stopped) return;
    const startedAt = Date.now();
    onStart?.();
    child = spawn('python3', ['-u', HELPER, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg && typeof msg === 'object') onLine(msg);
      }
    });
    child.stderr.on('data', (chunk) => logger?.error?.(`remote_keys_helper(${mode}): ${chunk.toString().trim()}`));
    child.on('exit', (code, signal) => {
      child = null;
      if (stopped) return;
      if (Date.now() - startedAt > 60_000) delay = 1000;
      onExit?.({ code, signal, restartInMs: delay });
      timer = setTimeout(launch, delay);
      delay = Math.min(delay * 2, 60_000);
    });
  };

  launch();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      child?.kill('SIGTERM');
    },
  };
}

export const upperAddress = (a) => (typeof a === 'string' && a ? a.toUpperCase() : null);
