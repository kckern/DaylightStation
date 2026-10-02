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
    expect(TOON_REPLY_RULES).toMatch(/looks like a number or like true, false or null/);
  });
  it('every value the primer says to quote is one the encoder quotes too', () => {
    for (const name of ['a\tb', 'a\nb', 'Soup: Miso', '12" Sub', '#1 Combo', '- x', ' lead', 'trail ', '12', '-3.5', 'true', 'false', 'null']) {
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

  // Final re-review: column shifts must fail, never decode ok.
  const FOOD_COLUMNS = ['name', 'icon', 'noom_color', 'quantity', 'unit', 'grams', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol', 'dish'];
  const foodShape = templateShape({
    date: 'YYYY-MM-DD', time: 'evening',
    items: [{ name: 'Food', icon: 'default', noom_color: 'green|yellow|orange', quantity: 1, unit: 'g|ml', grams: 100, calories: 100, protein: 1, carbs: 1, fat: 1, fiber: 1, sugar: 1, sodium: 1, cholesterol: 1, dish: 'Smoothie' }],
  });

  it('a comma-delimited 15-column food table (name with a comma) fails wrong-delimiter', () => {
    const reply = `date: 2026-10-01\ntime: evening\nitems[2]{${FOOD_COLUMNS.join(',')}}:\n`
      + '  Chicken Breast, Grilled,chicken,yellow,1,g,150,250,40,0,5,0,0,80,90,\n'
      + '  Rice,default,yellow,1,g,100,130,3,28,0,0,0,1,0,';
    expect(decodeReply(reply, foodShape)).toEqual({ ok: false, reason: 'wrong-delimiter' });
  });

  it('any header delimiter other than tab fails wrong-delimiter', () => {
    expect(decodeReply('items[1|]{name|unit|grams|dish}:\n  Egg|g|50|', shape)).toEqual({ ok: false, reason: 'wrong-delimiter' });
    expect(decodeReply('items[1]{name,unit,grams,dish}:\n  Egg,g,50,', shape)).toEqual({ ok: false, reason: 'wrong-delimiter' });
  });

  it('a shifted middle row (text lands in numeric grams) fails type-mismatch', () => {
    const reply = 'date: d\nitems[3\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\n  Rice\t100\tBowl\n  Toast\tg\t30\tPlate';
    expect(decodeReply(reply, shape)).toEqual({ ok: false, reason: 'type-mismatch' });
  });

  it('the 15-column food shape: a short row missing its unit cell fails type-mismatch (number in unit)', () => {
    const header = `items[2\t]{${FOOD_COLUMNS.join('\t')}}:`;
    const good = ['Rice', 'default', 'yellow', 1, 'g', 100, 130, 3, 28, 0, 0, 0, 1, 0, 'Bowl'].join('\t');
    const shifted = ['Egg', 'default', 'yellow', 1, 50, 70, 6, 0, 5, 0, 0, 60, 180, ''].join('\t');
    expect(decodeReply(`date: d\ntime: evening\n${header}\n  ${shifted}\n  ${good}`, foodShape)).toEqual({ ok: false, reason: 'type-mismatch' });
  });

  it('the 15-column food shape: a row missing its noom_color cell fails type-mismatch (text in quantity)', () => {
    const header = `items[2\t]{${FOOD_COLUMNS.join('\t')}}:`;
    const good = ['Rice', 'default', 'yellow', 1, 'g', 100, 130, 3, 28, 0, 0, 0, 1, 0, 'Bowl'].join('\t');
    const shifted = ['Egg', 'default', 1, 'g', 50, 70, 6, 0, 5, 0, 0, 60, 180, 'Plate'].join('\t');
    expect(decodeReply(`date: d\ntime: evening\n${header}\n  ${shifted}\n  ${good}`, foodShape)).toEqual({ ok: false, reason: 'type-mismatch' });
  });

  it('a full-width row may still carry a number-like name (only short rows are suspect)', () => {
    const reply = 'items[2\t]{name\tunit\tgrams\tdish}:\n  7\tg\t330\t\n  Rice\tg\t100\tBowl';
    expect(decodeReply(reply, shape).value.items[0].name).toBe('7');
  });

  it('two table headers fail multiple-tables', () => {
    const reply = 'date: d\nitems[1\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\nitems[1\t]{name\tunit\tgrams\tdish}:\n  Rice\tg\t100\tBowl';
    expect(decodeReply(reply, shape)).toEqual({ ok: false, reason: 'multiple-tables' });
    const other = 'date: d\nitems[1\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\nextras[1\t]{name}:\n  Salt';
    expect(decodeReply(other, shape)).toEqual({ ok: false, reason: 'multiple-tables' });
  });

  it('a valid reply with null in a numeric column still decodes', () => {
    const reply = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\tnull\t\n  Rice\tg\t100\tBowl';
    expect(decodeReply(reply, shape)).toEqual({ ok: true, value: { date: 'd', items: [
      { name: 'Egg', unit: 'g', grams: null },
      { name: 'Rice', unit: 'g', grams: 100, dish: 'Bowl' },
    ] } });
  });

  it('an empty numeric cell is an absent key, not a type mismatch', () => {
    const reply = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t\t\n  Rice\tg\t100\tBowl';
    expect(decodeReply(reply, shape).value.items[0]).toEqual({ name: 'Egg', unit: 'g' });
  });

  it('a header column outside the template fails shape-mismatch', () => {
    expect(decodeReply('items[1\t]{name\tunit\tgrams\tcolour}:\n  Egg\tg\t50\tred', shape)).toEqual({ ok: false, reason: 'shape-mismatch' });
  });

  // A short row may only omit trailing text columns (real 15-column food shape).
  describe('short rows in the 15-column food shape', () => {
    const header = `items[3\t]{${FOOD_COLUMNS.join('\t')}}:`;
    const egg = ['Egg', 'default', 'yellow', 1, 'g', 50, 70, 6, 0, 5, 0, 0, 60, 180];
    const rice = ['Rice', 'default', 'yellow', 1, 'g', 100, 130, 3, 28, 0, 0, 0, 1, 0, 'Bowl'];
    const toast = ['Toast', 'default', 'yellow', 1, 'g', 30, 80, 3, 15, 1, 1, 1, 150, 0, 'Plate'];
    const reply = (...rows) => `date: d\ntime: evening\n${header}\n${rows.map((r) => `  ${r.join('\t')}`).join('\n')}`;
    const withoutProtein = (row) => row.filter((_, i) => i !== FOOD_COLUMNS.indexOf('protein'));

    it('missing protein, dish empty and no trailing tab: fails short-row (cholesterol is in the missing suffix)', () => {
      expect(decodeReply(reply(withoutProtein(egg), rice, toast), foodShape)).toEqual({ ok: false, reason: 'short-row' });
    });

    it('missing protein, dish empty WITH its trailing tab: fails short-row (short row ending in an empty cell)', () => {
      expect(decodeReply(reply([...withoutProtein(egg), ''], rice, toast), foodShape)).toEqual({ ok: false, reason: 'short-row' });
    });

    it('missing protein with dish present: fails (the shifted number lands in dish)', () => {
      expect(decodeReply(reply(withoutProtein([...egg, 'Breakfast']), rice, toast), foodShape)).toEqual({ ok: false, reason: 'type-mismatch' });
    });

    it('dish empty with no trailing tab in a middle row decodes with dish absent', () => {
      const result = decodeReply(reply(rice, egg, toast), foodShape);
      expect(result.ok).toBe(true);
      expect(result.value.items[1]).toEqual(Object.fromEntries(egg.map((v, i) => [FOOD_COLUMNS[i], v])));
      expect(Object.hasOwn(result.value.items[1], 'dish')).toBe(false);
    });

    it('dish empty on the last row of a strict decode (tab present) decodes with dish absent', () => {
      const result = decodeReply(reply(rice, toast, [...egg, '']), foodShape);
      expect(result.ok).toBe(true);
      expect(Object.hasOwn(result.value.items[2], 'dish')).toBe(false);
      expect(result.value.items[2].cholesterol).toBe(180);
    });

    it('dish empty with no trailing tab on the LAST row cannot be strict and stays truncated', () => {
      expect(decodeReply(reply(rice, toast, egg), foodShape)).toEqual({ ok: false, reason: 'truncated' });
    });
  });
});
