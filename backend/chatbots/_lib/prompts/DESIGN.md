# AI Prompt Externalization Design

## Overview

Externalize AI prompts from the codebase into user-specific YAML files stored in the data directory. This enables:

1. **Per-user customization** - Different users can have different prompts
2. **Easy editing** - No code changes needed to modify prompts
3. **A/B testing** - Test different prompt variations
4. **Version control** - Track prompt changes independently from code
5. **Fallback hierarchy** - User prompts → Bot defaults → Hardcoded defaults

---

## Directory Structure

```
/data/users/{username}/ai/
├── nutribot/
│   └── prompts.yaml        # User's NutriBot prompt overrides
├── journalist/
│   └── prompts.yaml        # User's Journalist prompt overrides
└── shared/
    └── prompts.yaml        # Shared prompts across bots

/data/defaults/ai/
├── nutribot/
│   └── prompts.yaml        # Default NutriBot prompts
├── journalist/
│   └── prompts.yaml        # Default Journalist prompts
└── shared/
    └── prompts.yaml        # Shared default prompts
```

---

## YAML Schema

### prompts.yaml Structure

```yaml
# Metadata
version: "1.0"
description: "NutriBot AI prompts for food logging"
updated: "2025-12-18"

# Prompt definitions
prompts:
  # Each prompt has a unique identifier
  food_detection:
    # Human-readable name
    name: "Food Detection"
    description: "Parse food descriptions into structured nutrition data"
    
    # Model configuration (optional - can override defaults)
    model: "gpt-4o-mini"
    temperature: 0.3
    max_tokens: 2000
    
    # The prompt messages
    messages:
      - role: system
        content: |
          You are a nutrition analyzer. Given a food description:
          1. Identify each food item mentioned
          2. Estimate portion sizes in grams or common measures
          3. Estimate macros (calories, protein, carbs, fat)
          
          {{#if timezone}}Current timezone: {{timezone}}{{/if}}
          Today is {{dayOfWeek}}, {{today}} at {{timeAMPM}}.
          
          Respond in JSON format:
          {
            "date": "YYYY-MM-DD",
            "items": [...]
          }
      
      - role: user
        content: 'Parse this food description: "{{userText}}"'
    
    # Template variables documentation
    variables:
      userText: "The user's food description"
      today: "Current date (YYYY-MM-DD)"
      dayOfWeek: "Current day name"
      timeAMPM: "Current time in AM/PM format"
      timezone: "User's timezone"

  food_revision:
    name: "Food Revision"
    description: "Handle corrections to logged food items"
    messages:
      - role: system
        content: |
          You are a nutrition analyzer helping to revise a food log.
          
          Current items:
          {{#each currentItems}}
          - {{label}}: {{amount}}{{unit}} ({{calories}} cal)
          {{/each}}
          
          The user wants to make changes. Parse their revision request.
      
      - role: user
        content: "{{revisionText}}"
    
    variables:
      currentItems: "Array of current food items"
      revisionText: "User's revision request"

  coaching_first_of_day:
    name: "Morning Coaching"
    description: "First coaching message of the day"
    messages:
      - role: system
        content: |
          You are a supportive nutrition coach providing a morning briefing.
          
          User's goals:
          - Calories: {{goals.calories}}
          - Protein: {{goals.protein}}g
          
          Keep it brief and encouraging. 1-2 sentences max.
      
      - role: user
        content: |
          Today's progress so far:
          - Calories: {{todaySummary.calories}}/{{goals.calories}}
          - Protein: {{todaySummary.protein}}g/{{goals.protein}}g

  coaching_subsequent:
    name: "Meal Update Coaching"
    description: "Brief feedback after logging a meal"
    temperature: 0.7
    messages:
      - role: system
        content: |
          You are a supportive nutrition coach. Give brief, encouraging 
          feedback on the meal just logged. 1-2 sentences max.
      
      - role: user
        content: "Just logged: {{lastMeal}}. Daily progress: {{progress}}"
```

### Journalist prompts.yaml Example

```yaml
version: "1.0"
description: "Journalist AI prompts for journaling"

prompts:
  biographer:
    name: "Biographer Follow-up"
    description: "Generate follow-up questions for journal entries"
    messages:
      - role: system
        content: |
          You are a compassionate biographer helping someone document 
          their life story through daily journaling.
          
          Guidelines:
          - Ask 1-3 follow-up questions
          - Be warm but not intrusive
          - Avoid yes/no questions
          
          Respond with just the question(s), no preamble.
      
      - role: user
        content: |
          Conversation history:
          {{history}}
          
          Latest entry:
          {{entry}}
          
          Generate follow-up question(s):

  autobiographer:
    name: "Session Opener"
    description: "Start a new journaling session"
    messages:
      - role: system
        content: |
          You are a thoughtful journaling companion. Generate an opening 
          question to start a journaling session.
          
          Guidelines:
          - Be warm and inviting
          - Vary topics: feelings, events, gratitude, goals
          - One question only
      
      - role: user
        content: |
          {{#if history}}
          Recent conversation:
          {{history}}
          {{/if}}
          
          Generate an opening question:

  therapist:
    name: "Therapist Analysis"
    description: "Analyze journal entries for patterns and insights"
    temperature: 0.6
    messages:
      - role: system
        content: |
          You are a supportive therapist providing insight based on 
          journal entries.
          
          Your analysis should:
          1. Identify emotional themes and patterns
          2. Note positive developments and strengths
          3. Gently highlight areas for growth
          4. Offer supportive observations (not advice)
          
          Be compassionate and constructive. Write 2-3 paragraphs.
      
      - role: user
        content: "Analyze these journal entries:\n\n{{history}}"

  multiple_choice:
    name: "Generate Options"
    description: "Generate answer choices for a journaling question"
    temperature: 0.8
    messages:
      - role: system
        content: |
          Generate 4-6 possible answers for the given journaling question.
          
          Respond with ONLY a JSON array of strings:
          ["Option 1", "Option 2", "Option 3", "Option 4"]
      
      - role: user
        content: |
          {{#if context}}Context: {{context}}{{/if}}
          Question: {{question}}
          
          Generate answer options:
```

---

## Implementation Architecture

### New Files to Create

```
backend/chatbots/_lib/prompts/
├── index.mjs                    # Barrel export
├── PromptRepository.mjs         # Main repository class
├── PromptLoader.mjs             # YAML loading & caching
├── PromptRenderer.mjs           # Template variable substitution
├── PromptSchema.mjs             # Validation schemas
└── defaultPrompts/
    ├── nutribot.yaml            # Fallback defaults
    └── journalist.yaml          # Fallback defaults
```

### PromptRepository Interface

```javascript
/**
 * Prompt Repository
 * 
 * Loads prompts with fallback hierarchy:
 * 1. User-specific: /data/users/{username}/ai/{bot}/prompts.yaml
 * 2. Bot defaults: /data/defaults/ai/{bot}/prompts.yaml  
 * 3. Hardcoded: ./defaultPrompts/{bot}.yaml
 */
export class PromptRepository {
  #config;
  #cache;
  #logger;
  
  constructor(config, options = {}) {
    this.#config = config;
    this.#cache = new Map();
    this.#logger = options.logger;
  }
  
  /**
   * Get a prompt by ID with variable substitution
   * @param {string} bot - Bot name (nutribot, journalist)
   * @param {string} promptId - Prompt identifier
   * @param {Object} variables - Template variables
   * @param {Object} options
   * @param {string} [options.userId] - User ID for user-specific prompts
   * @returns {Promise<ChatMessage[]>}
   */
  async getPrompt(bot, promptId, variables = {}, options = {}) {
    const promptDef = await this.#loadPrompt(bot, promptId, options.userId);
    return this.#renderMessages(promptDef.messages, variables);
  }
  
  /**
   * Get prompt configuration (model, temperature, etc.)
   * @param {string} bot
   * @param {string} promptId
   * @param {Object} options
   * @returns {Promise<PromptConfig>}
   */
  async getPromptConfig(bot, promptId, options = {}) {
    const promptDef = await this.#loadPrompt(bot, promptId, options.userId);
    return {
      model: promptDef.model,
      temperature: promptDef.temperature,
      maxTokens: promptDef.max_tokens,
    };
  }
  
  /**
   * List available prompts for a bot
   * @param {string} bot
   * @returns {Promise<string[]>}
   */
  async listPrompts(bot) { ... }
  
  /**
   * Reload prompts (clear cache)
   */
  clearCache() {
    this.#cache.clear();
  }
}
```

### PromptRenderer (Handlebars-like templating)

```javascript
/**
 * Render template variables in prompt content
 * 
 * Supports:
 * - {{variable}} - Simple substitution
 * - {{#if condition}}...{{/if}} - Conditionals
 * - {{#each array}}...{{/each}} - Iteration
 * - {{object.property}} - Nested access
 */
export class PromptRenderer {
  static render(template, variables) {
    let result = template;
    
    // Handle {{#each array}}...{{/each}}
    result = this.#processEach(result, variables);
    
    // Handle {{#if condition}}...{{/if}}
    result = this.#processConditionals(result, variables);
    
    // Handle {{variable}} and {{object.property}}
    result = this.#processVariables(result, variables);
    
    return result;
  }
  
  static #processVariables(template, variables) {
    return template.replace(/\{\{([^#/}]+)\}\}/g, (match, path) => {
      const value = this.#getNestedValue(variables, path.trim());
      return value !== undefined ? String(value) : '';
    });
  }
  
  static #getNestedValue(obj, path) {
    return path.split('.').reduce((acc, key) => acc?.[key], obj);
  }
  
  // ... conditional and iteration handlers
}
```

---

## Integration Points

### Use Case Updates

Each use case that builds prompts will be updated to use PromptRepository:

```javascript
// Before (hardcoded)
class LogFoodFromText {
  #buildDetectionPrompt(userText) {
    return [
      { role: 'system', content: `You are a nutrition analyzer...` },
      { role: 'user', content: `Parse: "${userText}"` },
    ];
  }
}

// After (externalized)
class LogFoodFromText {
  #promptRepository;
  
  async #buildDetectionPrompt(userText) {
    const variables = {
      userText,
      today: this.#getToday(),
      dayOfWeek: this.#getDayOfWeek(),
      timeAMPM: this.#getTimeAMPM(),
      timezone: this.#getTimezone(),
    };
    
    return this.#promptRepository.getPrompt(
      'nutribot', 
      'food_detection', 
      variables,
      { userId: this.#currentUserId }
    );
  }
}
```

### Container Updates

Add PromptRepository to containers:

```javascript
// NutribotContainer
constructor(config, options = {}) {
  // ...
  this.#promptRepository = options.promptRepository 
    || new PromptRepository(config, { logger: this.#logger });
}

getPromptRepository() {
  return this.#promptRepository;
}
```

---

## Migration Plan

### Phase 1: Create Infrastructure
1. Create PromptRepository, PromptLoader, PromptRenderer
2. Create default prompt YAML files (extract from current code)
3. Add to containers

### Phase 2: Extract NutriBot Prompts
1. food_detection → prompts.yaml
2. food_revision → prompts.yaml
3. coaching_first_of_day → prompts.yaml
4. coaching_subsequent → prompts.yaml

### Phase 3: Extract Journalist Prompts
1. biographer → prompts.yaml
2. autobiographer → prompts.yaml
3. therapist → prompts.yaml
4. multiple_choice → prompts.yaml
5. evaluate_response → prompts.yaml

### Phase 4: User Customization
1. Create sample user prompt overrides
2. Document customization options
3. Add prompt hot-reload capability

---

## Benefits

| Feature | Benefit |
|---------|---------|
| YAML files in user directories | Easy to edit without touching code |
| Fallback hierarchy | Users can override specific prompts while inheriting defaults |
| Template variables | Reusable prompts with dynamic content |
| Version tracking | Track prompt changes in data directory |
| Model overrides | Per-prompt model and temperature settings |
| Caching | Performance optimization with cache invalidation |
| Hot reload | Update prompts without restarting server |
