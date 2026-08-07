import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateQuestionBank } from '#domains/school/index.mjs';
import { GeneratedBankSource } from './GeneratedBankSource.mjs';

let dataDir;
let source;

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-generated-bank-'));
  fs.writeFileSync(path.join(dataDir, 'recipes.yml'), `
- bankId: rates:values
  summaryId: values
  title: Values
  subject: economics
  topics: [rates]
  collections: [quantitative]
  audience: generic
  entities: values
  itemType: multiple_choice
  prompt: "Value of {name}?"
  answerField: value
  distractorField: value
  available: true
- bankId: rates:future
  summaryId: future
  title: Future Values
  entities: values
  itemType: multiple_choice
  prompt: "Value of {name}?"
  answerField: value
  available: false
`);
  fs.writeFileSync(path.join(dataDir, 'values.yml'), `
- { id: a, name: Alpha, value: '10' }
- { id: b, name: Beta, value: '20' }
- { id: c, name: Gamma, value: '30' }
- { id: d, name: Delta, value: '40' }
`);
  source = new GeneratedBankSource({ dataDir });
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe('GeneratedBankSource', () => {
  it('resolves configured banks without a namespace branch', () => {
    const bank = source.resolve('rates:values');
    expect(bank.items).toHaveLength(4);
    expect(validateQuestionBank(bank).ok).toBe(true);
    expect(source.resolve('anything:not-configured')).toBeNull();
    expect(source.resolve('rates:future')).toBeNull();
  });

  it('lists generic metadata and memoizes generated banks', () => {
    const summary = source.listSummaries().find((entry) => entry.bankId === 'rates:values');
    expect(summary).toMatchObject({
      summaryId: 'values', itemType: 'multiple_choice', available: true,
      collections: ['quantitative'],
    });
    expect(source.resolve('rates:values')).toBe(source.resolve('rates:values'));
  });
});

describe('boot resilience (admin advocacy A1 — the station must never crash-loop over school content)', () => {
  it('a MISSING recipes file degrades to an empty source with a warn, never a throw', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-gb-missing-'));
    const warns = [];
    const src = new GeneratedBankSource({ dataDir: emptyDir, logger: { warn: (...a) => warns.push(a), error: () => {} } });
    expect(src.listSummaries()).toEqual([]);
    expect(src.resolve('anything')).toBeNull();
    expect(warns.length).toBe(1);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('a MALFORMED recipes file degrades to an empty source with an ERROR, never a throw', () => {
    const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-gb-bad-'));
    fs.writeFileSync(path.join(badDir, 'recipes.yml'), '{ this is: [not, valid, yaml');
    const errors = [];
    const src = new GeneratedBankSource({ dataDir: badDir, logger: { warn: () => {}, error: (...a) => errors.push(a) } });
    expect(src.listSummaries()).toEqual([]);
    expect(errors.length).toBe(1);
    fs.rmSync(badDir, { recursive: true, force: true });
  });

  it('one invalid recipe is skipped with an error; the valid rest still serve', () => {
    const mixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-gb-mix-'));
    fs.writeFileSync(path.join(mixDir, 'recipes.yml'), `
- bankId: ok:one
  title: Fine
  entities: values
  itemType: multiple_choice
  prompt: "Value of {name}?"
  answerField: value
  available: true
- title: no bankId at all
- bankId: ok:one
  title: duplicate id
  entities: values
`);
    fs.writeFileSync(path.join(mixDir, 'values.yml'), "- { id: a, name: Alpha, value: '1' }\n- { id: b, name: Beta, value: '2' }\n- { id: c, name: Gamma, value: '3' }\n- { id: d, name: Delta, value: '4' }\n");
    const errors = [];
    const src = new GeneratedBankSource({ dataDir: mixDir, logger: { warn: () => {}, error: (...a) => errors.push(a) } });
    expect(src.listSummaries().map((s) => s.bankId)).toEqual(['ok:one']);
    expect(errors.length).toBe(2); // the bankless recipe + the duplicate
    expect(src.resolve('ok:one')).toBeTruthy();
    fs.rmSync(mixDir, { recursive: true, force: true });
  });

  it('a missing dataDir is still a hard programmer error', () => {
    expect(() => new GeneratedBankSource({ dataDir: 'relative/nope' })).toThrow(/absolute/);
  });
});
