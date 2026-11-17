// exclusiveFileLock.mjs — one non-blocking, kernel-owned writer lock per path.
//
// Kernel ownership (flock(2) semantics) is the point: the lock vanishes when its
// holder dies, even by SIGKILL, so crash recovery needs no PID files or stale
// timers, and two holders can never both succeed.
//
//   linux   flock(1) holds the lock in a child that lives until our stdin pipe
//           closes. This is the path the supervision ledger has always used.
//   darwin  macOS ships no flock(1). open(2) with O_EXLOCK|O_NONBLOCK takes the
//           same flock(2) lock on the descriptor this process keeps open.
//   other   refused: writing without the lock would break single-writer.
//
// PER KERNEL ONLY. flock(2) excludes processes on the same machine. Two hosts
// sharing the file through Dropbox, NFS or any sync each take "their" lock and
// both succeed. Cross-host exclusion is the caller's job (the supervision
// ledgers gate on a configured writer host before calling this).
import {spawn} from 'node:child_process';
import {constants as fsConstants} from 'node:fs';
import {open} from 'node:fs/promises';

// <fcntl.h> on Darwin; Node does not export it.
const DARWIN_O_EXLOCK = 0x20;

const lockError = (code, message, cause) => Object.assign(new Error(message, cause ? {cause} : undefined), {code});

// A child forked by another thread while we close() still shares the open file
// description until it execs, so the lock can outlive close() by microseconds.
// A real holder keeps its lock for its whole life, so a short retry never lets
// two writers in.
const DARWIN_HELD_RETRIES = 5;
const DARWIN_RETRY_MS = 10;

async function acquireDarwin(lockPath) {
  let handle;
  for (let attempt = 0; ; attempt++) {
    try {
      handle = await open(lockPath, fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_NONBLOCK | DARWIN_O_EXLOCK, 0o600);
      break;
    } catch (error) {
      const held = error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK';
      if (held && attempt < DARWIN_HELD_RETRIES) { await new Promise((resolve) => setTimeout(resolve, DARWIN_RETRY_MS)); continue; }
      if (held) throw lockError('FILE_LOCK_HELD', `Lock held by another writer: ${lockPath}`, error);
      throw lockError('FILE_LOCK_FAILED', `Could not open lock ${lockPath}: ${error.message}`, error);
    }
  }
  let released = false;
  return {
    async release() { if (released) return; released = true; await handle.close(); },
    // A descriptor held by this process cannot be lost while the process lives.
    onLost() {},
  };
}

async function acquireLinux(lockPath, spawnProcess) {
  const child = spawnProcess('flock', ['-n', lockPath, process.execPath, '-e', "process.stdout.write('locked');process.stdin.resume()"], {stdio: ['pipe', 'pipe', 'pipe']});
  await new Promise((resolve, reject) => {
    child.once('error', (error) => reject(error.code === 'ENOENT'
      ? lockError('FILE_LOCK_FAILED', 'flock(1) is not installed; the writer lock needs it on Linux', error)
      : lockError('FILE_LOCK_FAILED', `flock(1) failed to start: ${error.message}`, error)));
    // `flock -n` exits 1 for a held lock. Anything else (73 is EX_CANTCREAT,
    // the lock file could not be opened) means no lock; both fail closed.
    child.once('exit', (code) => reject(code === 1
      ? lockError('FILE_LOCK_HELD', `Lock held by another writer: ${lockPath}`)
      : lockError('FILE_LOCK_FAILED', `flock(1) exited ${code} for ${lockPath}`)));
    child.stdout.once('data', () => resolve());
  });
  let released = false;
  return {
    async release() {
      if (released) return; released = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.stdin.end();
      await exited;
    },
    onLost(callback) { child.once('exit', () => { if (!released) callback(); }); },
  };
}

/**
 * Take the lock or throw. Errors carry `code`: `FILE_LOCK_HELD` (someone else
 * holds it) or `FILE_LOCK_FAILED` (no lock could be taken at all).
 * The caller creates the lock file's directory.
 */
export async function acquireExclusiveFileLock(lockPath, {platform = process.platform, spawnProcess = spawn} = {}) {
  if (platform === 'linux') return acquireLinux(lockPath, spawnProcess);
  if (platform === 'darwin') return acquireDarwin(lockPath);
  throw lockError('FILE_LOCK_FAILED', `No kernel file lock is supported on ${platform}; refusing to write without one`);
}
