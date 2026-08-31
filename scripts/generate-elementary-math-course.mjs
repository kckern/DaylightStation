#!/usr/bin/env node
/** Reproducible authoring source for Elementary Mathematics: Grade 2–3 Bridge. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { renderMathAsset } from '../cli/school/math-assets.mjs';

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
    reviewReference,
    feedback: { incorrect: feedback ?? `Try the ${def.title.toLowerCase()} strategy again, then check your work.` },
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

function buildItems(def, ctx) {
  if (def.kind === 'calculation') return Array.from({ length: 12 }, (_, index) => calculation(def, index));
  if (def.kind === 'place_value') return Array.from({ length: 12 }, (_, index) => {
    const number = pick(def.params.fourDigit
      ? [4821, 7316, 5064, 2948, 8603, 3159, 9472, 6285, 7041, 1596, 2738, 8904]
      : [482, 731, 506, 294, 860, 315, 947, 628, 704, 159, 273, 890], index);
    const places = def.params.fourDigit ? ['thousands', 'hundreds', 'tens', 'ones'] : ['hundreds', 'tens', 'ones']; const place = places[index % places.length];
    const divisor = place === 'thousands' ? 1000 : place === 'hundreds' ? 100 : place === 'tens' ? 10 : 1;
    const digit = Math.floor(number / divisor) % 10;
    return item(def, index, { prompt: `What is the value of the ${place} digit in ${number}?`, answer: digit * divisor, decoys: [digit, digit * 10, digit * 100, number] });
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
    const prompt = def.params.op === '−' ? `What number makes $${total} − \Box = ${total - b}$ true?` : `What number makes $${a} + \Box = ${total}$ true?`;
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
    const [a, b] = pick(PAIRS.sub2Regroup, index); return item(def, index, { prompt: `Which addition checks $${a} − ${b} = ${a - b}$?`, answer: `${a - b} + ${b} = ${a}`,
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
    const labels = ['Red', 'Blue', 'Green', 'Gold']; const values = [3 + index % 4, 6 + index % 3, 2 + (index * 2) % 5, 5 + (index * 3) % 4];
    const max = Math.max(...values); const answer = labels[values.indexOf(max)];
    return item(def, index, { prompt: 'Which category has the greatest value?', answer, decoys: labels.filter((label) => label !== answer).concat(['They are equal']),
      stimulus: figure(ctx, def, index, 'data_graph', `${def.params.style === 'pictograph' ? 'A pictograph' : def.params.style === 'line_plot' ? 'A line plot' : 'A bar graph'} with four labeled categories and values.`, { labels, values, style: def.params.style ?? 'bar' }) });
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
    const [a, b] = pick(PAIRS.mul, index); return item(def, index, { prompt: `Which multiplication expression has the same product as $${a} × ${b}$?`, answer: `${b} × ${a}`,
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
    return item(def, index, { prompt: `${selected} of ${total} counters are selected. What fraction of the set is selected?`, answer,
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
    return item(def, index, { prompt: `How many cents are ${quarters} quarters, ${dimes} dimes, ${nickels} nickels, and ${pennies} pennies worth?`, answer });
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
      ['Which word names every polygon with four sides?', 'quadrilateral', ['triangle', 'pentagon', 'hexagon', 'circle']],
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
  return {
    schema: 'school.question-bank/v2', id: `math/${COURSE}/${def.id}/worksheet`, title: def.title, subject: 'math', audience: 'assigned',
    unit: def.id, topics: [def.module, slug(def.title)], items,
    lesson: {
      schema: 'school.unit/v1', unitId: def.id, title: def.title,
      description: def.required ? `Six-question mastery-oriented worksheet for ${def.title.toLowerCase()}.` : `Optional practice and enrichment for ${def.title.toLowerCase()}.`,
      subject: 'math', courseId: COURSE, sequence: def.sequence, module: def.module, moduleRole: def.moduleRole, required: def.required,
      grades: ['lower'], objectives: [`Solve grade 2–3 bridge problems involving ${def.title.toLowerCase()}.`],
      bank: `math/${COURSE}/${def.id}/worksheet`, passing: { percent: 80 }, retry: { variants: 12 },
      studyReferences: def.studyReferences,
      provenance: { source: sourceName, reviewState: 'approved' },
    },
  };
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
    const moduleNumber = modules.findIndex((module) => module.id === def.module) + 1;
    const moduleDir = path.join(courseRoot, `${String(moduleNumber * 10).padStart(3, '0')}-${def.module}`);
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, `${def.id}.yml`), dump(bankFor(def, items)));
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

function parseDataDir(argv) {
  const at = argv.indexOf('--data-dir'); return at >= 0 ? argv[at + 1] : null;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const argv = process.argv.slice(2); const dataDir = parseDataDir(argv);
    const result = generateElementaryMathCourse({ dataDir, requireAbsent: !argv.includes('--refresh') });
    execFileSync('magick', [path.join(result.courseRoot, 'poster.svg'), '-quality', '92', path.join(result.courseRoot, 'poster.jpg')]);
    fs.rmSync(path.join(result.courseRoot, 'poster.svg'));
    process.stdout.write(`${JSON.stringify({ course: result.courseRoot, banks: result.bankCount, items: result.itemCount, assets: result.assetCount })}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1;
  }
}
