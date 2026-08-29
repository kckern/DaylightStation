import { execFileSync, spawnSync } from 'node:child_process';
import { relative } from 'node:path';

/** Read-only access to the exact Git index snapshot that a commit will record. */
export function listIndexFiles(pathspecs = []) {
  const output = execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], {
    encoding: 'utf8',
  });
  return output.split('\0').filter(Boolean);
}

export function readIndexFile(file, projectRoot = process.cwd()) {
  const repoRelative = file.startsWith('/') ? relative(projectRoot, file) : file;
  return execFileSync('git', ['show', `:${repoRelative}`], { encoding: 'utf8' });
}

/** Read many indexed blobs through one Git process, preserving exact index bytes. */
export function readIndexFiles(files, projectRoot = process.cwd()) {
  if (files.length === 0) return new Map();
  const repoFiles = files.map((file) => file.startsWith('/') ? relative(projectRoot, file) : file);
  const result = spawnSync('git', ['cat-file', '--batch'], {
    input: `${repoFiles.map((file) => `:${file}`).join('\n')}\n`,
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw result.error || new Error(result.stderr?.toString('utf8') || 'Unable to read index snapshot');
  }
  const snapshot = new Map();
  let offset = 0;
  for (const file of files) {
    const headerEnd = result.stdout.indexOf(0x0A, offset);
    if (headerEnd < 0) throw new Error(`Invalid Git object header for ${file}`);
    const header = result.stdout.subarray(offset, headerEnd).toString('utf8');
    const size = Number(header.split(' ')[2]);
    if (!Number.isInteger(size) || size < 0) throw new Error(`Unable to read indexed ${file}: ${header}`);
    const start = headerEnd + 1;
    const end = start + size;
    snapshot.set(file, result.stdout.subarray(start, end).toString('utf8'));
    offset = end + 1;
  }
  return snapshot;
}
