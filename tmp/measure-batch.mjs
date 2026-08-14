import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { createMeasurementDocument, measureDocumentFragments } from '#rendering/school/documents/measure.mjs';
import { placeFragments, contentHeightPt } from '#rendering/school/documents/layout.mjs';
import { contentBox } from '#rendering/school/documents/furniture.mjs';

function createChoiceResolver(bank) {
  const items = new Map((bank?.items ?? []).map((item) => [item.id, item]));
  return (itemId, { choices }) => {
    const item = items.get(itemId);
    const labels = item.choices.map((choice) => String(choice));
    if (item.type === 'multi_select') return { labels, multiSelect: true, maxSelect: item.maxSelect };
    return labels;
  };
}

function measureOne(doc, bank, density) {
  const theme = createWorkbookTheme({ typeScale: doc.fit.typeScale, density });
  const furnitureOpts = { gutter: true, duplex: true, title: doc.title || doc.id, nameLine: 'Felix' };
  const box = contentBox(theme, furnitureOpts);
  const measurementDoc = createMeasurementDocument({ theme });
  const fragments = measureDocumentFragments(doc, {
    doc: measurementDoc, theme, texToSvg: async () => ({ svg: '', widthPt: 0, heightPt: 0 }), resolveAsset: null,
    resolveChoices: createChoiceResolver(bank),
    studentName: 'Felix', widthPt: box.widthPt, italic: true, totalPoints: 10, tokens: null,
  });
  const { pages } = placeFragments(fragments, { pageHeightPt: box.pageHeightPt, marginPt: box.marginPt, spacing: theme.spacing });
  const totalPt = contentHeightPt(fragments, { spacing: theme.spacing });
  const availablePt = box.pageHeightPt - 2 * box.marginPt;
  return { pages: pages.length, totalPt, availablePt, oversetPt: Math.max(0, totalPt - availablePt) };
}

const root = process.argv[2];
const dirs = fs.readdirSync(root).filter((d) => d.startsWith('dss-state-batch2-'));
const results = [];
for (const d of dirs) {
  const pubDir = path.join(root, d, 'content/school/print-documents/published/civilization/young-peoples-atlas-us');
  const bankDir = path.join(root, d, 'content/school/print-documents/derived-banks/civilization/young-peoples-atlas-us');
  if (!fs.existsSync(pubDir)) continue;
  const pubFile = fs.readdirSync(pubDir)[0];
  const bankFile = fs.readdirSync(bankDir)[0];
  const doc = yaml.load(fs.readFileSync(path.join(pubDir, pubFile), 'utf8'));
  const bank = yaml.load(fs.readFileSync(path.join(bankDir, bankFile), 'utf8'));
  const compact = measureOne(doc, bank, 'compact');
  results.push({ d, compact });
}
results.sort((a, b) => b.compact.oversetPt - a.compact.oversetPt);
for (const r of results) {
  console.log(r.d, 'compact pages=', r.compact.pages, 'oversetPt=', r.compact.oversetPt.toFixed(1));
}
console.log('MAX overset:', Math.max(...results.map((r) => r.compact.oversetPt)).toFixed(1));
console.log('fit count (pages===1):', results.filter((r) => r.compact.pages === 1).length, '/', results.length);
