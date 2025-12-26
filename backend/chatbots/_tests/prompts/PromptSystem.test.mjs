/**
 * Prompt System Tests
 * @module _tests/prompts/PromptSystem.test
 */

import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { PromptRepository } from '../../_lib/prompts/PromptRepository.mjs';
import { PromptLoader } from '../../_lib/prompts/PromptLoader.mjs';
import { render, renderMessages } from '../../_lib/prompts/PromptRenderer.mjs';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { TEST_GOALS } from '../fixtures/nutritionGoals.mjs';

// ==================== PromptRenderer Tests ====================

describe('PromptRenderer', () => {
  describe('render', () => {
    it('should substitute simple variables', () => {
      const template = 'Hello {{name}}, welcome to {{place}}!';
      const result = render(template, { name: 'John', place: 'NutriBot' });
      expect(result).toBe('Hello John, welcome to NutriBot!');
    });

    it('should handle nested object properties', () => {
      const template = 'Goals: {{goals.calories}} cal, {{goals.protein}}g protein';
      const result = render(template, { 
        goals: TEST_GOALS,
      });
      expect(result).toBe('Goals: 2000 cal, 150g protein');
    });

    it('should handle missing variables gracefully', () => {
      const template = 'Hello {{name}}, your score is {{score}}';
      const result = render(template, { name: 'John' });
      expect(result).toBe('Hello John, your score is ');
    });

    it('should process {{#if}} conditionals (truthy)', () => {
      const template = '{{#if hasGoals}}Goals set!{{/if}}';
      const result = render(template, { hasGoals: true });
      expect(result).toBe('Goals set!');
    });

    it('should process {{#if}} conditionals (falsy)', () => {
      const template = '{{#if hasGoals}}Goals set!{{/if}}';
      const result = render(template, { hasGoals: false });
      expect(result).toBe('');
    });

    it('should process {{#if}}...{{else}}...{{/if}}', () => {
      const template = '{{#if premium}}Pro features{{else}}Free tier{{/if}}';
      
      expect(render(template, { premium: true })).toBe('Pro features');
      expect(render(template, { premium: false })).toBe('Free tier');
    });

    it('should process {{#each}} arrays', () => {
      const template = 'Items:{{#each items}}\n- {{name}}: {{calories}} cal{{/each}}';
      const result = render(template, {
        items: [
          { name: 'Apple', calories: 95 },
          { name: 'Banana', calories: 105 },
        ]
      });
      expect(result).toBe('Items:\n- Apple: 95 cal\n- Banana: 105 cal');
    });

    it('should handle empty arrays in {{#each}}', () => {
      const template = 'Items:{{#each items}}\n- {{name}}{{/each}}';
      const result = render(template, { items: [] });
      expect(result).toBe('Items:');
    });

    it('should provide @index in {{#each}}', () => {
      const template = '{{#each items}}{{@index}}. {{name}}\n{{/each}}';
      const result = render(template, {
        items: [{ name: 'A' }, { name: 'B' }]
      });
      expect(result).toBe('0. A\n1. B\n');
    });
  });

  describe('renderMessages', () => {
    it('should render all messages in array', () => {
      const messages = [
        { role: 'system', content: 'You help {{user}}' },
        { role: 'user', content: 'My goal is {{goal}}' },
      ];
      
      const result = renderMessages(messages, { user: 'John', goal: 'lose weight' });
      
      expect(result).toEqual([
        { role: 'system', content: 'You help John' },
        { role: 'user', content: 'My goal is lose weight' },
      ]);
    });
  });
});

// ==================== PromptLoader Tests ====================

describe('PromptLoader', () => {
  let testDir;
  let loader;

  beforeEach(async () => {
    // Create temp directory for test files
    testDir = join(tmpdir(), `prompt-test-${Date.now()}`);
    await mkdir(join(testDir, 'users', 'testuser', 'ai', 'nutribot'), { recursive: true });
    await mkdir(join(testDir, 'defaults', 'ai', 'nutribot'), { recursive: true });
    
    loader = new PromptLoader({ dataPath: testDir, cacheTTL: 0 }); // Disable cache for tests
  });

  afterAll(async () => {
    // Cleanup is handled by OS for temp files
  });

  it('should load prompts from default location', async () => {
    const defaultPrompts = `
version: "1.0"
prompts:
  test_prompt:
    name: "Test"
    messages:
      - role: system
        content: "Default system prompt"
`;
    await writeFile(join(testDir, 'defaults', 'ai', 'nutribot', 'prompts.yaml'), defaultPrompts);

    const prompts = await loader.loadPrompts('nutribot');
    
    expect(prompts.test_prompt).toBeDefined();
    expect(prompts.test_prompt.name).toBe('Test');
  });

  it('should merge user prompts over defaults', async () => {
    const defaultPrompts = `
version: "1.0"
prompts:
  test_prompt:
    name: "Default Test"
    temperature: 0.5
    messages:
      - role: system
        content: "Default content"
`;
    const userPrompts = `
version: "1.0"
prompts:
  test_prompt:
    name: "User Test"
    messages:
      - role: system
        content: "User content"
`;
    await writeFile(join(testDir, 'defaults', 'ai', 'nutribot', 'prompts.yaml'), defaultPrompts);
    await writeFile(join(testDir, 'users', 'testuser', 'ai', 'nutribot', 'prompts.yaml'), userPrompts);

    const prompts = await loader.loadPrompts('nutribot', 'testuser');
    
    expect(prompts.test_prompt.name).toBe('User Test');
    expect(prompts.test_prompt.messages[0].content).toBe('User content');
  });

  it('should list prompt IDs', async () => {
    const prompts = `
version: "1.0"
prompts:
  prompt_a:
    name: "A"
    messages: []
  prompt_b:
    name: "B"
    messages: []
`;
    await writeFile(join(testDir, 'defaults', 'ai', 'nutribot', 'prompts.yaml'), prompts);

    const ids = await loader.listPromptIds('nutribot');
    
    expect(ids).toContain('prompt_a');
    expect(ids).toContain('prompt_b');
  });
});

// ==================== PromptRepository Tests ====================

describe('PromptRepository', () => {
  let testDir;
  let repo;

  beforeEach(async () => {
    testDir = join(tmpdir(), `prompt-repo-test-${Date.now()}`);
    await mkdir(join(testDir, 'defaults', 'ai', 'nutribot'), { recursive: true });
    
    const prompts = `
version: "1.0"
prompts:
  food_detection:
    name: "Food Detection"
    model: "gpt-4o-mini"
    temperature: 0.3
    max_tokens: 2000
    messages:
      - role: system
        content: "Today is {{today}}. Analyze: {{userText}}"
      - role: user
        content: "Parse this: {{userText}}"
`;
    await writeFile(join(testDir, 'defaults', 'ai', 'nutribot', 'prompts.yaml'), prompts);
    
    repo = new PromptRepository({ dataPath: testDir, cacheTTL: 0 });
  });

  it('should get prompt with variables substituted', async () => {
    const messages = await repo.getPrompt('nutribot', 'food_detection', {
      today: '2025-12-18',
      userText: 'chicken salad',
    });
    
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Today is 2025-12-18. Analyze: chicken salad');
    expect(messages[1].content).toBe('Parse this: chicken salad');
  });

  it('should get prompt config', async () => {
    const config = await repo.getPromptConfig('nutribot', 'food_detection');
    
    expect(config.model).toBe('gpt-4o-mini');
    expect(config.temperature).toBe(0.3);
    expect(config.maxTokens).toBe(2000);
  });

  it('should return empty array for missing prompt', async () => {
    const messages = await repo.getPrompt('nutribot', 'nonexistent', {});
    expect(messages).toEqual([]);
  });

  it('should check if prompt exists', async () => {
    expect(await repo.hasPrompt('nutribot', 'food_detection')).toBe(true);
    expect(await repo.hasPrompt('nutribot', 'nonexistent')).toBe(false);
  });

  it('should list available prompts', async () => {
    const prompts = await repo.listPrompts('nutribot');
    expect(prompts).toContain('food_detection');
  });
});
