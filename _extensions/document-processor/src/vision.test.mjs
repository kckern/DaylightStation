import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseResponse } from './vision.mjs';

const CATEGORIES = ['Tax', 'Medical', 'Insurance', 'Receipt'];

describe('vision', () => {
  test('buildPrompt includes page count and categories', () => {
    const prompt = buildPrompt(12, CATEGORIES);
    assert.ok(prompt.includes('12'));
    assert.ok(prompt.includes('Tax'));
    assert.ok(prompt.includes('Receipt'));
  });

  test('parseResponse extracts valid document array', () => {
    const raw = JSON.stringify({
      documents: [
        { pages: [1, 2], category: 'Tax', description: 'W-2 Form', date: '2026-01-15', issues: {} },
        { pages: [3], category: 'Receipt', description: 'Target Purchase', date: '2026-03-01', issues: { '3': 'upside_down' } },
      ],
    });
    const result = parseResponse(raw);
    assert.equal(result.length, 2);
    assert.deepEqual(result[0].pages, [1, 2]);
    assert.equal(result[1].issues['3'], 'upside_down');
  });

  test('parseResponse extracts JSON from markdown code fence', () => {
    const raw = 'Here is the analysis:\n```json\n{"documents":[{"pages":[1],"category":"Tax","description":"Test","date":"2026-01-01","issues":{}}]}\n```';
    const result = parseResponse(raw);
    assert.equal(result.length, 1);
  });

  test('parseResponse throws on invalid JSON', () => {
    assert.throws(() => parseResponse('not json at all'), /Failed to parse/);
  });

  test('parseResponse throws when documents array missing', () => {
    assert.throws(() => parseResponse('{"foo": "bar"}'), /Missing "documents"/);
  });
});
