import { describe, it, expect } from 'vitest';
import { encode } from '@toon-format/toon';
import { buildReplySkeleton, rewriteCueLine, stripFormatSentences, decodeReply, TOON_REPLY_RULES } from './replyFormat.mjs';
import { templateShape } from './shapes.mjs';
import { planWire } from './planWire.mjs';
import { captureTextPrompt } from './fixtures/foodPrompts.mjs';

/** Every whole TOON reply ends with its END line. */
const ended = (text) => `${text}\nEND`;

const template = {
  date: 'YYYY-MM-DD',
  time: 'evening',
  items: [{ name: 'Food Name In Title Case', unit: 'g|ml', grams: 100, dish: 'Smoothie' }],
};
const shape = templateShape(template);

describe('buildReplySkeleton', () => {
  it('writes scalar lines and a tab table header with one example row from the template values', () => {
    expect(buildReplySkeleton(template, shape)).toBe(
      'date: YYYY-MM-DD\ntime: evening\nitems[N\t]{name\tunit\tgrams\tdish}:\n  Food Name In Title Case\tg|ml\t100\tSmoothie\nEND',
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
    expect(TOON_REPLY_RULES).toMatch(/exactly one value per column/);
    expect(TOON_REPLY_RULES).toMatch(/final line containing exactly END, with nothing after it/);
    expect(TOON_REPLY_RULES).toMatch(/including a tab before an empty last value/);
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
  const H = 'items[2\t]{name\tunit\tgrams\tdish}:';
  const reply = `date: 2026-10-01\ntime: evening\n${H}\n  Chicken, Rice\tg\t150\t\n  Broccoli\tg\t80\tBowl`;

  it('decodes full-width rows and turns an empty cell (written with its tab) into an absent key', () => {
    expect(decodeReply(ended(reply), shape)).toEqual({
      ok: true,
      value: { date: '2026-10-01', time: 'evening', items: [
        { name: 'Chicken, Rice', unit: 'g', grams: 150 },
        { name: 'Broccoli', unit: 'g', grams: 80, dish: 'Bowl' },
      ] },
    });
  });

  it('accepts a correct table with zero rows', () => {
    expect(decodeReply(ended(`date: 2026-10-01\nitems[0\t]{name\tunit\tgrams\tdish}:`), shape).value.items).toEqual([]);
  });

  it('reports a JSON reply instead of decoding it', () => {
    expect(decodeReply('{"items":[]}', shape)).toEqual({ ok: false, reason: 'json-reply' });
  });

  it('fenced reply: strips a ```toon fence and decodes', () => {
    expect(decodeReply('```toon\n' + reply + '\nEND\n```', shape).ok).toBe(true);
  });

  it('fenced reply: an empty last cell (trailing tab) survives the fence strip', () => {
    const result = decodeReply('```toon\nitems[1\t]{name\tunit\tgrams\tdish}:\n  A\tg\t1\t\nEND\n```', shape);
    expect(result).toEqual({ ok: true, value: { items: [{ name: 'A', unit: 'g', grams: 1 }] } });
  });

  it('prose preface falls back instead of returning a junk key', () => {
    expect(decodeReply(ended('Here you go:\n' + reply), shape)).toEqual({ ok: false, reason: 'shape-mismatch' });
  });

  it('quoted values round-trip: tab, newline, quote and leading space in a name', () => {
    const items = [
      { name: 'Mac\t"n" Cheese', unit: 'g', grams: 200, dish: '' },
      { name: ' Leading space\nand newline', unit: 'g', grams: 50, dish: 'Plate' },
    ];
    const result = decodeReply(ended(encode({ date: 'd', items }, { delimiter: '\t' })), shape);
    expect(result.ok).toBe(true);
    expect(result.value.items[0].name).toBe('Mac\t"n" Cheese');
    expect(result.value.items[1].name).toBe(' Leading space\nand newline');
  });

  // Exact width: one value per column on every row, middle and last alike.
  it('a middle row without the trailing tab of an empty dish fails short-row', () => {
    const r = `date: d\nitems[3\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\n  Toast\tg\t30\t\n  Rice\tg\t100\tBowl`;
    expect(decodeReply(ended(r), shape)).toEqual({ ok: false, reason: 'short-row' });
  });

  it('a last row without the trailing tab of an empty dish fails short-row', () => {
    const r = `date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  Rice\tg\t100\tBowl\n  Egg\tg\t50`;
    expect(decodeReply(ended(r), shape)).toEqual({ ok: false, reason: 'short-row' });
  });

  it('a truncated last row fails short-row', () => {
    const cut = `date: d\nitems[3\t]{name\tunit\tgrams\tdish}:\n  A\tg\t1\t\n  B\tg\t2\tX\n  C\tg`;
    expect(decodeReply(ended(cut), shape)).toEqual({ ok: false, reason: 'short-row' });
  });

  it('an extra cell the lax decoder would discard fails extra-cells', () => {
    expect(decodeReply(ended('date: d\nitems[1\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\tX\tY'), shape)).toEqual({ ok: false, reason: 'extra-cells' });
  });

  it('a reordered header fails column-mismatch', () => {
    expect(decodeReply(ended('items[1\t]{name\tgrams\tunit\tdish}:\n  Egg\t50\tg\t'), shape)).toEqual({ ok: false, reason: 'column-mismatch' });
  });

  it('a header missing a column, or naming one outside the template, fails column-mismatch', () => {
    expect(decodeReply(ended('items[1\t]{name\tunit\tgrams}:\n  Egg\tg\t50'), shape)).toEqual({ ok: false, reason: 'column-mismatch' });
    expect(decodeReply(ended('items[1\t]{name\tunit\tgrams\tcolour}:\n  Egg\tg\t50\tred'), shape)).toEqual({ ok: false, reason: 'column-mismatch' });
  });

  // Lines the decoder silently eats.
  it('a middle row starting with # (a comment to the decoder) fails instead of vanishing', () => {
    const r = 'date: d\nitems[3\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\n  #1 Combo\tg\t300\t\n  Rice\tg\t100\tBowl';
    expect(decodeReply(ended(r), shape)).toEqual({ ok: false, reason: 'row-count-mismatch' });
  });

  it('a # row is caught even when the declared [N] agrees with what strict decode kept', () => {
    const r = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\n  #1 Combo\tg\t300\t\n  Rice\tg\t100\tBowl';
    expect(decodeReply(ended(r), shape).ok).toBe(false);
  });

  it('a quoted "#1 Combo" decodes correctly', () => {
    const r = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\n  "#1 Combo"\tg\t300\t';
    expect(decodeReply(ended(r), shape).value.items.map((i) => i.name)).toEqual(['Egg', '#1 Combo']);
  });

  it('a single unquoted "Soup: Miso" row fails, never {items:[]} ok', () => {
    const r = 'date: d\nitems[1\t]{name\tunit\tgrams\tdish}:\n  Soup: Miso\tg\t200\t';
    expect(decodeReply(ended(r), shape)).toEqual({ ok: false, reason: 'row-count-mismatch' });
  });

  it('an unquoted "Soup: Miso" middle row fails', () => {
    const r = 'date: d\nitems[3\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\n  Soup: Miso\tg\t200\t\n  Rice\tg\t100\tBowl';
    expect(decodeReply(ended(r), shape).ok).toBe(false);
  });

  it('a colon after the first cell, or a quoted colon value, decodes correctly', () => {
    const r = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  "Soup: Miso"\tml\t200\t\n  Tofu\tg\t50\tSoup: Miso';
    expect(decodeReply(ended(r), shape).value.items).toEqual([
      { name: 'Soup: Miso', unit: 'ml', grams: 200 },
      { name: 'Tofu', unit: 'g', grams: 50, dish: 'Soup: Miso' },
    ]);
  });

  it('a declared [N] that disagrees with the rows present fails, in either direction', () => {
    const rows = '\n  Egg\tg\t50\t\n  Toast\tg\t30\t\n  Rice\tg\t100\tBowl';
    expect(decodeReply(ended(`date: d\nitems[2\t]{name\tunit\tgrams\tdish}:${rows}`), shape)).toEqual({ ok: false, reason: 'row-count-mismatch' });
    expect(decodeReply(ended(`date: d\nitems[4\t]{name\tunit\tgrams\tdish}:${rows}`), shape)).toEqual({ ok: false, reason: 'row-count-mismatch' });
  });

  it('a stray unquoted double quote (which would swallow the following tabs) fails', () => {
    const r = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  12" Sub\tg\t300\t\n  Rice\tg\t100\tBowl';
    expect(decodeReply(ended(r), shape)).toEqual({ ok: false, reason: 'stray-quote' });
  });

  it('a blank line inside the table does not lose a row', () => {
    const r = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\n\n  Rice\tg\t100\tBowl';
    expect(decodeReply(ended(r), shape).value.items.map((i) => i.name)).toEqual(['Egg', 'Rice']);
  });

  // Header form.
  it('any header delimiter other than tab fails wrong-delimiter', () => {
    expect(decodeReply(ended('items[1|]{name|unit|grams|dish}:\n  Egg|g|50|'), shape)).toEqual({ ok: false, reason: 'wrong-delimiter' });
    expect(decodeReply(ended('items[1]{name,unit,grams,dish}:\n  Egg,g,50,'), shape)).toEqual({ ok: false, reason: 'wrong-delimiter' });
  });

  it('two table headers fail multiple-tables', () => {
    const r = 'date: d\nitems[1\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\nitems[1\t]{name\tunit\tgrams\tdish}:\n  Rice\tg\t100\tBowl';
    expect(decodeReply(ended(r), shape)).toEqual({ ok: false, reason: 'multiple-tables' });
    const other = 'date: d\nitems[1\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\t50\t\nextras[1\t]{name}:\n  Salt';
    expect(decodeReply(ended(other), shape)).toEqual({ ok: false, reason: 'multiple-tables' });
  });

  // Types.
  it('a shifted row (text lands in numeric grams) fails type-mismatch', () => {
    const r = 'date: d\nitems[1\t]{name\tunit\tgrams\tdish}:\n  Rice\t100\tBowl\t';
    expect(decodeReply(ended(r), shape)).toEqual({ ok: false, reason: 'type-mismatch' });
  });

  it('a bare number or boolean in a text column fails; quoted "7" and "true" decode as strings', () => {
    expect(decodeReply(ended('items[1\t]{name\tunit\tgrams\tdish}:\n  7\tg\t330\t'), shape)).toEqual({ ok: false, reason: 'type-mismatch' });
    expect(decodeReply(ended('items[1\t]{name\tunit\tgrams\tdish}:\n  true\tg\t1\t'), shape)).toEqual({ ok: false, reason: 'type-mismatch' });
    const quoted = decodeReply(ended('items[2\t]{name\tunit\tgrams\tdish}:\n  "7"\tg\t330\t\n  "true"\tg\t1\t'), shape);
    expect(quoted.value.items.map((i) => i.name)).toEqual(['7', 'true']);
    expect(quoted.value.items[0].grams).toBe(330);
  });

  it('a boolean column must decode to a boolean or null', () => {
    const boolShape = templateShape({ items: [{ name: 'x', organic: false }] });
    expect(decodeReply(ended('items[1\t]{name\torganic}:\n  Egg\tyes'), boolShape)).toEqual({ ok: false, reason: 'type-mismatch' });
    expect(decodeReply(ended('items[1\t]{name\torganic}:\n  Egg\t1'), boolShape)).toEqual({ ok: false, reason: 'type-mismatch' });
    expect(decodeReply(ended('items[2\t]{name\torganic}:\n  Egg\ttrue\n  Kale\tnull'), boolShape).value.items).toEqual([
      { name: 'Egg', organic: true }, { name: 'Kale', organic: null },
    ]);
  });

  it('null in a numeric column decodes; an empty numeric cell is an absent key', () => {
    const r = 'date: d\nitems[2\t]{name\tunit\tgrams\tdish}:\n  Egg\tg\tnull\t\n  Rice\tg\t\tBowl';
    expect(decodeReply(ended(r), shape)).toEqual({ ok: true, value: { date: 'd', items: [
      { name: 'Egg', unit: 'g', grams: null },
      { name: 'Rice', unit: 'g', dish: 'Bowl' },
    ] } });
  });
});

describe('decodeReply on the real 15-column food shape', () => {
  const FOOD_COLUMNS = ['name', 'icon', 'noom_color', 'quantity', 'unit', 'grams', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol', 'dish'];
  const realShape = async () => planWire(await captureTextPrompt(), { reply: true }).shape;
  const header = (n) => `items[${n}\t]{${FOOD_COLUMNS.join('\t')}}:`;
  const scalars = 'date: 2026-10-01\ndateExplicit: false\ntime: evening\nmealTimeExplicit: true';
  const reply = (...rows) => `${scalars}\n${header(rows.length)}\n${rows.map((r) => `  ${r.join('\t')}`).join('\n')}`;
  const egg = ['Egg', 'default', 'yellow', 1, 'g', 50, 70, 6, 0.6, 5, 0, 0.2, 60, 180, ''];
  const rice = ['Rice', 'default', 'yellow', 1, 'g', 100, 130, 2.7, 28, 0.3, 0.4, 0.1, 1, 0, 'Bowl'];
  const toast = ['Toast', 'default', 'yellow', 1, 'g', 30, 80, 3, 15, 1, 1, 1, 150, 0, 'Plate'];
  const asObject = (row) => Object.fromEntries(row.map((v, i) => [FOOD_COLUMNS[i], v]).filter(([, v]) => v !== ''));

  it('the shape the real prompt produces is the 15 columns in order', async () => {
    expect((await realShape()).columns).toEqual(FOOD_COLUMNS);
  });

  it('good reply: full-width rows, empty dish with its tab, mixed dish rows, four scalars, decimals', async () => {
    expect(decodeReply(ended(reply(egg, rice, toast)), await realShape())).toEqual({ ok: true, value: {
      date: '2026-10-01', dateExplicit: false, time: 'evening', mealTimeExplicit: true,
      items: [asObject(egg), asObject(rice), asObject(toast)],
    } });
  });

  it('good reply: a null nutrient decodes as null', async () => {
    const withNull = [...rice];
    withNull[FOOD_COLUMNS.indexOf('fiber')] = 'null'; // join() would write a JS null as an empty cell
    expect(decodeReply(ended(reply(withNull)), await realShape()).value.items[0].fiber).toBeNull();
  });

  it('good reply: a single row ([1])', async () => {
    expect(decodeReply(ended(reply(rice)), await realShape()).value.items).toEqual([asObject(rice)]);
  });

  it('good reply: CRLF line endings', async () => {
    expect(decodeReply(ended(reply(egg, rice).replace(/\n/g, '\r\n')), await realShape()).value.items).toEqual([asObject(egg), asObject(rice)]);
  });

  it('a comma-delimited table (name with a comma) fails wrong-delimiter', async () => {
    const r = `${scalars}\nitems[2]{${FOOD_COLUMNS.join(',')}}:\n`
      + '  Chicken Breast, Grilled,chicken,yellow,1,g,150,250,40,0,5,0,0,80,90,\n'
      + '  Rice,default,yellow,1,g,100,130,3,28,0,0,0,1,0,';
    expect(decodeReply(ended(r), await realShape())).toEqual({ ok: false, reason: 'wrong-delimiter' });
  });

  it('probe 2e: a dish-less row without its trailing tab plus a doubled tab among the nutrients fails', async () => {
    // Exactly full width: protein reads empty, everything after shifts, dish gets a bare 180.
    const slipped = `  ${egg.slice(0, 7).join('\t')}\t\t${egg.slice(7, 14).join('\t')}`;
    const r = `${scalars}\n${header(2)}\n${slipped}\n  ${rice.join('\t')}`;
    expect(slipped.split('\t')).toHaveLength(FOOD_COLUMNS.length);
    expect(decodeReply(ended(r), await realShape())).toEqual({ ok: false, reason: 'type-mismatch' });
  });

  it('missing protein, dish empty, no trailing tab: fails short-row', async () => {
    const noProtein = egg.filter((_, i) => i !== FOOD_COLUMNS.indexOf('protein')).slice(0, -1);
    expect(decodeReply(ended(reply(noProtein, rice)), await realShape())).toEqual({ ok: false, reason: 'short-row' });
  });

  it('missing protein, dish present: fails short-row', async () => {
    const noProtein = rice.filter((_, i) => i !== FOOD_COLUMNS.indexOf('protein'));
    expect(decodeReply(ended(reply(noProtein, egg)), await realShape())).toEqual({ ok: false, reason: 'short-row' });
  });

  it('dish empty without its trailing tab fails on a middle row and on the last row', async () => {
    const eggNoTab = egg.slice(0, -1);
    expect(decodeReply(ended(reply(rice, eggNoTab, toast)), await realShape())).toEqual({ ok: false, reason: 'short-row' });
    expect(decodeReply(ended(reply(rice, toast, eggNoTab)), await realShape())).toEqual({ ok: false, reason: 'short-row' });
  });

  it('a reordered header fails column-mismatch', async () => {
    const swapped = [...FOOD_COLUMNS];
    [swapped[7], swapped[8]] = [swapped[8], swapped[7]];
    const r = `${scalars}\nitems[1\t]{${swapped.join('\t')}}:\n  ${rice.join('\t')}`;
    expect(decodeReply(ended(r), await realShape())).toEqual({ ok: false, reason: 'column-mismatch' });
  });

  it('a row missing its noom_color cell (text lands in quantity) fails', async () => {
    const shifted = [...egg.slice(0, 2), ...egg.slice(3)];
    expect(decodeReply(ended(reply(shifted, rice)), await realShape()).ok).toBe(false);
  });
});

describe('decodeReply END marker', () => {
  const H = 'items[2\t]{name\tunit\tgrams\tdish}:';
  const whole = `date: d\n${H}\n  Egg\tg\t50\t\n  Rice\tg\t100\tPlate`;

  it('a whole reply with its END line decodes', () => {
    expect(decodeReply(`${whole}\nEND`, shape).value.items[1]).toEqual({ name: 'Rice', unit: 'g', grams: 100, dish: 'Plate' });
  });

  it('a cut inside the last dish (no END) fails no-end-marker', () => {
    expect(decodeReply(whole.slice(0, -2), shape)).toEqual({ ok: false, reason: 'no-end-marker' });
  });

  it('a cut right after the last tab (no END) fails no-end-marker', () => {
    expect(decodeReply(`date: d\n${H}\n  Egg\tg\t50\t\n  Rice\tg\t100\t`, shape)).toEqual({ ok: false, reason: 'no-end-marker' });
  });

  it('a whole-looking reply without END (cut before trailing scalars or END) fails no-end-marker', () => {
    expect(decodeReply(whole, shape)).toEqual({ ok: false, reason: 'no-end-marker' });
    const tableFirst = `${H}\n  Egg\tg\t50\t\n  Rice\tg\t100\tPlate\ndate: d`;
    expect(decodeReply(tableFirst.slice(0, tableFirst.indexOf('\ndate')), shape)).toEqual({ ok: false, reason: 'no-end-marker' });
    expect(decodeReply(`${tableFirst}\nEND`, shape).ok).toBe(true);
  });

  it('END with CRLF line endings (and surrounding whitespace) decodes', () => {
    expect(decodeReply(`${whole}\n  END  \n`.replace(/\n/g, '\r\n'), shape).value.items).toHaveLength(2);
  });

  it('a fenced reply with END inside the fence decodes', () => {
    expect(decodeReply('```toon\n' + whole + '\nEND\n```', shape).ok).toBe(true);
  });

  it('text after END fails: END must be the last non-blank line', () => {
    expect(decodeReply(`${whole}\nEND\nHope that helps!`, shape)).toEqual({ ok: false, reason: 'no-end-marker' });
  });

  it('a JSON reply still reports json-reply, not no-end-marker', () => {
    expect(decodeReply('{"items":[]}', shape)).toEqual({ ok: false, reason: 'json-reply' });
  });
});


// 2026-10-02 A/B: 9 of 20 gpt-4.1 replies wrote the table rows without the
// 2-space indent, and 5 copied the primer's placeholder header (`name[N<TAB>]`)
// literally. See docs/_wip/plans/2026-10-02-ai-wire-layer-rollout.md.
describe('A/B findings', () => {
  it('decodes rows written without their indent', () => {
    const reply = ended('date: 2026-10-02\ntime: morning\nitems[2\t]{name\tunit\tgrams\tdish}:\nScrambled Eggs\tg\t100\t\nSourdough Toast\tslice\t40\tBreakfast');
    expect(decodeReply(reply, shape)).toEqual({ ok: true, value: { date: '2026-10-02', time: 'morning', items: [
      { name: 'Scrambled Eggs', unit: 'g', grams: 100 },
      { name: 'Sourdough Toast', unit: 'slice', grams: 40, dish: 'Breakfast' },
    ] } });
  });

  it('still applies every row check to unindented rows', () => {
    const shifted = ended('items[1\t]{name\tunit\tgrams\tdish}:\nRice\t100\tBowl');
    expect(decodeReply(shifted, shape)).toEqual({ ok: false, reason: 'short-row' });
  });

  it('stops re-indenting at a line with no tab, so a trailing scalar stays a scalar', () => {
    const reply = ended('items[1\t]{name\tunit\tgrams\tdish}:\nRice\tg\t100\t\ntime: evening');
    const result = decodeReply(reply, shape);
    expect(result.ok).toBe(true);
    expect(result.value.time).toBe('evening');
    expect(result.value.items).toEqual([{ name: 'Rice', unit: 'g', grams: 100 }]);
  });

  it('the primer gives no placeholder header a model could copy', () => {
    expect(TOON_REPLY_RULES).not.toMatch(/name\[N/);
    expect(TOON_REPLY_RULES).toMatch(/Copy the table header line above exactly/);
  });
});

// Scalars are positional-free but were never checked: one stray tab in
// `dateExplicit: false` made it the truthy string "f\talse" (a meal filed
// under the wrong day), and a tab before a scalar line made the key vanish.
describe('scalar lines', () => {
  const flags = templateShape({
    date: 'YYYY-MM-DD', dateExplicit: false, time: 'evening', mealTimeExplicit: false,
    items: [{ name: 'Food', grams: 100 }],
  });
  const reply = (scalars) => ended(`${scalars}\nitems[1\t]{name\tgrams}:\n  Rice\t100`);

  it('decodes well-formed scalars of every type', () => {
    expect(decodeReply(reply('date: 2026-10-01\ndateExplicit: true\ntime: evening\nmealTimeExplicit: false'), flags)).toEqual({
      ok: true, value: { date: '2026-10-01', dateExplicit: true, time: 'evening', mealTimeExplicit: false, items: [{ name: 'Rice', grams: 100 }] },
    });
  });

  it('a boolean scalar that is not a boolean fails', () => {
    expect(decodeReply(reply('dateExplicit: f\talse'), flags)).toEqual({ ok: false, reason: 'scalar-format' });
    expect(decodeReply(reply('dateExplicit: yes'), flags)).toEqual({ ok: false, reason: 'type-mismatch' });
  });

  it('a tab anywhere in a scalar line fails', () => {
    expect(decodeReply(reply('date: 2026\t-10-01'), flags)).toEqual({ ok: false, reason: 'scalar-format' });
  });

  it('an indented scalar line fails instead of silently vanishing', () => {
    expect(decodeReply(reply('date: 2026-10-01\n\tdateExplicit: true'), flags)).toEqual({ ok: false, reason: 'scalar-format' });
  });

  it('a scalar written twice fails', () => {
    expect(decodeReply(reply('time: evening\ntime: morning'), flags)).toEqual({ ok: false, reason: 'scalar-format' });
  });

  it('a text scalar that decodes as a number fails', () => {
    expect(decodeReply(reply('time: 7'), flags)).toEqual({ ok: false, reason: 'type-mismatch' });
  });

  it('templateShape records each scalar\'s example type', () => {
    expect(flags.scalarTypes).toEqual({ date: 'string', dateExplicit: 'boolean', time: 'string', mealTimeExplicit: 'boolean' });
  });
});
