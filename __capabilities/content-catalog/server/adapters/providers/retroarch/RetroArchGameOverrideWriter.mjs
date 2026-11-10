import { applyAutoLoad } from './retroarchGameOverrides.mjs';

/** Single-quote a string for the Android (toybox) shell. */
function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * Writes RetroArch game override files on the device over a shell runner
 * (ADB in production). Idempotent: reads the file, rewrites only when the
 * `savestate_auto_load` line differs, and preserves every other key.
 *
 * Content travels base64-encoded so ROM names with quotes, brackets or `&`
 * never reach the device shell as syntax.
 */
export class RetroArchGameOverrideWriter {
  #shell;
  #logger;

  /**
   * @param {object} deps
   * @param {(script: string) => Promise<{ok: boolean, output?: string, error?: string}>} deps.shell
   * @param {object} [deps.logger]
   */
  constructor({ shell, logger = console } = {}) {
    if (typeof shell !== 'function') throw new TypeError('RetroArchGameOverrideWriter requires shell()');
    this.#shell = shell;
    this.#logger = logger;
  }

  /**
   * Ensure one planned override is in place.
   * @param {{consoleId, gameId, path, resume}} plan
   * @returns {Promise<{status: 'unchanged'|'written'|'failed', path: string, error?: string}>}
   */
  async ensure(plan) {
    const { path, resume } = plan;
    const read = await this.#shell(`cat ${shQuote(path)} 2>/dev/null; true`);
    if (!read?.ok) return this.#failed(plan, `read: ${read?.error || 'unknown'}`);

    const existing = read.output ? `${read.output}\n` : '';
    const { text, changed } = applyAutoLoad(existing, resume);
    if (!changed) {
      this.#logger.debug?.('retroarch.override.unchanged', { gameId: plan.gameId, path, resume });
      return { status: 'unchanged', path };
    }

    const dir = path.slice(0, path.lastIndexOf('/'));
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    const write = await this.#shell(`mkdir -p ${shQuote(dir)} && echo ${b64} | base64 -d > ${shQuote(path)}`);
    if (!write?.ok) return this.#failed(plan, `write: ${write?.error || 'unknown'}`);

    this.#logger.info?.('retroarch.override.written', { gameId: plan.gameId, consoleId: plan.consoleId, path, resume });
    return { status: 'written', path };
  }

  /** Ensure many overrides sequentially (one ADB shell at a time). */
  async ensureAll(plans) {
    const results = [];
    for (const plan of plans) {
      results.push({ ...plan, ...(await this.ensure(plan)) });
    }
    return results;
  }

  #failed(plan, error) {
    this.#logger.warn?.('retroarch.override.failed', { gameId: plan.gameId, path: plan.path, error });
    return { status: 'failed', path: plan.path, error };
  }
}

export default RetroArchGameOverrideWriter;
