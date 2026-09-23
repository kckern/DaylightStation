import { describe, expect, it, vi } from 'vitest';
import { validateDocumentSource, publishDocument } from '#domains/school/documents/documentSource.mjs';
import { planRows } from '#domains/school/documents/allocation.mjs';
import { RecordCardScanOutcome } from '#apps/school/documents/RecordCardScanOutcome.mjs';
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { createMeasurementDocument, measureDocumentFragments } from '#rendering/school/documents/measure.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { texToSvg } from '#rendering/school/documents/mathSvg.mjs';
import {
  DEFAULT_SETTINGS, buildWordQuizSource, emptyDay, emptyStatusV3, emptyWordV3, expandLexiconDeck, foldPaperAttempts, openDay, quizDocumentIdFor, validateLexicon,
} from './index.mjs';

const G = 'week-01-classroom';
const { lexicon: LEXICON } = validateLexicon({
  schema: 'school.word-lexicon/v2',
  package: 'korean-vocab',
  language: { code: 'ko', name: 'Korean' },
  gloss: { code: 'en', name: 'English' },
  program: { title: 'Korean words' },
  entries: [
    { id: 'annyeong', kind: 'phrase', group: G, term: '안녕', gloss: 'Hi (casual)', pronunciation: 'an-nyeong', decoys: { term: ['안녕하세요', '안녕히계세요', '안경'], gloss: ['Hello (polite)', 'Thank you', 'Excuse me'] } },
    { id: 'annyeong-haseyo', kind: 'phrase', group: G, term: '안녕하세요', gloss: 'Hello (polite)', pronunciation: 'an-nyeong-ha-se-yo', decoys: { term: ['안녕히계세요', '안녕', '안녕히가세요'], gloss: ['Hi (casual)', 'Goodbye (to someone staying)', 'Thank you'] } },
    { id: 'gawi', kind: 'word', group: G, term: '가위', gloss: 'Scissors', pronunciation: null, decoys: { term: ['가지', '바위', '가방'], gloss: ['Knife', 'Tape', 'Ruler'] } },
  ],
});
const QUIZ_INSTRUCTIONS = LEXICON.quiz.instructions;
// annyeong-haseyo's decoy 'Goodbye (to someone staying)' is not an entry in THIS three-word fixture, so validation passes.
const DECK = { id: 'language/korean/week-01-classroom', title: 'Korean — Classroom', words: ['annyeong', 'annyeong-haseyo', 'gawi'] };

describe('a second language needs only YAML', () => {
  const { errors, lexicon: spanish } = validateLexicon({
    schema: 'school.word-lexicon/v2',
    package: 'spanish-vocab',
    language: { code: 'es', name: 'Spanish' },
    gloss: { code: 'en', name: 'English' },
    program: { title: 'Spanish words' },
    quiz: { instructions: 'Stuck? Open Spanish words on the Portal first.' },
    entries: [
      { id: 'gato', kind: 'word', group: 'unit-01-animals', term: 'gato', gloss: 'Cat', decoys: { term: ['pato', 'perro', 'gallo'], gloss: ['Dog', 'Duck', 'Rooster'] } },
      { id: 'perro', kind: 'word', group: 'unit-01-animals', term: 'perro', gloss: 'Dog', decoys: { term: ['gato', 'pero', 'pato'], gloss: ['Cat', 'Pig', 'Duck'] } },
      { id: 'hola', kind: 'phrase', group: 'unit-02-greetings', term: 'hola', gloss: 'Hello', pronunciation: 'OH-lah', decoys: { term: ['adiós', 'gracias', 'buenas noches'], gloss: ['Goodbye', 'Thank you', 'Good night'] } },
    ],
  });
  const raw = { schema: 'school.flashcard-deck/v1', id: 'language/spanish/unit-01', title: 'Spanish — Unit 1', revision: 1, lexicon: 'media:language/spanish-vocab/lexicon.yml', words: ['gato', 'perro', 'hola'] };
  it('validates, expands into grouped media paths, plans and prints a quiz in Spanish', () => {
    expect(errors).toEqual([]);
    expect(spanish.quiz.topics).toEqual(['spanish', 'vocabulary']);
    const { errors: deckErrors, deck } = expandLexiconDeck(raw, spanish);
    expect(deckErrors).toEqual([]);
    expect(deck.cards[2].front.blocks[2].assetId).toBe('media:language/spanish-vocab/words/unit-02-greetings/hola/term.mp3');
    const { dayFile } = openDay({
      status: emptyStatusV3(), dayFile: emptyDay('2026-09-22'), day: '2026-09-22', deckId: raw.id,
      pool: raw.words, settings: DEFAULT_SETTINGS, learnerId: 'test-learner', at: '2026-09-22T16:00:00-07:00',
    });
    expect(dayFile.rounds[0].words.length).toBeGreaterThan(0);
    expect(dayFile.rounds[0].words.every((id) => raw.words.includes(id))).toBe(true);
    const quiz = buildWordQuizSource({ deck, lexicon: spanish, seed: 7 });
    expect(validateDocumentSource(quiz).errors).toEqual([]);
    expect(quiz.blocks[0].blocks[0].md).toBe('What does **gato** mean?');
    expect(quiz.blocks[1].blocks[0].md).toBe('Which is **Dog** in Spanish?');
    expect(quiz.topics).toEqual(['spanish', 'vocabulary']);
    expect(quiz.header.instructions).toBe('Stuck? Open Spanish words on the Portal first.');
    expect(JSON.stringify(quiz)).not.toMatch(/korean/i);
  });
});

describe('buildWordQuizSource', () => {
  const source = buildWordQuizSource({ deck: DECK, lexicon: LEXICON, seed: 4242 });
  it('is a valid young-scale quiz source with the stuck-on-a-word instruction', () => {
    expect(validateDocumentSource(source).errors).toEqual([]);
    expect(source).toMatchObject({
      schema: 'school.document-source/v1', id: 'language/korean/week-01-classroom-quiz', subject: 'language',
      archetype: 'quiz', target: ['letter'], fit: { typeScale: 'young' }, header: { instructions: QUIZ_INSTRUCTIONS },
    });
    expect(QUIZ_INSTRUCTIONS).toBe('Not sure of a word? Open Korean words on the Portal and review the cards, then come back.');
    expect(source.topics).toEqual(['korean', 'vocabulary']);
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
    // The printed sheet only shows lettered choices when the question carries an omr_response.
    for (const q of questions) {
      expect(q.omr).toBe(true);
      expect(q.blocks[1]).toEqual({ type: 'omr_response', itemId: q.itemId, choices: q.choices.length, layout: 'compact' });
    }
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

    const seeded = emptyStatusV3();
    seeded.words.gawi = { ...emptyWordV3(), state: 'claimed' };
    const { status, folded } = foldPaperAttempts({
      status: seeded, attempts: appended, quizDocumentIds: [quizDocumentIdFor(DECK.id)], dayOf: (at) => at.slice(0, 10), settings: { afterMisses: 2, gapScale: 1 },
    });
    expect(folded.filter((row) => !row.correct).map((row) => row.wordId)).toEqual(['gawi']);
    expect(status.words.gawi.state).toBe('familiar');
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
