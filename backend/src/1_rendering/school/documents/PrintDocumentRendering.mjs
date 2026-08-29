import { createWorkbookTheme } from './workbookTheme.mjs';
import { createDocumentPdfRenderer } from './DocumentPdfRenderer.mjs';
import { createMeasurementDocument, measureDocumentFragments } from './measure.mjs';
import { placeFragments, contentHeightPt } from './layout.mjs';
import { contentBox } from './furniture.mjs';
import { texToSvg } from './mathSvg.mjs';

/** Cohesive rendering capability injected into the print-document use case. */
export function createPrintDocumentRendering({ resolveAsset = null } = {}) {
  const assetResolver = resolveAsset ?? (() => null);
  return Object.freeze({
    createTheme: createWorkbookTheme,
    createRenderer: createDocumentPdfRenderer,
    createMeasurementDocument,
    measureDocumentFragments,
    placeFragments,
    contentHeightPt,
    contentBox,
    texToSvg,
    resolveAsset: assetResolver,
  });
}

export default createPrintDocumentRendering;
