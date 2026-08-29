import path from 'node:path';
import {
  closeFileDescriptor,
  deleteFile,
  ensureDir,
  getStats,
  openFileForAppend,
  readDirectory,
  syncFileDescriptor,
  writeToFileDescriptor,
} from '#system/utils/FileIO.mjs';

const SCHOOL_EVENT = /^school\./;
const DEFAULT_MAX_AGE_DAYS = 400;

function localDay(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date - offset).toISOString().slice(0, 10);
}

function pruneOldFiles(directory, maxAgeDays) {
  const cutoff = Date.now() - maxAgeDays * 86400000;
  let names;
  try { names = readDirectory(directory); } catch { return; }
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
    const file = path.join(directory, name);
    try { if (getStats(file).mtimeMs < cutoff) deleteFile(file); } catch { /* logging never stops runtime */ }
  }
}

export function createSchoolLedgerTransport({ baseDir, maxAgeDays = DEFAULT_MAX_AGE_DAYS }) {
  if (!baseDir) throw new Error('School ledger transport requires a baseDir option');
  const directory = path.join(baseDir, 'school');
  let usable = true;
  try { ensureDir(directory); pruneOldFiles(directory, maxAgeDays); }
  catch (error) {
    usable = false;
    process.stderr.write(`[WARN] school-ledger disabled: cannot use ${directory} (${error?.code ?? error?.message}). School events will still reach console and Loggly, but nothing will survive a restart.\n`);
  }
  let openDay = null;
  let descriptor = null;
  const descriptorForToday = () => {
    const day = localDay();
    if (day === openDay && descriptor != null) return descriptor;
    if (descriptor != null) { try { closeFileDescriptor(descriptor); } catch { /* ignore */ } descriptor = null; }
    try { descriptor = openFileForAppend(path.join(directory, `${day}.jsonl`)); openDay = day; }
    catch { descriptor = null; openDay = null; }
    return descriptor;
  };
  return {
    name: 'school-ledger',
    send(event) {
      if (!usable || typeof event?.event !== 'string' || !SCHOOL_EVENT.test(event.event)) return;
      const handle = descriptorForToday();
      if (handle == null) return;
      try { writeToFileDescriptor(handle, `${JSON.stringify(event)}\n`); } catch { /* logging never stops runtime */ }
    },
    async flush() { if (descriptor != null) { try { syncFileDescriptor(descriptor); } catch { /* ignore */ } } },
  };
}

export default createSchoolLedgerTransport;
