// scripts/port-manager.mjs
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const LOCK_DIR = '/tmp/daylight-locks';
const PORTS = {
  dev: 3112,
  test: 3113,
  docker: 3111
};

export function ensureLockDir() {
  if (!fs.existsSync(LOCK_DIR)) {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
  }
}

export function getLockFile(port) {
  return path.join(LOCK_DIR, `port-${port}.lock`);
}

export function isPortInUse(port) {
  try {
    const result = execSync(`lsof -i :${port} -t 2>/dev/null || true`, { encoding: 'utf8' });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

export function getPortOwner(port) {
  const lockFile = getLockFile(port);
  if (fs.existsSync(lockFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      // Check if process still exists
      try {
        process.kill(data.pid, 0);
        return data;
      } catch {
        // Process dead, clean up stale lock
        fs.unlinkSync(lockFile);
        return null;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function acquirePort(port, purpose) {
  ensureLockDir();
  const lockFile = getLockFile(port);

  // Check for existing lock
  const owner = getPortOwner(port);
  if (owner) {
    throw new Error(`Port ${port} locked by PID ${owner.pid} (${owner.purpose}) since ${owner.timestamp}`);
  }

  // Check if port is actually in use (orphaned process)
  if (isPortInUse(port)) {
    throw new Error(`Port ${port} in use by unknown process. Run: lsof -i :${port}`);
  }

  // Acquire lock
  const lockData = {
    pid: process.pid,
    purpose,
    timestamp: new Date().toISOString(),
    port
  };
  fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2));

  // Register cleanup
  const cleanup = () => {
    try { fs.unlinkSync(lockFile); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  return lockData;
}

export function releasePort(port) {
  const lockFile = getLockFile(port);
  try {
    fs.unlinkSync(lockFile);
    return true;
  } catch {
    return false;
  }
}

export function killPortProcess(port) {
  try {
    const pids = execSync(`lsof -i :${port} -t 2>/dev/null || true`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);

    for (const pid of pids) {
      try {
        process.kill(parseInt(pid), 'SIGTERM');
        console.log(`Killed PID ${pid} on port ${port}`);
      } catch {}
    }

    releasePort(port);
    return pids.length > 0;
  } catch {
    return false;
  }
}

export function forceCleanPort(port) {
  killPortProcess(port);
  releasePort(port);

  // Wait for port to be free
  let attempts = 0;
  while (isPortInUse(port) && attempts < 10) {
    execSync('sleep 0.5');
    attempts++;
  }

  return !isPortInUse(port);
}

// CLI interface
if (process.argv[1].endsWith('port-manager.mjs')) {
  const [,, command, portArg] = process.argv;
  const port = parseInt(portArg) || PORTS.dev;

  switch (command) {
    case 'status':
      console.log(`Port ${port}: ${isPortInUse(port) ? 'IN USE' : 'FREE'}`);
      const owner = getPortOwner(port);
      if (owner) console.log(`  Locked by: PID ${owner.pid} (${owner.purpose})`);
      break;
    case 'kill':
      forceCleanPort(port);
      console.log(`Port ${port} cleaned`);
      break;
    case 'clean-all':
      Object.values(PORTS).forEach(p => {
        if (p !== PORTS.docker) forceCleanPort(p);
      });
      console.log('All dev/test ports cleaned');
      break;
    default:
      console.log('Usage: node port-manager.mjs [status|kill|clean-all] [port]');
  }
}
