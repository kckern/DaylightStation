// Destination layout mapping shared by the static layer and filesystem gates.
// Keep evidence paths physical; only rule selection uses the legacy layer names.
export const DESTINATION_ROOTS = ['modules', 'capabilities'];
const LEGACY_LAYERS = Object.freeze({
  domain: '2_domains',
  application: '3_applications',
  adapters: '1_adapters',
  api: '4_api',
  rendering: '1_rendering',
  composition: '5_composition',
});

export function isDestinationServerFile(file) {
  return /(?:^|\/)(modules|capabilities)\/[^/]+\/server\/.+/.test(file);
}

export function destinationServerPath(file) {
  const match = file?.match(/(?:^|\/)(modules|capabilities)\/([^/]+)\/server\/(domain|application|adapters|api|rendering|composition)\/(.*)$/);
  return match ? { tree: match[1], owner: match[2], layer: match[3], suffix: match[4] } : null;
}

export function matchesAuditLayer(file, legacyLayer) {
  const destination = destinationServerPath(file);
  if (!destination) return file.includes(legacyLayer);
  return legacyLayer === 'backend/src/' || legacyLayer === `${LEGACY_LAYERS[destination.layer]}/`;
}

export function targetsAuditLayer(file, legacyLayer) {
  if (!file) return false;
  const destination = destinationServerPath(file);
  return destination
    ? LEGACY_LAYERS[destination.layer] === legacyLayer
    : file.includes(`/backend/src/${legacyLayer}/`);
}
