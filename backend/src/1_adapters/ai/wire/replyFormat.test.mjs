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
  it('asks for a tab on every column and quoting that matches what the encoder quotes', () => {
    expect(TOON_REPLY_RULES).toMatch(/including before trailing empty cells/);
    expect(TOON_REPLY_RULES).toMatch(/colon/);
    expect(TOON_REPLY_RULES).toMatch(/starts with # or -/);
  });
  it('every value the primer says to quote is one the encoder quotes too', () => {
    for (const name of ['a\tb', 'a\nb', 'Soup: Miso', '12" Sub', '#1 Combo', '- x', ' lead', 'trail ']) {
      expect(encode({ items: [{ name, n: 1 }] }, { delimiter: '\t' })).toMatch(/\n  "/);
    }
  });
});

describe('decodeReply', () => {
  const reply = 'date: 2026-10-01\ntime: evening\nitems[2\t]{name\tunit\tgrams\tdish}:\n  Chicken, Rice\tg\t150\t\n  Broccoli\tg\t80\tBowl';

  it('decodes rows and turns an empty cell into an absent key', () => {
    expect(decodeReply(reply, shape)).toEqual({
      ok: true,
      value: { date: '2026-10-01', time: 'evening', items: [
        { name: 'Chicken, Rice', unit: 'g', grams: 150 },
        { name: 'Broccoli', unit: 'g', grams: 80, dish: 'Bowl' },
      ] },
    });
  });

  // Real model output: no trailing tab when the last optional cell (dish) is empty.
  it('keeps every row when non-last rows omit the trailing tab of an empty dish', () => {
    const real = 'date: 2026-10-01\ntime: morning\nitems[3\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\n  Toast\tg\t30\n  Rice\tg\t100\tBowl';
    expect(decodeReply(real, shape)).toEqual({
      ok: true,
      value: { date: '2026-10-01', time: 'morning', items: [
        { name: 'Egg', unit: 'g', grams: 50 },
        { name: 'Toast', unit: 'g', grams: 30 },
        { name: 'Rice', unit: 'g', grams: 100, dish: 'Bowl' },
      ] },
    });
  });

  it('a short LAST row in a lax decode is a truncation failure, not a silent drop', () => {
    const cut = 'date: 2026-10-01\nitems[3\t]{name\tunit\tgrams\tdish}:\n  A\tg\t1\t\n  B\tg\t2\tX\n  C\tg';
    expect(decodeReply(cut, shape)).toEqual({ ok: false, reason: 'truncated' });
  });

  it('a last row missing only its trailing dish tab also fails truncated (indistinguishable from a cut)', () => {
    const cut = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  A\tg\t1\tX\n  B\tg\t2';
    expect(decodeReply(cut, shape)).toEqual({ ok: false, reason: 'truncated' });
  });

  it('a middle row starting with # (a comment to the decoder) fails instead of vanishing', () => {
    const reply = 'date: d\nitems[3\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\n  #1 Combo\tg\t300\t\n  Rice\tg\t100\tBowl';
    expect(decodeReply(reply, shape)).toEqual({ ok: false, reason: 'row-count-mismatch' });
  });

  it('a # row is caught even when the declared [N] agrees with what strict decode kept', () => {
    const reply = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\n  #1 Combo\tg\t300\t\n  Rice\tg\t100\tBowl';
    expect(decodeReply(reply, shape).ok).toBe(false);
  });

  it('a quoted "#1 Combo" decodes correctly', () => {
    const reply = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\n  "#1 Combo"\tg\t300\t';
    expect(decodeReply(reply, shape).value.items.map((i) => i.name)).toEqual(['Egg', '#1 Combo']);
  });

  it('a single unquoted "Soup: Miso" row fails, never {items:[]} ok', () => {
    const reply = 'date: d\nitems[1\t]{name\tunit\tgrams\tdish}:\n  Soup: Miso\tg\t200\t';
    expect(decodeReply(reply, shape)).toEqual({ ok: false, reason: 'row-count-mismatch' });
  });

  it('an unquoted "Soup: Miso" middle row fails', () => {
    const reply = 'date: d\nitems[3\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\n  Soup: Miso\tg\t200\t\n  Rice\tg\t100\tBowl';
    expect(decodeReply(reply, shape).ok).toBe(false);
  });

  it('a colon after the first cell, or a quoted colon value, decodes correctly', () => {
    const reply = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  "Soup: Miso"\tml\t200\t\n  Tofu\tg\t50\tSoup: Miso';
    expect(decodeReply(reply, shape).value.items).toEqual([
      { name: 'Soup: Miso', unit: 'ml', grams: 200 },
      { name: 'Tofu', unit: 'g', grams: 50, dish: 'Soup: Miso' },
    ]);
  });

  it('a declared [N] that disagrees with the rows present fails, in either direction', () => {
    const rows = '\n  Egg\tg\t50\t\n  Toast\tg\t30\t\n  Rice\tg\t100\tBowl';
    expect(decodeReply(`date: d\nitems[2\t]{name\tunit\tgrams\tdish}:${rows}`, shape)).toEqual({ ok: false, reason: 'row-count-mismatch' });
    expect(decodeReply(`date: d\nitems[4\t]{name\tunit\tgrams\tdish}:${rows}`, shape)).toEqual({ ok: false, reason: 'row-count-mismatch' });
  });

  it('an extra cell the lax decoder would discard fails', () => {
    expect(decodeReply('date: d\nitems[1\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\tX\tY', shape)).toEqual({ ok: false, reason: 'extra-cells' });
  });

  it('a stray unquoted double quote (which would swallow the following tabs) fails', () => {
    const reply = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  12" Sub\tg\t300\t\n  Rice\tg\t100\tBowl';
    expect(decodeReply(reply, shape)).toEqual({ ok: false, reason: 'stray-quote' });
  });

  it('a blank line inside the table does not lose a row', () => {
    const reply = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\n\n  Rice\tg\t100\tBowl';
    expect(decodeReply(reply, shape).value.items.map((i) => i.name)).toEqual(['Egg', 'Rice']);
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

  // Regression: fenced reply with empty last cell is kept (tab preserved through fence)
  it('fenced reply: empty last cell (trailing tab) is preserved and row is complete', () => {
    const fenced = '```toon\nitems[1\t]{name\tunit\tgrams\tdish}:\n  A\tg\t1\t\n```';
    const result = decodeReply(fenced, shape);
    expect(result.ok).toBe(true);
    expect(result.value.items.length).toBe(1);
    expect(result.value.items[0].name).toBe('A');
  });
});
