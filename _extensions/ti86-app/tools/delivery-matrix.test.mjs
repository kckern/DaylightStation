import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const REQUIREMENTS_PATH = path.join(EXTENSION, 'docs', 'schoolcalc-requirements.md');
const MATRIX_PATH = path.join(EXTENSION, 'docs', 'delivery-matrix.md');
const REQUIREMENTS = readFileSync(REQUIREMENTS_PATH, 'utf8');
const MATRIX = readFileSync(MATRIX_PATH, 'utf8');
const STATUS = new Set(['done', 'partial', 'missing', 'hardware', 'n/a']);

// These are the requirement identities published by delivery-matrix.md. A
// deliberate addition/removal requires changing both the canonical prose and
// this count, which makes renumbering or a silently orphaned row reviewable.
const EXPECTED_ITEMS = Object.freeze({
  1: 6, 2: 10, 3: 12, 4: 10, 5: 13, 6: 8,
  7: 7, 8: 8, 9: 15, 10: 9, 11: 18, 12: 12,
  13: 16, 14: 8, 15: 8, 16: 12, 17: 8, 18: 3,
});

describe('SchoolCalc requirement delivery ledger', () => {
  it('covers the same complete 1–18 group sequence as the canonical requirements', () => {
    expect(sectionNumbers(REQUIREMENTS)).toEqual(range(1, 18));
    expect(sectionNumbers(MATRIX)).toEqual(range(1, 18));
  });

  it('assigns every requirement one unique contiguous identity', () => {
    const rows = matrixRows(MATRIX);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);

    for (const [groupText, count] of Object.entries(EXPECTED_ITEMS)) {
      const group = Number(groupText);
      expect(rows.filter((row) => row.group === group).map((row) => row.item))
        .toEqual(range(1, count));
    }
  });

  it('uses only declared status marks in each group-specific status column', () => {
    for (const row of matrixRows(MATRIX)) {
      const statusIndexes = row.group <= 15 ? [2, 3, 4]
        : row.group === 16 ? [2, 3]
          : [2];
      for (const index of statusIndexes) {
        expect(STATUS.has(row.cells[index]), `${row.id} has invalid status '${row.cells[index]}'`).toBe(true);
      }
    }
  });

  it('does not call implementation complete while its evidence names an implementation gap', () => {
    const contradictions = matrixRows(MATRIX)
      .filter((row) => row.group <= 15 && row.cells[3] === 'done' && row.cells[4] === 'done')
      .filter((row) => /\b(?:missing|not yet|still required|remains? to (?:build|implement|add))\b/i
        .test(row.cells[5] ?? ''))
      .map((row) => row.id);
    expect(contradictions).toEqual([]);
  });

  it('contains no placeholder requirements and every refining-document link resolves', () => {
    expect(MATRIX).not.toMatch(/\b(?:TODO|TBD|FIXME)\b/);
    const refining = REQUIREMENTS.slice(REQUIREMENTS.indexOf('## 18. Refining documents'));
    const links = [...refining.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
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
    const match = /^\| SC-(\d+)\.(\d+) \|/.exec(line);
    if (!match) return [];
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
    return [{
      id: `SC-${match[1]}.${match[2]}`,
      group: Number(match[1]),
      item: Number(match[2]),
      cells,
    }];
  });
}

function range(first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}
