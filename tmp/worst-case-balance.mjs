import fs from 'node:fs';
import yaml from 'js-yaml';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { createMeasurementDocument, measureDocumentFragments } from '#rendering/school/documents/measure.mjs';
import { placeFragments, contentHeightPt } from '#rendering/school/documents/layout.mjs';
import { contentBox } from '#rendering/school/documents/furniture.mjs';

const bankDoc = yaml.load(fs.readFileSync(
  '/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/content/school/curriculum/civilization/young-peoples-atlas-us/units/00-united-states/lessons/atlas-us-p006-united-states/worksheet.yml',
  'utf8',
));
const itemsById = new Map(bankDoc.items.map((i) => [i.id, i]));

const ids = [
  'us-rockies-separation', 'us-western-ocean', 'us-eastern-ocean', 'us-commonwealth-possession',
  'us-hawaii-western-extent', 'us-northern-border', 'us-continent', 'us-alaska-caption-resources',
  'us-noncontiguous-states', 'us-southern-boundaries',
];

const bank = { id: 'worst-case', items: ids.map((id) => itemsById.get(id)) };
const blocks = ids.map((id, index) => {
  const item = itemsById.get(id);
  const choices = [item.answer, ...item.decoys.slice(0, 4)];
  return {
    type: 'question', itemId: id, number: index + 1, omr: true, fillAfter: true,
    blocks: [
      { type: 'rich_text', md: item.prompt },
      { type: 'omr_response', itemId: id, choices: choices.length, layout: 'compact' },
    ],
    choices,
    ...(item.type === 'multi_select' ? { answers: item.answers } : { answer: item.answer }),
  };
});

const doc = {
  schema: 'school.document/v2',
  id: 'worst-case',
  title: 'The United States',
  archetype: 'worksheet',
  header: {
    name: true, date: true, scoreBox: false, metaFirst: true, rule: false,
    subtitle: 'U.S. states, capital, boundaries, landforms, and noncontiguous geography.',
    reading: 'Read: The Young People’s Atlas of the United States, pages 6–7.',
    frame: 'double',
  },
  fit: { policy: 'prefer-one-page', typeScale: 'standard' },
  defaultPoints: 1,
  blocks,
};

function createChoiceResolver(bank) {
  const items = new Map((bank?.items ?? []).map((item) => [item.id, item]));
  return (itemId) => {
    const item = items.get(itemId);
    const choices = [item.answer, ...item.decoys.slice(0, 4)];
    const labels = choices.map((c) => String(c));
    if (item.type === 'multi_select') return { labels, multiSelect: true, maxSelect: item.maxSelect };
    return labels;
  };
}

function measure(density, balance, growLastPage = false) {
  const theme = createWorkbookTheme({ typeScale: doc.fit.typeScale, density });
  const furnitureOpts = { gutter: true, duplex: true, title: doc.title, nameLine: 'Learner-Four' };
  const box = contentBox(theme, furnitureOpts);
  const measurementDoc = createMeasurementDocument({ theme });
  const fragments = measureDocumentFragments(doc, {
    doc: measurementDoc, theme, texToSvg: async () => ({ svg: '', widthPt: 0, heightPt: 0 }), resolveAsset: null,
    resolveChoices: createChoiceResolver(bank),
    studentName: 'Learner-Four', widthPt: box.widthPt, italic: true, totalPoints: 10, tokens: null,
  });
  const { pages } = placeFragments(fragments, {
    pageHeightPt: box.pageHeightPt, marginPt: box.marginPt, spacing: theme.spacing, balance, growLastPage,
  });
  console.log(`--- density=${density} balance=${balance} growLastPage=${growLastPage} ---`);
  pages.forEach((p, i) => {
    const last = p.fragments[p.fragments.length - 1];
    const bottom = last ? last.yPt + last.heightPt : box.marginPt;
    console.log(`  page ${i + 1}: ${p.fragments.length} fragments, bottom y=${bottom.toFixed(1)}, contentBottomPt=${(box.pageHeightPt - box.marginPt).toFixed(1)}, spareAtBottom=${(box.pageHeightPt - box.marginPt - bottom).toFixed(1)}`);
  });
}

measure('compact', false, false);
measure('compact', true, false);
measure('compact', true, true);
