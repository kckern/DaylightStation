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

// Theoretical worst case for the "upper" profile (question_count:10,
// multi_select:[1,2]): BOTH multi_select items this bank has (there are
// only two total, so "2" always means these two) plus the 8 longest
// multiple_choice prompts by character count — maximizes wrapped-line count
// across the page, which is what actually drives page height (not the
// question COUNT, which is fixed at 10 by the profile either way).
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

function measure(density) {
  const theme = createWorkbookTheme({ typeScale: doc.fit.typeScale, density });
  const furnitureOpts = { gutter: true, duplex: true, title: doc.title, nameLine: 'Learner-Four' };
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
  console.log(density, 'pages=', pages.length, 'totalPt=', totalPt.toFixed(1), 'availablePt=', availablePt.toFixed(1), 'oversetPt=', Math.max(0, totalPt - availablePt).toFixed(1));
}

measure('normal');
measure('compact');
