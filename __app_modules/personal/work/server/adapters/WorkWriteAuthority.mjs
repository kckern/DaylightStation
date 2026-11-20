import path from 'node:path';
import { spawn as spawnChild } from 'node:child_process';
import * as FileIO from '#system/utils/FileIO.mjs';
import { createLogger } from '#system/logging/logger.mjs';
import { workError } from '../domain/workState.mjs';
/**
 * Is this backend the configured Work writer? writer_env must match exactly. A
 * configured writer_host must match this host. Without one, the writer is the
 * prod container: Linux with /.dockerenv, because a container's hostname is its
 * id and changes on every deploy (same rule as LedgerWriterGate).
 */
export function matchesWriter({ writer_env, writer_host } = {}, { environment, hostId, platform = process.platform, isDocker = false } = {}) {
  if (platform !== 'linux' || !writer_env || writer_env !== environment) return false;
  return writer_host ? writer_host === hostId : isDocker === true;
}
/** Exact writer role plus a real kernel lease; the file alone is never a lock. */
export class WorkWriteAuthority {
  #configuration;
  #environment;
  #hostId;
  #platform;
  #isDocker;
  #spawn;
  #leases = new Map();
  #closed = false;
  #logger;
  constructor({
    configuration = {},
    environment,
    hostId,
    platform = process.platform,
    isDocker = false,
    spawn = spawnChild,
    logger = createLogger({
      source: 'backend',
      app: 'work',
      context: {
        module: 'writer'
      }
    })
  } = {}) {
    this.#configuration = structuredClone(configuration);
    this.#environment = environment;
    this.#hostId = hostId;
    this.#platform = platform;
    this.#isDocker = isDocker;
    this.#spawn = spawn;
    this.#logger = logger;
  }
  get canWrite() {
    const c = this.#configuration;
    return !this.#closed && c.enabled === true && c.write === true && matchesWriter(c, { environment: this.#environment, hostId: this.#hostId, platform: this.#platform, isDocker: this.#isDocker });
  }
  get leaseLost() {
    return !this.#closed && [...this.#leases.values()].some(({
      child
    }) => child.exitCode !== null || child.signalCode !== null);
  }
  async assertWriter({
    root
  }) {
    if (!this.canWrite) throw workError('WORK_WRITE_DENIED');
    const existing = this.#leases.get(root);
    if (existing) {
      if (existing.child.exitCode !== null || existing.child.signalCode !== null) throw workError('WORK_LEASE_LOST');
      return existing.ready;
    }
    FileIO.ensureDir(root);
    const child = this.#spawn('flock', ['-n', '--', path.join(root, 'writer.lock'), 'sh', '-c', 'printf "work-writer-ready\\n"; cat >/dev/null'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const lease = {
      child,
      ready: null
    };
    lease.ready = new Promise((resolve, reject) => {
      let ready = false,
        received = '';
      const fail = () => {
        if (!ready) {
          this.#leases.delete(root);
          reject(workError('WORK_WRITER_BUSY'));
        }
      };
      child.once('error', fail);
      child.once('exit', fail);
      child.stdout.on('data', data => {
        received += data.toString();
        if (!ready && received.includes('work-writer-ready\n')) {
          ready = true;
          resolve(true);
        }
      });
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => {});
    });
    this.#leases.set(root, lease);
    return lease.ready;
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.all([...this.#leases.values()].map(({
      child
    }) => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once('exit', resolve);
      child.stdin.end();
    })));
    this.#leases.clear();
    this.#logger?.debug?.('work.writer.closed');
  }
}
