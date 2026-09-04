#!/usr/bin/env node
/** Reproducible authoring source for Elementary Mathematics: Grade 2–3 Bridge. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { renderMathAsset } from '../cli/school/math-assets.mjs';
import { validateQuestionBank } from '../backend/src/2_domains/school/questionBankValidation.mjs';
import { validateUnit } from '../backend/src/2_domains/school/curriculum/unitValidation.mjs';
import { elementaryMathMasteryBlueprint } from './school/elementary-math-mastery.mjs';

const COURSE = 'elementary-math-2-3';
const COURSE_TITLE = 'Elementary Mathematics: Grade 2–3 Bridge';
const SOURCE_MAP_PATH = fileURLToPath(new URL('./school/elementary-math-source-map.yml', import.meta.url));
const SOURCE = Object.freeze({
  beast: { name: 'Beast Academy 2A Guide' },
  boosters: { name: 'Math Boosters: Addition and Subtraction' },
  ultimate: { name: 'The Ultimate Grade 3 Math Workbook' },
  authored: { name: 'Original bridge-course synthesis' },
});
const pick = (values, index) => values[index % values.length];
const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
const unique = (values) => [...new Set(values.map(String))];
const countedNoun = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
const joinedList = (values) => values.length < 2 ? values[0] : values.length === 2
  ? `${values[0]} and ${values[1]}` : `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;

const FEEDBACK_BY_KIND = Object.freeze({
  calculation: 'Line up the numbers by place value, use the operation shown, and check each step.',
  place_value: 'Find the named digit, identify its place, and use that place to decide what the digit represents.',
  base_ten: 'Count the hundreds, tens, and ones separately, then combine their values.',
  forms: 'Match each digit to its place before combining the expanded-form parts.',
  sequence: 'Compare neighboring numbers to find the repeated step, then use that step once more.',
  compare: 'Compare the greatest place first; if those digits tie, move one place to the right.',
  number_line: 'Start at a labeled tick and count equal spaces—not tick marks—to point A.',
  round: 'Find the rounding place, then use the digit immediately to its right to decide whether to round up.',
  ten_frame: 'Count a full group of ten first, then add any counters in the next frame.',
  missing: 'Undo the known operation to find the missing number, then substitute it to check the equation.',
  mental: 'Break one number into friendly tens and ones, then combine the partial results.',
  multi_add: 'Add two numbers first, keep that subtotal, and then add the third number.',
  fact_family: 'Use the same three numbers to write the related inverse fact.',
  inverse: 'Add the difference and the number subtracted; the check must return to the starting number.',
  operation: 'Decide whether the story joins amounts or separates them before choosing an operation.',
  word: 'Identify what changed in the story, choose the matching operation, and check whether the result is reasonable.',
  two_step: 'Work the story in time order and carry the first result into the second step.',
  graph: 'Read the amount for each label from the graph, then compare those amounts.',
  graph_difference: 'Read both amounts from the graph and subtract the smaller amount from the larger one.',
  array: 'Count the rows and the number in each row, then multiply those two numbers.',
  groups: 'Multiply the number of equal groups by the number in each group.',
  property: 'Turn the array around: switching the two factors does not change the total.',
  division_model: 'Share the total into equal groups and count how many land in one group.',
  fraction: 'Count all equal parts for the denominator and shaded parts for the numerator.',
  fraction_set: 'Use all counters as the denominator and the shaded counters as the numerator.',
  fraction_line: 'Count the equal spaces from zero to one for the denominator, then count spaces to point A.',
  fraction_compare: 'For equal denominators, compare numerators; for equivalent fractions, scale numerator and denominator together.',
  money: 'Find each coin group’s value, then add the groups in cents.',
  clock: 'Read the short hour hand and then count the long minute hand by fives.',
  measurement: 'Match the object and what is being measured to a unit of a sensible size.',
  shape: 'Count sides and corners, and notice whether sides are straight or curved.',
  quadrilateral: 'Use the number of sides, equal sides, right angles, and parallel sides to classify the shape.',
  area: 'Area counts square units, so multiply the rectangle’s rows by its columns.',
  perimeter: 'Perimeter is the distance around the outside, so add all four side lengths.',
  advanced: 'Line up equal place values, add from right to left, and regroup when a column reaches ten.',
});

function defaultFeedback(def) {
  const feedback = FEEDBACK_BY_KIND[def.kind];
  if (!feedback) throw new Error(`missing instructional feedback for ${def.kind} (${def.id})`);
  return feedback;
}

/**
 * Select four authored distractors. There is intentionally no numeric fallback:
 * a generic answer-neighbour generator hides missing pedagogy and turns every
 * error into an undiagnosable counting slip. Callers must supply misconceptions
 * that are fair for the exact question being asked.
 */
function decoysFor(answer, candidates = []) {
  const target = String(answer);
  const result = unique(candidates).filter((value) => value !== target).slice(0, 4);
  if (result.length < 4) throw new Error(`not enough authored decoys for ${target}; got ${result.join(', ') || 'none'}`);
  return result;
}

function nonNegative(values) {
  return values.filter((value) => typeof value !== 'number' || value >= 0);
}

/** Add each column without carrying. This is a real, recognizable error model. */
function addWithoutRegrouping(...terms) {
  const width = Math.max(...terms.map((value) => String(value).length));
  let result = '';
  for (let place = width - 1; place >= 0; place -= 1) {
    const column = terms.reduce((sum, value) => sum + Math.floor(value / (10 ** (width - place - 1))) % 10, 0);
    result = `${column % 10}${result}`;
  }
  return Number(result);
}

/** Subtract the smaller digit from the larger digit in every column, never borrowing. */
function subtractWithoutRegrouping(minuend, subtrahend) {
  const width = Math.max(String(minuend).length, String(subtrahend).length);
  let result = '';
  for (let place = width - 1; place >= 0; place -= 1) {
    const power = 10 ** (width - place - 1);
    const a = Math.floor(minuend / power) % 10;
    const b = Math.floor(subtrahend / power) % 10;
    result = `${Math.abs(a - b)}${result}`;
  }
  return Number(result);
}

function arithmeticDecoys(a, b, op) {
  if (op === '+') {
    const answer = a + b; const place = answer >= 1000 ? 100 : 10;
    return nonNegative([
      addWithoutRegrouping(a, b),
      Math.abs(a - b),
      answer - place,
      answer + place,
      a,
      b,
      answer - 1,
    ]);
  }
  if (op === '−') {
    const answer = a - b; const place = a >= 1000 ? 100 : 10;
    return nonNegative([
      subtractWithoutRegrouping(a, b),
      a + b,
      answer + place,
      answer - place,
      a,
      b,
      answer + 1,
    ]);
  }
  if (op === '×') {
    return nonNegative([
      a + b,
      a * Math.max(0, b - 1),
      a * (b + 1),
      Math.max(0, a - 1) * b,
      (a + 1) * b,
      a * b + 1,
    ]);
  }
  if (op === '÷') {
    const answer = a / b;
    return nonNegative([
      b,
      a - b,
      answer + 1,
      answer - 1,
      a,
      a / Math.max(1, b - 1),
    ]).filter(Number.isInteger);
  }
  throw new Error(`unsupported arithmetic operation ${op}`);
}

function properFractionDecoys(numerator, denominator) {
  return [
    `${Math.max(1, denominator - numerator)}/${denominator}`,
    `${Math.max(1, numerator - 1)}/${denominator}`,
    `${Math.min(denominator, numerator + 1)}/${denominator}`,
    `${numerator}/${denominator + 1}`,
    `${Math.min(denominator, numerator + 1)}/${denominator + 1}`,
    `1/${denominator}`,
    `${denominator - 1}/${denominator}`,
    `${numerator}/${denominator + 2}`,
    `${Math.min(denominator + 1, numerator + 2)}/${denominator + 2}`,
    `${denominator}/${denominator}`,
  ];
}

function item(def, index, {
  prompt, answer, decoys = [], stimulus = null, feedback = null, source = def.source ?? 'authored',
  concepts = [], referenceIndex = 0,
}) {
  if (!SOURCE[source]) throw new Error(`unknown source family ${source} for ${def.id}`);
  const { role: _role, ...reviewReference } = def.studyReferences[referenceIndex] ?? def.studyReferences[0];
  return {
    id: `${slug(def.id)}-q${String(index + 1).padStart(2, '0')}`,
    type: 'multiple_choice', prompt, answer: String(answer), decoys: decoysFor(answer, decoys), levels: ['lower'],
    concepts: unique([slug(def.kind), ...concepts]),
    reviewReference,
    feedback: { incorrect: feedback ?? defaultFeedback(def) },
    ...(stimulus ? { stimulus: { type: 'asset', ref: stimulus.ref, alt: stimulus.alt } } : {}),
  };
}

function authoredItems(def, questions) {
  if (questions.length !== 12) throw new Error(`${def.id}: authored question set must contain exactly 12 items`);
  return questions.map((question, index) => item(def, index, question));
}

function authoredRows(def, rows, shared = {}) {
  return authoredItems(def, rows.map(([prompt, answer, decoys, feedback, concepts = []]) => ({
    ...shared, prompt, answer, decoys, feedback, concepts,
  })));
}

const PAIRS = Object.freeze({
  addFacts: [[3, 8], [7, 6], [9, 4], [5, 7], [8, 8], [6, 9], [4, 7], [2, 9], [5, 8], [9, 9], [7, 7], [6, 8]],
  add2: [[23, 14], [35, 22], [41, 38], [52, 16], [64, 25], [31, 47], [26, 13], [43, 24], [55, 32], [62, 17], [34, 45], [71, 18]],
  add2Regroup: [[28, 47], [36, 29], [58, 24], [67, 18], [45, 39], [76, 17], [29, 64], [38, 55], [49, 33], [57, 26], [68, 25], [79, 14]],
  add3: [[246, 132], [358, 247], [469, 125], [517, 286], [638, 174], [729, 163], [284, 519], [395, 408], [476, 327], [587, 216], [698, 205], [749, 138]],
  subFacts: [[13, 6], [15, 7], [18, 9], [14, 5], [17, 8], [12, 7], [16, 9], [11, 4], [19, 8], [14, 8], [17, 9], [13, 5]],
  sub2: [[68, 24], [75, 31], [89, 46], [57, 23], [96, 52], [84, 41], [73, 22], [65, 34], [98, 57], [76, 45], [87, 36], [69, 28]],
  sub2Regroup: [[72, 38], [81, 47], [93, 56], [64, 29], [85, 48], [70, 36], [92, 57], [61, 27], [83, 49], [74, 58], [90, 46], [82, 35]],
  sub3: [[503, 178], [642, 286], [731, 459], [804, 367], [920, 584], [715, 238], [600, 274], [843, 596], [902, 475], [781, 394], [650, 287], [930, 568]],
  sub4: [[5032, 1786], [6421, 2867], [7310, 4598], [8043, 3679], [9200, 5846], [7152, 2388], [6004, 2749], [8431, 5967], [9020, 4758], [7814, 3946], [6500, 2875], [9302, 5689]],
  mul: [[2, 7], [3, 6], [4, 8], [5, 7], [10, 6], [3, 9], [4, 6], [2, 12], [5, 8], [10, 9], [4, 7], [3, 8]],
  mulAdvanced: [[6, 7], [7, 8], [8, 9], [9, 11], [11, 12], [6, 12], [7, 9], [8, 11], [9, 12], [6, 8], [7, 11], [8, 12]],
  div: [[14, 2], [18, 3], [32, 4], [35, 5], [60, 10], [27, 3], [24, 4], [20, 5], [40, 10], [45, 5], [28, 4], [30, 3]],
  divAdvanced: [[42, 6], [56, 7], [72, 8], [81, 9], [99, 11], [144, 12], [63, 7], [88, 8], [108, 9], [66, 6], [121, 11], [96, 12]],
});

function figure(ctx, def, index, kind, alt, params) {
  const ref = `school/math/${COURSE}/figures/${slug(def.id)}-q${String(index + 1).padStart(2, '0')}`;
  const spec = { schema: 'school.math-svg/v1', ref, kind, alt, params };
  ctx.specs.set(ref, spec); return { ref, alt };
}

function calculation(def, index) {
  const [a, b] = pick(PAIRS[def.params.pairs], index); const op = def.params.op;
  const answer = op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : a / b;
  const feedback = op === '+'
    ? `Add ${a} and ${b} by place value; regroup a column only when its total reaches ten.`
    : op === '−'
      ? `Subtract ${b} from ${a}; when a top digit is too small, regroup from the place to its left.`
      : op === '×'
        ? `Use ${a} equal groups of ${b}, or a nearby fact you know, and check the total by repeated addition.`
        : `Ask how many groups of ${b} make ${a}, then check by multiplying the quotient by ${b}.`;
  return item(def, index, { prompt: `What is $${a} ${op} ${b}$?`, answer, decoys: arithmeticDecoys(a, b, op), feedback });
}

const solvedExample = (def, { prompt, choices, answer, steps, appliesTo = [slug(def.kind)] }) => ({
  id: `${slug(def.id)}-worked-example`,
  title: 'Worked example',
  ...(appliesTo?.length ? { appliesTo: { concepts: unique(appliesTo) } } : {}),
  question: { type: 'multiple_choice', prompt, choices: choices.map(String) },
  solution: { steps, answer: String(answer) },
});

function calculationWorkedExample(def) {
  const examples = {
    addFacts: { a: 4, b: 5, answer: 9, steps: ['Start at 5 and count on 4: 6, 7, 8, 9.', 'So 4 + 5 = 9.'] },
    add2: { a: 24, b: 13, answer: 37, steps: ['Add ones: 4 + 3 = 7.', 'Add tens: 2 tens + 1 ten = 3 tens.'] },
    add2Regroup: { a: 27, b: 18, answer: 45, steps: ['7 + 8 = 15, so write 5 ones and regroup 1 ten.', '2 tens + 1 ten + 1 ten = 4 tens.'] },
    add3: { a: 358, b: 247, answer: 605, steps: ['8 + 7 = 15; write 5 and regroup 1 ten.', '5 + 4 + 1 = 10; write 0 and regroup to make 605.'] },
    subFacts: { a: 16, b: 7, answer: 9, steps: ['Think: 7 + what equals 16?', '7 + 9 = 16.'] },
    sub2: { a: 79, b: 35, answer: 44, steps: ['Subtract ones: 9 − 5 = 4.', 'Subtract tens: 7 tens − 3 tens = 4 tens.'] },
    sub2Regroup: { a: 73, b: 48, answer: 25, steps: ['Regroup 73 as 6 tens and 13 ones.', '13 − 8 = 5 and 6 tens − 4 tens = 2 tens.'] },
    sub3: { a: 612, b: 287, answer: 325, steps: ['Start with the ones and regroup from the next place when needed.', 'Subtract ones, tens, then hundreds to get 325.'] },
    sub4: { a: 7043, b: 2685, answer: 4358, steps: ['Start with the ones and regroup across the zero.', 'Subtract each place from ones through thousands to get 4358.'] },
    mul: { a: 3, b: 4, answer: 12, steps: ['Three groups of 4 are 4 + 4 + 4.', '4 + 4 + 4 = 12.'] },
    mulAdvanced: { a: 7, b: 12, answer: 84, steps: ['Break 12 into 10 + 2.', '7 × 10 + 7 × 2 = 70 + 14 = 84.'] },
    div: { a: 21, b: 3, answer: 7, steps: ['Ask how many groups of 3 make 21.', '3 × 7 = 21.'] },
    divAdvanced: { a: 84, b: 7, answer: 12, steps: ['Use the related multiplication fact.', '7 × 12 = 84.'] },
  };
  const chosen = examples[def.params.pairs] ?? (def.params.op === '−' ? examples.sub2
    : def.params.op === '×' ? examples.mul : def.params.op === '÷' ? examples.div : examples.add2);
  return solvedExample(def, {
    prompt: `What is ${chosen.a} ${def.params.op} ${chosen.b}?`,
    choices: [chosen.answer, ...decoysFor(chosen.answer, arithmeticDecoys(chosen.a, chosen.b, def.params.op)).slice(0, 3)],
    answer: chosen.answer,
    steps: chosen.steps,
  });
}

/** One representative, fully solved question for every lesson kind. */
function workedExampleFor(def) {
  if (def.kind === 'mastery') {
    const representative = workedExampleFor(def.masteryOf[0]);
    return {
      ...representative,
      id: `${slug(def.id)}-worked-example`,
      // A cumulative sheet intentionally mixes concepts; the example is a
      // stable orientation strip, so it must not disappear based on its draw.
      appliesTo: undefined,
    };
  }
  if (def.kind === 'calculation') return calculationWorkedExample(def);
  if (def.kind === 'place_value') return solvedExample(def, def.params.fourDigit ? {
    prompt: 'In 5274, what amount does the digit 2 represent?', choices: ['2', '20', '200', '2000'], answer: '200',
    steps: ['The digit 2 is in the hundreds place.', 'Two hundreds equal 200.'],
  } : {
    prompt: 'In 364, what amount does the digit 6 represent?', choices: ['6', '60', '600'], answer: '60',
    steps: ['The digit 6 is in the tens place.', 'Six tens equal 60.'],
  });
  if (def.kind === 'base_ten') return solvedExample(def, {
    prompt: 'A model has 2 hundreds, 4 tens, and 3 ones. What number is shown by the base-ten blocks?',
    choices: ['243', '234', '423'], answer: '243',
    steps: ['2 hundreds = 200, 4 tens = 40, and 3 ones = 3.', '200 + 40 + 3 = 243.'],
  });
  if (def.kind === 'forms') return solvedExample(def, {
    prompt: 'Which number equals 500 + 30 + 7?', choices: ['537', '573', '503', '5307'], answer: '537',
    steps: ['500 gives the hundreds digit 5 and 30 gives the tens digit 3.', 'Add 7 ones to make 537.'],
  });
  if (def.kind === 'sequence') return solvedExample(def, {
    prompt: 'What comes next? 15, 20, 25, ___', choices: ['26', '30', '35'], answer: '30',
    steps: ['Each number is 5 more than the one before it.', '25 + 5 = 30.'],
  });
  if (def.kind === 'compare') {
    const least = def.params.mode === 'least';
    return solvedExample(def, {
      prompt: `Which number is ${least ? 'least' : 'greatest'}?`,
      choices: ['491', '419', '194', '941'], answer: least ? '194' : '941',
      steps: ['Compare the hundreds digits first.', `${least ? '1 is the smallest' : '9 is the largest'} hundreds digit.`],
    });
  }
  if (def.kind === 'number_line') return solvedExample(def, {
    prompt: 'On a number line, point A is 2 spaces after 15. What number is marked by point A?',
    choices: ['16', '17', '18'], answer: '17',
    steps: ['Start at 15 and count spaces, not tick marks.', 'Two spaces after 15 is 17.'],
  });
  if (def.kind === 'round') {
    const hundreds = def.params.place === 100;
    return solvedExample(def, hundreds ? {
      prompt: 'Round 364 to the nearest hundred.', choices: ['300', '360', '400'], answer: '400',
      steps: ['Look at the tens digit, 6.', 'Because 6 is 5 or more, round 3 hundreds up to 4 hundreds.'],
    } : {
      prompt: 'Round 63 to the nearest ten.', choices: ['60', '63', '70'], answer: '60',
      steps: ['Look at the ones digit, 3.', 'Because 3 is less than 5, keep 6 tens.'],
    });
  }
  if (def.kind === 'ten_frame') return solvedExample(def, {
    prompt: 'A full ten-frame and 7 more counters are shown. How many counters are shown?',
    choices: ['7', '10', '17'], answer: '17',
    steps: ['A full ten-frame has 10 counters.', '10 + 7 = 17.'],
  });
  if (def.kind === 'missing') return solvedExample(def, def.params.op === '−' ? {
    prompt: 'What number makes 18 − □ = 11 true?', choices: ['7', '11', '18', '29'], answer: '7',
    steps: ['Find the difference between 18 and 11.', '18 − 7 = 11.'],
  } : {
    prompt: 'What number makes 7 + □ = 15 true?', choices: ['8', '7', '15', '22'], answer: '8',
    steps: ['Subtract the known addend from the total.', '15 − 7 = 8.'],
  });
  if (def.kind === 'mixed_missing') return solvedExample(def, {
    prompt: 'What number makes 6 × □ = 42 true?', choices: ['6', '7', '36'], answer: '7',
    steps: ['Use the related division fact 42 ÷ 6.', '42 ÷ 6 = 7, and 6 × 7 = 42.'],
  });
  if (def.kind === 'mental') {
    const subtract = def.params.op === '−';
    return solvedExample(def, subtract ? {
      prompt: 'Solve mentally: 47 − 18.', choices: ['29', '31', '39'], answer: '29',
      steps: ['Subtract 20 to get 27.', 'Add back 2 because 18 is 2 less than 20: 29.'],
    } : {
      prompt: 'Solve mentally: 47 + 18.', choices: ['55', '65', '75'], answer: '65',
      steps: ['Add 20 to get 67.', 'Subtract 2 because 18 is 2 less than 20: 65.'],
    });
  }
  if (def.kind === 'multi_add') return solvedExample(def, {
    prompt: 'What is 14 + 25 + 36?', choices: ['65', '75', '85'], answer: '75',
    steps: ['14 + 25 = 39.', '39 + 36 = 75.'],
  });
  if (def.kind === 'fact_family') return solvedExample(def, def.params.family === 'division' ? {
    prompt: 'If 5 × 6 = 30, what is 30 ÷ 5?', choices: ['5', '6', '25'], answer: '6',
    steps: ['Multiplication and division undo each other.', 'Because 5 × 6 = 30, 30 ÷ 5 = 6.'],
  } : {
    prompt: 'If 4 + 9 = 13, what is 13 − 4?', choices: ['4', '9', '17'], answer: '9',
    steps: ['Addition and subtraction undo each other.', 'Because 4 + 9 = 13, 13 − 4 = 9.'],
  });
  if (def.kind === 'inverse') return solvedExample(def, {
    prompt: 'Which addition equation proves that 62 − 27 = 35 is correct?',
    choices: ['35 + 27 = 62', '62 + 27 = 89', '62 + 35 = 27'], answer: '35 + 27 = 62',
    steps: ['Add the difference to the number that was subtracted.', '35 + 27 returns to 62.'],
  });
  if (def.kind === 'operation') return solvedExample(def, {
    prompt: 'Leo has 18 cards and gets 7 more. Which operation finds how many he has now?',
    choices: ['addition', 'subtraction', 'division'], answer: 'addition',
    steps: ['The words “gets more” mean the amount increases.', 'Use addition to join the two amounts.'],
  });
  if (def.kind === 'word') return solvedExample(def, {
    prompt: 'A basket held 36 apples. The family used 19. How many apples remain?',
    choices: ['17', '45', '55'], answer: '17',
    steps: ['“Remain” asks what is left, so subtract.', '36 − 19 = 17.'],
  });
  if (def.kind === 'two_step') return solvedExample(def, {
    prompt: 'A box held 25 pencils. 12 were added, then 8 were used. How many pencils are in the box?',
    choices: ['29', '37', '45'], answer: '29',
    steps: ['First add: 25 + 12 = 37.', 'Then subtract: 37 − 8 = 29.'],
  });
  if (def.kind === 'problem_solving_challenge') return solvedExample(def, {
    prompt: 'Five bags hold 6 marbles each. Four marbles roll away. How many marbles remain?',
    choices: ['26', '30', '34'], answer: '26',
    steps: ['First find the starting total: 5 × 6 = 30.', 'Then subtract the 4 marbles that rolled away: 30 − 4 = 26.'],
  });
  if (def.kind === 'graph') return solvedExample(def, def.params.style === 'line_plot' ? {
    prompt: 'A line plot has 2 X marks above 2, 5 above 3, and 3 above 4. Which number appears most often?',
    choices: ['2', '3', '4'], answer: '3',
    steps: ['Count the X marks above each number.', 'Five is the greatest count, so 3 appears most often.'],
  } : {
    prompt: 'A graph shows Red with 3 votes, Blue with 6, and Green with 2. Which color received the most votes?',
    choices: ['Red', 'Blue', 'Green'], answer: 'Blue',
    steps: ['Compare the number of votes for each color.', '6 is the greatest number, so Blue has the most.'],
  });
  if (def.kind === 'graph_difference') return solvedExample(def, {
    prompt: 'A graph shows Dogs with 9 votes and Cats with 5. How many more votes did Dogs get than Cats?',
    choices: ['4', '5', '14'], answer: '4',
    steps: ['“How many more” asks for the difference.', '9 − 5 = 4.'],
  });
  if (def.kind === 'data_challenge') return solvedExample(def, {
    prompt: 'A graph shows 7 red votes, 5 blue votes, and 4 green votes. How many votes are shown altogether?',
    choices: ['11', '12', '16'], answer: '16',
    steps: ['A total uses every category.', 'Add 7 + 5 + 4 = 16.'],
  });
  if (def.kind === 'array') return solvedExample(def, {
    prompt: 'An array has 3 rows with 5 dots in each row. How many dots are in the array?',
    choices: ['8', '15', '35'], answer: '15',
    steps: ['Multiply rows by dots in each row.', '3 × 5 = 15.'],
  });
  if (def.kind === 'groups') return solvedExample(def, {
    prompt: 'There are 4 equal groups with 3 in each group. How many altogether?',
    choices: ['7', '12', '43'], answer: '12',
    steps: ['Use 4 groups of 3.', '4 × 3 = 12.'],
  });
  if (def.kind === 'property') return solvedExample(def, {
    prompt: 'Which multiplication fact has the same answer as 3 × 7?',
    choices: ['7 × 3', '3 + 7', '3 × 6'], answer: '7 × 3',
    steps: ['Turn the array around by switching the factors.', '3 × 7 and 7 × 3 both equal 21.'],
  });
  if (def.kind === 'division_model') return solvedExample(def, {
    prompt: '24 counters are shared equally among 6 groups. How many are in each group?',
    choices: ['4', '6', '18'], answer: '4',
    steps: ['Share one counter at a time among all 6 groups.', 'Each group receives 4 because 6 × 4 = 24.'],
  });
  if (def.kind === 'division_story') return solvedExample(def, {
    prompt: 'Twenty-four photos are placed 6 on each page. How many pages are needed?',
    choices: ['4', '6', '18'], answer: '4',
    steps: ['This asks how many groups of 6 fit in 24.', 'Because 6 × 4 = 24, 24 ÷ 6 = 4 pages.'],
  });
  if (def.kind === 'fraction') return solvedExample(def, {
    prompt: 'A bar has 5 equal parts and 3 are shaded. What fraction of the bar is shaded?',
    choices: ['2/5', '3/5', '3/8'], answer: '3/5',
    steps: ['Five equal parts make the denominator 5.', 'Three shaded parts make the numerator 3.'],
  });
  if (def.kind === 'fraction_set') return solvedExample(def, {
    prompt: '5 of 8 counters are shaded. What fraction of the counters are shaded?',
    choices: ['3/8', '5/8', '5/13'], answer: '5/8',
    steps: ['Use all 8 counters as the denominator.', 'Use the 5 shaded counters as the numerator.'],
  });
  if (def.kind === 'fraction_line') return solvedExample(def, {
    prompt: 'A number line from 0 to 1 has 5 equal spaces. Point A is at the second mark. Which fraction is marked by point A?',
    choices: ['1/5', '2/5', '2/3'], answer: '2/5',
    steps: ['Five equal spaces make the denominator 5.', 'Two spaces from 0 make the numerator 2.'],
  });
  if (def.kind === 'fraction_compare') return solvedExample(def, {
    prompt: 'Which fraction is greater: 2/7 or 5/7?', choices: ['2/7', '5/7', 'They are equal'], answer: '5/7',
    steps: ['The denominators are equal, so compare numerators.', '5 is greater than 2.'],
  });
  if (def.kind === 'fraction_challenge') return solvedExample(def, {
    prompt: 'Which fraction is equivalent to 3/4?', choices: ['4/5', '6/8', '6/7'], answer: '6/8',
    steps: ['Multiply both the numerator and denominator by 2.', '3 × 2 over 4 × 2 is 6/8.'],
  });
  if (def.kind === 'money') return solvedExample(def, {
    prompt: 'What is the total value, in cents, of 2 quarters, 1 dime, 2 nickels, and 4 pennies?',
    choices: ['64', '74', '84'], answer: '74',
    steps: ['Coin values: 50¢ + 10¢ + 10¢ + 4¢.', '50 + 10 + 10 + 4 = 74¢.'],
  });
  if (def.kind === 'money_challenge') return solvedExample(def, {
    prompt: 'A toy costs 63¢. You pay with 3 quarters. How much change should you receive?',
    choices: ['12¢', '13¢', '22¢'], answer: '12¢',
    steps: ['Three quarters are worth 75¢.', 'Subtract the 63¢ cost: 75 − 63 = 12¢.'],
  });
  if (def.kind === 'clock') return solvedExample(def, {
    prompt: 'The short hand points just past 7 and the long hand points to the 4. What time does the clock show?',
    choices: ['4:35', '7:20', '7:40'], answer: '7:20',
    steps: ['The short hand gives the hour: 7.', 'The long hand at 4 means 4 groups of 5 minutes, or 20 minutes.'],
  });
  if (def.kind === 'measurement') return solvedExample(def, {
    prompt: 'Which is the most reasonable estimate for the height of a door?', choices: ['2 centimeters', '2 meters', '2 kilometers'], answer: '2 meters',
    steps: ['Height is a length, so compare sensible length units.', 'A door is about as tall as a person, so 2 meters is reasonable.'],
  });
  if (def.kind === 'measurement_application') return solvedExample(def, {
    prompt: 'A 16-centimeter strip loses a 7-centimeter piece. How long is the strip now?',
    choices: ['9 centimeters', '16 centimeters', '23 centimeters'], answer: '9 centimeters',
    steps: ['“Loses” means subtract while keeping the unit centimeters.', '16 − 7 = 9, so 9 centimeters remain.'],
  });
  if (def.kind === 'shape') return solvedExample(def, {
    prompt: 'Shape A has five straight sides. What is the name of shape A?',
    choices: ['triangle', 'pentagon', 'hexagon'], answer: 'pentagon',
    steps: ['Count the five straight sides.', 'A shape with five sides is a pentagon.'],
  });
  if (def.kind === 'quadrilateral') return solvedExample(def, {
    prompt: 'Which shape has four right angles, two 6-inch sides, and two 3-inch sides?',
    choices: ['rectangle', 'rhombus', 'trapezoid'], answer: 'rectangle',
    steps: ['Four right angles rule out the rhombus and trapezoid.', 'Two long sides and two shorter sides describe a rectangle.'],
  });
  if (def.kind === 'area') return solvedExample(def, {
    prompt: 'A rectangle is 4 units by 6 units. What is its area in square units?',
    choices: ['10', '20', '24'], answer: '24',
    steps: ['Area counts rows of square units.', '4 × 6 = 24 square units.'],
  });
  if (def.kind === 'perimeter') return solvedExample(def, {
    prompt: 'A rectangle is 6 units long and 4 units wide. What is its perimeter?',
    choices: ['10', '20', '24'], answer: '20',
    steps: ['Perimeter adds every outside side.', '6 + 4 + 6 + 4 = 20 units.'],
  });
  if (def.kind === 'geometry_challenge') return solvedExample(def, {
    prompt: 'A rectangle has area 24 square units and one side is 6 units. How long is the other side?',
    choices: ['4 units', '12 units', '18 units'], answer: '4 units',
    steps: ['Area is length × width.', 'Find the missing factor: 6 × 4 = 24.'],
  });
  if (def.kind === 'cumulative_arithmetic') return solvedExample(def, {
    prompt: 'Which equation proves that 83 − 47 = 36?', choices: ['36 + 47 = 83', '83 + 47 = 130', '47 − 36 = 11'], answer: '36 + 47 = 83',
    steps: ['Addition undoes subtraction.', 'Add the difference and subtrahend to return to 83.'],
  });
  if (def.kind === 'cumulative_data') return solvedExample(def, {
    prompt: 'A graph shows 8 cats, 5 dogs, and 3 birds. How many pets are shown?', choices: ['8', '13', '16'], answer: '16',
    steps: ['A total includes all three categories.', 'Add 8 + 5 + 3 = 16.'],
  });
  if (def.kind === 'cumulative_fraction_geometry') return solvedExample(def, {
    prompt: 'A 3-by-4 rectangle has one row shaded. What fraction of its area is shaded?', choices: ['1/3', '1/4', '3/4'], answer: '1/3',
    steps: ['Three equal rows divide the whole into thirds.', 'One of the three rows is shaded, so 1/3 is shaded.'],
  });
  if (def.kind === 'cumulative_measurement') return solvedExample(def, {
    prompt: 'A movie begins at 2:15 and lasts 30 minutes. When does it end?', choices: ['2:30', '2:45', '3:15'], answer: '2:45',
    steps: ['Add 30 minutes to 2:15.', 'Fifteen plus 30 minutes is 45 minutes, so the time is 2:45.'],
  });
  if (def.kind === 'final_challenge') return solvedExample(def, {
    prompt: 'Four tables seat 6 students each. Three students are absent. How many students are present?', choices: ['21', '24', '27'], answer: '21',
    steps: ['Find all seats: 4 × 6 = 24.', 'Subtract the 3 absent students: 24 − 3 = 21.'],
  });
  if (def.kind === 'advanced') return solvedExample(def, {
    prompt: 'Challenge: What is 2345 + 678?', choices: ['2923', '3013', '3023'], answer: '3023',
    steps: ['Line up ones, tens, hundreds, and thousands.', 'Add right to left and regroup each total of 10 or more.'],
  });
  if (def.kind === 'fluency') return solvedExample(def, def.params.op === '−' ? {
    prompt: 'Use a known fact to solve 16 − 7.', choices: ['7', '9', '23'], answer: '9',
    steps: ['Think of the related addition fact 7 + 9 = 16.', 'Therefore 16 − 7 = 9.'],
  } : {
    prompt: 'Use a make-ten strategy to solve 8 + 5.', choices: ['12', '13', '14'], answer: '13',
    steps: ['Move 2 from the 5 to make 8 into 10.', '10 + 3 = 13.'],
  });
  throw new Error(`missing worked example for ${def.kind} (${def.id})`);
}

function buildItems(def, ctx) {
  if (def.kind === 'calculation') return Array.from({ length: 12 }, (_, index) => calculation(def, index));
  if (def.kind === 'fluency') {
    const addition = [
      ['What is $9 + 7$?', '16', ['15', '17', '2', '63'], 'Make 10: move 1 from 7 to 9, then add 10 + 6.'],
      ['What is $8 + 6$?', '14', ['13', '15', '2', '48'], 'Make 10: move 2 from 6 to 8, leaving 10 + 4.'],
      ['What is double 8, plus 1?', '17', ['16', '18', '9', '15'], 'Double 8 is 16; then add the extra 1.'],
      ['What is $10 + 7 + 3$?', '20', ['17', '13', '21', '10'], 'Combine 7 + 3 to make 10, then add the other 10.'],
      ['What number makes $9 + \\Box = 20$ true?', '11', ['9', '10', '19', '29'], 'Subtract 9 from 20, then check by adding the missing number back.'],
      ['Which expression has a sum of 20?', '12 + 8', ['12 + 7', '11 + 8', '13 + 8', '10 + 8'], 'Make a ten or add on to test each expression; only one totals 20.'],
      ['Use a near-double: what is $6 + 7$?', '13', ['12', '14', '1', '42'], 'Double 6 is 12, and one more makes 13.'],
      ['What is $4 + 9 + 6$?', '19', ['13', '15', '18', '20'], 'Combine 4 + 6 to make 10, then add 9.'],
      ['Nia has 8 cards and receives 7 more. How many cards does she have?', '15', ['1', '14', '16', '56'], 'The amount increases, so add 8 + 7.'],
      ['Which is another way to make the sum $8 + 5$?', '10 + 3', ['8 + 3', '10 + 5', '5 + 2', '13 + 2'], 'Move 2 from the 5 to the 8; the total stays the same.'],
      ['Which equation is true?', '7 + 8 = 15', ['7 + 8 = 14', '7 + 7 = 15', '8 + 8 = 15', '15 + 1 = 15'], 'Use a known double or make-ten fact to check both sides of each equation.'],
      ['Which expression has the greatest value?', '9 + 9', ['8 + 9', '7 + 10', '6 + 11', '5 + 12'], 'Compare each sum; the four decoys make 17, while 9 + 9 makes 18.'],
    ];
    const subtraction = [
      ['What is $15 − 7$?', '8', ['7', '9', '22', '15'], 'Use the related fact 7 + 8 = 15.'],
      ['What is $18 − 9$?', '9', ['8', '10', '27', '18'], 'Half of 18 is 9, so removing 9 leaves 9.'],
      ['If $8 + 7 = 15$, what is $15 − 8$?', '7', ['8', '15', '23', '6'], 'Subtraction undoes addition and returns the other addend.'],
      ['What number makes $20 − \\Box = 11$ true?', '9', ['11', '20', '31', '8'], 'Find the difference between 20 and 11, then substitute it to check.'],
      ['Use a make-ten strategy: what is $17 − 8$?', '9', ['8', '10', '25', '7'], 'Subtract 7 to reach 10, then subtract 1 more.'],
      ['Which expression has a difference of 9?', '16 − 7', ['16 − 6', '15 − 7', '17 − 7', '14 − 6'], 'Use addition to check which subtrahend plus 9 returns to the starting number.'],
      ['A box held 14 markers. Six were used. How many remain?', '8', ['6', '14', '20', '9'], '“Remain” means subtract 6 from 14.'],
      ['What is $14 − 6$?', '8', ['6', '7', '9', '20'], 'Break apart 6: subtract 4 to reach 10, then subtract 2 more.'],
      ['What number makes $19 − \\Box = 10$ true?', '9', ['10', '19', '29', '8'], 'The missing amount is the difference between 19 and 10.'],
      ['Which expression has the greatest value?', '18 − 5', ['17 − 5', '16 − 4', '15 − 3', '14 − 2'], 'Compute or compare each difference; only 18 − 5 is 13.'],
      ['Which equation is true?', '16 − 7 = 9', ['16 − 7 = 8', '16 − 9 = 9', '9 − 7 = 16', '16 + 7 = 9'], 'Check subtraction with addition: difference + subtrahend must equal the starting number.'],
      ['What is $20 − 6 − 4$?', '10', ['14', '16', '18', '30'], 'Work left to right: 20 − 6 = 14, then 14 − 4 = 10.'],
    ];
    const rows = def.params.op === '−' ? subtraction : addition;
    return authoredItems(def, rows.map(([prompt, answer, decoys, feedback]) => ({ prompt, answer, decoys, feedback })));
  }
  if (def.kind === 'place_value') return Array.from({ length: 12 }, (_, index) => {
    const number = pick(def.params.fourDigit
      ? [4821, 7316, 5064, 2948, 8603, 3159, 9472, 6285, 7041, 1596, 2738, 8904]
      : [482, 731, 506, 294, 860, 315, 947, 628, 704, 159, 273, 890], index);
    const places = def.params.fourDigit ? ['thousands', 'hundreds', 'tens', 'ones'] : ['hundreds', 'tens', 'ones']; const place = places[index % places.length];
    const divisor = place === 'thousands' ? 1000 : place === 'hundreds' ? 100 : place === 'tens' ? 10 : 1;
    const digit = Math.floor(number / divisor) % 10;
    if (index % 3 === 1) {
      return item(def, index, {
        prompt: `Which digit is in the ${place} place in ${number}?`, answer: digit,
        decoys: [...String(number)].map(Number).concat([digit - 1, digit + 1, 0, 5, 9]),
        feedback: `Read ${number} by place: the ${place} digit is ${digit}.`,
      });
    }
    const prompt = index % 3 === 0
      ? `In ${number}, what amount does the digit ${digit} represent?`
      : `In ${number}, the digit ${digit} is in the ${place} place. What amount does it represent?`;
    return item(def, index, {
      prompt, answer: digit * divisor,
      decoys: [digit, digit * 10, digit * 100, digit * 1000, number, divisor, divisor * 2, divisor * 5],
      feedback: `The digit ${digit} is in the ${place} place, so it represents ${digit} × ${divisor} = ${digit * divisor}.`,
    });
  });
  if (def.kind === 'base_ten') return Array.from({ length: 12 }, (_, index) => {
    const h = 1 + index % 4; const t = (index * 2 + 1) % 6; const o = (index * 3 + 2) % 8; const answer = h * 100 + t * 10 + o;
    return item(def, index, { prompt: 'What number is shown by the base-ten blocks?', answer,
      decoys: [
        h * 100 + o * 10 + t, // tens and ones reversed
        t * 100 + h * 10 + o, // hundreds and tens reversed
        h + t + o, // physical blocks counted instead of their values
        h * 100 + t + o, // tens treated as ones
        t * 10 + o, // hundreds omitted
        h * 100 + t * 10, // ones omitted
        h * 100 + o, // tens omitted
        h * 10 + t + o, // hundreds treated as tens
        h * 100 + t * 100 + o, // tens treated as hundreds
      ],
      feedback: `The model has ${countedNoun(h, 'hundred')}, ${countedNoun(t, 'ten')}, and ${countedNoun(o, 'one')}; combine ${h * 100} + ${t * 10} + ${o}.`,
      stimulus: figure(ctx, def, index, 'base_ten', `${countedNoun(h, 'hundred')}, ${countedNoun(t, 'ten')}, and ${countedNoun(o, 'one')} shown with base-ten blocks.`, { hundreds: h, tens: t, ones: o }) });
  });
  if (def.kind === 'forms') return Array.from({ length: 12 }, (_, index) => {
    const h = 1 + index % 8; const t = (index * 3) % 10; const o = (index * 7 + 2) % 10; const answer = h * 100 + t * 10 + o;
    return item(def, index, {
      prompt: `Which number equals $${h * 100} + ${t * 10} + ${o}$?`, answer,
      decoys: [
        h * 100 + o * 10 + t,
        h * 10 + t + o,
        h * 1000 + t * 10 + o,
        h * 100 + t + o * 10,
        h * 1000 + t * 100 + o * 10,
        h * 100 + t * 10,
        t * 10 + o,
      ],
      feedback: `Match ${h * 100}, ${t * 10}, and ${o} to the hundreds, tens, and ones places before combining them.`,
    });
  });
  if (def.kind === 'sequence') return Array.from({ length: 12 }, (_, index) => {
    const step = pick(def.params.steps ?? [2, 5, 10, 100], index); const start = (index + 1) * step; const last = start + 2 * step; const answer = last + step;
    return item(def, index, { prompt: `What comes next? ${start}, ${start + step}, ${last}, ___`, answer,
      decoys: [last, answer + step, last + 1, last - step, answer + 1, last + Math.max(1, step - 1)],
      feedback: `Each term is ${step} more than the one before it; add ${step} to ${last}.` });
  });
  if (def.kind === 'compare') return Array.from({ length: 12 }, (_, index) => {
    const values = [328 + index * 7, 382 + index * 5, 283 + index * 9, 238 + index * 6]; const least = def.params.mode === 'least';
    const answer = least ? Math.min(...values) : Math.max(...values);
    const close = least ? answer + 1 : answer - 1;
    return item(def, index, {
      prompt: `Which number is ${least ? 'least' : 'greatest'}?`, answer,
      decoys: [...values.filter((value) => value !== answer), close, least ? answer + 2 : answer - 2],
      feedback: `Compare ${values.join(', ')} from hundreds to ones; ${answer} is ${least ? 'least' : 'greatest'}.`,
    });
  });
  if (def.kind === 'number_line') return Array.from({ length: 12 }, (_, index) => {
    const target = 2 + index; const labels = [0, 5, 10, 15, 20].filter((value) => value !== target);
    return item(def, index, { prompt: 'What number is marked by point A?', answer: target,
      decoys: nonNegative([target - 1, target + 1, target + 5, 20 - target, target + 2, target - 5]),
      feedback: `Begin at a labeled tick and count equal one-unit spaces to point A; the marked value is ${target}.`,
      stimulus: figure(ctx, def, index, 'number_line', 'A number line from zero to twenty with point A above one tick.', { min: 0, max: 20, step: 1, labels, marks: [{ value: target, label: 'A' }] }) });
  });
  if (def.kind === 'round') return Array.from({ length: 12 }, (_, index) => {
    const place = def.params.place ?? 10; const number = pick(place === 100 ? [149, 251, 348, 452, 550, 649, 751, 849, 950, 125, 375, 825] : [23, 47, 65, 81, 94, 136, 252, 378, 414, 569, 742, 887], index);
    const lower = Math.floor(number / place) * place; const upper = lower + place; const answer = Math.round(number / place) * place;
    return item(def, index, {
      prompt: `Round ${number} to the nearest ${place === 100 ? 'hundred' : 'ten'}.`, answer,
      decoys: nonNegative([lower, upper, lower - place, upper + place, number]),
      feedback: `The nearest multiples are ${lower} and ${upper}; use the ${place === 100 ? 'tens' : 'ones'} digit to choose between them.`,
    });
  });
  if (def.kind === 'ten_frame') return Array.from({ length: 12 }, (_, index) => {
    const filled = 4 + index; const capacity = filled > 10 ? 20 : 10;
    return item(def, index, { prompt: 'How many counters are shown?', answer: filled,
      decoys: nonNegative([capacity - filled, filled > 10 ? filled - 10 : 10 + filled, capacity, 10, filled - 1, filled + 1]),
      feedback: filled > 10 ? `Count the full frame as 10, then add the ${filled - 10} counters in the second frame.` : `Count the filled spaces, not the empty spaces, in the ten-frame.`,
      stimulus: figure(ctx, def, index, 'ten_frame', `Ten-frame model showing ${filled} filled counters.`, { filled, frames: filled > 10 ? 2 : 1 }) });
  });
  if (def.kind === 'missing') return Array.from({ length: 12 }, (_, index) => {
    const [a, b] = pick(def.params.op === '−' ? PAIRS.subFacts : PAIRS.addFacts, index); const total = def.params.op === '−' ? a : a + b; const answer = b;
    const prompt = def.params.op === '−' ? `What number makes $${total} − \\Box = ${total - b}$ true?` : `What number makes $${a} + \\Box = ${total}$ true?`;
    const result = total - b;
    return item(def, index, {
      prompt, answer,
      decoys: def.params.op === '−'
        ? nonNegative([result, total + result, total, result + b, answer - 1, answer + 1])
        : nonNegative([a, total, Math.abs(a - b), total + a, answer - 1, answer + 1]),
      feedback: def.params.op === '−'
        ? `Find what was removed by subtracting the remaining ${result} from the starting ${total}, then check ${total} − □ = ${result}.`
        : `Subtract the known addend ${a} from the total ${total}, then put the result back into the equation to check it.`,
    });
  });
  if (def.kind === 'mixed_missing') return authoredRows(def, [
    ['What number makes $47 + □ = 82$ true?', 35, [47, 82, 129, 45], 'Undo the addition: 82 − 47 = 35.', ['missing-addend']],
    ['What number makes $93 − □ = 58$ true?', 35, [58, 93, 151, 45], 'The missing subtrahend is 93 − 58 = 35.', ['missing-subtrahend']],
    ['What number makes $□ + 28 = 75$ true?', 47, [28, 75, 103, 57], 'The unknown start is 75 − 28 = 47.', ['missing-addend']],
    ['What number makes $□ − 19 = 46$ true?', 65, [27, 46, 19, 55], 'Add the difference and subtrahend: 46 + 19 = 65.', ['missing-minuend']],
    ['What number makes $6 × □ = 42$ true?', 7, [6, 36, 42, 48], 'Use the related fact 42 ÷ 6 = 7.', ['missing-factor']],
    ['What number makes $□ × 5 = 40$ true?', 8, [5, 35, 40, 45], 'Divide the product by the known factor: 40 ÷ 5 = 8.', ['missing-factor']],
    ['What number makes $56 ÷ □ = 7$ true?', 8, [7, 49, 56, 63], 'Find the factor that pairs with 7 to make 56; 7 × 8 = 56.', ['missing-divisor']],
    ['What number makes $□ ÷ 4 = 9$ true?', 36, [5, 13, 32, 45], 'Multiply quotient by divisor: 9 × 4 = 36.', ['missing-dividend']],
    ['Which value makes both $8 + □ = 21$ and $21 − □ = 8$ true?', 13, [8, 21, 29, 12], 'The equations are inverses; 21 − 8 = 13.', ['inverse-operations', 'missing-numbers']],
    ['Some pencils plus 26 new pencils make 71 pencils. How many pencils were there first?', 45, [26, 71, 97, 55], 'The unknown starting part is 71 − 26 = 45.', ['start-unknown', 'missing-numbers']],
    ['What number makes $64 = 27 + □$ true?', 37, [27, 64, 91, 47], 'Subtract the known part from the whole: 64 − 27 = 37.', ['missing-addend']],
    ['What number makes $72 ÷ 8 = □$ true?', 9, [8, 64, 72, 80], 'Use the related multiplication fact: 8 × 9 = 72.', ['missing-quotient']],
  ]);
  if (def.kind === 'mental') return Array.from({ length: 12 }, (_, index) => {
    const a = 19 + index * 10; const b = pick([9, 11, 18, 21], index); const op = def.params.op ?? '+'; const answer = op === '+' ? a + b : a - b;
    const friendly = Math.round(b / 10) * 10; const correction = b - friendly;
    const friendlyResult = op === '+' ? a + friendly : a - friendly;
    const wrongCorrection = op === '+' ? friendlyResult - correction : friendlyResult + correction;
    const compensation = op === '+'
      ? correction < 0 ? `subtract ${Math.abs(correction)}` : `add the extra ${correction}`
      : correction < 0 ? `add back ${Math.abs(correction)}` : `subtract the extra ${correction}`;
    return item(def, index, {
      prompt: `Solve mentally: $${a} ${op === '+' ? '+' : '−'} ${b}$.`, answer,
      decoys: nonNegative([friendlyResult, wrongCorrection, op === '+' ? a - b : a + b, answer + 10, answer - 10, answer + 1]),
      feedback: `Use ${friendly} as a friendly number, then ${compensation} to compensate.`,
    });
  });
  if (def.kind === 'multi_add') return Array.from({ length: 12 }, (_, index) => {
    const values = [12 + index, 23 + index * 2, 34 + index % 5]; const answer = values.reduce((sum, value) => sum + value, 0);
    return item(def, index, {
      prompt: `What is $${values.join(' + ')}$?`, answer,
      decoys: [values[0] + values[1], values[0] + values[2], values[1] + values[2], addWithoutRegrouping(...values), answer - 10, answer + 10],
      feedback: `Add ${values[0]} + ${values[1]} first, then add ${values[2]}; verify that all three addends were used.`,
    });
  });
  if (def.kind === 'fact_family') return Array.from({ length: 12 }, (_, index) => {
    const [a, b] = pick(def.params.family === 'division' ? PAIRS.mul : PAIRS.addFacts, index); const total = a * b;
    if (def.params.family === 'division') return item(def, index, {
      prompt: `If $${a} × ${b} = ${total}$, what is $${total} ÷ ${a}$?`, answer: b,
      decoys: nonNegative([a, total, a + b, total - a, b - 1, b + 1]),
      feedback: `Use the same fact-family numbers: because ${a} × ${b} = ${total}, dividing ${total} by ${a} returns the other factor.`,
    });
    return item(def, index, {
      prompt: `If $${a} + ${b} = ${a + b}$, what is $${a + b} − ${a}$?`, answer: b,
      decoys: nonNegative([a, a + b, Math.abs(a - b), a + b + a, b - 1, b + 1]),
      feedback: `Addition and subtraction undo each other: subtracting ${a} from ${a + b} returns the other addend.`,
    });
  });
  if (def.kind === 'inverse') return Array.from({ length: 12 }, (_, index) => {
    const [a, b] = pick(PAIRS.sub2Regroup, index); return item(def, index, { prompt: `Which addition equation proves that $${a} − ${b} = ${a - b}$ is correct?`, answer: `${a - b} + ${b} = ${a}`,
      decoys: [`${a} + ${b} = ${a + b}`, `${a - b} + ${a} = ${b}`, `${b} + ${a} = ${a - b}`, `${a} − ${a - b} = ${a}`],
      feedback: `Add the difference ${a - b} and the subtrahend ${b}; returning to ${a} proves the subtraction.` });
  });
  if (def.kind === 'operation') {
    const choices = ['addition', 'subtraction', 'multiplication', 'division', 'rounding'];
    const questions = [
      ['Two classes collected 28 cans and 35 cans. Which operation finds the combined number of cans?', 'addition', 'The two class amounts are parts of one combined total, so join them with addition.'],
      ['A jar held 64 beads. After an art project, 27 were left. Which operation finds how many beads were used?', 'subtraction', 'The starting amount and the amount left are known; subtract to find the missing change.'],
      ['Kai has 18 cards. Lena has 7 more cards than Kai. Which operation finds Lena’s number of cards?', 'addition', 'Lena’s amount is the known amount plus the stated difference.'],
      ['A blue ribbon is 53 centimeters long. A red ribbon is 38 centimeters long. Which operation finds how much longer the blue ribbon is?', 'subtraction', '“How much longer” asks for the difference between two lengths.'],
      ['There are 6 trays with 4 muffins on each tray. Which operation finds the total number of muffins?', 'multiplication', 'Equal groups with the same amount in each group are combined by multiplication.'],
      ['Thirty pencils are shared equally among 5 tables. Which operation finds the number at each table?', 'division', 'A total is being shared into equal groups, so divide by the number of groups.'],
      ['A team scored 16 points in one game and 23 in another. Which operation finds its total for both games?', 'addition', 'The question asks for a total made by joining two scores.'],
      ['Seventy-two seats were available and 49 were filled. Which operation finds the number of empty seats?', 'subtraction', 'Empty seats are the part left after the filled seats are removed from all seats.'],
      ['Each bicycle has 2 wheels. Which operation finds the number of wheels on 9 bicycles?', 'multiplication', 'Nine equal groups of two wheels are represented by multiplication.'],
      ['Forty-two photos are placed 6 on each page. Which operation finds the number of pages used?', 'division', 'The question asks how many groups of 6 fit in 42.'],
      ['A museum had 125 visitors before lunch and 88 after lunch. Which operation finds the whole-day attendance?', 'addition', 'Both time periods contribute to the whole-day total.'],
      ['A goal is 300 pages. Sam has read 184 pages. Which operation finds how many pages are still needed?', 'subtraction', 'Subtract the completed part from the goal to find the missing part.'],
    ];
    return authoredItems(def, questions.map(([prompt, answer, feedback]) => ({
      prompt, answer, decoys: choices.filter((choice) => choice !== answer), feedback,
    })));
  }
  if (def.kind === 'word') {
    const questions = [
      ['One class collected 38 cans and another collected 47. How many cans did they collect altogether?', 85, [9, 75, 76, 47], 'Join both class collections: 38 + 47 = 85.'],
      ['A library cart held 72 books. Students borrowed 38. How many books remained?', 34, [110, 44, 38, 72], 'Subtract the borrowed part from the starting amount: 72 − 38 = 34.'],
      ['Nora had 29 shells. After finding more, she had 63. How many shells did she find?', 34, [92, 29, 63, 44], 'The change is unknown, so subtract the starting amount from the ending amount: 63 − 29.'],
      ['Some birds were in a tree. After 17 flew away, 26 remained. How many birds were there at first?', 43, [9, 26, 17, 33], 'The starting amount is the remaining 26 plus the 17 that flew away.'],
      ['Luis has 46 cards. Priya has 18 fewer cards than Luis. How many cards does Priya have?', 28, [64, 18, 46, 38], '“18 fewer than 46” means 46 − 18 = 28.'],
      ['The red team scored 37 points. That was 16 more than the blue team. How many points did the blue team score?', 21, [53, 16, 37, 31], 'If 37 is 16 more, subtract 16 to find the smaller score.'],
      ['A gardener planted 54 tulips and 28 daffodils. How many flowers were planted?', 82, [26, 72, 54, 28], 'The two flower counts are parts of one total, so add 54 + 28.'],
      ['There were 91 tickets. After some were sold, 35 remained. How many tickets were sold?', 56, [126, 66, 35, 91], 'The sold part plus 35 makes 91, so calculate 91 − 35.'],
      ['Mika needs 80 points and has earned 47. How many more points does Mika need?', 33, [127, 43, 47, 80], 'The missing distance to the goal is 80 − 47 = 33.'],
      ['A train carried 68 passengers. At a stop, 24 got off and no one got on. How many passengers continued?', 44, [92, 34, 24, 68], 'The amount decreases, so subtract 24 from 68.'],
      ['A shelf has 36 fiction books and 59 nonfiction books. How many books are on the shelf?', 95, [23, 85, 36, 59], 'Both categories make the shelf total: 36 + 59 = 95.'],
      ['A box had some crayons. Adding 27 crayons made 74. How many crayons were in the box first?', 47, [101, 57, 27, 74], 'The unknown start plus 27 equals 74, so undo the addition with 74 − 27.'],
    ];
    return authoredItems(def, questions.map(([prompt, answer, decoys, feedback]) => ({ prompt, answer, decoys, feedback })));
  }
  if (def.kind === 'two_step') {
    const questions = [
      ['A shelf held 48 books. Twelve were added, then 9 were borrowed. How many books are on the shelf?', 51, [60, 39, 69, 45], 'Work in time order: 48 + 12 = 60, then 60 − 9 = 51.'],
      ['A class made 35 paper stars Monday and 28 Tuesday. It used 19 on a poster. How many stars were left?', 44, [63, 16, 82, 46], 'First combine both days: 35 + 28 = 63. Then subtract the 19 used.'],
      ['A bus began with 52 riders. Eighteen got off and 13 got on. How many riders are on the bus now?', 47, [34, 65, 21, 83], 'Follow the events: 52 − 18 = 34, then 34 + 13 = 47.'],
      ['There are 4 boxes with 6 markers in each box. Seven markers are being used. How many markers remain in the boxes?', 17, [24, 13, 31, 10], 'Find the total first: 4 × 6 = 24. Then subtract the 7 in use.'],
      ['A baker arranged 30 rolls equally on 5 trays, then added 2 rolls to each tray. How many rolls are on each tray?', 8, [6, 10, 32, 17], 'Divide 30 by 5 to get 6 per tray, then add 2.'],
      ['A 90-centimeter ribbon is cut into a 24-centimeter piece and a 37-centimeter piece. How much ribbon remains?', 29, [61, 53, 66, 151], 'Add the two used pieces, 24 + 37 = 61, then subtract 61 from 90.'],
      ['A store had 75 balloons. It sold 28 in the morning and 19 later. How many balloons remain?', 28, [47, 56, 122, 38], 'Subtract both sold groups: 75 − 28 = 47, then 47 − 19 = 28.'],
      ['Three teams each collected 8 cans. Then the class collected 15 more cans. How many cans were collected?', 39, [24, 23, 120, 47], 'Find 3 × 8 = 24, then add the extra 15.'],
      ['A reader finished 27 pages Saturday and 34 Sunday. The book has 85 pages. How many pages are unread?', 24, [61, 58, 112, 34], 'Add pages read, 27 + 34 = 61, then find 85 − 61.'],
      ['Forty-eight stickers are shared equally among 6 children. Each child gives away 3 stickers. How many does each child keep?', 5, [8, 11, 45, 21], 'Divide first: 48 ÷ 6 = 8. Then subtract 3 from each child’s share.'],
      ['A farmer packed 5 baskets with 7 apples each and had 9 apples left over. How many apples were there?', 44, [35, 26, 21, 54], 'The baskets hold 5 × 7 = 35 apples; add the 9 unpacked apples.'],
      ['A game awards 10 points per goal. A team scored 6 goals but lost 15 penalty points. What was its score?', 45, [60, 75, 35, 55], 'Six goals earn 6 × 10 = 60 points; subtract the 15-point penalty.'],
    ];
    return authoredItems(def, questions.map(([prompt, answer, decoys, feedback]) => ({ prompt, answer, decoys, feedback })));
  }
  if (def.kind === 'problem_solving_challenge') return authoredRows(def, [
    ['A club packed 6 boxes with 8 snack bags in each box. It gave away 13 bags. How many snack bags remain?', 35, [48, 61, 42, 29], 'Find all packed bags first, 6 × 8 = 48, then subtract the 13 given away.', ['multiplication', 'two-step-problems']],
    ['A pet store has 27 fish, 14 birds, and 9 empty cages. How many animals are in the store?', 41, [50, 36, 13, 27], 'The empty cages are irrelevant. Add only the animals: 27 + 14 = 41.', ['relevant-information', 'addition']],
    ['Which expression matches this story? “There were 63 tickets. Eighteen were sold in the morning and 16 in the afternoon. How many remain?”', '63 − 18 − 16', ['63 + 18 + 16', '63 − 18 + 16', '63 + 18 − 16', '63 − (18 − 16)'], 'Both sales reduce the starting number, so subtract both amounts from 63.', ['equation-modeling', 'two-step-problems']],
    ['Jules solved 24 puzzles in June. That was 7 fewer than in May. Jules solved 9 puzzles in April. How many were solved in May?', 31, [17, 33, 40, 24], 'April is irrelevant. If June is 7 fewer than May, add 7 to 24.', ['comparison-problems', 'relevant-information']],
    ['Four teams have 7 players each. Three players are absent. How many players are present?', 25, [28, 31, 18, 11], 'Multiply 4 × 7 for all players, then subtract the 3 absent players.', ['multiplication', 'two-step-problems']],
    ['Ava has 18 beads. Ben has twice as many beads as Ava. Ben uses 11 beads. How many beads does Ben have left?', 25, [36, 47, 14, 43], 'First find Ben’s amount, 2 × 18 = 36, then subtract 11.', ['multiplication', 'two-step-problems']],
    ['A 72-page book is read over 3 days. The reader finishes 18 pages Monday and 25 Tuesday. How many pages remain for Wednesday?', 29, [43, 47, 115, 32], 'Add pages already read, 18 + 25 = 43, then calculate 72 − 43.', ['addition', 'subtraction', 'two-step-problems']],
    ['Some markers were in a bin. The teacher added 18. After 9 were used, 44 remained. How many markers were there at first?', 35, [53, 71, 17, 44], 'Undo the last change first: 44 + 9 = 53. Then undo the 18 added: 53 − 18 = 35.', ['start-unknown', 'inverse-operations']],
    ['A student says 46 + 28 − 15 = 89. Which step identifies the error?', '46 + 28 equals 74, not 84.', ['28 − 15 equals 12, not 13.', 'The operations must be done right to left.', 'The 15 should be added.', 'The answer should be greater than 100.'], 'Check the first subtotal by place value: 46 + 28 = 74, then 74 − 15 = 59.', ['error-analysis', 'two-step-problems']],
    ['Five vans carry 6 students each. Two more students ride with a teacher. How many students travel altogether?', 32, [30, 13, 28, 42], 'The vans carry 5 × 6 = 30 students; add the 2 students with the teacher.', ['multiplication', 'addition']],
    ['A theater has 9 rows of 8 seats. Fifty-seven seats are filled. How many seats are empty?', 15, [72, 129, 49, 7], 'Find all seats, 9 × 8 = 72, then subtract the 57 filled seats.', ['multiplication', 'subtraction']],
    ['User_4 needs 100 points. He earns 38 points, then 27 more. Which answer is reasonable for the points still needed?', 35, [65, 73, 135, 165], 'He has 38 + 27 = 65 points, so 100 − 65 = 35 points are still needed.', ['reasonableness', 'two-step-problems']],
  ]);
  if (def.kind === 'graph') return Array.from({ length: 12 }, (_, index) => {
    const linePlot = def.params.style === 'line_plot';
    const labels = linePlot ? ['2', '3', '4', '5'] : ['Red', 'Blue', 'Green', 'Gold'];
    // Each graph has a unique data set and one unambiguous mode. Merely
    // rotating one four-value set created twelve IDs for only four questions.
    const winner = index % labels.length; const high = 7 + Math.floor(index / labels.length);
    const values = labels.map((_, position) => 2 + ((index * 2 + position * 3) % 5));
    values[winner] = high;
    const max = Math.max(...values); const answer = labels[values.indexOf(max)];
    const prompt = linePlot ? 'Which number appears most often on the line plot?' : 'Which color received the most votes?';
    const details = labels.map((label, position) => `${label}: ${values[position]}`).join(', ');
    return item(def, index, { prompt, answer, decoys: labels.filter((label) => label !== answer).concat(['They are tied']),
      feedback: `Read the counts ${details}; ${answer} has the one greatest count.`,
      stimulus: figure(ctx, def, index, 'data_graph', `${linePlot ? 'A line plot' : def.params.style === 'pictograph' ? 'A pictograph' : 'A bar graph'} with counts ${details}.`, { labels, values, style: def.params.style ?? 'bar' }) });
  });
  if (def.kind === 'graph_difference') return Array.from({ length: 12 }, (_, index) => {
    const labels = ['Cats', 'Dogs', 'Birds']; const cats = 3 + index; const dogs = cats + 2 + index % 5;
    const birds = 2 + (index * 3) % 11; const values = [cats, dogs, birds]; const answer = dogs - cats;
    return item(def, index, { prompt: 'How many more votes did Dogs get than Cats?', answer,
      decoys: nonNegative([values[1] + values[0], values[1], values[0], Math.abs(values[1] - values[2]), answer + 1, answer - 1]),
      feedback: `Read Dogs as ${values[1]} and Cats as ${values[0]}; “how many more” asks for ${values[1]} − ${values[0]}.`,
      stimulus: figure(ctx, def, index, 'data_graph', `A bar graph with Cats: ${values[0]}, Dogs: ${values[1]}, and Birds: ${values[2]}.`, { labels, values }) });
  });
  if (def.kind === 'data_challenge') {
    const questions = [
      { labels: ['Red', 'Blue', 'Green'], values: [7, 5, 4], style: 'bar', prompt: 'How many votes are shown altogether?', answer: 16, decoys: [12, 11, 7, 20], feedback: 'A total includes every category: 7 + 5 + 4 = 16.' },
      { labels: ['Mystery', 'Adventure', 'Science'], values: [4, 9, 6], style: 'pictograph', prompt: 'What is the difference between the greatest and least numbers of books?', answer: 5, decoys: [13, 9, 4, 3], feedback: 'Identify 9 as greatest and 4 as least, then subtract 9 − 4.' },
      { labels: ['Tulips', 'Roses', 'Daisies'], values: [6, 8, 3], style: 'bar', prompt: 'How many more roses than daisies are shown?', answer: 5, decoys: [11, 8, 3, 2], feedback: 'Compare the two requested categories: 8 − 3 = 5.' },
      { labels: ['2', '3', '4', '5'], values: [2, 5, 3, 1], style: 'line_plot', prompt: 'How many measurements are recorded on the line plot?', answer: 11, decoys: [5, 4, 8, 10], feedback: 'Each X represents one measurement, so add all four stacks: 2 + 5 + 3 + 1.' },
      { labels: ['Bus', 'Walk', 'Bike', 'Car'], values: [6, 4, 7, 8], style: 'bar', prompt: 'Which two categories together account for 13 students?', answer: 'Bus and Bike', decoys: ['Walk and Bike', 'Bike and Car', 'Bus and Car', 'Walk and Car'], feedback: 'Test pairs of categories: Bus 6 + Bike 7 = 13.' },
      { labels: ['Apples', 'Pears', 'Peaches'], values: [8, 5, 6], style: 'pictograph', prompt: 'How many pears would need to be added for Pears to tie Apples?', answer: 3, decoys: [5, 8, 13, 2], feedback: 'Find the gap between Apples and Pears: 8 − 5 = 3.' },
      { labels: ['Cats', 'Dogs', 'Birds'], values: [7, 10, 4], style: 'bar', prompt: 'Which statement is supported by the graph?', answer: 'Dogs exceed Cats by 3.', decoys: ['Cats exceed Dogs by 3.', 'Birds and Cats total 10.', 'Dogs are twice Cats.', 'All categories are equal.'], feedback: 'Read Dogs as 10 and Cats as 7; 10 − 7 = 3.' },
      { labels: ['1', '2', '3', '4'], values: [1, 4, 6, 3], style: 'line_plot', prompt: 'How many measurements are greater than 2?', answer: 9, decoys: [6, 3, 10, 14], feedback: 'Values greater than 2 are 3 and 4; their stacks contain 6 + 3 = 9 measurements.' },
      { labels: ['Monday', 'Tuesday', 'Wednesday'], values: [12, 7, 9], style: 'bar', prompt: 'Monday and Wednesday together exceed Tuesday by how many?', answer: 14, decoys: [21, 16, 9, 4], feedback: 'Combine Monday and Wednesday, 12 + 9 = 21, then compare with Tuesday: 21 − 7.' },
      { labels: ['2', '3', '4', '5'], values: [3, 2, 5, 4], style: 'line_plot', prompt: 'If one new measurement of 3 is added, which value will still occur most often?', answer: '4', decoys: ['2', '3', '5', '3 and 4 tie'], feedback: 'Adding one mark above 3 changes its count to 3; the count above 4 remains greatest at 5.' },
      { labels: ['A', 'B', 'C', 'D'], values: [6, 8, 2, 7], style: 'bar', prompt: 'Which categories have a combined count equal to category B?', answer: 'A and C', decoys: ['A and D', 'B and C', 'C and D', 'B and D'], feedback: 'Category B is 8; A and C combine to 6 + 2 = 8.' },
      { labels: ['Oak', 'Pine', 'Maple'], values: [9, 6, 11], style: 'pictograph', prompt: 'How many fewer pine trees than oak and maple trees combined are shown?', answer: 14, decoys: [20, 17, 5, 8], feedback: 'Oak and Maple combine to 9 + 11 = 20; subtract Pine’s 6 to get 14.' },
    ];
    return authoredItems(def, questions.map((question, index) => ({
      prompt: question.prompt, answer: question.answer, decoys: question.decoys, feedback: question.feedback,
      concepts: ['graph-reading', 'data-reasoning'],
      stimulus: figure(ctx, def, index, 'data_graph', `${question.style === 'line_plot' ? 'A line plot' : question.style === 'pictograph' ? 'A pictograph' : 'A bar graph'} with ${question.labels.map((label, position) => `${label}: ${question.values[position]}`).join(', ')}.`, {
        labels: question.labels, values: question.values, style: question.style,
      }),
    })));
  }
  if (def.kind === 'array') return Array.from({ length: 12 }, (_, index) => {
    const rows = 2 + index % 4; const columns = 2 + (index * 2) % 5; const answer = rows * columns;
    return item(def, index, { prompt: 'How many dots are in the array?', answer,
      decoys: nonNegative([rows + columns, (rows - 1) * columns, rows * (columns - 1), 2 * (rows + columns), rows * 10 + columns, answer + 1]),
      feedback: `The array has ${countedNoun(rows, 'row')} with ${countedNoun(columns, 'dot')} in each row; multiply ${rows} × ${columns}.`,
      stimulus: figure(ctx, def, index, 'array', `An array with ${rows} rows and ${columns} columns.`, { rows, columns }) });
  });
  if (def.kind === 'groups') return Array.from({ length: 12 }, (_, index) => {
    const [groups, each] = pick(PAIRS.mul, index); const answer = groups * each;
    return item(def, index, {
      prompt: `There are ${groups} equal groups with ${each} in each group. How many altogether?`, answer,
      decoys: nonNegative([groups + each, groups * (each - 1), groups * (each + 1), (groups - 1) * each, groups * 10 + each, answer + 1]),
      feedback: `Use ${countedNoun(groups, 'group')} of ${each}: multiply ${groups} × ${each}, then check with repeated addition.`,
    });
  });
  if (def.kind === 'property') return Array.from({ length: 12 }, (_, index) => {
    const [a, b] = pick(PAIRS.mul, index); return item(def, index, { prompt: `Which multiplication fact has the same answer as $${a} × ${b}$?`, answer: `${b} × ${a}`,
      decoys: [`${a} + ${b}`, `${b} − ${a}`, `${a} × ${Math.max(1, b - 1)}`, `${a + 1} × ${b}`],
      feedback: `Turning a ${a}-by-${b} array makes a ${b}-by-${a} array with the same ${a * b} dots.` });
  });
  if (def.kind === 'division_model') return Array.from({ length: 12 }, (_, index) => {
    const [total, divisor] = pick(PAIRS.div, index); const answer = total / divisor;
    return item(def, index, { prompt: `${total} counters are shared equally among ${divisor} groups. How many are in each group?`, answer,
      decoys: nonNegative([divisor, total - divisor, answer + 1, answer - 1, total, divisor + answer]),
      feedback: `Share all ${total} counters among ${divisor} equal groups, then verify that ${divisor} × the group size equals ${total}.`,
      stimulus: figure(ctx, def, index, 'counters', `${total} counters arranged for counting.`, { count: total, columns: Math.min(10, total) }) });
  });
  if (def.kind === 'division_story') return authoredRows(def, [
    ['Thirty-two crayons are shared equally among 4 boxes. How many crayons go in each box?', 8, [4, 28, 36, 128], 'This is equal sharing: 32 ÷ 4 = 8, checked by 4 × 8 = 32.', ['partitive-division']],
    ['Thirty-five flowers are arranged with 5 flowers in each bouquet. How many bouquets are made?', 7, [5, 30, 40, 175], 'This asks how many groups of 5 fit in 35: 35 ÷ 5 = 7.', ['quotative-division']],
    ['Which equation matches “24 markers are split equally among 6 students”?', '24 ÷ 6 = 4', ['24 − 6 = 18', '24 + 6 = 30', '6 ÷ 24 = 4', '24 × 6 = 144'], 'The total 24 is divided by the 6 equal groups, leaving 4 in each group.', ['equation-modeling']],
    ['A coach puts 42 tennis balls into cans that hold 7 balls each. How many cans are filled?', 6, [7, 35, 49, 294], 'Count groups of 7 in 42; because 7 × 6 = 42, six cans are filled.', ['quotative-division']],
    ['Eighteen strawberries are shared equally on 3 plates. Which multiplication fact checks the amount on each plate?', '3 × 6 = 18', ['3 × 18 = 54', '18 × 6 = 108', '3 + 6 = 9', '18 − 3 = 15'], 'The number of plates times the number on each plate must return to all 18 strawberries.', ['inverse-operations']],
    ['A 40-inch ribbon is cut into 5 equal pieces. How long is each piece?', '8 inches', ['5 inches', '35 inches', '45 inches', '200 inches'], 'Equal-sized pieces mean divide the total length: 40 ÷ 5 = 8 inches.', ['partitive-division']],
    ['There are 27 students. Teams must have 3 students each. How many teams can be formed?', 9, [3, 24, 30, 81], 'Find how many groups of 3 fit in 27: 27 ÷ 3 = 9.', ['quotative-division']],
    ['Which question can be answered by $48 ÷ 6$?', 'How many groups of 6 are in 48?', ['How many are 6 groups of 48?', 'How many more is 48 than 6?', 'What is 48 increased by 6?', 'What is half of 48 plus 6?'], 'In 48 ÷ 6, 48 is the total and 6 can be the group size or number of equal groups.', ['equation-modeling']],
    ['Five equal bags hold 45 marbles altogether. How many marbles are in one bag?', 9, [5, 40, 50, 225], 'The total is split among 5 equal bags: 45 ÷ 5 = 9.', ['partitive-division']],
    ['Sixty stickers fill pages with 10 stickers on each page. How many pages are filled?', 6, [10, 50, 70, 600], 'Count how many groups of 10 fit in 60: 60 ÷ 10 = 6.', ['quotative-division']],
    ['A student says $28 ÷ 4 = 6$ because $4 × 6 = 24$. What corrects the reasoning?', '4 × 7 = 28, so the quotient is 7.', ['4 + 6 = 10, so the quotient is 10.', '28 − 4 = 24, so the quotient is 24.', '4 × 6 is close enough to 28.', '28 × 4 = 112, so the quotient is 112.'], 'A quotient must pass the multiplication check exactly; 4 × 7 returns to 28.', ['error-analysis']],
    ['A baker has 36 rolls and places an equal number on 4 trays. After sharing, how many rolls should be on each tray?', 9, [4, 32, 40, 144], 'Share all 36 rolls among 4 trays: 36 ÷ 4 = 9.', ['partitive-division']],
  ]);
  if (def.kind === 'fraction') return Array.from({ length: 12 }, (_, index) => {
    const [numerator, denominator] = [
      [1, 2], [1, 3], [2, 3], [1, 4], [2, 4], [3, 4],
      [1, 5], [2, 5], [3, 5], [4, 5], [5, 6], [7, 8],
    ][index];
    const answer = `${numerator}/${denominator}`;
    return item(def, index, { prompt: 'What fraction of the bar is shaded?', answer, decoys: properFractionDecoys(numerator, denominator),
      feedback: `The bar has ${denominator} equal parts and ${numerator} shaded parts, so the fraction is ${answer}.`,
      stimulus: figure(ctx, def, index, 'fraction_model', `A bar divided into ${denominator} equal parts with ${numerator} shaded.`, { numerator, denominator }) });
  });
  if (def.kind === 'fraction_set') return Array.from({ length: 12 }, (_, index) => {
    const total = pick([6, 8, 10, 12], index); const selected = 1 + index % (total - 1); const answer = `${selected}/${total}`;
    return item(def, index, { prompt: `${selected} of ${total} counters are shaded. What fraction of the counters are shaded?`, answer,
      decoys: properFractionDecoys(selected, total),
      feedback: `Use all ${total} counters as the denominator and the ${selected} shaded counters as the numerator: ${answer}.` });
  });
  if (def.kind === 'fraction_line') return Array.from({ length: 12 }, (_, index) => {
    const [numerator, denominator] = [
      [1, 2], [2, 3], [1, 4], [3, 4], [2, 5], [4, 5],
      [1, 6], [5, 6], [3, 8], [5, 8], [7, 10], [9, 10],
    ][index];
    const value = numerator / denominator; const answer = `${numerator}/${denominator}`;
    return item(def, index, { prompt: 'Which fraction is marked by point A?', answer,
      decoys: properFractionDecoys(numerator, denominator),
      feedback: `The unit is split into ${denominator} equal spaces, and point A is ${numerator} spaces from zero: ${answer}.`,
      stimulus: figure(ctx, def, index, 'number_line', `A fraction number line from zero to one with point A at ${answer}.`, { min: 0, max: 1, step: 1 / denominator, labels: [0, 1], marks: [{ value, label: 'A' }] }) });
  });
  if (def.kind === 'fraction_compare') return Array.from({ length: 12 }, (_, index) => {
    const comparisons = [[1, 2, 3], [2, 4, 5], [3, 5, 6], [4, 5, 8], [2, 3, 7], [5, 6, 10]];
    const equivalents = [[1, 3, 2], [2, 5, 2], [3, 4, 2], [1, 2, 3], [2, 3, 3], [3, 5, 3]];
    if (index % 2 === 1) {
      const [baseNumerator, baseDenominator, scale] = equivalents[Math.floor(index / 2)];
      const equivalent = `${baseNumerator * scale}/${baseDenominator * scale}`;
      return item(def, index, { prompt: `Which fraction is equivalent to $${baseNumerator}/${baseDenominator}$?`, answer: equivalent,
        decoys: [`${baseNumerator + scale}/${baseDenominator + scale}`, `${baseNumerator}/${baseDenominator * scale}`,
          `${baseNumerator * scale + 1}/${baseDenominator * scale}`, `${baseNumerator + 1}/${baseDenominator}`],
        feedback: `Equivalent fractions scale both parts by the same number; multiply ${baseNumerator} and ${baseDenominator} by ${scale}.` });
    }
    const [a, b, denominator] = comparisons[Math.floor(index / 2)]; const answer = `${b}/${denominator}`;
    return item(def, index, { prompt: `Which fraction is greater: $${a}/${denominator}$ or $${b}/${denominator}$?`, answer,
      decoys: [`${a}/${denominator}`, 'They are equal', `${b}/${denominator + 1}`, `${Math.min(denominator, b + 1)}/${denominator}`, `1/${denominator}`],
      feedback: `Both fractions have denominator ${denominator}, so the larger numerator names the greater fraction.` });
  });
  if (def.kind === 'fraction_challenge') return authoredRows(def, [
    ['Which fraction is equivalent to $3/4$?', '6/8', ['4/5', '6/7', '3/8', '5/8'], 'Multiply both 3 and 4 by 2; changing both parts by the same scale gives 6/8.', ['equivalent-fractions']],
    ['Which unit fraction is greatest?', '1/3', ['1/4', '1/5', '1/6', '1/8'], 'For unit fractions, fewer equal pieces make each piece larger, so thirds are largest here.', ['compare-fractions']],
    ['Which fraction is least?', '2/7', ['3/7', '5/7', '6/7', '7/7'], 'The denominators match, so the fraction with the smallest numerator is least.', ['compare-fractions']],
    ['A bar has 8 equal parts. Five parts are shaded. What fraction is not shaded?', '3/8', ['5/8', '3/5', '3/6', '1/8'], 'Eight total parts minus five shaded parts leaves three unshaded parts, or 3/8.', ['fraction-complements']],
    ['One fourth of 20 counters are blue. How many counters are blue?', 5, [4, 10, 16, 80], 'Divide 20 into 4 equal groups; one group contains 5 counters.', ['fraction-of-a-set']],
    ['What number makes $2/3 = □/12$ true?', 8, [6, 9, 10, 18], 'The denominator is multiplied by 4, so multiply the numerator by 4 too: 2 × 4 = 8.', ['equivalent-fractions']],
    ['Which pair names the same amount?', '$1/2$ and $3/6$', ['$1/2$ and $2/3$', '$2/4$ and $2/6$', '$3/4$ and $4/5$', '$1/3$ and $3/4$'], 'Three of six equal parts is half of the whole, so 3/6 equals 1/2.', ['equivalent-fractions']],
    ['Point A is at $3/8$ on a number line. What fraction of the unit remains from A to 1?', '5/8', ['3/8', '2/8', '5/11', '1/8'], 'One whole is 8/8; 8/8 − 3/8 leaves 5/8.', ['fraction-number-line', 'fraction-complements']],
    ['A student calls 3 shaded pieces out of 5 “5/3.” What should the student change?', 'Use 5 as the denominator and 3 as the numerator.', ['Use 3 for both numerator and denominator.', 'Count only the unshaded pieces.', 'Add the two numbers to get 8/8.', 'Use 5 as the numerator because it is larger.'], 'The denominator counts all equal parts; the numerator counts the selected parts.', ['error-analysis', 'fraction-models']],
    ['Which fraction is greater?', '3/4', ['2/3', 'They are equal', '1/4', '1/3'], 'Compare twelfths: 3/4 = 9/12 and 2/3 = 8/12, so 3/4 is greater.', ['compare-fractions']],
    ['What fraction must be added to $5/6$ to make one whole?', '1/6', ['5/6', '1/5', '6/6', '2/6'], 'One whole is 6/6, and 6/6 − 5/6 = 1/6.', ['fraction-complements']],
    ['Which statement is true?', '$2/4$ is equal to $1/2$.', ['$2/4$ is greater than $3/4$.', '$1/6$ is greater than $1/3$.', '$3/5$ is equal to $3/8$.', '$4/4$ is less than one whole.'], 'Two of four equal parts is the same portion as one of two equal parts.', ['equivalent-fractions', 'compare-fractions']],
  ]);
  if (def.kind === 'money') return Array.from({ length: 12 }, (_, index) => {
    const quarters = index % 4; const dimes = (index + 1) % 5; const nickels = index % 3; const pennies = (index * 3) % 5; const answer = quarters * 25 + dimes * 10 + nickels * 5 + pennies;
    const coins = [
      [quarters, 'quarter', 'quarters'], [dimes, 'dime', 'dimes'],
      [nickels, 'nickel', 'nickels'], [pennies, 'penny', 'pennies'],
    ].filter(([count]) => count > 0).map(([count, singular, plural]) => countedNoun(count, singular, plural));
    const omitQuarters = answer - quarters * 25; const omitDimes = answer - dimes * 10;
    const omitNickels = answer - nickels * 5; const omitPennies = answer - pennies;
    const quartersAsDimes = answer - quarters * 25 + quarters * 10;
    const nickelsAsDimes = answer - nickels * 5 + nickels * 10;
    return item(def, index, {
      prompt: `What is the total value, in cents, of ${joinedList(coins)}?`, answer,
      decoys: nonNegative([omitQuarters, omitDimes, omitNickels, omitPennies, quartersAsDimes, nickelsAsDimes,
        dimes, nickels, pennies, answer + 5, answer - 5, answer + 10, answer - 10]),
      feedback: `The coin subtotals are ${quarters * 25}¢, ${dimes * 10}¢, ${nickels * 5}¢, and ${pennies}¢; together they make ${answer}¢.`,
    });
  });
  if (def.kind === 'money_challenge') return authoredRows(def, [
    ['A toy costs 63¢. You pay with 3 quarters. How much change should you receive?', '12¢', ['2¢', '13¢', '22¢', '138¢'], 'Three quarters equal 75¢; subtract the 63¢ cost to get 12¢ change.', ['making-change']],
    ['Which coin collection is worth exactly 65¢?', '2 quarters, 1 dime, and 1 nickel', ['1 quarter, 3 dimes, and 1 nickel', '2 quarters and 1 nickel', '1 quarter, 2 dimes, and 5 pennies', '3 quarters and 1 dime'], 'Value each group: 50¢ + 10¢ + 5¢ = 65¢.', ['coin-combinations']],
    ['Collection A has 2 quarters and 3 pennies. Collection B has 4 dimes and 2 nickels. Which collection is worth more?', 'Collection A', ['Collection B', 'They have equal value', 'There is not enough information', 'Each collection is worth 40¢'], 'Collection A is 53¢; Collection B is 50¢, so A is worth 3¢ more.', ['compare-money']],
    ['How many dimes have the same value as one dollar?', 10, [1, 5, 20, 100], 'One dollar is 100¢ and each dime is 10¢, so 100 ÷ 10 = 10 dimes.', ['coin-equivalence']],
    ['Two dimes, one nickel, and one mystery coin are worth 50¢. What is the mystery coin?', 'a quarter', ['a dime', 'a nickel', 'a penny', 'a half-dollar'], 'The known coins total 25¢, leaving 25¢; a quarter supplies the missing value.', ['missing-value']],
    ['A notebook costs 34¢ and an eraser costs 27¢. What is their total cost?', '61¢', ['7¢', '51¢', '57¢', '71¢'], 'Add the two prices by place value: 34 + 27 = 61¢.', ['money-addition']],
    ['A book costs 68¢. How much change comes from one dollar?', '32¢', ['22¢', '28¢', '42¢', '168¢'], 'Write one dollar as 100¢, then subtract 100 − 68 = 32¢.', ['making-change']],
    ['Nia has 75¢ and Omar has 58¢. How much more money does Nia have?', '17¢', ['13¢', '23¢', '33¢', '133¢'], 'Compare the amounts by subtraction: 75 − 58 = 17¢.', ['compare-money']],
    ['Two quarters have the same value as how many dimes?', 5, [2, 4, 10, 20], 'Two quarters equal 50¢; five 10-cent dimes also equal 50¢.', ['coin-equivalence']],
    ['Which uses the fewest coins to make exactly 40¢?', '1 quarter, 1 dime, and 1 nickel', ['4 dimes', '8 nickels', '2 dimes and 4 nickels', '1 quarter and 15 pennies'], 'All choices make 40¢, but quarter + dime + nickel uses only 3 coins.', ['coin-combinations']],
    ['Three children each save 24¢. How much do they save altogether?', '72¢', ['27¢', '48¢', '62¢', '96¢'], 'Three equal amounts of 24¢ make 24 + 24 + 24 = 72¢.', ['equal-groups', 'money-addition']],
    ['Which collection pays exactly 83¢?', '3 quarters and 8 pennies', ['2 quarters, 2 dimes, and 8 pennies', '3 quarters and 3 pennies', '8 dimes and 8 pennies', '1 quarter, 5 dimes, and 3 pennies'], 'Three quarters are 75¢; eight pennies bring the total to 83¢.', ['coin-combinations']],
  ]);
  if (def.kind === 'clock') return Array.from({ length: 12 }, (_, index) => {
    const hour = 1 + index % 12; const minute = pick([0, 5, 15, 30, 45, 55], index); const answer = `${hour}:${String(minute).padStart(2, '0')}`;
    return item(def, index, { prompt: 'What time does the clock show?', answer,
      decoys: [`${hour}:${String((minute + 5) % 60).padStart(2, '0')}`, `${hour}:${String((minute + 55) % 60).padStart(2, '0')}`,
        `${(hour % 12) + 1}:${String(minute).padStart(2, '0')}`, `${((hour + 10) % 12) + 1}:${String(minute).padStart(2, '0')}`,
        `${hour}:00`, `${((hour + 10) % 12) + 1}:30`],
      feedback: `The short hand gives hour ${hour}; the long hand gives ${minute} minutes, so the time is ${answer}.`,
      stimulus: figure(ctx, def, index, 'clock', `An analog clock showing ${answer}.`, { hour, minute }) });
  });
  if (def.kind === 'measurement') return Array.from({ length: 12 }, (_, index) => {
    const questions = [
      ['Which is the most reasonable estimate for the length of a pencil?', '15 centimeters', ['15 millimeters', '15 meters', '15 kilometers', '150 centimeters']],
      ['Which is the most reasonable estimate for the mass of a loaded backpack?', '3 kilograms', ['3 grams', '3 milligrams', '3 tonnes', '30 kilograms']],
      ['Which is the most reasonable capacity for a small juice bottle?', '500 milliliters', ['500 liters', '5 milliliters', '50 liters', '5,000 milliliters']],
      ['Which is the most reasonable estimate for the distance across a classroom?', '8 meters', ['8 centimeters', '8 millimeters', '8 kilometers', '80 meters']],
      ['Which is the most reasonable estimate for the length of a paper clip?', '3 centimeters', ['3 millimeters', '3 meters', '3 kilometers', '30 centimeters']],
      ['Which is the most reasonable estimate for the mass of a watermelon?', '5 kilograms', ['5 grams', '5 milligrams', '5 tonnes', '50 kilograms']],
      ['Which is the most reasonable capacity for a bathtub?', '150 liters', ['150 milliliters', '15 milliliters', '1,500 liters', '15,000 liters']],
      ['Which is the most reasonable distance between two nearby towns?', '12 kilometers', ['12 meters', '12 centimeters', '12 millimeters', '1,200 kilometers']],
      ['Which is the most reasonable capacity for a spoonful of medicine?', '5 milliliters', ['5 liters', '500 milliliters', '50 liters', '5 kiloliters']],
      ['Which is the most reasonable estimate for an adult’s mass?', '70 kilograms', ['70 grams', '7 kilograms', '700 kilograms', '70 tonnes']],
      ['Which is the most reasonable length of a school day?', '7 hours', ['7 minutes', '7 seconds', '70 hours', '700 hours']],
      ['Which is the most reasonable time for a fast 100-meter run?', '10 seconds', ['10 minutes', '10 hours', '100 seconds', '1 second']],
    ];
    const [prompt, answer, decoys] = questions[index];
    return item(def, index, { prompt, answer, decoys,
      feedback: `Identify what is being measured and compare real-world scale; ${answer} uses a sensible unit and amount.` });
  });
  if (def.kind === 'measurement_application') return Array.from({ length: 12 }, (_, index) => {
    const questions = [
      ['A ribbon was 18 centimeters long. After 7 centimeters were cut off, how long was it?', '11 centimeters', ['25 centimeters', '7 centimeters', '18 centimeters', '10 centimeters']],
      ['A plant grew from 24 centimeters to 39 centimeters. How much did it grow?', '15 centimeters', ['63 centimeters', '24 centimeters', '39 centimeters', '13 centimeters']],
      ['A 2-liter jug and a 3-liter jug are full. How much water do they hold altogether?', '5 liters', ['1 liter', '2 liters', '3 liters', '6 liters']],
      ['A cart holds a 12-kilogram box and an 8-kilogram box. What is their total mass?', '20 kilograms', ['4 kilograms', '12 kilograms', '8 kilograms', '22 kilograms']],
      ['A family walked 3 kilometers before lunch and 2 kilometers after lunch. How far did they walk?', '5 kilometers', ['1 kilometer', '2 kilometers', '3 kilometers', '6 kilometers']],
      ['A 75-centimeter board is shortened by 30 centimeters. How long is it now?', '45 centimeters', ['105 centimeters', '30 centimeters', '75 centimeters', '55 centimeters']],
      ['Four bottles each hold 1 liter. How much do they hold altogether?', '4 liters', ['1 liter', '3 liters', '5 liters', '40 liters']],
      ['A 10-liter bucket loses 4 liters of water. How much remains?', '6 liters', ['14 liters', '4 liters', '10 liters', '5 liters']],
      ['A 20-meter rope is used for one 7-meter piece and one 5-meter piece. How much remains?', '8 meters', ['12 meters', '15 meters', '2 meters', '32 meters']],
      ['A 2-kilogram parcel and a 5-kilogram parcel are placed together. What is the total mass?', '7 kilograms', ['3 kilograms', '5 kilograms', '10 kilograms', '25 kilograms']],
      ['A table is 120 centimeters long and a shelf is 85 centimeters long. How much longer is the table?', '35 centimeters', ['205 centimeters', '85 centimeters', '120 centimeters', '45 centimeters']],
      ['Three pitchers each hold 2 liters. How much do they hold altogether?', '6 liters', ['2 liters', '5 liters', '8 liters', '32 liters']],
    ];
    const [prompt, answer, decoys] = questions[index];
    return item(def, index, { prompt, answer, decoys,
      feedback: `Keep the stated unit through the calculation; the situation gives ${answer}, which has a sensible size.` });
  });
  if (def.kind === 'shape') return Array.from({ length: 12 }, (_, index) => {
    const shapes = [
      ['triangle', 'triangle', 'an upright triangle'],
      ['right-triangle', 'triangle', 'a right triangle turned sideways'],
      ['square', 'square', 'an upright square'],
      ['rotated-square', 'square', 'a square rotated onto one corner'],
      ['rectangle', 'rectangle', 'a wide rectangle'],
      ['circle', 'circle', 'a circle'],
      ['pentagon', 'pentagon', 'a regular pentagon'],
      ['hexagon', 'hexagon', 'a regular hexagon'],
      ['octagon', 'octagon', 'a regular octagon'],
      ['rhombus', 'rhombus', 'a rhombus with no right angles'],
      ['trapezoid', 'trapezoid', 'a trapezoid with exactly one pair of parallel sides'],
      ['parallelogram', 'parallelogram', 'a slanted parallelogram'],
    ];
    const [type, answer, description] = shapes[index];
    const choices = ['triangle', 'square', 'rectangle', 'circle', 'pentagon', 'hexagon', 'octagon', 'rhombus', 'trapezoid', 'parallelogram'];
    const start = choices.indexOf(answer);
    const decoys = Array.from({ length: choices.length - 1 }, (_, offset) => choices[(start + offset + 1) % choices.length]);
    return item(def, index, { prompt: 'What is the most specific name for shape A?', answer, decoys,
      feedback: `Shape A is ${description}; its defining sides, corners, and angle properties make it a ${answer}.`,
      stimulus: figure(ctx, def, index, 'shape_set', `Shape A is ${description}.`, { shapes: [{ label: 'A', type }] }) });
  });
  if (def.kind === 'quadrilateral') return Array.from({ length: 12 }, (_, index) => {
    const prompts = [
      ['Which shape always has four equal sides and four right angles?', 'square', ['rectangle', 'rhombus', 'trapezoid', 'triangle']],
      ['Which word describes every shape with four straight sides?', 'quadrilateral', ['triangle', 'pentagon', 'hexagon', 'circle']],
      ['Which shape has exactly one pair of parallel sides?', 'trapezoid', ['square', 'rectangle', 'rhombus', 'triangle']],
      ['Which shape always has four right angles, but does not need four equal sides?', 'rectangle', ['rhombus', 'trapezoid', 'kite', 'triangle']],
      ['Which shape always has four equal sides, but does not need four right angles?', 'rhombus', ['rectangle', 'trapezoid', 'kite', 'pentagon']],
      ['Which shape always has two pairs of parallel sides?', 'parallelogram', ['trapezoid', 'kite', 'triangle', 'pentagon']],
      ['A square is always also which kind of shape?', 'rectangle', ['trapezoid only', 'triangle', 'pentagon', 'circle']],
      ['A rectangle is always also which kind of shape?', 'parallelogram', ['rhombus', 'trapezoid only', 'kite', 'triangle']],
      ['Which statement is true for every square?', 'It has four right angles.', ['It has exactly one pair of parallel sides.', 'It has only two equal sides.', 'It has three corners.', 'It has no parallel sides.']],
      ['Which statement is true for every parallelogram?', 'Opposite sides are parallel.', ['All four sides are equal.', 'All four angles are right angles.', 'It has exactly one pair of parallel sides.', 'It has five sides.']],
      ['Which quadrilateral can have four equal sides without being a square?', 'rhombus', ['rectangle', 'trapezoid', 'pentagon', 'triangle']],
      ['Which description guarantees that a quadrilateral is a rectangle?', 'four right angles', ['four equal sides', 'one pair of parallel sides', 'no equal sides', 'one right angle']],
    ];
    const [prompt, answer, decoys] = prompts[index];
    return item(def, index, { prompt, answer, decoys,
      feedback: `Use defining properties and shape hierarchy; the statement or classification that fits every case is “${answer}.”` });
  });
  if (def.kind === 'area') return Array.from({ length: 12 }, (_, index) => {
    const rows = 2 + index % 5; const columns = 3 + (index * 2) % 6; const answer = rows * columns;
    return item(def, index, { prompt: `A rectangle is ${rows} units by ${columns} units. What is its area in square units?`, answer,
      decoys: nonNegative([rows + columns, 2 * (rows + columns), (rows - 1) * columns, rows * (columns - 1), rows * 10 + columns, answer + 1]),
      feedback: `Area counts all square units in ${rows} rows of ${columns}; multiply ${rows} × ${columns}, rather than adding only the side lengths.`,
      stimulus: figure(ctx, def, index, 'array', `A rectangular array with ${rows} rows and ${columns} columns.`, { rows, columns }) });
  });
  if (def.kind === 'perimeter') return Array.from({ length: 12 }, (_, index) => {
    const width = 3 + index % 8; const height = 2 + (index * 2) % 6; const answer = 2 * (width + height);
    return item(def, index, {
      prompt: `A rectangle is ${width} units long and ${height} units wide. What is its perimeter?`, answer,
      decoys: nonNegative([width + height, width * height, 2 * width + height, width + 2 * height, answer - 2, answer + 2]),
      feedback: `Perimeter includes two lengths and two widths: ${width} + ${height} + ${width} + ${height}.`,
    });
  });
  if (def.kind === 'geometry_challenge') return authoredRows(def, [
    ['A rectangle has area 24 square units and one side is 6 units. How long is the other side?', '4 units', ['18 units', '6 units', '12 units', '30 units'], 'Area is length × width; the missing factor in 6 × □ = 24 is 4.', ['area', 'missing-factor']],
    ['A rectangle is 9 meters long and 4 meters wide. What is its perimeter?', '26 meters', ['13 meters', '36 meters', '18 meters', '22 meters'], 'Perimeter includes both lengths and both widths: 9 + 4 + 9 + 4 = 26.', ['perimeter']],
    ['Which statement is always true?', 'Every square is a rectangle.', ['Every rectangle is a square.', 'Every rhombus has four right angles.', 'Every trapezoid has four equal sides.', 'Every quadrilateral is a triangle.'], 'A square meets the definition of a rectangle because it has four right angles.', ['shape-hierarchy']],
    ['Rectangle A is 2 by 8 units. Rectangle B is 4 by 4 units. Which comparison is true?', 'They have equal area but different perimeters.', ['They have equal area and equal perimeter.', 'A has greater area.', 'B has greater area.', 'A has the smaller perimeter.'], 'Both areas are 16, but A’s perimeter is 20 and B’s is 16.', ['area', 'perimeter', 'compare-attributes']],
    ['A 3-by-7 rectangle gains one complete row of 7 square tiles. What is its new area?', '28 square units', ['21 square units', '24 square units', '31 square units', '42 square units'], 'The new array has 4 rows of 7, so its area is 4 × 7 = 28.', ['area', 'arrays']],
    ['A rectangle has perimeter 30 units and width 5 units. What is its length?', '10 units', ['5 units', '15 units', '20 units', '25 units'], 'Two widths use 10 units of perimeter; the remaining 20 units form two equal lengths of 10.', ['perimeter', 'missing-length']],
    ['Which side lengths can make a rectangle with area 24 square units?', '3 units by 8 units', ['2 units by 10 units', '4 units by 5 units', '6 units by 6 units', '1 unit by 23 units'], 'Area is the product of side lengths; only 3 × 8 equals 24.', ['area', 'factor-pairs']],
    ['A student finds the perimeter of a 6-by-3 rectangle by calculating $6 × 3 = 18$. What did the student find instead?', 'the area', ['the perimeter', 'one side length', 'the number of corners', 'the difference of the sides'], 'Multiplying length by width counts square units inside, which is area.', ['area-perimeter-distinction', 'error-analysis']],
    ['A square has perimeter 28 centimeters. How long is each side?', '7 centimeters', ['4 centimeters', '14 centimeters', '24 centimeters', '112 centimeters'], 'All four sides are equal, so divide the perimeter by 4: 28 ÷ 4 = 7.', ['perimeter', 'squares']],
    ['Which description identifies a rhombus but does not guarantee a square?', 'four equal sides', ['four right angles', 'three equal sides', 'exactly one pair of parallel sides', 'no parallel sides'], 'A rhombus has four equal sides; right angles are not required.', ['quadrilaterals']],
    ['A floor is covered by 5 rows of 9 square tiles. Which unit describes its area?', '45 square tiles', ['28 tiles around', '14 square tiles', '45 linear units', '90 corners'], 'Area counts the square tiles covering the surface: 5 × 9 = 45 square tiles.', ['area', 'units']],
    ['A rectangular garden is 12 feet long and 7 feet wide. Fencing goes around the entire garden. How much fencing is needed?', '38 feet', ['19 feet', '84 feet', '24 feet', '31 feet'], 'Fencing follows the outside edge, so add 12 + 7 + 12 + 7 = 38 feet.', ['perimeter', 'applications']],
  ]);
  if (def.kind === 'cumulative_arithmetic') return authoredRows(def, [
    ['What is $347 + 286$?', 633, [523, 623, 533, 61], 'Add by place value and regroup: 7 + 6 = 13, then 4 + 8 + 1 = 13, then the hundreds.', ['multi-digit-addition']],
    ['What is $704 − 268$?', 436, [544, 536, 972, 446], 'Regroup across the zero, then subtract ones, tens, and hundreds; check 436 + 268 = 704.', ['multi-digit-subtraction']],
    ['Which expression has a value of 56?', '$7 × 8$', ['$7 + 8$', '$8 × 6$', '$56 ÷ 8$', '$6 × 9$'], 'Seven equal groups of eight make 56.', ['multiplication-facts']],
    ['What is $63 ÷ 9$?', 7, [9, 54, 72, 567], 'Use the related multiplication fact: 9 × 7 = 63.', ['division-facts']],
    ['What number makes $58 + □ = 93$ true?', 35, [45, 151, 93, 25], 'Undo the addition: 93 − 58 = 35, then check 58 + 35 = 93.', ['missing-addend']],
    ['Which expression has the greatest value?', '$46 + 29$', ['$83 − 14$', '$8 × 9$', '$70 − 4$', '$9 × 7$'], 'Evaluate or estimate each expression; 46 + 29 = 75 is the greatest.', ['compare-expressions']],
    ['Which is the best estimate for $47 + 32$?', 80, [70, 75, 90, 100], 'Round 47 to 50 and 32 to 30; 50 + 30 = 80.', ['estimation']],
    ['A bin had 38 balls. Some were added, and then it held 86. How many balls were added?', 48, [124, 58, 38, 86], 'The change is unknown, so subtract the start from the end: 86 − 38 = 48.', ['change-unknown']],
    ['A school collected 128 cans Monday and 94 Tuesday, then recycled 75 cans. How many cans remained?', 147, [222, 203, 297, 109], 'Combine the two collections to get 222, then subtract the 75 recycled cans.', ['two-step-problems']],
    ['Which equation proves that $92 − 57 = 35$?', '$35 + 57 = 92$', ['$92 + 57 = 149$', '$57 − 35 = 22$', '$92 + 35 = 127$', '$35 − 57 = 22$'], 'A subtraction check adds the difference and subtrahend to return to the minuend.', ['inverse-operations']],
    ['What comes next in the pattern $125, 150, 175, 200, \_\_\_$?', 225, [201, 210, 250, 325], 'Each term increases by 25; add 25 to 200.', ['number-patterns']],
    ['What is $36 + 48 + 27$?', 111, [84, 75, 101, 121], 'Add all three addends: 36 + 48 = 84, then 84 + 27 = 111.', ['add-three-numbers']],
  ]);
  if (def.kind === 'cumulative_data') {
    const questions = [
      { labels: ['Soccer', 'Tennis', 'Swim'], values: [9, 6, 8], style: 'bar', prompt: 'Which activity received the most votes?', answer: 'Soccer', decoys: ['Tennis', 'Swim', 'They are tied', 'Cannot tell'], feedback: 'Compare the bar heights: 9 is the greatest count.' },
      { labels: ['Red', 'Blue', 'Gold'], values: [6, 7, 5], style: 'pictograph', prompt: 'How many votes are shown altogether?', answer: 18, decoys: [13, 12, 7, 21], feedback: 'Add every category: 6 + 7 + 5 = 18.' },
      { labels: ['Dogs', 'Cats', 'Birds'], values: [11, 7, 4], style: 'bar', prompt: 'How many more dogs than cats are shown?', answer: 4, decoys: [18, 11, 7, 3], feedback: 'Compare only Dogs and Cats: 11 − 7 = 4.' },
      { labels: ['Mystery', 'History', 'Science'], values: [5, 8, 6], style: 'pictograph', prompt: 'Which category has the least number of books?', answer: 'Mystery', decoys: ['History', 'Science', 'They are tied', 'All three'], feedback: 'Mystery has 5, the smallest of 5, 8, and 6.' },
      { labels: ['Apples', 'Pears', 'Plums'], values: [9, 4, 7], style: 'bar', prompt: 'How many apples and plums are shown together?', answer: 16, decoys: [13, 11, 20, 2], feedback: 'Use the requested categories: 9 apples + 7 plums = 16.' },
      { labels: ['Walk', 'Bike', 'Bus'], values: [5, 8, 12], style: 'bar', prompt: 'How many more Walk responses are needed to tie Bus?', answer: 7, decoys: [5, 12, 17, 4], feedback: 'Find the gap from 5 to 12: 12 − 5 = 7.' },
      { labels: ['1', '2', '3', '4'], values: [2, 3, 4, 3], style: 'line_plot', prompt: 'How many measurements are recorded?', answer: 12, decoys: [4, 7, 10, 14], feedback: 'Add all X marks: 2 + 3 + 4 + 3 = 12.' },
      { labels: ['2', '3', '4', '5'], values: [1, 5, 2, 4], style: 'line_plot', prompt: 'Which value occurs most often?', answer: '3', decoys: ['2', '4', '5', '3 and 5 tie'], feedback: 'The tallest stack has 5 marks above the value 3.' },
      { labels: ['A', 'B', 'C'], values: [7, 10, 6], style: 'bar', prompt: 'How many fewer are in A and C together than twice the count in B?', answer: 7, decoys: [3, 13, 20, 33], feedback: 'A and C total 13; twice B is 20; the difference is 20 − 13 = 7.' },
      { labels: ['Oak', 'Pine', 'Maple'], values: [8, 5, 9], style: 'pictograph', prompt: 'Which statement is true?', answer: 'Oak and Pine total 13.', decoys: ['Maple and Pine total 12.', 'Pine exceeds Oak by 3.', 'Oak exceeds Maple by 2.', 'All three total 20.'], feedback: 'Read the counts and test each statement; 8 + 5 = 13.' },
      { labels: ['Mon', 'Tue', 'Wed'], values: [6, 9, 7], style: 'bar', prompt: 'If Wednesday gains 3, which day will have the greatest count?', answer: 'Wednesday', decoys: ['Monday', 'Tuesday', 'Monday and Wednesday tie', 'Tuesday and Wednesday tie'], feedback: 'Wednesday changes from 7 to 10, which is greater than Tuesday’s 9 and Monday’s 6.' },
      { labels: ['Small', 'Medium', 'Large'], values: [4, 7, 5], style: 'bar', prompt: 'After 2 Medium items are removed, which categories tie?', answer: 'Medium and Large', decoys: ['Small and Medium', 'Small and Large', 'All three', 'No categories'], feedback: 'Medium changes from 7 to 5, matching Large at 5.' },
    ];
    return authoredItems(def, questions.map((question, index) => ({
      prompt: question.prompt, answer: question.answer, decoys: question.decoys, feedback: question.feedback,
      concepts: ['graph-reading', 'data-reasoning'],
      stimulus: figure(ctx, def, index, 'data_graph', `${question.style === 'line_plot' ? 'A line plot' : question.style === 'pictograph' ? 'A pictograph' : 'A bar graph'} with ${question.labels.map((label, position) => `${label}: ${question.values[position]}`).join(', ')}.`, { labels: question.labels, values: question.values, style: question.style }),
    })));
  }
  if (def.kind === 'cumulative_fraction_geometry') return authoredRows(def, [
    ['A bar has 8 equal parts and 3 are shaded. What fraction is shaded?', '3/8', ['5/8', '3/5', '1/8', '4/8'], 'The denominator counts all 8 equal parts; the numerator counts the 3 shaded parts.', ['fraction-models']],
    ['Which fraction is equivalent to $2/3$?', '6/9', ['4/7', '4/9', '6/8', '2/6'], 'Multiply numerator and denominator by 3: 2/3 = 6/9.', ['equivalent-fractions']],
    ['Which fraction is greater?', '7/8', ['5/8', 'They are equal', '3/8', '1/8'], 'Equal denominators allow direct numerator comparison; 7 is greater than 5.', ['compare-fractions']],
    ['What fraction must be added to $3/5$ to make one whole?', '2/5', ['3/5', '1/5', '2/3', '5/5'], 'One whole is 5/5; 5/5 − 3/5 = 2/5.', ['fraction-complements']],
    ['Which shape always has four right angles and four equal sides?', 'square', ['rectangle', 'rhombus', 'trapezoid', 'parallelogram'], 'A square satisfies both conditions: equal sides and four right angles.', ['quadrilaterals']],
    ['A rectangle is 8 units by 3 units. What is its area?', '24 square units', ['11 square units', '22 square units', '16 square units', '48 square units'], 'Area counts 3 rows of 8 square units: 8 × 3 = 24.', ['area']],
    ['A rectangle is 8 units by 3 units. What is its perimeter?', '22 units', ['11 units', '24 units', '16 units', '48 units'], 'Perimeter adds all outside sides: 8 + 3 + 8 + 3 = 22.', ['perimeter']],
    ['A square has side length 6 centimeters. What is its perimeter?', '24 centimeters', ['12 centimeters', '18 centimeters', '36 centimeters', '30 centimeters'], 'A square has four equal sides: 4 × 6 = 24 centimeters.', ['perimeter', 'squares']],
    ['One row of a 4-row rectangular array is shaded. What fraction of the array is shaded?', '1/4', ['3/4', '1/3', '4/4', '2/4'], 'The four equal rows are fourths; one shaded row represents 1/4.', ['fractions', 'arrays']],
    ['Which description is true for every rectangle?', 'It has two pairs of parallel sides.', ['All four sides are equal.', 'It has exactly one pair of parallel sides.', 'It has no right angles.', 'It has five sides.'], 'Opposite sides of every rectangle are parallel; equal lengths for all four sides are not required.', ['quadrilaterals']],
    ['A rectangle has area 35 square units and one side is 5 units. What is the other side length?', '7 units', ['5 units', '30 units', '40 units', '175 units'], 'Find the missing factor in 5 × □ = 35; it is 7.', ['area', 'missing-factor']],
    ['Which comparison is true?', '$4/5 > 3/5$', ['$4/5 < 3/5$', '$4/5 = 3/5$', '$2/5 > 4/5$', '$5/5 < 4/5$'], 'With equal denominators, compare numerators; 4 is greater than 3.', ['compare-fractions']],
  ]);
  if (def.kind === 'cumulative_measurement') return authoredRows(def, [
    ['A lesson begins at 9:20 and lasts 35 minutes. When does it end?', '9:55', ['9:45', '9:50', '10:05', '10:55'], 'Add 35 minutes to 9:20; 20 + 35 = 55 minutes.', ['elapsed-time']],
    ['What time is 25 minutes after 3:45?', '4:10', ['3:70', '4:00', '4:20', '3:20'], 'Fifteen minutes reaches 4:00, and 10 more minutes reaches 4:10.', ['elapsed-time']],
    ['A snack costs 47¢. How much change comes from 75¢?', '28¢', ['22¢', '32¢', '38¢', '122¢'], 'Subtract the cost from the amount paid: 75 − 47 = 28¢.', ['making-change']],
    ['Which coin collection is worth 90¢?', '3 quarters, 1 dime, and 1 nickel', ['2 quarters and 3 dimes', '3 quarters and 1 nickel', '4 dimes and 4 nickels', '2 quarters, 2 dimes, and 5 pennies'], 'Three quarters, one dime, and one nickel total 75 + 10 + 5 = 90¢.', ['coin-combinations']],
    ['Which is the most reasonable length of a dining table?', '2 meters', ['2 centimeters', '2 millimeters', '2 kilometers', '20 meters'], 'A table is about the height of a person laid sideways, so meters and a value near 2 are sensible.', ['measurement-estimation']],
    ['Which is the most reasonable mass of an apple?', '150 grams', ['150 kilograms', '15 milligrams', '15 tonnes', '1,500 kilograms'], 'An apple is light enough to measure in grams; about 150 grams is sensible.', ['measurement-estimation']],
    ['A 65-centimeter board is cut into a 28-centimeter piece and a 17-centimeter piece. How much remains?', '20 centimeters', ['37 centimeters', '45 centimeters', '48 centimeters', '110 centimeters'], 'The used pieces total 45 centimeters; 65 − 45 = 20 centimeters remain.', ['measurement-applications']],
    ['Three bottles each hold 2 liters. One liter is poured out. How many liters remain?', '5 liters', ['6 liters', '4 liters', '7 liters', '1 liter'], 'The bottles hold 3 × 2 = 6 liters; subtract the 1 liter poured out.', ['capacity', 'two-step-problems']],
    ['A package has mass 4 kilograms. Another has mass 3 kilograms. What is their combined mass?', '7 kilograms', ['1 kilogram', '4 kilograms', '12 kilograms', '43 kilograms'], 'Both masses use the same unit, so add 4 + 3 = 7 kilograms.', ['mass']],
    ['Which event is most likely to last about 30 seconds?', 'washing your hands', ['a school day', 'sleeping overnight', 'driving to another city', 'a week of vacation'], 'Handwashing is measured in seconds; the other events take hours or days.', ['time-estimation']],
    ['A movie starts at 1:35 and ends at 2:20. How long is the movie?', '45 minutes', ['35 minutes', '55 minutes', '85 minutes', '1 hour 45 minutes'], 'Count 25 minutes to 2:00 and 20 more to 2:20, for 45 minutes.', ['elapsed-time']],
    ['A runner completes 2 kilometers in the morning and 3 kilometers later. Which expression gives the total distance in meters?', '$2{,}000 + 3{,}000$', ['$2 + 3$', '$2{,}000 − 3{,}000$', '$2 × 3$', '$5 ÷ 1{,}000$'], 'Convert each kilometer amount to meters, then add 2,000 + 3,000.', ['unit-conversion', 'equation-modeling']],
  ]);
  if (def.kind === 'final_challenge') return authoredRows(def, [
    ['A school buys 7 boxes of 8 markers. After 19 markers are used, how many remain?', 37, [56, 75, 45, 29], 'First find 7 × 8 = 56 markers, then subtract the 19 used.', ['multiplication', 'subtraction', 'two-step-problems']],
    ['A graph shows 12 red votes, 9 blue votes, and 7 green votes. How many more red and blue votes together than green votes are there?', 14, [21, 16, 28, 4], 'Combine red and blue, 12 + 9 = 21, then compare with green: 21 − 7 = 14.', ['data-reasoning', 'two-step-problems']],
    ['A rectangular garden is 9 meters by 6 meters. A fence goes around it except for a 3-meter gate. How many meters of fence are used?', 27, [30, 51, 54, 24], 'The full perimeter is 9 + 6 + 9 + 6 = 30; subtract the 3-meter gate.', ['perimeter', 'two-step-problems']],
    ['Three fourths of 20 counters are blue. How many counters are not blue?', 5, [15, 4, 16, 25], 'One fourth is not blue; 20 ÷ 4 = 5 counters.', ['fraction-of-a-set', 'fraction-complements']],
    ['A bus leaves with 48 riders. At one stop, 17 leave and 12 enter. How many riders are now on the bus?', 43, [31, 60, 19, 77], 'Follow the events in order: 48 − 17 = 31, then 31 + 12 = 43.', ['two-step-problems']],
    ['A game begins at 2:35 and lasts 50 minutes. At what time does it end?', '3:25', ['2:85', '3:15', '3:35', '2:25'], 'Add 25 minutes to reach 3:00, then 25 more minutes to reach 3:25.', ['elapsed-time']],
    ['A notebook costs 38¢ and a pen costs 27¢. You pay with 3 quarters. How much change do you receive?', '10¢', ['65¢', '37¢', '48¢', '140¢'], 'The items cost 38 + 27 = 65¢; three quarters are 75¢, leaving 10¢ change.', ['money', 'two-step-problems']],
    ['Which value makes both equations true: $6 × □ = 42$ and $42 ÷ □ = 6$?', 7, [6, 36, 42, 48], 'The same fact family uses 6, 7, and 42.', ['fact-families', 'missing-factor']],
    ['A 120-centimeter ribbon is cut into 4 equal pieces. Two pieces are used. How many centimeters remain?', 60, [30, 58, 116, 240], 'Each piece is 120 ÷ 4 = 30 centimeters; two unused pieces total 60 centimeters.', ['division', 'measurement', 'two-step-problems']],
    ['A rectangle has area 32 square units and one side is 4 units. What is its perimeter?', '24 units', ['8 units', '12 units', '32 units', '36 units'], 'The other side is 32 ÷ 4 = 8; perimeter is 4 + 8 + 4 + 8 = 24.', ['area', 'perimeter', 'two-step-problems']],
    ['A student rounds 347 to 300 and 186 to 200. Which estimate for their sum follows from that rounding?', 500, [400, 533, 600, 100], 'Use the rounded addends exactly: 300 + 200 = 500.', ['rounding', 'estimation']],
    ['Some stickers were shared equally among 5 children. Each child received 7, and 3 stickers were left over. How many stickers were there?', 38, [35, 32, 40, 73], 'The equal shares use 5 × 7 = 35 stickers; add the 3 leftovers.', ['multiplication', 'remainders', 'two-step-problems']],
  ]);
  if (def.kind === 'advanced') return Array.from({ length: 12 }, (_, index) => {
    const a = 1200 + index * 137; const b = 245 + index * 29; const answer = a + b;
    return item(def, index, {
      prompt: `Challenge: What is $${a} + ${b}$?`, answer,
      decoys: arithmeticDecoys(a, b, '+'),
      feedback: `Align ${a} and ${b} by place value, add from right to left, and record every regrouped ten in the next column.`,
    });
  });
  throw new Error(`unknown course item builder: ${def.kind}`);
}

function buildMasteryItems(def, ctx) {
  return elementaryMathMasteryBlueprint(def.module).map((question, index) => {
    const { figure: figureSpec, ...authored } = question;
    const stimulus = figureSpec
      ? figure(ctx, def, index, figureSpec.kind, figureSpec.alt, figureSpec.params)
      : null;
    return item(def, index, {
      ...authored, stimulus, source: 'authored', referenceIndex: index % def.studyReferences.length,
    });
  });
}

const modules = [
  { id: 'number-sense', title: 'Number Sense and Place Value', weeks: '1–3', lessons: [
    ['Place Value to 1,000', 'place_value', 'beast'], ['Base-Ten Models', 'base_ten', 'beast'], ['Number Forms', 'forms', 'beast'], ['Skip-Counting Patterns', 'sequence', 'ultimate', { steps: [2, 5, 10, 100] }],
  ], optional: ['Four-Digit Place Value', 'place_value', 'ultimate', { fourDigit: true }] },
  { id: 'compare-order-round', title: 'Compare, Order, Round, and Number Lines', weeks: '4–5', lessons: [
    ['Greatest Numbers', 'compare', 'beast', { mode: 'greatest' }], ['Least Numbers', 'compare', 'beast', { mode: 'least' }], ['Read a Number Line', 'number_line', 'beast'], ['Round Numbers', 'round', 'ultimate', { place: 10 }],
  ], optional: ['Round to Hundreds', 'round', 'ultimate', { place: 100 }] },
  { id: 'addition-facts', title: 'Addition Facts and Mental Strategies', weeks: '6–8', lessons: [
    ['Addition Facts through 20', 'calculation', 'boosters', { op: '+', pairs: 'addFacts' }], ['Ten-Frame Addition', 'ten_frame', 'beast'], ['Missing Addends', 'missing', 'ultimate', { op: '+' }], ['Mental Addition', 'mental', 'boosters', { op: '+' }],
  ], optional: ['Addition Fluency Challenge', 'fluency', 'boosters', { op: '+' }] },
  { id: 'multi-digit-addition', title: 'Multi-Digit Addition', weeks: '9–11', lessons: [
    ['Two-Digit Addition', 'calculation', 'boosters', { op: '+', pairs: 'add2' }], ['Addition with Regrouping', 'calculation', 'boosters', { op: '+', pairs: 'add2Regroup' }], ['Add Three Numbers', 'multi_add', 'ultimate'], ['Three-Digit Addition', 'calculation', 'boosters', { op: '+', pairs: 'add3' }],
  ], optional: ['Four-Digit Addition', 'advanced', 'ultimate'] },
  { id: 'subtraction-facts', title: 'Subtraction Facts and Strategies', weeks: '12–14', lessons: [
    ['Subtraction Facts through 20', 'calculation', 'boosters', { op: '−', pairs: 'subFacts' }], ['Addition and Subtraction Families', 'fact_family', 'ultimate'], ['Missing Subtrahends', 'missing', 'ultimate', { op: '−' }], ['Mental Subtraction', 'mental', 'boosters', { op: '−' }],
  ], optional: ['Subtraction Fluency Challenge', 'fluency', 'boosters', { op: '−' }] },
  { id: 'multi-digit-subtraction', title: 'Multi-Digit Subtraction', weeks: '15–17', lessons: [
    ['Two-Digit Subtraction', 'calculation', 'boosters', { op: '−', pairs: 'sub2' }], ['Subtraction with Regrouping', 'calculation', 'boosters', { op: '−', pairs: 'sub2Regroup' }], ['Three-Digit Subtraction', 'calculation', 'boosters', { op: '−', pairs: 'sub3' }], ['Check Subtraction with Addition', 'inverse', 'ultimate'],
  ], optional: ['Four-Digit Subtraction', 'calculation', 'boosters', { op: '−', pairs: 'sub4' }] },
  { id: 'mixed-operations', title: 'Mixed Operations and Word Problems', weeks: '18–19', lessons: [
    ['Choose the Operation', 'operation', 'ultimate'], ['One-Step Word Problems', 'word', 'ultimate'], ['Two-Step Word Problems', 'two_step', 'ultimate'], ['Mixed Missing Numbers', 'mixed_missing', 'ultimate'],
  ], optional: ['Problem-Solving Challenge', 'problem_solving_challenge', 'ultimate'] },
  { id: 'graphs-data', title: 'Graphs and Data', weeks: '20–21', lessons: [
    ['Read Pictographs', 'graph', 'ultimate', { style: 'pictograph' }], ['Read Bar Graphs', 'graph', 'ultimate'], ['Read Line Plots', 'graph', 'ultimate', { style: 'line_plot' }], ['Compare Graph Data', 'graph_difference', 'ultimate'],
  ], optional: ['Data Detective Challenge', 'data_challenge', 'ultimate'] },
  { id: 'multiplication', title: 'Multiplication Foundations and Facts', weeks: '22–25', lessons: [
    ['Equal Groups', 'groups', 'ultimate'], ['Arrays', 'array', 'ultimate'], ['Turn-Around Facts', 'property', 'ultimate'], ['Facts for 0–5 and 10', 'calculation', 'ultimate', { op: '×', pairs: 'mul' }],
  ], optional: ['Facts through 12', 'calculation', 'ultimate', { op: '×', pairs: 'mulAdvanced' }] },
  { id: 'division', title: 'Division Foundations and Facts', weeks: '26–28', lessons: [
    ['Share Equally', 'division_model', 'ultimate'], ['Multiplication and Division Families', 'fact_family', 'ultimate', { family: 'division' }], ['Division Facts', 'calculation', 'ultimate', { op: '÷', pairs: 'div' }], ['Division Stories', 'division_story', 'ultimate'],
  ], optional: ['Division Facts through 12', 'calculation', 'ultimate', { op: '÷', pairs: 'divAdvanced' }] },
  { id: 'fractions', title: 'Fractions', weeks: '29–31', lessons: [
    ['Fractions of a Whole', 'fraction', 'ultimate'], ['Fractions of a Set', 'fraction_set', 'ultimate'], ['Fractions on Number Lines', 'fraction_line', 'ultimate'], ['Compare and Equivalent Fractions', 'fraction_compare', 'ultimate'],
  ], optional: ['Fraction Challenge', 'fraction_challenge', 'ultimate'] },
  { id: 'measurement', title: 'Money, Time, and Measurement', weeks: '32–33', lessons: [
    ['Count Money', 'money', 'ultimate'], ['Tell Time', 'clock', 'ultimate'], ['Choose Measurement Units', 'measurement', 'ultimate'], ['Measurement Applications', 'measurement_application', 'ultimate'],
  ], optional: ['Money Challenge', 'money_challenge', 'ultimate'] },
  { id: 'geometry', title: 'Geometry, Area, and Perimeter', weeks: '34–35', lessons: [
    ['Name Shapes', 'shape', 'ultimate'], ['Classify Quadrilaterals', 'quadrilateral', 'ultimate'], ['Area with Arrays', 'area', 'ultimate'], ['Perimeter', 'perimeter', 'ultimate'],
  ], optional: ['Geometry Challenge', 'geometry_challenge', 'ultimate'] },
  { id: 'cumulative', title: 'Cumulative Problem Solving', weeks: '36', lessons: [
    ['Cumulative Arithmetic', 'cumulative_arithmetic', 'authored'], ['Cumulative Data', 'cumulative_data', 'authored'], ['Cumulative Fractions and Geometry', 'cumulative_fraction_geometry', 'authored'], ['Cumulative Measurement', 'cumulative_measurement', 'authored'],
  ], optional: ['Final Multi-Step Challenge', 'final_challenge', 'beast'] },
];

function lessonDefinitions() {
  let sequence = 1; const result = [];
  modules.forEach((module, moduleIndex) => {
    const required = module.lessons.map(([title, kind, source, params], index) => ({
      id: `em23-${String(moduleIndex + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}-${slug(title)}`,
      title, kind, source, params: params ?? {}, module: module.id, sequence: sequence++, required: true,
      moduleRole: index === 0 ? 'overview' : 'lesson',
    }));
    result.push(...required);
    const [optionalTitle, optionalKind, optionalSource, optionalParams] = module.optional;
    result.push({ id: `em23-${String(moduleIndex + 1).padStart(2, '0')}-90-${slug(optionalTitle)}`, title: optionalTitle,
      kind: optionalKind, source: optionalSource, params: optionalParams ?? {}, module: module.id, sequence: sequence++, required: false, moduleRole: 'lesson' });
    result.push({ id: `em23-${String(moduleIndex + 1).padStart(2, '0')}-99-mastery`, title: `${module.title} Mastery`, kind: 'mastery',
      source: 'authored', params: {}, module: module.id, sequence: sequence++, required: true, moduleRole: 'lesson', masteryOf: required });
  });
  return result;
}

function studyReferenceDefinitions(definitions, sourceMapPath = SOURCE_MAP_PATH) {
  const raw = yaml.load(fs.readFileSync(sourceMapPath, 'utf8'));
  if (raw?.schema !== 'school.study-reference-map/v1') throw new Error('source map schema must be school.study-reference-map/v1');
  if (raw?.course !== COURSE) throw new Error(`source map course must be ${COURSE}`);
  if (!raw.materials || typeof raw.materials !== 'object' || Array.isArray(raw.materials)) throw new Error('source map materials must be a mapping');
  if (!raw.lessons || typeof raw.lessons !== 'object' || Array.isArray(raw.lessons)) throw new Error('source map lessons must be a mapping');

  const expected = new Set(definitions.map((definition) => definition.id));
  const actual = new Set(Object.keys(raw.lessons));
  const missing = [...expected].filter((id) => !actual.has(id));
  const extra = [...actual].filter((id) => !expected.has(id));
  if (missing.length || extra.length) throw new Error(`source map lesson mismatch; missing=${missing.join(',') || 'none'}; extra=${extra.join(',') || 'none'}`);

  const referencesByLesson = new Map();
  const usedMaterials = new Set();
  definitions.forEach((definition) => {
    const materialIds = raw.lessons[definition.id];
    if (!Array.isArray(materialIds) || materialIds.length < 1 || materialIds.length > 3) {
      throw new Error(`${definition.id} must name 1..3 study materials`);
    }
    if (definition.kind === 'mastery' && materialIds.length < 2) throw new Error(`${definition.id} mastery must name 2..3 study materials`);
    const references = materialIds.map((materialId, index) => {
      const material = raw.materials[materialId];
      if (!material) throw new Error(`${definition.id} references unknown material ${materialId}`);
      usedMaterials.add(materialId);
      const unknown = Object.keys(material).filter((field) => !['title', 'pages', 'section'].includes(field));
      if (unknown.length) throw new Error(`${materialId} has unknown fields: ${unknown.join(', ')}`);
      if (typeof material.title !== 'string' || !material.title.trim()) throw new Error(`${materialId}.title is required`);
      if (typeof material.section !== 'string' || !material.section.trim()) throw new Error(`${materialId}.section is required`);
      if (!Array.isArray(material.pages) || material.pages.length < 1 || material.pages.length > 12
          || material.pages.some((page) => !Number.isInteger(page) || page < 1)
          || new Set(material.pages).size !== material.pages.length) {
        throw new Error(`${materialId}.pages must contain 1..12 unique positive printed page numbers`);
      }
      return {
        role: index === 0 ? 'primary' : 'alternate', title: material.title.trim(),
        pages: [...material.pages].sort((left, right) => left - right), section: material.section.trim(),
      };
    });
    referencesByLesson.set(definition.id, references);
  });
  const unused = Object.keys(raw.materials).filter((materialId) => !usedMaterials.has(materialId));
  if (unused.length) throw new Error(`source map has unused materials: ${unused.join(', ')}`);
  return referencesByLesson;
}

function courseIndex() {
  return {
    schema: 'school.course/v2', poster: 'poster.jpg', work: COURSE, title: COURSE_TITLE, short_title: 'Elementary Math 2–3',
    subject: 'math', category: 'course', medium: 'paper',
    structure: { shape: 'modules', module: 'unit', items: { from: 'units', order: 'sequence' } },
    grading: { gate: 'omr', scope: 'item', pass_percent: 80, exit: 'Complete every required unit mastery worksheet.' },
    printables: [{ document: 'elementary-math-dynamic-worksheet', when: 'study', scan: 'omr' }],
    progression: { mode: 'module_blocks', required_opening_module: 'number-sense', one_active_module: true, module_order: 'fixed', lesson_order: 'fixed' },
    profiles: { lower: { question_count: 6, visible_choices: [3, 4], multi_select: 0, receipt_answers: 'locator_only' } },
    sources: [
      { title: 'Beast Academy 2A Guide', publisher: 'Art of Problem Solving' },
      { title: 'Math Boosters: Addition and Subtraction', publisher: 'Kumon Publishing North America' },
      { title: 'The Ultimate Grade 3 Math Workbook' },
    ],
    modules: modules.map((module, index) => ({ module: module.id, title: module.title, short_title: module.title, number: index + 1 })),
  };
}

function moduleIndex(module, index) {
  return { schema: 'school.course-unit/v1', unit: module.id, title: module.title, sequence: (index + 1) * 10, required: true, overview_first: true, lesson_order: 'sequence' };
}

function bankFor(def, items) {
  const sourceName = SOURCE[def.source].name;
  const conceptIds = unique(items.flatMap((entry) => entry.concepts ?? []));
  return {
    schema: 'school.question-bank/v2', id: `math/${COURSE}/${def.id}/worksheet`, title: def.title, subject: 'math', audience: 'assigned',
    unit: def.id, topics: [def.module, slug(def.title)],
    concepts: conceptIds.map((conceptId) => ({
      conceptId,
      title: conceptId.split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' '),
    })),
    items,
    lesson: {
      schema: 'school.unit/v1', unitId: def.id, title: def.title,
      description: def.required ? `Six-question mastery-oriented worksheet for ${def.title.toLowerCase()}.` : `Optional practice and enrichment for ${def.title.toLowerCase()}.`,
      subject: 'math', courseId: COURSE, sequence: def.sequence, module: def.module, moduleRole: def.moduleRole, required: def.required,
      grades: ['lower'], objectives: [`Solve grade 2–3 bridge problems involving ${def.title.toLowerCase()}.`],
      bank: `math/${COURSE}/${def.id}/worksheet`, passing: { percent: 80 }, retry: { variants: 12 },
      studyReferences: def.studyReferences,
      worksheet: { examples: [workedExampleFor(def)] },
      provenance: { source: sourceName, reviewState: 'approved' },
    },
  };
}

const AMBIGUOUS_PROMPT_PATTERNS = Object.freeze([
  /^(?=.*\bdigit\b)(?=.*\bvalue\b)/iu,
  /Which category has the greatest value/iu,
  /counters are selected\. What fraction of the set is selected/iu,
  /Which multiplication expression has the same product/iu,
  /Which addition checks/iu,
  /Which word names every polygon with four sides/iu,
]);
const GENERIC_FEEDBACK = /^Try the .+ strategy again, then check your work\.$/iu;

function questionSignature(entry) {
  return JSON.stringify({
    prompt: String(entry?.prompt ?? '').replace(/\s+/gu, ' ').trim(),
    answer: String(entry?.answer ?? '').trim(),
    decoys: [...(entry?.decoys ?? [])].map(String).sort(),
    stimulus: String(entry?.stimulus?.alt ?? '').replace(/\s+/gu, ' ').trim(),
  });
}

function elementaryExpressionValue(choice) {
  const normalized = String(choice).replaceAll('$', '').replaceAll('{,}', '').replaceAll(',', '').trim();
  const numeric = /^\d+(?:\.\d+)?$/u.exec(normalized);
  if (numeric) return Number(normalized);
  const fraction = /^(\d+)\/(\d+)$/u.exec(normalized);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const match = /^(\d+)\s*([+−×÷-])\s*(\d+)$/u.exec(normalized);
  if (!match) return null;
  const left = Number(match[1]); const right = Number(match[3]);
  if (match[2] === '+') return left + right;
  if (match[2] === '−' || match[2] === '-') return left - right;
  if (match[2] === '×') return left * right;
  if (match[2] === '÷') return right === 0 ? null : left / right;
  return null;
}

function elementaryStatementTruth(choice) {
  const normalized = String(choice).replaceAll('$', '').trim();
  const match = /^(.+?)\s*(=|>|<)\s*(.+)$/u.exec(normalized);
  if (!match) return null;
  const left = elementaryExpressionValue(match[1]); const right = elementaryExpressionValue(match[3]);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  if (match[2] === '=') return Math.abs(left - right) < Number.EPSILON;
  return match[2] === '>' ? left > right : left < right;
}

function measurementDimension(choice) {
  const value = String(choice).toLowerCase();
  if (/\b(?:millimeters?|centimeters?|meters?|kilometers?)\b/u.test(value)) return 'length';
  if (/\b(?:milligrams?|grams?|kilograms?|tonnes?)\b/u.test(value)) return 'mass';
  if (/\b(?:milliliters?|liters?|kiloliters?)\b/u.test(value)) return 'capacity';
  if (/\b(?:seconds?|minutes?|hours?|days?)\b/u.test(value)) return 'time';
  return null;
}

/** Course-specific language checks that run before a generated bank is published. */
export function auditElementaryMathBank(bank) {
  const errors = [];
  (bank?.items ?? []).forEach((entry, index) => {
    const at = `${bank?.id ?? 'bank'} item ${index + 1}`;
    const prompt = String(entry?.prompt ?? '').trim();
    const feedback = String(entry?.feedback?.incorrect ?? '').trim();
    if (!prompt) errors.push(`${at}: prompt is required`);
    AMBIGUOUS_PROMPT_PATTERNS.forEach((pattern) => {
      if (pattern.test(prompt)) errors.push(`${at}: ambiguous or developmentally weak prompt: ${prompt}`);
    });
    if (/(^|[^\\])\bBox\b/u.test(prompt)) errors.push(`${at}: unescaped Box token`);
    if (!feedback) errors.push(`${at}: incorrect feedback is required`);
    if (GENERIC_FEEDBACK.test(feedback)) errors.push(`${at}: generic incorrect feedback`);
    const answer = Number(entry?.answer); const numericDecoys = (entry?.decoys ?? []).map(Number);
    if (Number.isFinite(answer) && numericDecoys.length === 4 && numericDecoys.every(Number.isFinite)
        && [-2, -1, 1, 2].every((delta) => numericDecoys.includes(answer + delta))) {
      errors.push(`${at}: decoys reproduce the forbidden answer ±1/±2 fallback`);
    }
    const comparison = /Which (?:number|expression) is (greatest|least)/iu.exec(prompt);
    if (comparison) {
      const choices = [entry.answer, ...(entry.decoys ?? [])];
      const values = choices.map((choice) => {
        const numeric = Number(choice); return Number.isFinite(numeric) ? numeric : elementaryExpressionValue(choice);
      });
      if (values.every((value) => Number.isFinite(value))) {
        const expected = comparison[1].toLowerCase() === 'greatest' ? Math.max(...values) : Math.min(...values);
        if (values[0] !== expected || values.filter((value) => value === expected).length !== 1) {
          errors.push(`${at}: designated ${comparison[1].toLowerCase()} answer is not uniquely correct`);
        }
      }
    }
    const expressionExtreme = /Which expression has the (greatest|least) (?:value|product)/iu.exec(prompt);
    if (expressionExtreme) {
      const values = [entry.answer, ...(entry.decoys ?? [])].map(elementaryExpressionValue);
      if (values.every((value) => Number.isFinite(value))) {
        const expected = expressionExtreme[1].toLowerCase() === 'greatest' ? Math.max(...values) : Math.min(...values);
        if (values[0] !== expected || values.filter((value) => value === expected).length !== 1) {
          errors.push(`${at}: designated ${expressionExtreme[1].toLowerCase()} expression is not uniquely correct`);
        }
      }
    }
    const targetedExpression = /Which expression has (?:a|the) (?:sum|difference|value) of (\d+)/iu.exec(prompt);
    if (targetedExpression) {
      const target = Number(targetedExpression[1]);
      const values = [entry.answer, ...(entry.decoys ?? [])].map(elementaryExpressionValue);
      if (values.every((value) => Number.isFinite(value))
          && (values[0] !== target || values.filter((value) => value === target).length !== 1)) {
        errors.push(`${at}: expression choices do not have one uniquely correct value of ${target}`);
      }
    }
    if (/Which (?:equation|sum|difference|comparison) is (?:true|correct)/iu.test(prompt)) {
      const truths = [entry.answer, ...(entry.decoys ?? [])].map(elementaryStatementTruth);
      if (truths.every((truth) => typeof truth === 'boolean') && (truths[0] !== true || truths.filter(Boolean).length !== 1)) {
        errors.push(`${at}: equation choices do not have one uniquely true answer`);
      }
    }
    const equivalentFraction = /Which fraction is equivalent to \$?(\d+\/\d+)\$?/iu.exec(prompt);
    if (equivalentFraction) {
      const target = elementaryExpressionValue(equivalentFraction[1]);
      const values = [entry.answer, ...(entry.decoys ?? [])].map(elementaryExpressionValue);
      if (values.every((value) => Number.isFinite(value))
          && (Math.abs(values[0] - target) >= Number.EPSILON
            || values.filter((value) => Math.abs(value - target) < Number.EPSILON).length !== 1)) {
        errors.push(`${at}: equivalent-fraction choices do not have one uniquely correct answer`);
      }
    }
    const rounding = /^Round (\d+) to the nearest (ten|hundred)\.$/iu.exec(prompt);
    if (rounding) {
      const source = Number(rounding[1]); const place = rounding[2].toLowerCase() === 'hundred' ? 100 : 10;
      const expected = Math.round(source / place) * place;
      if (Number(entry.answer) !== expected) errors.push(`${at}: incorrect rounded answer; expected ${expected}`);
      [entry.answer, ...(entry.decoys ?? [])].forEach((choice) => {
        const numeric = Number(choice);
        if (!Number.isFinite(numeric) || (numeric !== source && numeric % place !== 0)) {
          errors.push(`${at}: rounding choice ${choice} is neither the source number nor a multiple of ${place}`);
        }
      });
    }
    if (/most reasonable (?:estimate|capacity|distance|length|mass|time)/iu.test(prompt)) {
      const dimensions = [entry.answer, ...(entry.decoys ?? [])].map(measurementDimension);
      if (dimensions.some((dimension) => !dimension) || new Set(dimensions).size !== 1) {
        errors.push(`${at}: reasonable-estimate choices must be dimensional peers`);
      }
    }
  });
  const signatures = (bank?.items ?? []).map(questionSignature);
  if (new Set(signatures).size !== signatures.length) errors.push(`${bank?.id ?? 'bank'}: bank contains semantically duplicate questions`);
  const feedbackVariants = new Set((bank?.items ?? []).map((entry) => String(entry?.feedback?.incorrect ?? '').trim()));
  if ((bank?.items ?? []).length === 12 && feedbackVariants.size < 3) {
    errors.push(`${bank?.id ?? 'bank'}: twelve-item bank needs at least three item-specific feedback variants`);
  }
  const examples = bank?.lesson?.worksheet?.examples;
  if (!Array.isArray(examples) || examples.length !== 1) {
    errors.push(`${bank?.id ?? 'bank'}: every lesson must author exactly one compact worked example`);
  } else {
    const [example] = examples;
    const prompt = String(example?.question?.prompt ?? '').trim();
    const choices = example?.question?.choices ?? [];
    const answer = String(example?.solution?.answer ?? '').trim();
    if (!prompt || /^(?:look|study|notice|observe)\b[^?!.]*[.!]?$/iu.test(prompt)) {
      errors.push(`${bank.id}: worked example must contain a genuine representative question`);
    }
    AMBIGUOUS_PROMPT_PATTERNS.forEach((pattern) => {
      if (pattern.test(prompt)) errors.push(`${bank.id}: worked example repeats ambiguous wording: ${prompt}`);
    });
    if (!Array.isArray(choices) || !choices.includes(answer)) {
      errors.push(`${bank.id}: worked example's correct answer must be one of its displayed choices`);
    }
    if (!Array.isArray(choices) || new Set(choices.map(String)).size !== choices.length) {
      errors.push(`${bank.id}: worked example choices must be distinct`);
    }
    if (!Array.isArray(example?.solution?.steps) || example.solution.steps.length < 1) {
      errors.push(`${bank.id}: worked example must show how to reach the answer`);
    }
  }
  return errors;
}

/** Cross-bank checks prevent renamed copies from masquerading as new assessments. */
export function auditElementaryMathCourse(banks) {
  const errors = []; const seenItems = new Map(); const seenBanks = new Map();
  banks.forEach((bank) => {
    const signatures = (bank.items ?? []).map(questionSignature);
    signatures.forEach((signature) => {
      const prior = seenItems.get(signature);
      if (prior && prior !== bank.id) errors.push(`${bank.id}: duplicates a question from ${prior}`);
      else seenItems.set(signature, bank.id);
    });
    const bankSignature = JSON.stringify([...signatures].sort());
    const priorBank = seenBanks.get(bankSignature);
    if (priorBank) errors.push(`${bank.id}: full-bank clone of ${priorBank}`);
    else seenBanks.set(bankSignature, bank.id);
    if (bank.unit.endsWith('-99-mastery')) {
      (bank.items ?? []).forEach((entry, index) => {
        if (!(entry.concepts ?? []).some((concept) => concept !== 'mastery')) {
          errors.push(`${bank.id} item ${index + 1}: mastery question lacks a specific assessed concept`);
        }
      });
    }
  });
  return errors;
}

function curriculumMarkdown(definitions) {
  const lines = [`# ${COURSE_TITLE}`, '', 'The week spans are planning targets. Mastery, not the calendar, controls advancement.', '',
    '| Weeks | Unit | Required worksheets | Optional worksheet |', '|---|---|---|---|'];
  modules.forEach((module) => {
    const lessons = definitions.filter((def) => def.module === module.id);
    const required = lessons.filter((def) => def.required && def.kind !== 'mastery').map((def) => def.title).join('; ');
    const optional = lessons.find((def) => !def.required)?.title;
    lines.push(`| ${module.weeks} | ${module.title} | ${required}; unit mastery | ${optional} |`);
  });
  lines.push('', 'Every issued sheet samples exactly six multiple-choice questions from a twelve-item bank. Five correct answers meet the 80% gate.',
    'Optional worksheets never block a later required worksheet or module.', '');
  return lines.join('\n');
}

function posterSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600"><rect width="1200" height="1600" fill="#f4efe3"/><rect x="70" y="70" width="1060" height="1460" rx="36" fill="#fff" stroke="#1c3557" stroke-width="18"/><g fill="#1c3557" font-family="Helvetica,Arial,sans-serif" text-anchor="middle"><text x="600" y="280" font-size="78" font-weight="700">ELEMENTARY</text><text x="600" y="380" font-size="92" font-weight="700">MATHEMATICS</text><text x="600" y="475" font-size="48">GRADE 2–3 BRIDGE</text></g><g stroke="#1c3557" fill="none" stroke-width="18"><line x1="170" y1="760" x2="1030" y2="760"/><circle cx="300" cy="760" r="32" fill="#d67a3c"/><circle cx="600" cy="760" r="32" fill="#4f8f73"/><circle cx="900" cy="760" r="32" fill="#d0a632"/><rect x="195" y="980" width="230" height="230"/><path d="M510 1210 L650 930 L790 1210 Z"/><circle cx="970" cy="1095" r="120"/></g><g fill="#1c3557" font-family="Helvetica,Arial,sans-serif" text-anchor="middle" font-size="36"><text x="300" y="835">NUMBER</text><text x="600" y="835">OPERATIONS</text><text x="900" y="835">REASONING</text><text x="600" y="1410" font-size="42">SIX QUESTIONS • ONE STEP AT A TIME</text></g></svg>`;
}

const dump = (value) => yaml.dump(value, { noRefs: true, lineWidth: 110, sortKeys: false });
export function generateElementaryMathCourse({ dataDir, requireAbsent = true, sourceMapPath = SOURCE_MAP_PATH } = {}) {
  if (!dataDir) throw new Error('dataDir is required');
  const courseRoot = path.join(dataDir, 'content', 'school', 'math', COURSE);
  const assetRoot = path.join(dataDir, 'content', 'assets', 'school', 'math', COURSE);
  if (requireAbsent && (fs.existsSync(courseRoot) || fs.existsSync(assetRoot))) throw new Error('course or asset target already exists; refuse to overwrite');
  fs.mkdirSync(courseRoot, { recursive: true }); fs.mkdirSync(path.join(assetRoot, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(courseRoot, '_index.yml'), dump(courseIndex()));
  const definitions = lessonDefinitions();
  const referencesByLesson = studyReferenceDefinitions(definitions, sourceMapPath);
  definitions.forEach((definition) => { definition.studyReferences = referencesByLesson.get(definition.id); });
  const ctx = { specs: new Map() }; const built = new Map(); const banks = [];
  definitions.forEach((def) => {
    let items;
    if (def.kind === 'mastery') items = buildMasteryItems(def, ctx);
    else items = buildItems(def, ctx);
    built.set(def.id, items);
    const bank = bankFor(def, items);
    banks.push(bank);
    const auditErrors = auditElementaryMathBank(bank);
    const bankValidation = validateQuestionBank(bank);
    if (!bankValidation.ok) auditErrors.push(...bankValidation.errors.map((error) => `${bank.id}: ${error}`));
    const unitValidation = validateUnit(bank.lesson, { bankIds: new Set([bank.id]) });
    if (unitValidation.errors.length) auditErrors.push(...unitValidation.errors.map((error) => `${bank.id} lesson: ${error}`));
    if (auditErrors.length) throw new Error(`elementary math content audit failed:\n${auditErrors.join('\n')}`);
    const moduleNumber = modules.findIndex((module) => module.id === def.module) + 1;
    const moduleDir = path.join(courseRoot, `${String(moduleNumber * 10).padStart(3, '0')}-${def.module}`);
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, `${def.id}.yml`), dump(bank));
  });
  const courseAuditErrors = auditElementaryMathCourse(banks);
  if (courseAuditErrors.length) throw new Error(`elementary math cross-bank audit failed:\n${courseAuditErrors.join('\n')}`);
  modules.forEach((module, index) => {
    const moduleDir = path.join(courseRoot, `${String((index + 1) * 10).padStart(3, '0')}-${module.id}`);
    fs.writeFileSync(path.join(moduleDir, '_index.yml'), dump(moduleIndex(module, index)));
  });
  ctx.specs.forEach((spec) => {
    const name = `${spec.ref.split('/').at(-1)}.yml`;
    fs.writeFileSync(path.join(assetRoot, 'specs', name), dump(spec));
    fs.mkdirSync(path.dirname(path.join(dataDir, 'content', 'assets', `${spec.ref}.svg`)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'content', 'assets', `${spec.ref}.svg`), renderMathAsset(spec));
  });
  fs.writeFileSync(path.join(courseRoot, 'CURRICULUM.md'), curriculumMarkdown(definitions));
  fs.writeFileSync(path.join(courseRoot, '_study-references.yml'), dump({
    schema: 'school.study-reference-map/v1', course: COURSE,
    note: 'These printed-page references support original parallel practice; they are not question provenance.',
    lessons: Object.fromEntries(definitions.map((definition) => [definition.id, definition.studyReferences])),
  }));
  fs.writeFileSync(path.join(courseRoot, 'poster.svg'), posterSvg());
  return { courseRoot, assetRoot, definitions, bankCount: definitions.length, itemCount: [...built.values()].reduce((sum, items) => sum + items.length, 0), assetCount: ctx.specs.size };
}

function magickPoster(courseRoot) {
  const svg = path.join(courseRoot, 'poster.svg');
  const jpg = path.join(courseRoot, 'poster.jpg');
  const png = path.join(courseRoot, '.poster-rsvg.png');
  try {
    try {
      execFileSync('magick', [svg, '-quality', '92', jpg], { stdio: 'pipe' });
    } catch (directError) {
      // ImageMagick installations on macOS may advertise SVG support while
      // hard-coding an absent Inkscape.app delegate. Librsvg gives us a plain
      // PNG first; ImageMagick can always perform the final JPEG conversion.
      try {
        execFileSync('rsvg-convert', ['--format', 'png', '--background-color', 'white', '--output', png, svg], { stdio: 'pipe' });
        execFileSync('magick', [png, '-quality', '92', jpg], { stdio: 'pipe' });
      } catch (fallbackError) {
        throw new Error(
          `poster rendering failed with ImageMagick and librsvg fallback: ${fallbackError.message}`,
          { cause: directError },
        );
      }
    }
  } finally {
    fs.rmSync(png, { force: true });
  }
  fs.rmSync(svg);
}

function stageCompleteCourse({ dataDir, sourceMapPath = SOURCE_MAP_PATH, renderPoster = magickPoster }) {
  const stageRoot = fs.mkdtempSync(path.join(path.dirname(path.resolve(dataDir)), '.elementary-math-stage-'));
  try {
    const result = generateElementaryMathCourse({ dataDir: stageRoot, sourceMapPath });
    renderPoster(result.courseRoot);
    if (!fs.existsSync(path.join(result.courseRoot, 'poster.jpg'))) throw new Error('poster renderer did not create poster.jpg');
    return { stageRoot, result };
  } catch (error) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

/** Build and validate every generated byte without touching live curriculum. */
export function checkElementaryMathCourse(options = {}) {
  if (!options.dataDir) throw new Error('dataDir is required');
  const staged = stageCompleteCourse(options);
  try {
    return { banks: staged.result.bankCount, items: staged.result.itemCount, assets: staged.result.assetCount };
  } finally {
    fs.rmSync(staged.stageRoot, { recursive: true, force: true });
  }
}

/** Publish complete course and asset directories with rollback on any failed move. */
export function publishElementaryMathCourse(options = {}) {
  if (!options.dataDir) throw new Error('dataDir is required');
  const dataDir = path.resolve(options.dataDir);
  const staged = stageCompleteCourse({ ...options, dataDir });
  const liveCourse = path.join(dataDir, 'content', 'school', 'math', COURSE);
  const liveAssets = path.join(dataDir, 'content', 'assets', 'school', 'math', COURSE);
  const backupRoot = fs.mkdtempSync(path.join(path.dirname(dataDir), '.elementary-math-backup-'));
  const pairs = [
    { staged: staged.result.courseRoot, live: liveCourse, backup: path.join(backupRoot, 'course') },
    { staged: staged.result.assetRoot, live: liveAssets, backup: path.join(backupRoot, 'assets') },
  ];
  const saved = []; const installed = [];
  try {
    pairs.forEach((pair) => {
      fs.mkdirSync(path.dirname(pair.live), { recursive: true });
      if (fs.existsSync(pair.live)) { fs.renameSync(pair.live, pair.backup); saved.push(pair); }
    });
    pairs.forEach((pair) => { fs.renameSync(pair.staged, pair.live); installed.push(pair); });
    return {
      courseRoot: liveCourse, assetRoot: liveAssets, backupRoot: saved.length ? backupRoot : null,
      bankCount: staged.result.bankCount, itemCount: staged.result.itemCount, assetCount: staged.result.assetCount,
    };
  } catch (error) {
    installed.reverse().forEach((pair) => fs.rmSync(pair.live, { recursive: true, force: true }));
    saved.reverse().forEach((pair) => fs.renameSync(pair.backup, pair.live));
    throw error;
  } finally {
    fs.rmSync(staged.stageRoot, { recursive: true, force: true });
    if (!saved.length) fs.rmSync(backupRoot, { recursive: true, force: true });
  }
}

function parseDataDir(argv) {
  const at = argv.indexOf('--data-dir'); return at >= 0 ? argv[at + 1] : null;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const argv = process.argv.slice(2); const dataDir = parseDataDir(argv);
    if (argv.includes('--check')) {
      process.stdout.write(`${JSON.stringify({ checked: true, ...checkElementaryMathCourse({ dataDir }) })}\n`);
    } else if (argv.includes('--refresh')) {
      const result = publishElementaryMathCourse({ dataDir });
      process.stdout.write(`${JSON.stringify({ course: result.courseRoot, backup: result.backupRoot,
        banks: result.bankCount, items: result.itemCount, assets: result.assetCount })}\n`);
    } else {
      const result = generateElementaryMathCourse({ dataDir }); magickPoster(result.courseRoot);
      process.stdout.write(`${JSON.stringify({ course: result.courseRoot, banks: result.bankCount, items: result.itemCount, assets: result.assetCount })}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1;
  }
}
