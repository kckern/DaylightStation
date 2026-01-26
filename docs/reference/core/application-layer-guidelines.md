# Application Layer Guidelines

> Guidelines for `backend/src/3_applications/` - the orchestration layer in DDD architecture.

---

## Core Principle

**The application layer orchestrates business workflows without knowing implementation details.**

Use cases in `3_applications/` coordinate domain entities and call abstract gateways/repositories. They express *what* the system does, not *how* it connects to external services.

**The Abstraction Test:** If you could swap Telegram for Discord, Plex for Jellyfin, or OpenAI for Anthropic without touching any file in `3_applications/`, your abstraction is correct.

---

## Abstraction Boundaries

| Domain | Application Layer KNOWS | Application Layer DOES NOT KNOW |
|--------|------------------------|--------------------------------|
| **Messaging** | messages, conversations, replies, keyboards | Telegram, Discord, Slack, webhook URLs |
| **AI** | prompts, completions, chat messages, tokens | OpenAI, Anthropic, Ollama, model names, API keys |
| **Media** | media items, playback, libraries, metadata | Plex, Jellyfin, local filesystem, S3 |
| **Storage** | entities, repositories, save/load/query | YAML, JSON, SQLite, file paths, directory structure |
| **Finance** | transactions, accounts, budgets, categories | Buxfer, Plaid, CSV imports, bank APIs |
| **Fitness** | activities, workouts, heart rate, calories | Strava, Garmin, Apple Health, FIT files |
| **Audio/Video** | media type (audio vs video), duration, bitrate | MP3, MP4, codec names, container formats |
| **Config** | system/household/user scopes, feature flags | YAML structure, file locations, env vars |
| **Time** | dates, timestamps, timezones, durations | moment.js internals, date-fns, cron expressions |
| **Users** | userId, householdId, permissions, roles | auth tokens, session storage, OAuth providers |

---

## Import Rules

### ALLOWED imports in `3_applications/`

- `1_domains/` - Entities, value objects, domain services
- `0_infrastructure/utils/` - Pure utilities (time, formatting, uuid)
- External packages for domain logic (moment-timezone, uuid)

### FORBIDDEN imports in `3_applications/`

- `2_adapters/` - Never import adapters directly
- `0_infrastructure/config/` - Config internals (paths, loaders)
- Vendor SDKs (telegraf, openai, @anthropic-ai/sdk, plex-api)
- Node fs/path for data operations (use repositories)

---

## Naming Rules

### In code

- Use generic names: `messagingGateway`, `aiGateway`, `mediaRepository`
- Never: `telegramClient`, `openaiService`, `plexAdapter`

### In comments/docstrings

```javascript
// GOOD
@param {Object} deps.messagingGateway - Gateway for sending messages

// BAD
@param {Object} deps.messagingGateway - TelegramAdapter instance
```

---

## Constructor Validation

Required dependencies throw; optional dependencies default gracefully:

```javascript
constructor(deps) {
  // Required - fail fast
  if (!deps.messagingGateway) throw new Error('messagingGateway is required');

  // Optional - graceful default
  this.#logger = deps.logger || console;
}
```

---

## Port Interfaces

**Ports** are abstract interfaces that define what the application layer *needs* without specifying *how*.

**Location:** `3_applications/{app}/ports/`

```
3_applications/
└── nutribot/
    ├── ports/
    │   ├── IMessagingGateway.mjs
    │   ├── IAIGateway.mjs
    │   └── IFoodLogRepository.mjs
    ├── usecases/
    └── NutribotContainer.mjs
```

### Port interface example

```javascript
// 3_applications/nutribot/ports/IMessagingGateway.mjs
export const IMessagingGateway = {
  async sendMessage(conversationId, text, options) {},
  async updateMessage(conversationId, messageId, updates) {},
  async deleteMessage(conversationId, messageId) {},
};

export function isMessagingGateway(obj) {
  return obj &&
    typeof obj.sendMessage === 'function' &&
    typeof obj.updateMessage === 'function';
}
```

**Why in `3_applications/` not `1_domains/`?**

- Ports define what the *application* needs from the outside world
- Domain layer is pure business logic with no external dependencies
- Adapters (`2_adapters/`) *implement* these ports

---

## Path and Configuration Rules

### No Path Construction

Application layer never builds file paths:

```javascript
// BAD - application knows path structure
const dataPath = `${dataDir}/users/${username}/lifelog/journalist`;
this.#repository = new Repository({ dataPath });

// GOOD - delegate to adapter/repository
this.#repository = new Repository({ configService, username });
```

### No Config Structure Knowledge

Application receives values, doesn't know where they came from:

```javascript
// BAD - knows config key names and structure
const auth = this.#configService.getUserAuth?.('payroll');
const baseUrl = auth.base_url || auth.base;
const authKey = auth.cookie_name || auth.authkey;

// GOOD - receives pre-resolved config object
constructor(deps) {
  this.#payrollConfig = deps.payrollConfig; // { baseUrl, authKey, ... }
}
```

### Scope Awareness Only

Application may know *which scope* to use, not *how scopes are stored*:

```javascript
// GOOD - knows conceptual scopes
const userPrefs = await this.#configRepository.getUserConfig(userId);
const householdSettings = await this.#configRepository.getHouseholdConfig(householdId);

// BAD - knows storage details
const userPrefs = yaml.load(`${dataDir}/households/${hid}/users/${uid}/prefs.yml`);
```

---

## Error Handling

### Throw, Don't Return Failure Objects

```javascript
// BAD - silent failure
catch (error) {
  return { success: false, error: error.message };
}

// GOOD - let errors propagate
catch (error) {
  this.#logger.error?.('usecase.operation.failed', { error: error.message });
  throw error;
}
```

### Log Silent Degradation

When optional features fail, log it:

```javascript
// BAD - swallowed silently
try {
  classification = await this.#classifyProduct(product);
} catch (e) { }

// GOOD - logged degradation
try {
  classification = await this.#classifyProduct(product);
} catch (e) {
  this.#logger.warn?.('classify.failed', { error: e.message });
}
```

### No Vendor-Specific Error Handling

```javascript
// BAD - knows about Telegram errors
const isTelegramError = error.message?.includes('Telegram error');

// GOOD - generic transport error
const isTransportError = error.code === 'ETIMEDOUT' ||
  error.code === 'ECONNRESET' ||
  error.isTransient === true;
```

---

## Anti-Patterns Summary

| Anti-Pattern | Example | Fix |
|--------------|---------|-----|
| **Vendor name in code** | `telegramGateway`, `plexClient` | Use `messagingGateway`, `mediaRepository` |
| **Vendor name in comments** | `// TelegramAdapter instance` | `// Gateway for sending messages` |
| **Direct adapter import** | `import { TelegramAdapter } from '2_adapters/...'` | Inject via container |
| **Path construction** | `` `${dataDir}/users/${id}/file.yml` `` | Delegate to repository |
| **Config key knowledge** | `config.getUserAuth('payroll').base_url` | Receive resolved config object |
| **Format-specific logic** | `if (file.endsWith('.mp4'))` | Use `mediaItem.type === 'video'` |
| **Vendor error parsing** | `error.message.includes('Telegram')` | Use error codes or `isTransient` flag |
| **fs/path imports** | `import fs from 'fs/promises'` | Use repository methods |
| **SDK imports** | `import OpenAI from 'openai'` | Use injected `aiGateway` |
| **Silent catch blocks** | `catch (e) { }` | Log with `logger.warn?.()` |

---

## Container Pattern

Each application has a Container that wires dependencies. This is the **only place** where adapters meet use cases.

### Container Responsibilities

```javascript
// 3_applications/nutribot/NutribotContainer.mjs

export class NutribotContainer {
  // Private fields for adapters (injected from outside)
  #messagingGateway;
  #aiGateway;
  #foodLogStore;

  // Private fields for use cases (created internally)
  #logFoodFromText;
  #logFoodFromVoice;

  constructor(config) {
    // Adapters come from outside (bootstrap)
    this.#messagingGateway = config.messagingGateway;
    this.#aiGateway = config.aiGateway;
    this.#foodLogStore = config.foodLogStore;
    this.#logger = config.logger || console;
  }

  // Lazy-load use cases with injected dependencies
  getLogFoodFromText() {
    if (!this.#logFoodFromText) {
      this.#logFoodFromText = new LogFoodFromText({
        messagingGateway: this.#messagingGateway,
        aiGateway: this.#aiGateway,
        foodLogStore: this.#foodLogStore,
        logger: this.#logger,
      });
    }
    return this.#logFoodFromText;
  }
}
```

### Container Rules

| Rule | Rationale |
|------|-----------|
| Containers receive adapters, create use cases | Single point of wiring |
| Use lazy initialization (`if (!this.#x)`) | Avoid creating unused instances |
| Validate required dependencies in getters | Fail fast with clear errors |
| Never import adapters in container | Adapters injected by bootstrap |

---

## File Structure

```
3_applications/
└── {app}/
    ├── ports/                    # Abstract interfaces (what we need)
    │   ├── IMessagingGateway.mjs
    │   ├── IAIGateway.mjs
    │   └── I{Entity}Repository.mjs
    │
    ├── usecases/                 # Business workflows (what we do)
    │   ├── {Verb}{Noun}.mjs      # e.g., LogFoodFromText.mjs
    │   └── {Verb}{Noun}.mjs      # e.g., GenerateDailyReport.mjs
    │
    ├── services/                 # Cross-cutting application services (optional)
    │   └── {App}Service.mjs      # e.g., HarvesterService.mjs
    │
    └── {App}Container.mjs        # Dependency wiring
```

### Naming Conventions

| Type | Pattern | Examples |
|------|---------|----------|
| Use cases | `{Verb}{Noun}.mjs` | `LogFoodFromText`, `SendMorningDebrief`, `ProcessVoiceEntry` |
| Ports | `I{Noun}{Role}.mjs` | `IMessagingGateway`, `IFoodLogRepository`, `IAIGateway` |
| Containers | `{App}Container.mjs` | `NutribotContainer`, `JournalistContainer` |
| Services | `{App}Service.mjs` | `HarvesterService`, `FinanceHarvestService` |
