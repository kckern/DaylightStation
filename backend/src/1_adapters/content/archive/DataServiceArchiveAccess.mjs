import path from 'node:path';
import { fileExists, readDirectory } from '#system/utils/FileIO.mjs';

/** Storage adapter for the legacy lifelog archive application service. */
export class DataServiceArchiveAccess {
  constructor({ dataService, dataDir }) {
    this.dataService = dataService;
    this.dataDir = dataDir;
  }

  read(username, service) {
    return this.dataService.user.read(`lifelog/${service}`, username);
  }

  write(username, service, data) {
    return this.dataService.user.write(`lifelog/${service}`, data, username);
  }

  listYears(username, service) {
    const archivePath = path.join(this.dataDir, 'users', username, 'lifelog', 'archives', service);
    if (!fileExists(archivePath)) return [];
    return readDirectory(archivePath)
      .filter((file) => /^\d{4}\.yml$/.test(file))
      .map((file) => Number.parseInt(file.replace('.yml', ''), 10))
      .sort((a, b) => b - a);
  }
}

export default DataServiceArchiveAccess;
