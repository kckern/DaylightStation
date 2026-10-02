import { describe, it, expect } from 'vitest';
import { encode } from '@toon-format/toon';
import { buildReplySkeleton, rewriteCueLine, stripFormatSentences, decodeReply, TOON_REPLY_RULES } from './replyFormat.mjs';
import { templateShape } from './shapes.mjs';

const template = {
  date: 'YYYY-MM-DD',
  time: 'evening',
  items: [{ name: 'Food Name In Title Case', unit: 'g|ml', grams: 100, dish: 'Smoothie' }],
};
const shape = templateShape(template);

describe('buildReplySkeleton', () => {
  it('writes scalar lines and a tab table header with one example row from the template values', () => {
    expect(buildReplySkeleton(template, shape)).toBe(
      'date: YYYY-MM-DD\ntime: evening\nitems[N\t]{name\tunit\tgrams\tdish}:\n  Food Name In Title Case\tg|ml\t100\tSmoothie',
    );
  });
});

describe('rewriteCueLine', () => {
  it('names TOON instead of JSON and keeps the rest of the line', () => {
    expect(rewriteCueLine('Respond in JSON format with the COMPLETE revised list:')).toBe('Respond in TOON format with the COMPLETE revised list:');
  });
});

describe('stripFormatSentences', () => {
  it("removes LogFoodFromText's JSON-only closing instruction entirely", () => {
    expect(stripFormatSentences("Use USDA values.\nBegin response with '{' character - output only valid JSON, no markdown.")).toBe('Use USDA values.\n');
  });
  it('leaves field-meaning notes alone', () => {
    const note = '("dish" is OPTIONAL — omit it for a standalone item.)';
    expect(stripFormatSentences(note)).toBe(note);
  });
});

describe('TOON_REPLY_RULES', () => {
  it('is fixed text that never mentions a specific array name', () => {
    expect(TOON_REPLY_RULES).toMatch(/^Reply in TOON, not JSON/);
    expect(TOON_REPLY_RULES).not.toMatch(/items/);
  });
});

describe('decodeReply', () => {
  const reply = 'date: 2026-10-01\ntime: evening\nitems[2\t]{name\tunit\tgrams\tdish}:\n  Chicken, Rice\tg\t150\t\n  Broccoli\tg\t80\tBowl';

  it('decodes rows and turns an empty cell into an absent key', () => {
    expect(decodeReply(reply, shape)).toEqual({
      ok: true, droppedRows: 0, truncated: false,
      value: { date: '2026-10-01', time: 'evening', items: [
        { name: 'Chicken, Rice', unit: 'g', grams: 150 },
        { name: 'Broccoli', unit: 'g', grams: 80, dish: 'Bowl' },
      ] },
    });
  });

  it('drops a truncated partial last row and keeps the complete ones', () => {
    const cut = 'date: 2026-10-01\nitems[3\t]{name\tunit\tgrams\tdish}:\n  A\tg\t1\t\n  B\tg\t2\tX\n  C\tg';
    const result = decodeReply(cut, shape);
    expect(result.ok).toBe(true);
    expect(result.droppedRows).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.value.items.map(i => i.name)).toEqual(['A', 'B']);
  });

  it('fails truncated-empty when every row was partial', () => {
    expect(decodeReply('items[2\t]{name\tunit\tgrams\tdish}:\n  A\tg', shape)).toEqual({ ok: false, reason: 'truncated-empty' });
  });

  it('accepts a correct table with zero rows', () => {
    expect(decodeReply('date: 2026-10-01\nitems[0\t]{name\tunit\tgrams\tdish}:', shape).value.items).toEqual([]);
  });

  it('reports a JSON reply instead of decoding it', () => {
    expect(decodeReply('{"items":[]}', shape)).toEqual({ ok: false, reason: 'json-reply' });
  });

  // Review Focus 2
  it('fenced reply: strips a ```toon fence and decodes', () => {
    expect(decodeReply('```toon\n' + reply + '\n```', shape).ok).toBe(true);
  });
  it('prose preface falls back instead of returning a junk key', () => {
    expect(decodeReply('Here you go:\n' + reply, shape)).toEqual({ ok: false, reason: 'shape-mismatch' });
  });

  // Review Focus 1
  it('quoted values round-trip: tab, newline, quote and leading space in a name', () => {
    const items = [
      { name: 'Mac\t"n" Cheese', unit: 'g', grams: 200, dish: '' },
      { name: ' Leading space\nand newline', unit: 'g', grams: 50, dish: 'Plate' },
    ];
    const result = decodeReply(encode({ date: 'd', items }, { delimiter: '\t' }), shape);
    expect(result.ok).toBe(true);
    expect(result.value.items[0].name).toBe('Mac\t"n" Cheese');
    expect(result.value.items[1].name).toBe(' Leading space\nand newline');
  });

  // Review Focus 4
  it('string columns stay strings when the cell looks like a number or boolean', () => {
    const result = decodeReply('items[2\t]{name\tunit\tgrams\tdish}:\n  7\tg\t330\t\n  true\tg\t1\t', shape);
    expect(result.value.items.map(i => i.name)).toEqual(['7', 'true']);
    expect(result.value.items[0].grams).toBe(330);
  });

  // Regression: truncated last row without trailing tab is dropped
  it('truncated last row (missing exactly 1 column, no trailing tab) is dropped', () => {
    const cut = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  A\tg\t1\tX\n  B\tg\t2';
    const result = decodeReply(cut, shape);
    expect(result.ok).toBe(true);
    expect(result.droppedRows).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.value.items.map(i => i.name)).toEqual(['A']);
  });

  // Regression: fenced reply with empty last cell is kept (tab preserved through fence)
  it('fenced reply: empty last cell (trailing tab) is preserved and row is complete', () => {
    const fenced = '```toon\nitems[1\t]{name\tunit\tgrams\tdish}:\n  A\tg\t1\t\n```';
    const result = decodeReply(fenced, shape);
    expect(result.ok).toBe(true);
    expect(result.droppedRows).toBe(0);
    expect(result.value.items.length).toBe(1);
    expect(result.value.items[0].name).toBe('A');
  });
});
