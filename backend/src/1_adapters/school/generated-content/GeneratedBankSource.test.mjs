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
