import fs from 'node:fs/promises';
import path from 'node:path';

export class FileModuleManifestDiscovery {
  async find(rootDir) {
    const manifests = [];
    const walk = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(fullPath);
        else if (entry.name === 'manifest.mjs') manifests.push(fullPath);
      }
    };
    await walk(rootDir);
    return manifests;
  }

  load(modulePath) {
    return import(modulePath);
  }
}
