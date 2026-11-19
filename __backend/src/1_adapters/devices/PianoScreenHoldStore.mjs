import { readTextFromPath, writeBinaryAtomic } from '#system/utils/FileIO.mjs';

export function createPianoScreenHoldStore(deviceId, path) {
  return {
    deviceId,
    load() {
      try {
        return JSON.parse(readTextFromPath(path));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    save(entry) {
      writeBinaryAtomic(path, Buffer.from(JSON.stringify(entry)), { durable: true, mode: 0o600 });
    },
  };
}
