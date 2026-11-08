/**
 * Runs one `contentfilter` CLI command as a child process (niced). Pipeline logic stays in
 * the CLI; the job runner only sequences commands.
 */
export class IContentFilterCli {
  /**
   * @param {string} _command - e.g. 'refine', 'scenes', 'audit', 'export', 'preflight'
   * @param {string[]} _args
   * @param {{ logPath?: string, timeoutMs?: number }} [_opts]
   * @returns {Promise<{ code: number, stdout: string, stderrTail: string }>}
   */
  async run(_command, _args, _opts) { throw new Error('IContentFilterCli.run not implemented'); }
}
