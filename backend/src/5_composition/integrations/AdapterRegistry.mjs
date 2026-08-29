import { FileModuleManifestDiscovery } from '#system/modules/FileModuleManifestDiscovery.mjs';

/**
 * Discovers and indexes adapter manifests at startup.
 * Provides lookup by capability and provider.
 */
export class AdapterRegistry {
  #manifests = new Map();  // capability -> Map<provider, manifest>
  #adaptersRoot;
  #moduleDiscovery;

  /**
   * @param {Object} options
   * @param {string} options.adaptersRoot - Path to adapters directory (required).
   */
  constructor({ adaptersRoot, moduleDiscovery = new FileModuleManifestDiscovery() } = {}) {
    if (!adaptersRoot) throw new Error('adaptersRoot is required');
    this.#adaptersRoot = adaptersRoot;
    this.#moduleDiscovery = moduleDiscovery;
  }

  // Dependency injection points for testing
  _findManifests = (rootDir) => this.#moduleDiscovery.find(rootDir);
  _import = (modulePath) => this.#moduleDiscovery.load(modulePath);

  /**
   * Scan adapters directory for manifest files and index them.
   */
  async discover() {
    const manifestPaths = await this._findManifests(this.#adaptersRoot);

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

export default AdapterRegistry;
