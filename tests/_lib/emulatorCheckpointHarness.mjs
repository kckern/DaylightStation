import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import express from 'express';
import request from './memory-http/request.mjs';
import { createEmulatorRouter } from '../../__app_modules/games/emulator/server/api/emulator.mjs';
import { EmulatorCheckpointService } from '../../__app_modules/games/emulator/server/application/EmulatorCheckpointService.mjs';
import { FilesystemEmulatorCheckpointRepository } from '../../__app_modules/games/emulator/server/adapters/FilesystemEmulatorCheckpointRepository.mjs';
import { FilesystemEmulatorSaveRepository } from '../../__app_modules/games/emulator/server/adapters/FilesystemEmulatorSaveRepository.mjs';
import { FilesystemEmulatorAssetRepository } from '../../__app_modules/games/emulator/server/adapters/FilesystemEmulatorAssetRepository.mjs';
import { sealCheckpointCapture } from '../../__app_modules/games/emulator/browser/core/checkpointJournal.js';

/** Real application/repository/HTTP serialization; only unique test storage is used. */
export function createEmulatorCheckpointHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emulator-progress-session-'));
  const key = { system: 'gb', gameId: `example-quest-${randomUUID()}`, user: 'user_5' };
  const repository = new FilesystemEmulatorCheckpointRepository({ emulationDir: root });
  const resource = value => ({ open: () => Readable.from([Buffer.from(value)]) });
  const service = new EmulatorCheckpointService({ checkpointRepository: repository,
    saveRepository: new FilesystemEmulatorSaveRepository({ emulationDir: root }),
    assetRepository: { getResourceDigest: FilesystemEmulatorAssetRepository.prototype.getResourceDigest,
      getRomResource: () => resource('rom'), getEngineResource: () => resource('core') },
    loadConfig: () => ({ systems: { gb: { core: 'gb' } }, games: [{ id: key.gameId, system: 'gb', saveMode: 'battery' }] }), makeId: randomUUID,
  });
  const app = express();
  app.use('/api/v1/emulator', createEmulatorRouter({ emulatorResources: {}, emulatorLibrary: { getLibrary: () => ({ games: [] }) }, checkpointService: service }));
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    const call = request(app)[(options.method ?? 'GET').toLowerCase()](url);
    if (options.body) call.send(JSON.parse(options.body));
    const response = await call;
    return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async () => response.body };
  };
  return { key, repository, service, fetchImpl, calls, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** Test journal port; production IndexedDB behavior has separate real-browser coverage. */
export function createMemoryCheckpointJournal() {
  const records = new Map();
  return {
    failWrites: false,
    async put(input) {
      if (this.failWrites) throw Object.assign(new Error('local disk unavailable'), { code: 'ECHECKPOINTJOURNALUNAVAILABLE' });
      const sealed = await sealCheckpointCapture(input);
      const key = `${sealed.gameKey}:${sealed.captureId}`;
      if (records.has(key) && records.get(key).fingerprint !== sealed.fingerprint) throw new Error('journal identity conflict');
      records.set(key, structuredClone(sealed));
      return structuredClone(sealed);
    },
    async list(key) {
      return [...records.values()].filter(r => r.key.system === key.system && r.key.gameId === key.gameId && r.key.user === key.user).map(r => structuredClone(r));
    },
    async acknowledge(key, captureId, fingerprint) {
      const record = [...records.values()].find(r => r.key.system === key.system && r.key.gameId === key.gameId && r.key.user === key.user && r.captureId === captureId);
      if (!record) return false;
      if (record.fingerprint !== fingerprint) throw new Error('wrong journal acknowledgment');
      records.delete(`${record.gameKey}:${record.captureId}`); return true;
    },
  };
}
