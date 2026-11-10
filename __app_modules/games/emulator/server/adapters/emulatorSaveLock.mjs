import path from 'node:path';
import { readBinaryFromPath, readDirectory } from '#system/utils/FileIO.mjs';
import { assertSafeSegment, containedPath } from './emulatorFileSupport.mjs';

// One production backend owns the emulation volume. Share queues across adapter
// instances so checkpoint, import/reset and legacy writers use the same boundary.
const tails = new Map();
export function checkpointDirectory(emulationDir, { system, gameId, user }) {
  for (const value of [system, gameId, user]) assertSafeSegment(value);
  return containedPath(emulationDir, path.join('_checkpoints', system, user.toLowerCase(), gameId));
}
export async function withEmulatorSaveLock(emulationDir, key, operation) {
  const id = checkpointDirectory(emulationDir, key);
  const previous = tails.get(id) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(operation);
  tails.set(id, pending);
  try { return await pending; }
  finally { if (tails.get(id) === pending) tails.delete(id); }
}

/** Once versioned progress exists, an unconditional old client must not replace it. */
export function assertLegacySaveWritable(emulationDir, key) {
  const dir = checkpointDirectory(emulationDir, key);
  let protectedProgress = false;
  try { readBinaryFromPath(path.join(dir, 'protected.json')); protectedProgress = true; }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  try { readBinaryFromPath(path.join(dir, 'head.json')); protectedProgress = true; }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  if (!protectedProgress) {
    try { protectedProgress = readDirectory(path.join(dir, 'revisions')).length > 0; }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  if (protectedProgress) throw Object.assign(new Error('Reload the arcade to use protected saving'), { code: 'ECHECKPOINTREQUIRED' });
}
