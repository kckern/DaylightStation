const REQUIRED_FUNCTIONS = [
  'createTheme',
  'createRenderer',
  'createMeasurementDocument',
  'measureDocumentFragments',
  'placeFragments',
  'contentHeightPt',
  'contentBox',
  'texToSvg',
  'resolveAsset',
];

export function isPrintDocumentRendering(value) {
  return value != null && REQUIRED_FUNCTIONS.every((name) => typeof value[name] === 'function');
}

export function assertPrintDocumentRendering(value) {
  if (!isPrintDocumentRendering(value)) {
    throw new TypeError(`RenderPrintDocument requires rendering capabilities: ${REQUIRED_FUNCTIONS.join(', ')}`);
  }
  return value;
}
