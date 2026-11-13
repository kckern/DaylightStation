/**
 * Runs `contentfilter <command> …` as a niced child process (IContentFilterCli). stdout is
 * returned (audit --json); stdout and stderr are appended to the step log; a timeout or the
 * parent's exit kills the child.
 */
import { spawn } from 'child_process';
import path from 'path';
import { appendTextFile, ensureDir } from '#system/utils/FileIO.mjs';
import { IContentFilterCli } from '../../application/content-filter/ports/IContentFilterCli.mjs';

const TAIL = 500;
const live = new Set();
let exitHooked = false;
function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.once('exit', () => { for (const c of live) { try { c.kill('SIGKILL'); } catch { /* gone */ } } });
}

export class ChildProcessContentFilterCli extends IContentFilterCli {
  #cliPath; #nodeBin; #nice; #env;

  /** @param {{ cliPath: string, nodeBin?: string, nice?: boolean, env?: object }} o - env: DAYLIGHT_DATA_DIR etc. */
  constructor({ cliPath, nodeBin = process.execPath, nice = true, env = {} }) {
    super();
    if (!cliPath) throw new Error('ChildProcessContentFilterCli requires cliPath');
    this.#cliPath = cliPath; this.#nodeBin = nodeBin; this.#nice = nice; this.#env = env;
  }

  /** onLine(line): each complete stderr line as it is written (refine's per-cue progress), the remainder at exit. */
  run(command, args = [], { logPath = null, timeoutMs = 0, onLine = null, signal = null } = {}) {
    hookExit();
    const argv = [this.#cliPath, command, ...args];
    const [bin, binArgs] = this.#nice ? ['nice', ['-n', '19', this.#nodeBin, ...argv]] : [this.#nodeBin, argv];
    if (logPath) {
      ensureDir(path.dirname(logPath));
      appendTextFile(logPath, `\n$ contentfilter ${[command, ...args].join(' ')}  (${new Date().toISOString()})\n`);
    }
    return new Promise((resolve) => {
      const child = spawn(bin, binArgs, { env: { ...process.env, ...this.#env }, stdio: ['ignore', 'pipe', 'pipe'] });
      live.add(child);
      let stdout = ''; let stderr = ''; let timedOut = false; let stopped = false;
      const stop = () => { stopped = true; try { child.kill('SIGKILL'); } catch { /* gone */ } };
      if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true });
      const log = (chunk) => { if (logPath) appendTextFile(logPath, String(chunk)); };
      child.stdout.on('data', (d) => { stdout += d; log(d); });
      let pending = '';
      const lines = (text) => { if (!onLine) return; pending += text; const parts = pending.split('\n'); pending = parts.pop(); for (const l of parts) { try { onLine(l); } catch { /* a listener never breaks the run */ } } };
      child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4 * TAIL); log(d); lines(String(d)); });
      const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs) : null;
      const done = (code, error) => {
        if (timer) clearTimeout(timer);
        if (onLine && pending) { try { onLine(pending); } catch { /* ignore */ } pending = ''; }
        live.delete(child);
        signal?.removeEventListener?.('abort', stop);
        const why = timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s` : stopped ? 'stopped' : error ? error.message : '';
        resolve({ code: timedOut || stopped || error ? 1 : code ?? 1, stdout, stderrTail: (stderr + (why ? `\n${why}` : '')).trim().slice(-TAIL) });
      };
      child.on('error', (e) => done(1, e));
      child.on('close', (code) => done(code));
    });
  }
}
