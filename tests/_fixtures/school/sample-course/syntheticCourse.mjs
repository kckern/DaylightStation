/**
 * Synthetic stand-in for the household's Korean course, with the SAME schema.
 *
 * Every word, phrase and prompt here is invented (nonsense syllable strings and
 * made-up English glosses) so no textbook content is committed. The real course
 * lives in the data volume (`data/content/school/learning-catalog/documents/
 * language/korean-3-2/`) and is built from `--source-dir` by korean-course.cli.mjs.
 *
 * `syntheticLessons()` returns lessons 2..16 shaped like the CLI's source JSON:
 * new lessons carry 2 patterns / 6 questions, reviews 4 / 8, the final 20 / 20,
 * which is the coverage `assembleKoreanCourse` demands of a complete course.
 */
const SYL = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타'];
const NOUNS = ['kite', 'lantern', 'anchor', 'orchard', 'ribbon', 'saddle', 'thimble', 'compass', 'quilt', 'hammock',
  'pebble', 'meadow', 'bonnet', 'walrus', 'turnip', 'glacier', 'bucket', 'fiddle', 'harbor', 'mitten',
  'pickle', 'rocket', 'sundial', 'trellis', 'violin', 'whistle', 'yodel', 'zipper', 'acorn', 'beacon'];

/** A deterministic nonsense Hangul word, unique per (lesson, index). */
export const syntheticWord = (lesson, index) => {
  const n = lesson * 100 + index; // unique while < 1728 (three base-12 digits)
  return SYL[n % 12] + SYL[Math.floor(n / 12) % 12] + SYL[Math.floor(n / 144) % 12];
};
const pad = (n) => String(n).padStart(2, '0');
const noun = (lesson, index) => `${NOUNS[(lesson * 7 + index * 3) % NOUNS.length]} ${lesson}-${index}`;
const kindOf = (n) => (n === 16 ? 'final' : [3, 6, 9, 12, 15].includes(n) ? 'review' : 'new');
const src = (page) => ({ book: 'textbook', page });

/** Labels the 20 final patterns re-use; each is taught first in a new/review lesson. */
export const patternLabel = (k) => `-sample-pattern-${pad(k)}`;

function question(lesson, p, q) {
  const id = `p${pad(p)}-q${pad(q)}`;
  const a = syntheticWord(lesson, 40 + p * 5 + q);
  const b = syntheticWord(lesson, 60 + p * 5 + q);
  const c = syntheticWord(lesson, 80 + p * 5 + q);
  const d = syntheticWord(lesson, 20 + p * 5 + q);
  const e = syntheticWord(lesson, 30 + p * 5 + q);
  return {
    id,
    modelId: `m${pad(p)}`,
    explanation: `Sample rule ${p}: the ${a} ending marks the sample form.`,
    formA: { prompt: `Sample form A ${lesson}.${p}.${q}: ${a}___`, choices: [`${a}다`, `${a}요`, `${a}니`, `${a}고`], answer: `${a}다` },
    formB: { prompt: `Sample form B ${lesson}.${p}.${q}: ${b}___`, choices: [`${b}요`, `${c}다`, `${d}다`, `${e}다`], answer: `${b}요` },
  };
}

function pattern(lesson, label, p, questionCount) {
  const model = syntheticWord(lesson, 10 + p);
  const model2 = syntheticWord(lesson, 12 + p);
  return {
    id: `pattern-${pad(p)}`,
    label,
    explanation: `Invented explanation for ${label}: attach the sample ending to the stem.`,
    source: src(28 + p),
    models: [{
      id: `m${pad(p)}`, term: `${model} ${model2}.`, gloss: `a sample sentence ${lesson}-${p}`,
      pronunciation: `sample ${lesson} ${p}`, source: src(28 + p),
    }],
    questions: Array.from({ length: questionCount }, (_, q) => question(lesson, p, q + 1)),
  };
}

export function syntheticLesson(n) {
  const kind = kindOf(n);
  const base = {
    lesson: n,
    title: `Sample lesson ${n}`,
    koreanTitle: `${syntheticWord(n, 1)} ${syntheticWord(n, 2)}`,
    kind,
    textbookPages: [10 + n, 19 + n],
    workbookPages: [4 + n, 9 + n],
    objectives: [`Practice invented sample pattern set ${n}.`, 'Recognize the sample vocabulary in both directions.'],
  };
  if (kind === 'final') {
    // 20 patterns, 1 question each, all re-using labels taught earlier.
    return { ...base, vocabulary: [], patterns: Array.from({ length: 20 }, (_, i) => pattern(n, patternLabel(i + 1), i + 1, 1)) };
  }
  const patternCount = kind === 'new' ? 2 : 4;
  const perPattern = kind === 'new' ? 3 : 2;
  // New lessons teach labels 1.. in order; reviews re-teach labels from earlier lessons.
  const newOrder = [2, 4, 5, 7, 8, 10, 11, 13, 14];
  const reviewOrder = [3, 6, 9, 12, 15];
  const first = kind === 'new' ? newOrder.indexOf(n) * 2 : reviewOrder.indexOf(n) * 4;
  const patterns = Array.from({ length: patternCount }, (_, i) => {
    const label = kind === 'new' ? patternLabel(first + i + 1) : patternLabel(((first + i) % 18) + 1);
    return pattern(n, label, i + 1, perPattern);
  });
  // The final needs 20 distinct labels; reviews contribute the last two.
  if (n === 15) { patterns[0].label = patternLabel(19); patterns[1].label = patternLabel(20); }
  const vocabulary = Array.from({ length: kind === 'new' ? 6 : 3 }, (_, i) => ({
    id: `w${pad(i + 1)}`, term: syntheticWord(n, i + 1), gloss: noun(n, i + 1), source: src(27),
  }));
  return { ...base, vocabulary, patterns };
}

export const syntheticLessons = () => Array.from({ length: 15 }, (_, i) => syntheticLesson(i + 2));
