/**
 * Builds the semantic description and capabilities needed to construct a Device.
 * Raw deployment configuration and concrete capability adapters stay behind
 * this boundary.
 */
export class IDeviceBlueprintFactory {
  async createBlueprint(_deviceId, _source) {
    throw new Error('IDeviceBlueprintFactory.createBlueprint must be implemented');
  }
}

export function isDeviceBlueprintFactory(value) {
  return value != null && typeof value.createBlueprint === 'function';
}

export default IDeviceBlueprintFactory;
