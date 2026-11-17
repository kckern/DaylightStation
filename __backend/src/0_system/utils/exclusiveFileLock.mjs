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
import {spawn} from 'node:child_process';
import {constants as fsConstants} from 'node:fs';
import {open} from 'node:fs/promises';

// <fcntl.h> on Darwin; Node does not export it.
const DARWIN_O_EXLOCK = 0x20;

const lockError = (code, message, cause) => Object.assign(new Error(message, cause ? {cause} : undefined), {code});

async function acquireDarwin(lockPath) {
  let handle;
  try {
    handle = await open(lockPath, fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_NONBLOCK | DARWIN_O_EXLOCK, 0o600);
  } catch (error) {
    if (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK') throw lockError('FILE_LOCK_HELD', `Lock held by another writer: ${lockPath}`, error);
    throw lockError('FILE_LOCK_FAILED', `Could not open lock ${lockPath}: ${error.message}`, error);
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
    // A held lock exits 1 under `flock -n`; 73 is kept as a conflict code, as before.
    child.once('exit', (code) => reject([1, 73].includes(code)
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
