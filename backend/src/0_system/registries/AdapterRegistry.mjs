import { glob } from 'fs/promises';
import path from 'path';

/**
 * Discovers and indexes adapter manifests at startup.
 * Provides lookup by capability and provider.
 */
export class AdapterRegistry {
  #manifests = new Map();  // capability -> Map<provider, manifest>
  #adaptersRoot;

  /**
   * @param {Object} options
   * @param {string} [options.adaptersRoot] - Path to adapters directory.
   *   Defaults to backend/src/2_adapters relative to cwd.
   */
  constructor({ adaptersRoot } = {}) {
    this.#adaptersRoot = adaptersRoot || path.resolve(process.cwd(), 'backend/src/2_adapters');
  }

  // Dependency injection points for testing
  _glob = async (pattern, cwd) => {
    const results = [];
    for await (const entry of glob(pattern, { cwd })) {
      results.push(path.resolve(cwd, entry));
    }
    return results;
  };
  _import = (modulePath) => import(modulePath);

  /**
   * Scan adapters directory for manifest files and index them.
   */
  async discover() {
    const manifestPaths = await this._glob('**/manifest.mjs', this.#adaptersRoot);

    for (const manifestPath of manifestPaths) {
      try {
        const { default: manifest } = await this._import(manifestPath);
        const { capability, provider } = manifest;

        if (!capability || !provider) {
          console.warn(`Invalid manifest at ${manifestPath}: missing capability or provider`);
          continue;
        }

        if (!this.#manifests.has(capability)) {
          this.#manifests.set(capability, new Map());
        }
        this.#manifests.get(capability).set(provider, manifest);
      } catch (err) {
        console.error(`Failed to load manifest at ${manifestPath}:`, err.message);
      }
    }
  }

  /**
   * Get manifest for a specific capability/provider pair.
   */
  getManifest(capability, provider) {
    return this.#manifests.get(capability)?.get(provider);
  }

  /**
   * Get all providers for a capability.
   */
  getProviders(capability) {
    const capMap = this.#manifests.get(capability);
    return capMap ? [...capMap.keys()] : [];
  }

  /**
   * Get all discovered capabilities.
   */
  getAllCapabilities() {
    return [...this.#manifests.keys()];
  }
}
