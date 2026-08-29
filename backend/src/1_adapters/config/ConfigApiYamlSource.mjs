import { loadYaml } from '#system/utils/FileIO.mjs';
export class ConfigApiYamlSource {
  constructor({ contentPrefixesPath, playerConfigPath } = {}) { this.contentPrefixesPath = contentPrefixesPath; this.playerConfigPath = playerConfigPath; }
  loadContentPrefixes = () => loadYaml(this.contentPrefixesPath);
  loadPlayerConfig = () => loadYaml(this.playerConfigPath);
}
