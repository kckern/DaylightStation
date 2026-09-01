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

const COURSE = 'elementary-math-2-3';
const COURSE_TITLE = 'Elementary Mathematics: Grade 2–3 Bridge';
const SOURCE_MAP_PATH = fileURLToPath(new URL('./school/elementary-math-source-map.yml', import.meta.url));
const SOURCE = Object.freeze({
  beast: { name: 'Beast Academy 2A Guide and Practice' },
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

function decoysFor(answer, candidates = []) {
  const target = String(answer); const numeric = Number(answer); const values = [...candidates];
  if (Number.isFinite(numeric)) {
    [1, -1, 2, -2, 5, -5, 10, -10, 100, -100].forEach((delta) => {
      const candidate = numeric + delta; if (candidate >= 0) values.push(Number.isInteger(candidate) ? candidate : candidate.toFixed(2));
    });
  }
  const fraction = /^(\d+)\/(\d+)$/u.exec(target);
  if (fraction) {
    const numerator = Number(fraction[1]); const denominator = Number(fraction[2]);
    for (let d = 2; d <= Math.min(12, denominator + 4); d += 1) {
      for (let n = 1; n <= Math.min(d, numerator + 3); n += 1) values.push(`${n}/${d}`);
    }
  }
  const time = /^(\d{1,2}):(\d{2})$/u.exec(target);
  if (time) {
    const hour = Number(time[1]); const minute = Number(time[2]);
    [5, 10, 15, 30].forEach((delta) => values.push(`${hour}:${String((minute + delta) % 60).padStart(2, '0')}`));
    [1, 2, 11].forEach((delta) => values.push(`${((hour - 1 + delta) % 12) + 1}:${String(minute).padStart(2, '0')}`));
  }
  const result = unique(values).filter((value) => value !== target).slice(0, 4);
  if (result.length < 4) throw new Error(`not enough distinct decoys for ${target}`);
  return result;
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
  ];
}

function item(def, index, { prompt, answer, decoys = [], stimulus = null, feedback = null, source = def.source ?? 'authored' }) {
  if (!SOURCE[source]) throw new Error(`unknown source family ${source} for ${def.id}`);
  const { role: _role, ...reviewReference } = def.studyReferences[0];
  return {
    id: `${slug(def.id)}-q${String(index + 1).padStart(2, '0')}`,
    type: 'multiple_choice', prompt, answer: String(answer), decoys: decoysFor(answer, decoys), levels: ['lower'],
    concepts: [slug(def.kind)],
    reviewReference,
    feedback: { incorrect: feedback ?? defaultFeedback(def) },
    ...(stimulus ? { stimulus: { type: 'asset', ref: stimulus.ref, alt: stimulus.alt } } : {}),
  };
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
  return item(def, index, { prompt: `What is $${a} ${op} ${b}$?`, answer });
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
    choices: [chosen.answer, chosen.answer + 1, Math.max(0, chosen.answer - 2), chosen.answer + 10],
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
    prompt: 'What number makes 18 − □ = 11 true?', choices: ['6', '7', '8'], answer: '7',
    steps: ['Find the difference between 18 and 11.', '18 − 7 = 11.'],
  } : {
    prompt: 'What number makes 7 + □ = 15 true?', choices: ['7', '8', '9'], answer: '8',
    steps: ['Subtract the known addend from the total.', '15 − 7 = 8.'],
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
  if (def.kind === 'money') return solvedExample(def, {
    prompt: 'What is the total value, in cents, of 2 quarters, 1 dime, 2 nickels, and 4 pennies?',
    choices: ['64', '74', '84'], answer: '74',
    steps: ['Coin values: 50¢ + 10¢ + 10¢ + 4¢.', '50 + 10 + 10 + 4 = 74¢.'],
  });
  if (def.kind === 'clock') return solvedExample(def, {
    prompt: 'The short hand points just past 7 and the long hand points to the 4. What time does the clock show?',
    choices: ['4:35', '7:20', '7:40'], answer: '7:20',
    steps: ['The short hand gives the hour: 7.', 'The long hand at 4 means 4 groups of 5 minutes, or 20 minutes.'],
  });
  if (def.kind === 'measurement') return solvedExample(def, {
    prompt: 'Which unit is best for the height of a door?', choices: ['meters', 'liters', 'grams'], answer: 'meters',
    steps: ['Height is a length.', 'A door is about 2 meters tall, so meters are a sensible size.'],
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
  if (def.kind === 'advanced') return solvedExample(def, {
    prompt: 'Challenge: What is 2345 + 678?', choices: ['2923', '3013', '3023'], answer: '3023',
    steps: ['Line up ones, tens, hundreds, and thousands.', 'Add right to left and regroup each total of 10 or more.'],
  });
  throw new Error(`missing worked example for ${def.kind} (${def.id})`);
}

function buildItems(def, ctx) {
  if (def.kind === 'calculation') return Array.from({ length: 12 }, (_, index) => calculation(def, index));
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
        decoys: [...String(number)].map(Number),
      });
    }
    const prompt = index % 3 === 0
      ? `In ${number}, what amount does the digit ${digit} represent?`
      : `In ${number}, the digit ${digit} is in the ${place} place. What amount does it represent?`;
    return item(def, index, {
      prompt, answer: digit * divisor,
      decoys: [digit, digit * 10, digit * 100, digit * 1000, number],
    });
  });
  if (def.kind === 'base_ten') return Array.from({ length: 12 }, (_, index) => {
    const h = 1 + index % 4; const t = (index * 2 + 1) % 6; const o = (index * 3 + 2) % 8; const answer = h * 100 + t * 10 + o;
    return item(def, index, { prompt: 'What number is shown by the base-ten blocks?', answer,
      stimulus: figure(ctx, def, index, 'base_ten', `${h} hundreds, ${t} tens, and ${o} ones shown with base-ten blocks.`, { hundreds: h, tens: t, ones: o }) });
  });
  if (def.kind === 'forms') return Array.from({ length: 12 }, (_, index) => {
    const h = 1 + index % 8; const t = (index * 3) % 10; const o = (index * 7 + 2) % 10; const answer = h * 100 + t * 10 + o;
    return item(def, index, { prompt: `Which number equals $${h * 100} + ${t * 10} + ${o}$?`, answer, decoys: [h * 100 + o * 10 + t, h * 10 + t + o, h * 1000 + t * 10 + o, h * 100 + t + o * 10] });
  });
  if (def.kind === 'sequence') return Array.from({ length: 12 }, (_, index) => {
    const step = pick(def.params.steps ?? [2, 5, 10, 100], index); const start = (index + 1) * step; const answer = start + 3 * step;
    return item(def, index, { prompt: `What comes next? ${start}, ${start + step}, ${start + 2 * step}, ___`, answer });
  });
  if (def.kind === 'compare') return Array.from({ length: 12 }, (_, index) => {
    const values = [328 + index * 7, 382 + index * 5, 283 + index * 9, 238 + index * 6]; const answer = def.params.mode === 'least' ? Math.min(...values) : Math.max(...values);
    return item(def, index, { prompt: `Which number is ${def.params.mode === 'least' ? 'least' : 'greatest'}?`, answer, decoys: values.filter((value) => value !== answer) });
  });
  if (def.kind === 'number_line') return Array.from({ length: 12 }, (_, index) => {
    const target = 2 + index; const labels = [0, 5, 10, 15, 20].filter((value) => value !== target);
    return item(def, index, { prompt: 'What number is marked by point A?', answer: target,
      stimulus: figure(ctx, def, index, 'number_line', 'A number line from zero to twenty with point A above one tick.', { min: 0, max: 20, step: 1, labels, marks: [{ value: target, label: 'A' }] }) });
  });
  if (def.kind === 'round') return Array.from({ length: 12 }, (_, index) => {
    const place = def.params.place ?? 10; const number = pick(place === 100 ? [149, 251, 348, 452, 550, 649, 751, 849, 950, 125, 375, 825] : [23, 47, 65, 81, 94, 136, 252, 378, 414, 569, 742, 887], index);
    const answer = Math.round(number / place) * place;
    return item(def, index, { prompt: `Round ${number} to the nearest ${place === 100 ? 'hundred' : 'ten'}.`, answer, decoys: [Math.floor(number / place) * place, Math.ceil(number / place) * place, answer - place, answer + place] });
  });
  if (def.kind === 'ten_frame') return Array.from({ length: 12 }, (_, index) => {
    const filled = 4 + index; return item(def, index, { prompt: 'How many counters are shown?', answer: filled,
      stimulus: figure(ctx, def, index, 'ten_frame', `Ten-frame model showing ${filled} filled counters.`, { filled, frames: filled > 10 ? 2 : 1 }) });
  });
  if (def.kind === 'missing') return Array.from({ length: 12 }, (_, index) => {
    const [a, b] = pick(def.params.op === '−' ? PAIRS.subFacts : PAIRS.addFacts, index); const total = def.params.op === '−' ? a : a + b; const answer = b;
    const prompt = def.params.op === '−' ? `What number makes $${total} − \\Box = ${total - b}$ true?` : `What number makes $${a} + \\Box = ${total}$ true?`;
    return item(def, index, { prompt, answer });
  });
  if (def.kind === 'mental') return Array.from({ length: 12 }, (_, index) => {
    const a = 19 + index * 10; const b = pick([9, 11, 18, 21], index); const op = def.params.op ?? '+'; const answer = op === '+' ? a + b : a - b;
    return item(def, index, { prompt: `Solve mentally: $${a} ${op === '+' ? '+' : '−'} ${b}$.`, answer });
  });
  if (def.kind === 'multi_add') return Array.from({ length: 12 }, (_, index) => {
    const values = [12 + index, 23 + index * 2, 34 + index % 5]; const answer = values.reduce((sum, value) => sum + value, 0);
    return item(def, index, { prompt: `What is $${values.join(' + ')}$?`, answer });
  });
  if (def.kind === 'fact_family') return Array.from({ length: 12 }, (_, index) => {
    const [a, b] = pick(def.params.family === 'division' ? PAIRS.mul : PAIRS.addFacts, index); const total = a * b;
    if (def.params.family === 'division') return item(def, index, { prompt: `If $${a} × ${b} = ${total}$, what is $${total} ÷ ${a}$?`, answer: b });
    return item(def, index, { prompt: `If $${a} + ${b} = ${a + b}$, what is $${a + b} − ${a}$?`, answer: b });
  });
  if (def.kind === 'inverse') return Array.from({ length: 12 }, (_, index) => {
    const [a, b] = pick(PAIRS.sub2Regroup, index); return item(def, index, { prompt: `Which addition equation proves that $${a} − ${b} = ${a - b}$ is correct?`, answer: `${a - b} + ${b} = ${a}`,
      decoys: [`${a} + ${b} = ${a + b}`, `${a - b} + ${a} = ${b}`, `${b} + ${a} = ${a - b}`, `${a} − ${a - b} = ${a}`] });
  });
  if (def.kind === 'operation') return Array.from({ length: 12 }, (_, index) => {
    const addition = index % 2 === 0; const a = 20 + index * 3; const b = 7 + index; const prompt = addition
      ? `Mia has ${a} stickers and gets ${b} more. Which operation finds how many she has now?`
      : `Mia has ${a} stickers and gives away ${b}. Which operation finds how many remain?`;
    return item(def, index, { prompt, answer: addition ? 'addition' : 'subtraction', decoys: ['multiplication', 'division', addition ? 'subtraction' : 'addition', 'rounding'] });
  });
  if (def.kind === 'word') return Array.from({ length: 12 }, (_, index) => {
    const op = def.params.op ?? (index % 2 ? '−' : '+'); const pairs = op === '−' ? PAIRS.sub2Regroup : PAIRS.add2Regroup; const [a, b] = pick(pairs, index); const answer = op === '−' ? a - b : a + b;
    const prompt = op === '−' ? `A library had ${a} books on a cart. Students borrowed ${b}. How many remain?` : `One class collected ${a} cans and another collected ${b}. How many cans altogether?`;
    return item(def, index, { prompt, answer });
  });
  if (def.kind === 'two_step') return Array.from({ length: 12 }, (_, index) => {
    const start = 40 + index * 3; const add = 10 + index; const take = 5 + index % 4; const answer = start + add - take;
    return item(def, index, { prompt: `A shelf held ${start} books. ${add} were added, then ${take} were borrowed. How many books are on the shelf?`, answer });
  });
  if (def.kind === 'graph') return Array.from({ length: 12 }, (_, index) => {
    const linePlot = def.params.style === 'line_plot';
    const labels = linePlot ? ['2', '3', '4', '5'] : ['Red', 'Blue', 'Green', 'Gold'];
    // Rotating a fixed set keeps one and only one greatest count. The old
    // formulas produced ties on four of twelve sheets while marking “They are
    // tied” wrong — a content defect, not merely awkward wording.
    const counts = linePlot ? [2, 5, 8, 3] : [3, 7, 4, 5];
    const values = counts.map((_, position) => counts[(position + index) % counts.length]);
    const max = Math.max(...values); const answer = labels[values.indexOf(max)];
    const prompt = linePlot ? 'Which number appears most often on the line plot?' : 'Which color received the most votes?';
    const details = labels.map((label, position) => `${label}: ${values[position]}`).join(', ');
    return item(def, index, { prompt, answer, decoys: labels.filter((label) => label !== answer).concat(['They are tied']),
      stimulus: figure(ctx, def, index, 'data_graph', `${linePlot ? 'A line plot' : def.params.style === 'pictograph' ? 'A pictograph' : 'A bar graph'} with counts ${details}.`, { labels, values, style: def.params.style ?? 'bar' }) });
  });
  if (def.kind === 'graph_difference') return Array.from({ length: 12 }, (_, index) => {
    const labels = ['Cats', 'Dogs', 'Birds']; const values = [4 + index % 4, 8 + index % 3, 3 + index % 2]; const answer = values[1] - values[0];
    return item(def, index, { prompt: 'How many more votes did Dogs get than Cats?', answer,
      stimulus: figure(ctx, def, index, 'data_graph', 'A bar graph of votes for Cats, Dogs, and Birds.', { labels, values }) });
  });
  if (def.kind === 'array') return Array.from({ length: 12 }, (_, index) => {
    const rows = 2 + index % 4; const columns = 2 + (index * 2) % 5; const answer = rows * columns;
    return item(def, index, { prompt: 'How many dots are in the array?', answer,
      stimulus: figure(ctx, def, index, 'array', `An array with ${rows} rows and ${columns} columns.`, { rows, columns }) });
  });
  if (def.kind === 'groups') return Array.from({ length: 12 }, (_, index) => {
    const groups = 2 + index % 5; const each = 2 + (index * 2) % 5; const answer = groups * each;
    return item(def, index, { prompt: `There are ${groups} equal groups with ${each} in each group. How many altogether?`, answer });
  });
  if (def.kind === 'property') return Array.from({ length: 12 }, (_, index) => {
    const [a, b] = pick(PAIRS.mul, index); return item(def, index, { prompt: `Which multiplication fact has the same answer as $${a} × ${b}$?`, answer: `${b} × ${a}`,
      decoys: [`${a} + ${b}`, `${b} − ${a}`, `${a} × ${Math.max(1, b - 1)}`, `${a + 1} × ${b}`] });
  });
  if (def.kind === 'division_model') return Array.from({ length: 12 }, (_, index) => {
    const [total, divisor] = pick(PAIRS.div, index); const answer = total / divisor;
    return item(def, index, { prompt: `${total} counters are shared equally among ${divisor} groups. How many are in each group?`, answer,
      stimulus: figure(ctx, def, index, 'counters', `${total} counters arranged for counting.`, { count: total, columns: Math.min(10, total) }) });
  });
  if (def.kind === 'fraction') return Array.from({ length: 12 }, (_, index) => {
    const denominator = pick([2, 3, 4, 5, 6, 8], index); const numerator = 1 + index % (denominator - 1); const answer = `${numerator}/${denominator}`;
    return item(def, index, { prompt: 'What fraction of the bar is shaded?', answer, decoys: properFractionDecoys(numerator, denominator),
      stimulus: figure(ctx, def, index, 'fraction_model', `A bar divided into ${denominator} equal parts with ${numerator} shaded.`, { numerator, denominator }) });
  });
  if (def.kind === 'fraction_set') return Array.from({ length: 12 }, (_, index) => {
    const total = pick([6, 8, 10, 12], index); const selected = 1 + index % (total - 1); const answer = `${selected}/${total}`;
    return item(def, index, { prompt: `${selected} of ${total} counters are shaded. What fraction of the counters are shaded?`, answer,
      decoys: properFractionDecoys(selected, total) });
  });
  if (def.kind === 'fraction_line') return Array.from({ length: 12 }, (_, index) => {
    const denominator = pick([2, 3, 4, 5, 6], index); const numerator = 1 + index % (denominator - 1); const value = numerator / denominator; const answer = `${numerator}/${denominator}`;
    return item(def, index, { prompt: 'Which fraction is marked by point A?', answer,
      decoys: properFractionDecoys(numerator, denominator),
      stimulus: figure(ctx, def, index, 'number_line', `A fraction number line from zero to one with point A at ${answer}.`, { min: 0, max: 1, step: 1 / denominator, labels: [0, 1], marks: [{ value, label: 'A' }] }) });
  });
  if (def.kind === 'fraction_compare') return Array.from({ length: 12 }, (_, index) => {
    const denominator = pick([4, 5, 6, 8], index); const a = 1 + index % (denominator - 2); const b = a + 1; const answer = `${b}/${denominator}`;
    if (index % 2 === 1) {
      const baseNumerator = 1 + index % 3; const baseDenominator = baseNumerator + 2; const equivalent = `${baseNumerator * 2}/${baseDenominator * 2}`;
      return item(def, index, { prompt: `Which fraction is equivalent to $${baseNumerator}/${baseDenominator}$?`, answer: equivalent,
        decoys: [`${baseNumerator + 1}/${baseDenominator + 1}`, `${baseNumerator}/${baseDenominator * 2}`, `${baseNumerator * 2 + 1}/${baseDenominator * 2}`, `${baseNumerator + 1}/${baseDenominator}`] });
    }
    return item(def, index, { prompt: `Which fraction is greater: $${a}/${denominator}$ or $${b}/${denominator}$?`, answer,
      decoys: [`${a}/${denominator}`, 'They are equal', `${b}/${denominator + 1}`, `${Math.min(denominator, b + 1)}/${denominator}`, `1/${denominator}`] });
  });
  if (def.kind === 'money') return Array.from({ length: 12 }, (_, index) => {
    const quarters = index % 4; const dimes = (index + 1) % 5; const nickels = index % 3; const pennies = (index * 3) % 5; const answer = quarters * 25 + dimes * 10 + nickels * 5 + pennies;
    const coins = [
      [quarters, 'quarter', 'quarters'], [dimes, 'dime', 'dimes'],
      [nickels, 'nickel', 'nickels'], [pennies, 'penny', 'pennies'],
    ].filter(([count]) => count > 0).map(([count, singular, plural]) => countedNoun(count, singular, plural));
    return item(def, index, { prompt: `What is the total value, in cents, of ${joinedList(coins)}?`, answer });
  });
  if (def.kind === 'clock') return Array.from({ length: 12 }, (_, index) => {
    const hour = 1 + index % 12; const minute = pick([0, 5, 15, 30, 45, 55], index); const answer = `${hour}:${String(minute).padStart(2, '0')}`;
    return item(def, index, { prompt: 'What time does the clock show?', answer,
      decoys: [`${hour}:${String((minute + 5) % 60).padStart(2, '0')}`, `${(hour % 12) + 1}:${String(minute).padStart(2, '0')}`, `${hour}:00`, `${(hour + 10) % 12 + 1}:30`],
      stimulus: figure(ctx, def, index, 'clock', `An analog clock showing ${answer}.`, { hour, minute }) });
  });
  if (def.kind === 'measurement') return Array.from({ length: 12 }, (_, index) => {
    const questions = [
      ['Which unit is best for the length of a pencil?', 'centimeters', ['liters', 'kilograms', 'hours', 'dollars']],
      ['Which unit is best for the mass of a backpack?', 'kilograms', ['meters', 'liters', 'minutes', 'cents']],
      ['Which unit is best for the capacity of a juice bottle?', 'liters', ['grams', 'kilometers', 'hours', 'inches']],
      ['Which unit is best for the distance across a room?', 'meters', ['milliliters', 'grams', 'seconds', 'coins']],
    ];
    const [prompt, answer, decoys] = pick(questions, index); return item(def, index, { prompt, answer, decoys });
  });
  if (def.kind === 'shape') return Array.from({ length: 12 }, (_, index) => {
    const type = pick(['triangle', 'square', 'rectangle', 'circle'], index); const names = { triangle: 'triangle', square: 'square', rectangle: 'rectangle', circle: 'circle' };
    return item(def, index, { prompt: 'What is the name of shape A?', answer: names[type], decoys: ['triangle', 'square', 'rectangle', 'circle', 'pentagon'].filter((name) => name !== names[type]),
      stimulus: figure(ctx, def, index, 'shape_set', `One labeled ${type}.`, { shapes: [{ label: 'A', type }] }) });
  });
  if (def.kind === 'quadrilateral') return Array.from({ length: 12 }, (_, index) => {
    const prompts = [
      ['Which shape always has four equal sides and four right angles?', 'square', ['rectangle', 'rhombus', 'trapezoid', 'triangle']],
      ['Which word describes every shape with four straight sides?', 'quadrilateral', ['triangle', 'pentagon', 'hexagon', 'circle']],
      ['Which shape has exactly one pair of parallel sides?', 'trapezoid', ['square', 'rectangle', 'rhombus', 'triangle']],
    ];
    const [prompt, answer, decoys] = pick(prompts, index); return item(def, index, { prompt, answer, decoys });
  });
  if (def.kind === 'area') return Array.from({ length: 12 }, (_, index) => {
    const rows = 2 + index % 5; const columns = 3 + (index * 2) % 6; const answer = rows * columns;
    return item(def, index, { prompt: `A rectangle is ${rows} units by ${columns} units. What is its area in square units?`, answer,
      stimulus: figure(ctx, def, index, 'array', `A rectangular array with ${rows} rows and ${columns} columns.`, { rows, columns }) });
  });
  if (def.kind === 'perimeter') return Array.from({ length: 12 }, (_, index) => {
    const width = 3 + index % 8; const height = 2 + (index * 2) % 6; const answer = 2 * (width + height);
    return item(def, index, { prompt: `A rectangle is ${width} units long and ${height} units wide. What is its perimeter?`, answer });
  });
  if (def.kind === 'advanced') return Array.from({ length: 12 }, (_, index) => {
    const a = 1200 + index * 137; const b = 245 + index * 29; return item(def, index, { prompt: `Challenge: What is $${a} + ${b}$?`, answer: a + b });
  });
  throw new Error(`unknown course item builder: ${def.kind}`);
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
  ], optional: ['Addition Fluency Challenge', 'calculation', 'boosters', { op: '+', pairs: 'addFacts' }] },
  { id: 'multi-digit-addition', title: 'Multi-Digit Addition', weeks: '9–11', lessons: [
    ['Two-Digit Addition', 'calculation', 'boosters', { op: '+', pairs: 'add2' }], ['Addition with Regrouping', 'calculation', 'boosters', { op: '+', pairs: 'add2Regroup' }], ['Add Three Numbers', 'multi_add', 'ultimate'], ['Three-Digit Addition', 'calculation', 'boosters', { op: '+', pairs: 'add3' }],
  ], optional: ['Four-Digit Addition', 'advanced', 'ultimate'] },
  { id: 'subtraction-facts', title: 'Subtraction Facts and Strategies', weeks: '12–14', lessons: [
    ['Subtraction Facts through 20', 'calculation', 'boosters', { op: '−', pairs: 'subFacts' }], ['Addition and Subtraction Families', 'fact_family', 'ultimate'], ['Missing Subtrahends', 'missing', 'ultimate', { op: '−' }], ['Mental Subtraction', 'mental', 'boosters', { op: '−' }],
  ], optional: ['Subtraction Fluency Challenge', 'calculation', 'boosters', { op: '−', pairs: 'subFacts' }] },
  { id: 'multi-digit-subtraction', title: 'Multi-Digit Subtraction', weeks: '15–17', lessons: [
    ['Two-Digit Subtraction', 'calculation', 'boosters', { op: '−', pairs: 'sub2' }], ['Subtraction with Regrouping', 'calculation', 'boosters', { op: '−', pairs: 'sub2Regroup' }], ['Three-Digit Subtraction', 'calculation', 'boosters', { op: '−', pairs: 'sub3' }], ['Check Subtraction with Addition', 'inverse', 'ultimate'],
  ], optional: ['Four-Digit Subtraction', 'calculation', 'boosters', { op: '−', pairs: 'sub4' }] },
  { id: 'mixed-operations', title: 'Mixed Operations and Word Problems', weeks: '18–19', lessons: [
    ['Choose the Operation', 'operation', 'ultimate'], ['One-Step Word Problems', 'word', 'ultimate'], ['Two-Step Word Problems', 'two_step', 'ultimate'], ['Mixed Missing Numbers', 'missing', 'ultimate', { op: '+' }],
  ], optional: ['Problem-Solving Challenge', 'two_step', 'ultimate'] },
  { id: 'graphs-data', title: 'Graphs and Data', weeks: '20–21', lessons: [
    ['Read Pictographs', 'graph', 'ultimate', { style: 'pictograph' }], ['Read Bar Graphs', 'graph', 'ultimate'], ['Read Line Plots', 'graph', 'ultimate', { style: 'line_plot' }], ['Compare Graph Data', 'graph_difference', 'ultimate'],
  ], optional: ['Data Detective Challenge', 'graph_difference', 'ultimate'] },
  { id: 'multiplication', title: 'Multiplication Foundations and Facts', weeks: '22–25', lessons: [
    ['Equal Groups', 'groups', 'ultimate'], ['Arrays', 'array', 'ultimate'], ['Turn-Around Facts', 'property', 'ultimate'], ['Facts for 0–5 and 10', 'calculation', 'ultimate', { op: '×', pairs: 'mul' }],
  ], optional: ['Facts through 12', 'calculation', 'ultimate', { op: '×', pairs: 'mulAdvanced' }] },
  { id: 'division', title: 'Division Foundations and Facts', weeks: '26–28', lessons: [
    ['Share Equally', 'division_model', 'ultimate'], ['Multiplication and Division Families', 'fact_family', 'ultimate', { family: 'division' }], ['Division Facts', 'calculation', 'ultimate', { op: '÷', pairs: 'div' }], ['Division Stories', 'division_model', 'ultimate'],
  ], optional: ['Division Facts through 12', 'calculation', 'ultimate', { op: '÷', pairs: 'divAdvanced' }] },
  { id: 'fractions', title: 'Fractions', weeks: '29–31', lessons: [
    ['Fractions of a Whole', 'fraction', 'ultimate'], ['Fractions of a Set', 'fraction_set', 'ultimate'], ['Fractions on Number Lines', 'fraction_line', 'ultimate'], ['Compare and Equivalent Fractions', 'fraction_compare', 'ultimate'],
  ], optional: ['Fraction Challenge', 'fraction_compare', 'ultimate'] },
  { id: 'measurement', title: 'Money, Time, and Measurement', weeks: '32–33', lessons: [
    ['Count Money', 'money', 'ultimate'], ['Tell Time', 'clock', 'ultimate'], ['Choose Measurement Units', 'measurement', 'ultimate'], ['Measurement Applications', 'measurement', 'ultimate'],
  ], optional: ['Money Challenge', 'money', 'ultimate'] },
  { id: 'geometry', title: 'Geometry, Area, and Perimeter', weeks: '34–35', lessons: [
    ['Name Shapes', 'shape', 'ultimate'], ['Classify Quadrilaterals', 'quadrilateral', 'ultimate'], ['Area with Arrays', 'area', 'ultimate'], ['Perimeter', 'perimeter', 'ultimate'],
  ], optional: ['Geometry Challenge', 'perimeter', 'ultimate'] },
  { id: 'cumulative', title: 'Cumulative Problem Solving', weeks: '36', lessons: [
    ['Cumulative Arithmetic', 'word', 'authored'], ['Cumulative Data', 'graph_difference', 'authored'], ['Cumulative Fractions and Geometry', 'fraction', 'authored'], ['Cumulative Measurement', 'clock', 'authored'],
  ], optional: ['Final Multi-Step Challenge', 'two_step', 'beast'] },
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
      { title: 'Beast Academy 2A Guide and Practice', publisher: 'Art of Problem Solving' },
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
  });
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
    if (!Array.isArray(example?.solution?.steps) || example.solution.steps.length < 1) {
      errors.push(`${bank.id}: worked example must show how to reach the answer`);
    }
  }
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
  const ctx = { specs: new Map() }; const built = new Map();
  definitions.forEach((def) => {
    let items;
    if (def.kind === 'mastery') {
      items = def.masteryOf.flatMap((sourceDef, sourceIndex) => [0, 4, 8].map((itemIndex, offset) => ({
        ...structuredClone(built.get(sourceDef.id)[itemIndex]), id: `${slug(def.id)}-q${String(sourceIndex * 3 + offset + 1).padStart(2, '0')}`,
      })));
    } else items = buildItems(def, ctx);
    built.set(def.id, items);
    const bank = bankFor(def, items);
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
