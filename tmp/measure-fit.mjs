import fs from 'node:fs';
import yaml from 'js-yaml';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { createMeasurementDocument, measureDocumentFragments } from '#rendering/school/documents/measure.mjs';
import { placeFragments, contentHeightPt } from '#rendering/school/documents/layout.mjs';
import { contentBox } from '#rendering/school/documents/furniture.mjs';

const doc = yaml.load(fs.readFileSync(process.argv[2], 'utf8'));
const bank = yaml.load(fs.readFileSync(process.argv[3], 'utf8'));

function createChoiceResolver(bank) {
  const items = new Map((bank?.items ?? []).map((item) => [item.id, item]));
  return (itemId, { choices, path }) => {
    const item = items.get(itemId);
    if (!item) throw new Error(`item '${itemId}' not in bank`);
    const labels = item.choices.map((choice) => String(choice));
    if (item.type === 'multi_select') return { labels, multiSelect: true, maxSelect: item.maxSelect };
    return labels;
  };
}

function measure(density) {
  const theme = createWorkbookTheme({ typeScale: doc.fit.typeScale, density });
  const furnitureOpts = {
    gutter: true, duplex: true, title: doc.title || doc.id, nameLine: 'Learner-Four',
  };
  const box = contentBox(theme, furnitureOpts);
  const measurementDoc = createMeasurementDocument({ theme });
  const fragments = measureDocumentFragments(doc, {
    doc: measurementDoc, theme, texToSvg: async () => ({ svg: '', widthPt: 0, heightPt: 0 }), resolveAsset: null,
    resolveChoices: createChoiceResolver(bank),
    studentName: 'Learner-Four', widthPt: box.widthPt, italic: true, totalPoints: 10, tokens: null,
  });
  const { pages } = placeFragments(fragments, { pageHeightPt: box.pageHeightPt, marginPt: box.marginPt, spacing: theme.spacing });
  const totalPt = contentHeightPt(fragments, { spacing: theme.spacing });
  const availablePt = box.pageHeightPt - 2 * box.marginPt;
  console.log('---', density, '---');
  console.log('pages=', pages.length, 'totalPt=', totalPt.toFixed(1), 'availablePt=', availablePt.toFixed(1), 'oversetPt=', Math.max(0, totalPt - availablePt).toFixed(1));
  pages.forEach((p, i) => {
    const last = p.fragments[p.fragments.length - 1];
    const bottom = last ? last.yPt + last.heightPt : box.marginPt;
    console.log(`  page ${i + 1}: ${p.fragments.length} fragments, bottom content y=${bottom.toFixed(1)}, contentBottomPt=${(box.pageHeightPt - box.marginPt).toFixed(1)}, spareAtBottom=${(box.pageHeightPt - box.marginPt - bottom).toFixed(1)}`);
    p.fragments.forEach((f) => console.log(`    #${f.number ?? '?'} y=${f.yPt.toFixed(1)} h=${f.heightPt.toFixed(1)} fillAfter=${f.fillAfter}`));
  });
}

measure('normal');
measure('compact');
