#!/usr/bin/env node
/** Deterministic, authoring-time SVG figures for paper mathematics courses. */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { parseArgv } from '../_argv.mjs';

const SCHEMA = 'school.math-svg/v1';
const REF = /^school\/math\/[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;
const KINDS = new Set([
  'number_line', 'ten_frame', 'counters', 'base_ten', 'array',
  'fraction_model', 'clock', 'data_graph', 'shape_set',
]);
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const int = (value, fallback = 0) => Math.trunc(num(value, fallback));
const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const line = (x1, y1, x2, y2, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${extra}/>`;
const text = (x, y, value, extra = '') => `<text x="${x}" y="${y}" ${extra}>${esc(value)}</text>`;
const circle = (cx, cy, r, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" ${extra}/>`;
const rect = (x, y, width, height, extra = '') => `<rect x="${x}" y="${y}" width="${width}" height="${height}" ${extra}/>`;

function numberLine(params) {
  const min = num(params.min, 0); const max = num(params.max, 20); const step = num(params.step, 1);
  assert(max > min && step > 0, 'number_line requires max > min and step > 0');
  const width = 540; const height = 130; const left = 34; const right = 506; const y = 50;
  const values = []; for (let value = min; value <= max + step / 100; value += step) values.push(Number(value.toFixed(6)));
  assert(values.length <= 41, 'number_line supports at most 41 ticks');
  const labels = params.labels === false ? [] : Array.isArray(params.labels) ? params.labels.map(num) : values;
  const marks = new Map((params.marks ?? []).map((mark) => [Number(num(mark.value).toFixed(6)), mark.label ?? '●']));
  const nodes = [line(left, y, right, y, 'stroke="#111" stroke-width="2"'),
    `<path d="M ${right} ${y} l -9 -6 v 12 z" fill="#111"/>`];
  values.forEach((value, index) => {
    const x = left + ((right - left) * (value - min)) / (max - min);
    nodes.push(line(x, y - 8, x, y + 8, 'stroke="#111" stroke-width="1.5"'));
    if (labels.includes(value)) nodes.push(text(x, y + 30, value, 'text-anchor="middle"'));
    if (marks.has(value)) nodes.push(text(x, y - 17, marks.get(value), 'text-anchor="middle" font-weight="700"'));
  });
  return { width, height, body: nodes.join('') };
}

function tenFrame(params) {
  const filled = int(params.filled, 0); assert(filled >= 0 && filled <= 20, 'ten_frame filled must be 0..20');
  const frames = filled > 10 || int(params.frames, 1) === 2 ? 2 : 1;
  const width = frames === 2 ? 540 : 280; const height = 150; const nodes = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const ox = 20 + frame * 260; const count = Math.min(10, Math.max(0, filled - frame * 10));
    for (let cell = 0; cell < 10; cell += 1) {
      const x = ox + (cell % 5) * 48; const y = 18 + Math.floor(cell / 5) * 48;
      nodes.push(rect(x, y, 48, 48, 'fill="white" stroke="#111" stroke-width="1.5"'));
      if (cell < count) nodes.push(circle(x + 24, y + 24, 14, 'fill="#111"'));
    }
  }
  return { width, height, body: nodes.join('') };
}

function counters(params) {
  const count = int(params.count, 1); const columns = int(params.columns, Math.min(10, count));
  assert(count >= 1 && count <= 60 && columns >= 1, 'counters requires count 1..60 and columns >= 1');
  const rows = Math.ceil(count / columns); const gap = 38; const width = Math.max(160, columns * gap + 30); const height = rows * gap + 35;
  return { width, height, body: Array.from({ length: count }, (_, index) => circle(
    28 + (index % columns) * gap, 24 + Math.floor(index / columns) * gap, 11,
    'fill="white" stroke="#111" stroke-width="2"',
  )).join('') };
}

function baseTen(params) {
  const hundreds = int(params.hundreds, 0); const tens = int(params.tens, 0); const ones = int(params.ones, 0);
  assert([hundreds, tens, ones].every((value) => value >= 0 && value <= 12), 'base_ten counts must be 0..12');
  const nodes = []; let x = 18; const cell = 6;
  for (let h = 0; h < hundreds; h += 1) {
    const ox = x + (h % 4) * 70; const oy = 16 + Math.floor(h / 4) * 70;
    nodes.push(rect(ox, oy, 60, 60, 'fill="white" stroke="#111" stroke-width="1.5"'));
    for (let i = 1; i < 10; i += 1) {
      nodes.push(line(ox + i * cell, oy, ox + i * cell, oy + 60, 'stroke="#aaa" stroke-width="0.5"'));
      nodes.push(line(ox, oy + i * cell, ox + 60, oy + i * cell, 'stroke="#aaa" stroke-width="0.5"'));
    }
  }
  x = 306;
  for (let t = 0; t < tens; t += 1) nodes.push(rect(x + (t % 8) * 12, 16 + Math.floor(t / 8) * 70, 6, 60, 'fill="white" stroke="#111" stroke-width="1.2"'));
  x = 420;
  for (let o = 0; o < ones; o += 1) nodes.push(rect(x + (o % 6) * 14, 16 + Math.floor(o / 6) * 14, 8, 8, 'fill="#111"'));
  return { width: 530, height: Math.max(115, Math.ceil(Math.max(hundreds / 4, tens / 8, ones / 6)) * 75), body: nodes.join('') };
}

function arrayModel(params) {
  const rows = int(params.rows, 2); const columns = int(params.columns, 3);
  assert(rows >= 1 && rows <= 12 && columns >= 1 && columns <= 12, 'array rows and columns must be 1..12');
  const gap = 34; const width = columns * gap + 38; const height = rows * gap + 38;
  return { width, height, body: Array.from({ length: rows * columns }, (_, index) => circle(
    28 + (index % columns) * gap, 24 + Math.floor(index / columns) * gap, 9,
    'fill="#111"',
  )).join('') };
}

function fractionModel(params) {
  const denominator = int(params.denominator, 4); const numerator = int(params.numerator, 1);
  assert(denominator >= 2 && denominator <= 12 && numerator >= 0 && numerator <= denominator, 'fraction_model requires 0 <= numerator <= denominator <= 12');
  const width = 500; const height = 100; const x = 20; const y = 20; const w = 460; const h = 48; const part = w / denominator; const nodes = [];
  for (let index = 0; index < denominator; index += 1) nodes.push(rect(x + index * part, y, part, h,
    `${index < numerator ? 'fill="#bbb"' : 'fill="white"'} stroke="#111" stroke-width="1.5"`));
  return { width, height, body: nodes.join('') };
}

function clock(params) {
  const hour = int(params.hour, 12); const minute = int(params.minute, 0);
  assert(hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59, 'clock requires hour 1..12 and minute 0..59');
  const width = 230; const height = 230; const cx = 115; const cy = 112; const r = 88; const nodes = [circle(cx, cy, r, 'fill="white" stroke="#111" stroke-width="2"')];
  for (let value = 1; value <= 12; value += 1) {
    const angle = (value / 6 - 0.5) * Math.PI;
    nodes.push(text(cx + Math.cos(angle) * 69, cy + Math.sin(angle) * 69 + 5, value, 'text-anchor="middle"'));
  }
  const minuteAngle = (minute / 30 - 0.5) * Math.PI; const hourAngle = (((hour % 12) + minute / 60) / 6 - 0.5) * Math.PI;
  nodes.push(line(cx, cy, cx + Math.cos(minuteAngle) * 65, cy + Math.sin(minuteAngle) * 65, 'stroke="#111" stroke-width="2"'));
  nodes.push(line(cx, cy, cx + Math.cos(hourAngle) * 45, cy + Math.sin(hourAngle) * 45, 'stroke="#111" stroke-width="4"'));
  nodes.push(circle(cx, cy, 4, 'fill="#111"'));
  return { width, height, body: nodes.join('') };
}

function dataGraph(params) {
  const labels = params.labels ?? []; const values = (params.values ?? []).map((value) => num(value));
  assert(labels.length >= 2 && labels.length === values.length && values.every((value) => value >= 0), 'data_graph requires matching nonnegative labels and values');
  const width = 540; const height = 250; const left = 58; const bottom = 205; const top = 20; const max = Math.max(1, ...values); const slot = 440 / values.length;
  const nodes = [line(left, top, left, bottom, 'stroke="#111" stroke-width="2"'), line(left, bottom, 510, bottom, 'stroke="#111" stroke-width="2"')];
  values.forEach((value, index) => {
    const x = left + index * slot + slot * 0.5;
    if (params.style === 'pictograph') {
      for (let icon = 0; icon < value; icon += 1) nodes.push(circle(x, bottom - 18 - icon * 20, 7, 'fill="#111"'));
    } else if (params.style === 'line_plot') {
      for (let mark = 0; mark < value; mark += 1) {
        const y = bottom - 15 - mark * 20;
        nodes.push(line(x - 6, y - 6, x + 6, y + 6, 'stroke="#111" stroke-width="2"'));
        nodes.push(line(x - 6, y + 6, x + 6, y - 6, 'stroke="#111" stroke-width="2"'));
      }
    } else {
      const barHeight = (bottom - top - 10) * value / max;
      nodes.push(rect(x - slot * 0.3, bottom - barHeight, slot * 0.6, barHeight, 'fill="#bbb" stroke="#111" stroke-width="1.2"'));
      nodes.push(text(x, bottom - barHeight - 6, value, 'text-anchor="middle" font-weight="700"'));
    }
    nodes.push(text(x, bottom + 23, labels[index], 'text-anchor="middle"'));
  });
  return { width, height, body: nodes.join('') };
}

function shapeSet(params) {
  const shapes = params.shapes ?? [];
  assert(shapes.length >= 1 && shapes.length <= 6, 'shape_set requires 1..6 shapes');
  const width = 540; const height = 170; const slot = width / shapes.length; const nodes = [];
  shapes.forEach((shape, index) => {
    const cx = slot * index + slot / 2; const cy = 78; const label = shape.label ?? String.fromCharCode(65 + index); const type = shape.type ?? 'rectangle';
    if (type === 'triangle') nodes.push(`<polygon points="${cx},25 ${cx - 45},120 ${cx + 45},120" fill="white" stroke="#111" stroke-width="2"/>`);
    else if (type === 'circle') nodes.push(circle(cx, cy, 44, 'fill="white" stroke="#111" stroke-width="2"'));
    else if (type === 'square') nodes.push(rect(cx - 43, 35, 86, 86, 'fill="white" stroke="#111" stroke-width="2"'));
    else nodes.push(rect(cx - 52, 48, 104, 60, 'fill="white" stroke="#111" stroke-width="2"'));
    nodes.push(text(cx, 151, label, 'text-anchor="middle" font-weight="700"'));
  });
  return { width, height, body: nodes.join('') };
}

const RENDERERS = { number_line: numberLine, ten_frame: tenFrame, counters, base_ten: baseTen, array: arrayModel,
  fraction_model: fractionModel, clock, data_graph: dataGraph, shape_set: shapeSet };

export function validateMathAssetSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return ['spec must be a mapping'];
  if (spec.schema !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
  if (!REF.test(spec.ref ?? '')) errors.push('ref must be under school/math and use safe slug segments');
  if (!KINDS.has(spec.kind)) errors.push(`kind must be one of ${[...KINDS].join('|')}`);
  if (typeof spec.alt !== 'string' || !spec.alt.trim()) errors.push('alt is required');
  if (spec.alt?.length > 300) errors.push('alt must be at most 300 characters');
  if (spec.params !== undefined && (!spec.params || typeof spec.params !== 'object' || Array.isArray(spec.params))) errors.push('params must be a mapping');
  return errors;
}

export function renderMathAsset(spec) {
  const errors = validateMathAssetSpec(spec); if (errors.length) throw new Error(errors.join('; '));
  const rendered = RENDERERS[spec.kind](spec.params ?? {});
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rendered.width} ${rendered.height}" role="img" aria-labelledby="title"><title id="title">${esc(spec.alt)}</title><g font-family="Helvetica,Arial,sans-serif" font-size="20" fill="#111" stroke-linecap="round" stroke-linejoin="round">${rendered.body}</g></svg>\n`;
}

function filesUnder(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name);
    return entry.isDirectory() ? filesUnder(child) : /\.ya?ml$/u.test(entry.name) ? [child] : [];
  }).sort();
}

export function generateMathAssets({ target, dataDir, check = false } = {}) {
  assert(typeof target === 'string' && target, 'target spec file or directory is required');
  assert(typeof dataDir === 'string' && dataDir, 'dataDir is required');
  const results = [];
  for (const file of filesUnder(path.resolve(target))) {
    const spec = yaml.load(fs.readFileSync(file, 'utf8')); const svg = renderMathAsset(spec);
    const output = path.join(path.resolve(dataDir), 'content', 'assets', `${spec.ref}.svg`);
    if (check) {
      assert(fs.existsSync(output), `${spec.ref}: generated SVG is missing`);
      assert(fs.readFileSync(output, 'utf8') === svg, `${spec.ref}: generated SVG is stale`);
    } else {
      fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, svg, 'utf8');
    }
    results.push({ ref: spec.ref, output, bytes: Buffer.byteLength(svg) });
  }
  return results;
}

const HELP = `school math-assets — deterministic SVG figures for paper math\n\nUsage:\n  node cli/school.mjs math-assets generate <spec.yml|dir> --data-dir <path>\n  node cli/school.mjs math-assets check <spec.yml|dir> --data-dir <path>\n`;
export async function main(argv = process.argv.slice(2)) {
  const { subcommand, positional, flags, help } = parseArgv(argv);
  if (help || !subcommand) { process.stdout.write(HELP); return help ? 0 : 2; }
  if (!['generate', 'check'].includes(subcommand) || !positional[0]) { process.stderr.write(HELP); return 2; }
  const dataDir = flags['data-dir'];
  if (!dataDir || dataDir === true) { process.stderr.write('ERROR: --data-dir <path> is required\n'); return 2; }
  const results = generateMathAssets({ target: positional[0], dataDir: String(dataDir), check: subcommand === 'check' });
  results.forEach((result) => process.stdout.write(`${subcommand === 'check' ? 'OK' : 'WROTE'} ${result.ref} ${result.bytes} bytes\n`));
  return 0;
}
