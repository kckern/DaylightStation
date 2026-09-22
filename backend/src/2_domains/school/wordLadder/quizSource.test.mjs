import { describe, expect, it, vi } from 'vitest';
import { validateDocumentSource, publishDocument } from '#domains/school/documents/documentSource.mjs';
import { planRows } from '#domains/school/documents/allocation.mjs';
import { RecordCardScanOutcome } from '#apps/school/documents/RecordCardScanOutcome.mjs';
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { createMeasurementDocument, measureDocumentFragments } from '#rendering/school/documents/measure.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { texToSvg } from '#rendering/school/documents/mathSvg.mjs';
import {
  QUIZ_INSTRUCTIONS, buildWordQuizSource, emptyStatus, foldPaperAttempts, quizDocumentIdFor, validateLexicon,
} from './index.mjs';

const { entries: LEXICON } = validateLexicon({ schema: 'school.word-lexicon/v1', entries: [
  { id: 'annyeong', kind: 'phrase', korean: '안녕', english: 'Hi (casual)', pronunciation: 'an-nyeong', decoys: { korean: ['안녕하세요', '안녕히계세요', '안경'], english: ['Hello (polite)', 'Thank you', 'Excuse me'] } },
  { id: 'annyeong-haseyo', kind: 'phrase', korean: '안녕하세요', english: 'Hello (polite)', pronunciation: 'an-nyeong-ha-se-yo', decoys: { korean: ['안녕히계세요', '안녕', '안녕히가세요'], english: ['Hi (casual)', 'Goodbye (to someone staying)', 'Thank you'] } },
  { id: 'gawi', kind: 'word', korean: '가위', english: 'Scissors', pronunciation: null, decoys: { korean: ['가지', '바위', '가방'], english: ['Knife', 'Tape', 'Ruler'] } },
] });
// annyeong-haseyo's decoy 'Goodbye (to someone staying)' is not an entry in THIS three-word fixture, so validation passes.
const DECK = { id: 'language/korean/week-01-classroom', title: 'Korean — Classroom', words: ['annyeong', 'annyeong-haseyo', 'gawi'] };

describe('buildWordQuizSource', () => {
  const source = buildWordQuizSource({ deck: DECK, lexicon: LEXICON, seed: 4242 });
  it('is a valid young-scale quiz source with the stuck-on-a-word instruction', () => {
    expect(validateDocumentSource(source).errors).toEqual([]);
    expect(source).toMatchObject({
      schema: 'school.document-source/v1', id: 'language/korean/week-01-classroom-quiz', subject: 'language',
      archetype: 'quiz', target: ['letter'], fit: { typeScale: 'young' }, header: { instructions: QUIZ_INSTRUCTIONS },
    });
    expect(QUIZ_INSTRUCTIONS).toBe('Not sure of a word? Open Korean words on the Portal and review the cards, then come back.');
    expect(quizDocumentIdFor(DECK.id)).toBe(source.id);
  });
  it('one question per word, itemId = word id, answer + 3 authored decoys, alternating directions', () => {
    const questions = source.blocks.filter((block) => block.type === 'question');
    expect(questions.map((q) => q.itemId)).toEqual(DECK.words);
    expect(questions.map((q) => q.number)).toEqual([1, 2, 3]);
    expect(questions[0].blocks[0].md).toBe('What does **안녕** mean?');
    expect(questions[0].choices).toContain('Hi (casual)');
    expect(questions[0].answer).toBe('Hi (casual)');
    expect(questions[1].blocks[0].md).toBe('Which is **Hello (polite)** in Korean?');
    expect(questions[1].answer).toBe('안녕하세요');
    for (const q of questions) {
      expect(q.choices).toHaveLength(4);
      expect(new Set(q.choices).size).toBe(4);
      expect(q.choices).toContain(q.answer);
    }
    expect(buildWordQuizSource({ deck: DECK, lexicon: LEXICON, seed: 4242 })).toEqual(source);
  });
  it('publishes, allocates rows whose itemId is the word id, and a scanned miss folds into a demotion', async () => {
    const { errors, published, bank, rev } = publishDocument(source);
    expect(errors).toBeUndefined();
    const { rows } = planRows({ document: published, bank, startRow: 1 });
    expect(rows.map((row) => row.itemId)).toEqual(DECK.words);
    expect(rows.every((row) => row.choiceCount === 4)).toBe(true);

    const appended = [];
    const datastore = { appendAttempt: (learnerId, attempt) => { appended.push(attempt); return attempt; }, readAllAttempts: () => [] };
    const scan = new RecordCardScanOutcome({ datastore, clock: () => new Date('2026-09-26T21:00:00.000Z'), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } });
    const results = rows.map((row, index) => ({
      row: row.row, itemId: row.itemId, itemType: row.itemType, prompt: null,
      status: index === 2 ? 'incorrect' : 'correct', given: 'x', points: 1, earned: index === 2 ? 0 : 1, concepts: [],
    }));
    await scan.execute({ testId: '1234567', card: {
      cardId: '1234567', recordId: `${published.id}@${rev}:v0:1-3`, documentId: published.id, rev, variant: 0,
      learnerId: 'kid', revisionSuperseded: false, renderedAt: '2026-09-25T20:00:00.000Z',
      results, totalPoints: 3, earnedPoints: 2, unscannedItems: [],
    } });
    expect(appended.map((a) => a.itemId)).toEqual(DECK.words);
    expect(appended.every((a) => a.transport === 'paper' && a.bankId === `${published.id}@${rev}`)).toBe(true);

    const { status, folded } = foldPaperAttempts({ status: emptyStatus(), attempts: appended, quizDocumentIds: [quizDocumentIdFor(DECK.id)], dayOf: (at) => at.slice(0, 10) });
    expect(folded.filter((row) => !row.correct).map((row) => row.wordId)).toEqual(['gawi']);
    expect(status.words.gawi.state).toBe('learning');
    expect(status.words.annyeong.state).toBe('new');
  });
  it('renders the instruction line under the title, inside the content width, with Hangul embedded', async () => {
    const { published, bank } = publishDocument(source);
    const theme = createWorkbookTheme({ typeScale: 'young' });
    const measureDoc = createMeasurementDocument({ theme });
    const [header] = measureDocumentFragments(published, { doc: measureDoc, theme, texToSvg });
    expect(header.nodes[0].instructions).toBe(QUIZ_INSTRUCTIONS);
    const style = theme.styles.caption ?? theme.styles.instruction ?? theme.styles.body;
    const width = measureDoc.font(theme.fonts[style.font].name).fontSize(style.sizePt).widthOfString(QUIZ_INSTRUCTIONS);
    // The line is drawn with lineBreak:false, so it must fit the quiz's gutter-narrowed content box.
    const contentWidthPt = theme.page.widthPt - 2 * theme.page.marginPt - theme.furniture.gutterPt;
    expect(width).toBeLessThanOrEqual(contentWidthPt);
    const { pdf } = await createDocumentPdfRenderer({ theme, texToSvg }).render(published, { bank });
    expect(pdf.toString('latin1')).toMatch(/NotoSansKR-Regular/);
  });
});
