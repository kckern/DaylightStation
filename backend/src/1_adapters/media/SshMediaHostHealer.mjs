/**
 * SshMediaHostHealer — asks the prod host what IT sees for a media file, and
 * lets it restore a zeroed mode.
 *
 * The app container cannot see the NAS share; only the Plex container mounts
 * it. So this runs one fixed command on the host over SSH: the key it uses is
 * restricted in the host's authorized_keys to a forced command
 * (`scripts/media-source-heal.sh`), which only accepts a path under the media
 * root. The path is passed base64-encoded so no shell quoting is involved.
 *
 * Plex reports paths as it sees them inside its container
 * (`/data/media/video/fitness/...`); `pathMap` translates them to host paths
 * (`/media/kckern/Media/Fitness/...`). Longest prefix wins.
 */

import { execFile as nodeExecFile } from 'child_process';

export class SshMediaHostHealer {
  #host;
  #user;
  #port;
  #privateKey;
  #knownHostsPath;
  #pathMap;
  #execFile;
  #timeoutMs;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host
   * @param {string} config.user
   * @param {number} [config.port=22]
   * @param {string} config.privateKey - path to the restricted key
   * @param {string} [config.knownHostsPath]
   * @param {Array<{from: string, to: string}>} config.pathMap - Plex path prefix → host path prefix
   * @param {Object} [deps]
   */
  constructor(config = {}, { execFile = nodeExecFile, logger = console, timeoutMs = 45_000 } = {}) {
    this.#host = config.host || '';
    this.#user = config.user || '';
    this.#port = config.port || 22;
    this.#privateKey = config.privateKey || config.private_key || '';
    this.#knownHostsPath = config.knownHostsPath || config.known_hosts_path || '';
    this.#pathMap = (config.pathMap || config.path_map || [])
      .filter((m) => m?.from && m?.to)
      .map((m) => ({ from: m.from.replace(/\/+$/, ''), to: m.to.replace(/\/+$/, '') }))
      .sort((a, b) => b.from.length - a.from.length);
    this.#execFile = execFile;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  isConfigured() {
    return Boolean(this.#host && this.#user && this.#privateKey && this.#pathMap.length);
  }

  /** Plex container path → host path, or null when no mapping covers it. */
  toHostPath(mediaPath) {
    const p = String(mediaPath || '');
    const hit = this.#pathMap.find((m) => p === m.from || p.startsWith(`${m.from}/`));
    return hit ? hit.to + p.slice(hit.from.length) : null;
  }

  /**
   * @param {string} mediaPath - the file path as Plex reports it
   * @returns {Promise<{ok: boolean, exists?: boolean, mode?: string, chmodApplied?: boolean, siblingsFixed?: number, readable?: boolean, error?: string}>}
   */
  async heal(mediaPath) {
    const hostPath = this.toHostPath(mediaPath);
    if (!hostPath) return { ok: false, error: 'unmapped-path' };

    const args = [
      '-i', this.#privateKey,
      '-p', String(this.#port),
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=accept-new',
      ...(this.#knownHostsPath ? ['-o', `UserKnownHostsFile=${this.#knownHostsPath}`] : []),
      `${this.#user}@${this.#host}`,
      Buffer.from(hostPath, 'utf8').toString('base64'),
    ];

    const stdout = await new Promise((resolve) => {
      this.#execFile('ssh', args, { timeout: this.#timeoutMs, maxBuffer: 64 * 1024 }, (error, out, err) => {
        if (error) {
          this.#logger.warn?.('media.source.host-heal.ssh-failed', {
            code: error.code ?? null, signal: error.signal ?? null, stderr: String(err || '').slice(0, 300),
          });
          resolve(null);
          return;
        }
        resolve(String(out || ''));
      });
    });
    if (stdout === null) return { ok: false, error: 'ssh-failed' };

    const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
    try {
      return JSON.parse(line);
    } catch {
      return { ok: false, error: 'bad-response' };
    }
  }
}

export default SshMediaHostHealer;
