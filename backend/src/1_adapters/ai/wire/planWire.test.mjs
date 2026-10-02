import { describe, it, expect } from 'vitest';
import { planWire } from './planWire.mjs';
import { TOON_REPLY_RULES } from './replyFormat.mjs';
import { captureTextPrompt, captureImagePrompt, captureRevisionPrompt, captureReviseEntryPrompt } from './fixtures/foodPrompts.mjs';

const system = (messages) => messages.find(m => m.role === 'system')?.content ?? messages[0].content;

describe('planWire on the real food-logging prompts', () => {
  it('LogFoodFromText: rewrites the reply template to a TOON table and removes every JSON instruction', async () => {
    const original = await captureTextPrompt();
    const plan = planWire(original, { reply: true });
    expect(plan.toonReply).toBe(true);
    expect(plan.shape.arrayKey).toBe('items');
    expect(plan.shape.columns).toContain('dish');
    const content = system(plan.messages);
    expect(content).toMatch(/items\[N\t\]\{name\ticon\tnoom_color\t/);
    expect(content).toMatch(/Respond in TOON format:/);
    // The appended rules deliberately say "Reply in TOON, not JSON" (pinned by replyFormat.test.mjs);
    // everything else in the prompt must be free of JSON instructions.
    expect(content.replace(TOON_REPLY_RULES, '')).not.toMatch(/JSON/);
    expect(content).not.toMatch(/'\{'/);
    expect(content).toMatch(/"dish" is OPTIONAL/);
    expect(content.endsWith('No code fences and no text before or after.')).toBe(true);
    expect(content).toMatch(/\t[^\n]*\nEND\n/); // the skeleton's last line is END
    expect(system(original)).toMatch(/Respond in JSON format:/); // caller's array untouched
  });

  it('LogFoodFromImage: reply template rewritten', async () => {
    const plan = planWire(await captureImagePrompt(), { reply: true });
    expect(plan.toonReply).toBe(true);
    expect(system(plan.messages)).toMatch(/items\[N\t\]\{name\t/);
    expect(system(plan.messages)).toMatch(/\t[^\n]*\nEND\n/);
  });

  it('ProcessRevisionInput: current items re-encoded as input AND reply template rewritten', async () => {
    const plan = planWire(await captureRevisionPrompt(), { reply: true });
    expect(plan.rewrites.map(r => r.kind).sort()).toEqual(['input', 'template']);
    const content = system(plan.messages);
    expect(content).toMatch(/\[2\t\]\{/);
    expect(content).not.toMatch(/"label": "Toast"/);
    expect(content).toMatch(/items\[N\t\]\{[^\n]*\n  [^\n]*\nEND\n/); // skeleton ends with END
  });

  it('ReviseEntryService: flat template left alone, call untouched', async () => {
    const original = await captureReviseEntryPrompt();
    const plan = planWire(original, { reply: true });
    expect(plan).toMatchObject({ toonReply: false, replyEligible: false, skip: 'flat-object' });
    expect(plan.messages).toBe(original);
  });

  it('reply:false still re-encodes input data but leaves the template', async () => {
    const plan = planWire(await captureRevisionPrompt(), { reply: false });
    expect(plan.toonReply).toBe(false);
    expect(plan.replyEligible).toBe(true);
    expect(plan.rewrites.map(r => r.kind)).toEqual(['input']);
    expect(system(plan.messages)).toMatch(/Respond in JSON format with the COMPLETE revised list:/);
  });
});

describe('planWire edge cases', () => {
  it('no JSON at all: same array back, skip no-cue', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const plan = planWire(messages, { reply: true });
    expect(plan.messages).toBe(messages);
    expect(plan.skip).toBe('no-cue');
  });

  it('two templates: ambiguous, untouched', () => {
    const t = 'Respond in JSON:\n{"items":[{"a":1}]}';
    const messages = [{ role: 'system', content: t }, { role: 'user', content: t }];
    expect(planWire(messages, { reply: true })).toMatchObject({ skip: 'ambiguous', toonReply: false });
  });

  it('template with nested rows: ambiguous, untouched (even its data blocks)', () => {
    const messages = [{ role: 'user', content: 'Data: [{"a":1},{"a":2}]\nReturn JSON:\n{"items":[{"x":{"y":1}}]}' }];
    const plan = planWire(messages, { reply: true });
    expect(plan.skip).toBe('ambiguous');
    expect(plan.messages).toBe(messages);
  });

  it('non-string content passes through', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'x' }] }];
    expect(planWire(messages, { reply: true }).messages).toBe(messages);
  });

  it('inline single-object data is not re-encoded', () => {
    const messages = [{ role: 'user', content: 'Current food: {"name":"Rice","grams":158}' }];
    expect(planWire(messages, { reply: true }).messages).toBe(messages);
  });

  it('data block on the template\'s cue line: ambiguous, same array back', () => {
    const messages = [{ role: 'user', content: 'Rows [{"a":1,"b":2},{"a":3,"b":4}]. Return JSON like {"items":[{"x":1}]}' }];
    const plan = planWire(messages, { reply: true });
    expect(plan.skip).toBe('ambiguous');
    expect(plan.messages).toBe(messages);
  });

  it('a cue in an earlier paragraph is not a cue: the array is input data', () => {
    const messages = [{ role: 'user', content: 'Return JSON.\n\n[{"a":1},{"a":2}]' }];
    const plan = planWire(messages, { reply: true });
    expect(plan.rewrites).toEqual([{ kind: 'input', rows: 2 }]);
    expect(plan.skip).toBeNull();
  });
});

describe('planWire reply cue: imperatives only', () => {
  const table = '{"items":[{"name":"Egg","grams":50},{"name":"Toast","grams":30}]}';
  const planFor = (cue) => planWire([{ role: 'user', content: `${cue}\n${table}` }], { reply: true });

  it.each([
    'Here is the previous reply as JSON data:',
    'The answer in JSON from yesterday:',
  ])('noun use %j is not a cue: the block is input data, not a template', (cue) => {
    const plan = planFor(cue);
    expect(plan.toonReply).toBe(false);
    expect(plan.replyEligible).toBe(false);
    expect(plan.rewrites).toEqual([{ kind: 'input', rows: 2 }]);
    expect(plan.messages[0].content).not.toMatch(/\[N\t\]/);
  });

  it.each([
    'Return the list as JSON:',
    'Respond in JSON format:',
    'Respond in JSON format with the COMPLETE revised list:',
    'Use USDA values. Reply with valid JSON:',
    '2. Output as JSON:',
  ])('imperative %j is a cue', (cue) => {
    const plan = planFor(cue);
    expect(plan.toonReply).toBe(true);
    expect(plan.messages[0].content).toMatch(/items\[N\t\]\{name\tgrams\}:/);
  });

  it('"Respond exactly as:" is a cue (flat template stays untouched)', () => {
    const plan = planWire([{ role: 'user', content: 'Respond exactly as:\n{"name":"x","grams":1}' }], { reply: true });
    expect(plan.skip).toBe('flat-object');
  });
});
