import path from 'node:path';
import yaml from 'js-yaml';
import { IAdminConfigStore } from '#apps/admin/ports/IAdminConfigStore.mjs';
import { HOUSEHOLD_APP_CONFIGS } from '#shared/contracts/householdConfig.mjs';
import {
  fileExists,
  getStats,
  readDirectory,
  readTextFromPath,
  writeFileAtomic,
} from '#system/utils/FileIO.mjs';

const DUMP_OPTS = { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false };
const ADMIN_ID_TO_APP = {
  fitness: 'fitness', finance: 'finance', gratitude: 'gratitude', shopping: 'harvest',
  media: 'media-app', entropy: 'entropy', piano: 'piano',
};
export const APP_CONFIGS = Object.freeze(Object.fromEntries(
  Object.entries(ADMIN_ID_TO_APP).map(([adminId, appName]) => [adminId, `household/${HOUSEHOLD_APP_CONFIGS[appName]}.yml`]),
));
const bothExtensions = rel => [`household/${rel}.yml`, `household/${rel}.yaml`];
export const EDITABLE_CONFIG_FILES = Object.freeze([
  ...Object.values(HOUSEHOLD_APP_CONFIGS).flatMap(bothExtensions),
  'household/integrations.yml', 'household/media/content-prefixes.yml',
  'household/triggers/bindings/keyboard.yml',
]);
const EDITABLE_DIRECTORIES = ['system/config'];
const MASKED_DIRECTORIES = ['system/auth', 'household/auth'];
const LISTED_DIRECTORIES = [...EDITABLE_DIRECTORIES, ...MASKED_DIRECTORIES];

function isMasked(relativePath) {
  return MASKED_DIRECTORIES.some(directory => relativePath === directory || relativePath.startsWith(`${directory}/`));
}
function isAllowed(relativePath) {
  return EDITABLE_DIRECTORIES.some(directory => relativePath === directory || relativePath.startsWith(`${directory}/`))
    || EDITABLE_CONFIG_FILES.includes(relativePath);
}

/** Filesystem/YAML implementation of the semantic admin config boundary. */
export class YamlAdminConfigStore extends IAdminConfigStore {
  #dataRoot;

  constructor({ dataRoot }) {
    super();
    if (!dataRoot) throw new Error('YamlAdminConfigStore requires dataRoot');
    this.#dataRoot = path.resolve(dataRoot);
  }

  #resolve(configPath) {
    const absolutePath = path.resolve(this.#dataRoot, configPath);
    const inside = absolutePath === this.#dataRoot || absolutePath.startsWith(`${this.#dataRoot}${path.sep}`);
    return inside ? absolutePath : null;
  }

  #metadata(absolutePath) {
    const stat = getStats(absolutePath);
    return stat ? { size: stat.size, modified: stat.mtime.toISOString() } : null;
  }

  #readTextRecord(configPath) {
    const absolutePath = this.#resolve(configPath);
    if (!absolutePath || !fileExists(absolutePath)) return null;
    return { raw: readTextFromPath(absolutePath), ...this.#metadata(absolutePath) };
  }

  #readYaml(configPath, fallback) {
    const record = this.#readTextRecord(configPath);
    return record ? (yaml.load(record.raw) ?? fallback) : fallback;
  }

  #writeText(configPath, raw) {
    const absolutePath = this.#resolve(configPath);
    if (!absolutePath) throw new Error('Config path escapes the data root');
    writeFileAtomic(absolutePath, raw);
    return this.#metadata(absolutePath);
  }

  #writeYaml(configPath, value) {
    return this.#writeText(configPath, yaml.dump(value, DUMP_OPTS));
  }

  #encode(content, messages) {
    const { raw, parsed } = content || {};
    if (raw === undefined && parsed === undefined) return { kind: 'empty' };
    if (raw !== undefined) {
      try { yaml.load(raw); }
      catch (error) { return { kind: 'invalid_yaml', error, message: messages.invalid }; }
      return { kind: 'encoded', raw };
    }
    try { return { kind: 'encoded', raw: yaml.dump(parsed, DUMP_OPTS) }; }
    catch (error) { return { kind: 'dump_failed', error, message: messages.dump }; }
  }

  listManagedAppConfigs() {
    return Object.entries(APP_CONFIGS).map(([appId, configPath]) => {
      const metadata = this.#inspectConfig(configPath);
      return { appId, configPath, exists: Boolean(metadata), size: metadata?.size ?? null, modified: metadata?.modified ?? null };
    });
  }

  readManagedAppConfig(appId) {
    const configPath = APP_CONFIGS[appId];
    if (!configPath) return { kind: 'unknown_app' };
    const record = this.#readTextRecord(configPath);
    if (!record) return { kind: 'missing', appId, configPath };
    let parsed = null;
    try { parsed = yaml.load(record.raw); } catch { /* malformed stored YAML remains editable as raw */ }
    return { kind: 'found', appId, configPath, ...record, parsed };
  }

  writeManagedAppConfig(appId, content) {
    const configPath = APP_CONFIGS[appId];
    if (!configPath) return { kind: 'unknown_app' };
    const encoded = this.#encode(content, { invalid: 'Invalid YAML', dump: 'Invalid YAML' });
    if (encoded.kind !== 'encoded') return { ...encoded, appId, configPath };
    const metadata = this.#writeConfig(configPath, encoded.raw);
    return metadata ? { kind: 'written', appId, configPath, ...metadata } : { kind: 'directory_missing', appId, configPath };
  }

  #editorAddress(documentId) {
    if (!documentId) return { kind: 'path_required' };
    if (!/\.ya?ml$/i.test(documentId)) return { kind: 'not_yaml' };
    const relativePath = this.#normalizeDocumentId(documentId);
    if (relativePath === null) return { kind: 'path_traversal', path: documentId };
    if (isMasked(relativePath)) return { kind: 'masked', path: relativePath };
    if (!isAllowed(relativePath)) return { kind: 'not_allowed', path: relativePath };
    return { kind: 'allowed', path: relativePath };
  }

  listEditableDocuments() {
    return this.#listDocuments({ directories: LISTED_DIRECTORIES, files: EDITABLE_CONFIG_FILES.filter(file => !isMasked(file)) })
      .map(document => ({ ...document, masked: isMasked(document.path) }));
  }

  readEditableDocument(documentId) {
    const address = this.#editorAddress(documentId);
    if (address.kind !== 'allowed') return address;
    const record = this.#readTextRecord(address.path);
    if (!record) return { kind: 'missing', path: address.path };
    let parsed = null;
    let parseError = null;
    try { parsed = yaml.load(record.raw); } catch (error) { parseError = error; }
    return {
      kind: 'found', path: address.path, name: path.basename(address.path),
      ...record, parsed, parseError,
    };
  }

  writeEditableDocument(documentId, content) {
    const address = this.#editorAddress(documentId);
    if (address.kind !== 'allowed') return address;
    const encoded = this.#encode(content, { invalid: 'Invalid YAML syntax', dump: 'Failed to serialize object to YAML' });
    if (encoded.kind !== 'encoded') return { ...encoded, path: address.path };
    return { kind: 'written', path: address.path, ...this.#writeText(address.path, encoded.raw) };
  }

  #inspectConfig(configPath) {
    const absolutePath = this.#resolve(configPath);
    return absolutePath ? this.#metadata(absolutePath) : null;
  }

  #writeConfig(configPath, raw) {
    const absolutePath = this.#resolve(configPath);
    if (!absolutePath || !fileExists(path.dirname(absolutePath))) return null;
    writeFileAtomic(absolutePath, raw);
    return this.#metadata(absolutePath);
  }

  readHousehold() { return this.#readYaml('household/household.yml', {}); }
  writeHousehold(value) { return this.#writeYaml('household/household.yml', value); }
  readMemberProfile(username) {
    const record = this.#readTextRecord(`users/${username}/profile.yml`);
    return record ? (yaml.load(record.raw) ?? {}) : null;
  }
  writeMemberProfile(username, value) { return this.#writeYaml(`users/${username}/profile.yml`, value); }
  readMemberLogin(username) {
    const record = this.#readTextRecord(`users/${username}/auth/login.yml`);
    return record ? (yaml.load(record.raw) ?? {}) : null;
  }
  readDevices() { return this.#readYaml('household/hardware/devices.yml', {}).devices || {}; }
  writeDevices(devices) { return this.#writeYaml('household/hardware/devices.yml', { devices }); }

  readIntegrations() { return this.#readYaml('household/integrations.yml', {}); }
  readServices() { return this.#readYaml('system/config/services.yml', {}); }
  getProviderAuthLocations(provider) {
    const household = this.#resolve(`household/auth/${provider}.yml`);
    const system = this.#resolve(`system/auth/${provider}.yml`);
    return {
      household: Boolean(household && fileExists(household)),
      system: Boolean(system && fileExists(system)),
    };
  }

  readScheduledJobs() { return this.#readYaml('system/config/jobs.yml', []); }
  writeScheduledJobs(jobs) { return this.#writeYaml('system/config/jobs.yml', jobs); }
  readSchedulerRuntime() { return this.#readYaml('system/state/cron-runtime.yml', {}); }

  #normalizeDocumentId(documentId) {
    const absolutePath = this.#resolve(documentId);
    if (!absolutePath) return null;
    return path.relative(this.#dataRoot, absolutePath).replace(/\\/g, '/');
  }

  #listDocuments({ directories = [], files = [] } = {}) {
    const documents = [];
    const seen = new Set();
    const add = (absolutePath) => {
      const relativePath = path.relative(this.#dataRoot, absolutePath).replace(/\\/g, '/');
      if (seen.has(relativePath)) return;
      const metadata = this.#metadata(absolutePath);
      if (!metadata) return;
      seen.add(relativePath);
      documents.push({
        path: relativePath,
        name: path.basename(relativePath),
        directory: path.dirname(relativePath).replace(/\\/g, '/'),
        ...metadata,
      });
    };
    const walk = (absoluteDirectory) => {
      if (!fileExists(absoluteDirectory)) return;
      for (const entry of readDirectory(absoluteDirectory, { withFileTypes: true })) {
        const absolutePath = path.join(absoluteDirectory, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) walk(absolutePath);
        else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) add(absolutePath);
      }
    };
    for (const directory of directories) {
      const absoluteDirectory = this.#resolve(directory);
      if (absoluteDirectory) walk(absoluteDirectory);
    }
    for (const configPath of files) {
      const absolutePath = this.#resolve(configPath);
      if (absolutePath && fileExists(absolutePath)) add(absolutePath);
    }
    return documents;
  }
}

export default YamlAdminConfigStore;
