/**
 * Fitness E2E Test Utilities
 * Helpers for session save runtime tests
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const execAsync = promisify(exec);

// Ports
const FRONTEND_PORT = 3111;
const BACKEND_PORT = 3112;

// Paths
const PROJECT_ROOT = path.resolve(new URL(import.meta.url).pathname, '../../../../');
const SIMULATION_SCRIPT = path.join(PROJECT_ROOT, '_extensions/fitness/simulation.mjs');
const DEV_LOG = path.join(PROJECT_ROOT, 'dev.log');

// Data path from .env (loaded at runtime)
function getDataPath() {
  // Try to load from .env
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/DAYLIGHT_DATA_PATH=(.+)/);
    if (match) return match[1].trim();
  }
  // Fallback
  return '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';
}

/**
 * Kill any processes using our dev ports
 */
export async function stopDevServer() {
  try {
    await execAsync(`lsof -ti:${FRONTEND_PORT} -ti:${BACKEND_PORT} | xargs kill -9 2>/dev/null || true`);
    // Wait for ports to be released
    await new Promise(r => setTimeout(r, 2000));
  } catch {
    // Ignore errors - processes may not exist
  }
}

/**
 * Clear the dev.log file
 */
export async function clearDevLog() {
  try {
    fs.writeFileSync(DEV_LOG, '');
  } catch {
    // File may not exist yet
  }
}

/**
 * Start the dev server and wait for ports to be ready
 */
export async function startDevServer(timeout = 60000) {
  const startTime = Date.now();

  // Start dev server in background
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore'
  });
  proc.unref();

  // Wait for frontend to be ready (backend is proxied through it in dev)
  while (Date.now() - startTime < timeout) {
    try {
      const frontendCheck = await fetch(`http://localhost:${FRONTEND_PORT}`).then(() => true).catch(() => false);
      const apiCheck = await fetch(`http://localhost:${FRONTEND_PORT}/api/fitness`).then(() => true).catch(() => false);

      if (frontendCheck && apiCheck) {
        console.log('Dev server ready');
        return proc;
      }
    } catch {
      // Keep waiting
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  throw new Error(`Dev server did not start within ${timeout}ms`);
}

/**
 * Run the fitness simulation for specified duration
 */
export async function runSimulation(durationSeconds) {
  return new Promise((resolve, reject) => {
    console.log(`Running simulation for ${durationSeconds} seconds...`);

    const proc = spawn('node', [SIMULATION_SCRIPT, `--duration=${durationSeconds}`], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });

    proc.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Simulation exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Get path to today's session folder
 */
function getSessionsFolder() {
  const dataPath = getDataPath();
  const today = getTodayDate();
  return path.join(dataPath, 'households/default/apps/fitness/sessions', today);
}

/**
 * Get list of session files for today
 */
export async function getSessionFilesForToday() {
  const folder = getSessionsFolder();

  try {
    if (!fs.existsSync(folder)) {
      return [];
    }

    const files = fs.readdirSync(folder)
      .filter(f => f.endsWith('.yml'))
      .map(f => path.join(folder, f));

    // Sort by modification time (newest first)
    files.sort((a, b) => {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    });

    return files;
  } catch {
    return [];
  }
}

/**
 * Get the most recent session file
 */
export async function getLatestSessionFile() {
  const files = await getSessionFilesForToday();
  return files.length > 0 ? files[0] : null;
}

/**
 * Read and parse a session YAML file
 */
export async function readSessionFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content);
}

/**
 * Validate session file structure
 */
export function validateSessionStructure(session) {
  const required = ['sessionId', 'startTime', 'endTime', 'durationMs', 'timeline', 'participants'];
  const timelineRequired = ['timebase', 'series'];

  const missing = [];

  for (const field of required) {
    if (session[field] === undefined) {
      missing.push(field);
    }
  }

  if (session.timeline) {
    for (const field of timelineRequired) {
      if (session.timeline[field] === undefined) {
        missing.push(`timeline.${field}`);
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    reason: missing.length > 0 ? `Missing fields: ${missing.join(', ')}` : null
  };
}

/**
 * Read dev.log contents
 */
export function readDevLog() {
  try {
    return fs.readFileSync(DEV_LOG, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Check if dev.log contains specific patterns
 */
export function logContains(pattern) {
  const log = readDevLog();
  if (pattern instanceof RegExp) {
    return pattern.test(log);
  }
  return log.includes(pattern);
}
