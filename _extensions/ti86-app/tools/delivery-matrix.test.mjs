import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const REQUIREMENTS_PATH = path.join(EXTENSION, 'docs', 'schoolcalc-v1-requirements.md');
const MATRIX_PATH = path.join(EXTENSION, 'docs', 'delivery-matrix.md');
const REQUIREMENTS = readFileSync(REQUIREMENTS_PATH, 'utf8');
const MATRIX = readFileSync(MATRIX_PATH, 'utf8');
const STATUS = new Set(['specified', 'partial', 'implemented', 'proven']);
const EXPECTED_IDS = [
  'AS-01', 'AS-02', 'AS-03', 'AS-04', 'AS-05',
  'AS-10', 'AS-11', 'AS-12', 'AS-13', 'AS-14', 'AS-15',
  'AS-20', 'AS-21', 'AS-22', 'AS-23', 'AS-24', 'AS-25', 'AS-26', 'AS-27', 'AS-28',
  'AS-30', 'AS-31', 'AS-32', 'AS-33', 'AS-34', 'AS-35',
  'AS-40', 'AS-41', 'AS-42', 'AS-43', 'AS-44', 'AS-45',
  'AS-50', 'AS-51', 'AS-52',
];

describe('SchoolCalc requirement delivery ledger', () => {
  it('covers the complete canonical v1 section sequence', () => {
    expect(sectionNumbers(REQUIREMENTS)).toEqual(range(1, 16));
  });

  it('assigns every requirement one unique contiguous identity', () => {
    const rows = matrixRows(MATRIX);
    expect(rows.map((row) => row.id)).toEqual(EXPECTED_IDS);
  });

  it('uses only declared status marks in each group-specific status column', () => {
    for (const row of matrixRows(MATRIX)) {
      expect(STATUS.has(row.cells[2]), `${row.id} has invalid status '${row.cells[2]}'`).toBe(true);
    }
  });

  it('does not call implementation complete while its evidence names an implementation gap', () => {
    const contradictions = matrixRows(MATRIX)
      .filter((row) => row.cells[2] === 'implemented' || row.cells[2] === 'proven')
      .filter((row) => /\b(?:missing|not yet|still required|remains? to (?:build|implement|add))\b/i
        .test(row.cells[5] ?? ''))
      .map((row) => row.id);
    expect(contradictions).toEqual([]);
  });

  it('contains no placeholder requirements and every refining-document link resolves', () => {
    expect(MATRIX).not.toMatch(/\b(?:TODO|TBD|FIXME)\b/);
    const links = [...REQUIREMENTS.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(existsSync(path.resolve(path.dirname(REQUIREMENTS_PATH), link)), link).toBe(true);
    }
  });
});

function sectionNumbers(markdown) {
  return [...markdown.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
}

function matrixRows(markdown) {
  return markdown.split('\n').flatMap((line) => {
    const match = /^\| AS-(\d)(\d) \|/.exec(line);
    if (!match) return [];
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
    return [{
      id: `AS-${match[1]}${match[2]}`,
      group: Number(match[1]),
      item: Number(match[2]),
      cells,
    }];
  });
}

function range(first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}
