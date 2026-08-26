/**
 * The lesson card's companion access code prints as a scannable QR in the
 * card's side rail — beside the subject icon, code under the symbol in the
 * dedicated code font — never as an inline text line in the reading column.
 *
 * What these tests prove: geometry (rail widening, bounded card growth), the
 * codeMap record (bare-code payload, ink actually emitted), and that a card
 * WITHOUT a companion measures exactly as it always did. What they cannot
 * prove is that the page LOOKS right — that gate is a rendered PDF viewed by
 * a human, not this file.
 */
import { describe, it, expect } from 'vitest';
import { createDocumentPdfRenderer } from './DocumentPdfRenderer.mjs';
import { createMeasurementDocument, measureBlocks } from './measure.mjs';
import { createWorkbookTheme } from './workbookTheme.mjs';
import { createSubjectIconResolver } from './assetResolver.mjs';
import { texToSvg } from './mathSvg.mjs';

const theme = createWorkbookTheme();
const resolveAsset = createSubjectIconResolver({ logger: { warn() {} } });
const renderer = createDocumentPdfRenderer({ theme, texToSvg, resolveAsset });

const CODE = '483920';
const card = (extra = {}) => ({
  type: 'inset', layout: 'lesson_card', subjectIcon: 'science', subjectName: 'Science',
  breadcrumb: 'Earth Science · Unit 2 · Lesson 5', lessonTitle: 'Inside the Earth',
  reading: 'Read: Our Dynamic Planet, pages 12–14.', citation: 'Structure of the Earth.',
  questionCount: 4, passPercent: 80,
  progress: [{ label: 'Course', total: 24, completed: 9 }, { label: 'Unit', total: 6, completed: 2 }],
  blocks: [{ type: 'rich_text', md: 'Inside the Earth' }],
  ...extra,
});

function measureCard(extra) {
  const doc = createMeasurementDocument({ theme });
  const [fragment] = measureBlocks([card(extra)], { doc, theme, texToSvg, resolveAsset });
  return fragment.nodes[0];
}

const contentWidthPt = theme.page.widthPt - 2 * theme.page.marginPt;

describe('lesson card companion QR rail', () => {
  it('a card with NO companion keeps the exact rail it always had, and no companion node', () => {
    const node = measureCard();
    expect(node.railPt).toBeCloseTo(Math.min(92, contentWidthPt * 0.18), 5);
    expect(node.companion).toBeNull();
    expect(node.iconRowHeightPt).toBe(node.icon.heightPt);
  });

  it('a companion widens the rail to min(112, 22%) and puts the QR beside the icon, code under it', () => {
    const node = measureCard({ companionCode: CODE });
    expect(node.railPt).toBeCloseTo(Math.min(112, contentWidthPt * 0.22), 5);
    const { companion } = node;
    expect(companion.code).toBe(CODE);
    // The QR shares the icon's row: both fit side by side inside the rail.
    expect(node.icon.widthPt + companion.qrSizePt).toBeLessThanOrEqual(node.railPt);
    // The code sits under the symbol, sized to fit its width.
    expect(companion.codeSizePt).toBeGreaterThan(0);
    expect(companion.heightPt).toBeGreaterThan(companion.qrSizePt);
    // The icon row grows to the QR+code stack, so progress rows clear the code.
    expect(node.iconRowHeightPt).toBeGreaterThanOrEqual(companion.heightPt);
  });

  it('the companion never prints as an inline text line, and grows the card at most ~20pt', () => {
    const plain = measureCard();
    const companion = measureCard({ companionCode: CODE });
    // The old `COMPANION • PANEL CODE …` label is gone from the text column.
    const textEntries = [companion.breadcrumb, companion.title, companion.reading, companion.citation, companion.success];
    for (const entry of textEntries.filter(Boolean)) {
      for (const line of entry.lines) {
        for (const run of line.runs) expect(run.text ?? '').not.toContain('PANEL CODE');
      }
    }
    const growth = companion.heightPt - plain.heightPt;
    expect(growth).toBeGreaterThanOrEqual(0);
    expect(growth).toBeLessThanOrEqual(20);
  });

  it('renders end to end: the codeMap records the bare access code with real ink on page 1', async () => {
    const source = {
      id: 'companion-card-test', title: 'Inside the Earth', seed: 7, variant: 0,
      target: ['letter'], blocks: [card({ companionCode: CODE })],
    };
    const { codeMap, pageCount } = await renderer.render(source, {});
    expect(pageCount).toBe(1);
    expect(codeMap).toHaveLength(1);
    // Payload is the BARE code — a scan and a typed code resolve identically.
    expect(codeMap[0].text).toBe(CODE);
    expect(codeMap[0].page).toBe(1);
    expect(codeMap[0].darkModules).toBeGreaterThan(0);
  });

  it('a card without a companion records no QR at all', async () => {
    const source = {
      id: 'plain-card-test', title: 'Inside the Earth', seed: 7, variant: 0,
      target: ['letter'], blocks: [card()],
    };
    const { codeMap } = await renderer.render(source, {});
    expect(codeMap).toHaveLength(0);
  });

  it('both PDF themes carry the shared kongtext code face for printed access codes', async () => {
    expect(theme.fonts.code.file).toBe('kongtext/kongtext.ttf');
    const { documentPdfTheme } = await import('./documentPdfTheme.mjs');
    expect(documentPdfTheme.fonts.code.file).toBe('kongtext/kongtext.ttf');
  });
});
