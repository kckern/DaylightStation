# Adapter Layer Guidelines

> Guidelines for `backend/src/2_adapters/` - the translation layer in DDD architecture.

---

## Core Principle

**The adapter layer translates between abstract ports and vendor-specific APIs - it's the replaceable bridge that knows vendor contracts but not implementation mechanics.**

Adapters in `2_adapters/` implement the abstractions defined elsewhere:
- They implement **ports** defined in `3_applications/`
- They use **services** from `0_system/` for I/O mechanics (HTTP client, file I/O)
- They are **vendor/format-specific** - one adapter per external system or format

| Layer | Responsibility | Example |
|-------|---------------|---------|
| **System** | I/O mechanics | `HttpClient` service, `FileIO` utilities |
| **Adapter** | Vendor contracts, format shapes | Telegram endpoint paths, YAML field names, OpenAI payload structure |
| **Application** | Defines what it needs (ports) | `IMessagingGateway.sendMessage()` |

**What Adapters Know:**
- Vendor API endpoints and authentication patterns
- Data format shapes (YAML field names, JSON structure)
- Vendor-specific error codes and responses

**What Adapters Don't Know:**
- HTTP client implementation (axios vs fetch)
- File system operations (fs.readFile vs fs.promises)
- Retry/timeout mechanics
- Business logic or workflow orchestration

**The Replaceability Test:** Swap vendors or formats - only adapters change. Other layers untouched.

**The Translation-Not-Decision Test:** Adapters translate data shapes; they don't make business decisions. If your adapter has `if (condition) { doBusinessLogic() }`, that logic belongs in application or domain layer.

---

## Adapter Categories

### Gateway Adapters

Outbound communication with external services.

| Purpose | Examples | Implements |
|---------|----------|------------|
| AI providers | `OpenAIAdapter`, `AnthropicAdapter` | `IAIGateway` |
| Messaging | `TelegramMessagingAdapter`, `GmailAdapter` | `IMessagingGateway` |
| Home automation | `HomeAssistantAdapter` | `IHomeAutomationGateway` |
| Finance | `BuxferAdapter` | `ITransactionSource` |

### Datastore Adapters

Persistence and data storage.

| Purpose | Examples | Implements |
|---------|----------|------------|
| YAML datastores | `YamlFoodLogDatastore`, `YamlSessionDatastore` | `IFoodLogDatastore`, `ISessionDatastore` |
| State datastores | `YamlConversationStateDatastore`, `YamlJobDatastore` | `IConversationStateDatastore`, `IJobDatastore` |

### Input Adapters

Inbound event parsing and routing.

| Purpose | Examples | Role |
|---------|----------|------|
| Webhook parsers | `TelegramWebhookParser` | Translate vendor payloads to `IInputEvent` |
| Input routers | `NutribotInputRouter`, `JournalistInputRouter` | Route events to appropriate handlers |

### Rendering Adapters

Format-specific output generation.

| Purpose | Examples | Role |
|---------|----------|------|
| Report renderers | `NutriReportRenderer`, `PrayerCardRenderer` | Domain data to visual/print format |

---

## Import Rules

### ALLOWED imports in `2_adapters/`

| Source | Purpose | Examples |
|--------|---------|----------|
| **`0_system/utils/FileIO`** | File read/write operations | `loadYamlSafe`, `saveYaml`, `ensureDir` |
| **`0_system/services/HttpClient`** | HTTP requests to external APIs | `httpClient.post()`, `httpClient.get()` |
| **`0_system/utils/time`** | Timestamp formatting | `formatLocalTimestamp`, `parseToDate` |
| **`0_system/utils/media`** | Buffer/stream handling | Media type detection, buffer operations |
| **`0_system/utils/collections`** | List/array utilities | Filtering, grouping helpers |
| `1_domains/` | Entity types for hydration | `NutriLog`, `Session`, `Message` |
| `3_applications/*/ports/` | Interfaces to implement | `IMessagingGateway`, `IFoodLogDatastore` |

### Config Handling

Adapters receive **config values** via constructor - they don't import ConfigService:

```javascript
// GOOD - receives resolved values
constructor(config, deps) {
  this.#apiKey = config.apiKey;
  this.#baseUrl = config.baseUrl;
  this.#httpClient = deps.httpClient;
}

// BAD - imports config service
import { configService } from '#system/config/ConfigService.mjs';
constructor(deps) {
  this.#apiKey = configService.getSecret('OPENAI_API_KEY');
}
```

### FORBIDDEN imports in `2_adapters/`

| Forbidden | Why | Instead |
|-----------|-----|---------|
| `#system/config/ConfigService` | Adapters receive config, don't fetch it | Pass values via constructor |
| Raw `axios`, `fetch`, `node-fetch` | HTTP mechanics belong in system | Use `#system/services/HttpClient` |
| Raw `fs`, `path` | File I/O belongs in system | Use `#system/utils/FileIO` |
| Other adapters | No cross-adapter coupling | Extract shared logic to system |
| `3_applications/*/usecases/` | Adapters don't orchestrate | Application calls adapter |

### Import Direction

```
0_system <── 2_adapters ──> 1_domains
                │
                └──> 3_applications/*/ports/
```

Adapters import DOWN to system and domains, and SIDEWAYS to application ports only.

---

## Naming Conventions

### File Naming by Category

| Category | Pattern | Examples |
|----------|---------|----------|
| **Gateway** | `{Vendor}Adapter.mjs` | `OpenAIAdapter.mjs`, `TelegramMessagingAdapter.mjs` |
| **Datastore** | `{Format}{Entity}Datastore.mjs` | `YamlFoodLogDatastore.mjs`, `YamlSessionDatastore.mjs` |
| **Input Parser** | `{Vendor}{Type}Parser.mjs` | `TelegramWebhookParser.mjs` |
| **Input Router** | `{App}InputRouter.mjs` | `NutribotInputRouter.mjs`, `JournalistInputRouter.mjs` |
| **Renderer** | `{Output}Renderer.mjs` | `PrayerCardRenderer.mjs`, `NutriReportRenderer.mjs` |

### Class Naming

| Type | Pattern | Rationale |
|------|---------|-----------|
| `{Vendor}Adapter` | Vendor in name | Makes replaceability obvious - `OpenAIAdapter` vs `AnthropicAdapter` |
| `{Format}{Entity}Datastore` | Format in name | Makes format explicit - `YamlFoodLogDatastore` vs `JsonFoodLogDatastore` |
| `I{Port}` prefix | On interfaces only | Interfaces in `3_applications/*/ports/`, not in adapters |

### Folder Structure

```
2_adapters/
├── ai/
│   ├── OpenAIAdapter.mjs
│   ├── AnthropicAdapter.mjs
│   └── index.mjs
├── telegram/
│   ├── TelegramMessagingAdapter.mjs
│   ├── TelegramWebhookParser.mjs
│   └── index.mjs
├── persistence/
│   └── yaml/
│       ├── YamlFoodLogDatastore.mjs
│       ├── YamlSessionDatastore.mjs
│       └── index.mjs
├── {app}/                          # App-specific adapters
│   ├── {App}InputRouter.mjs
│   └── index.mjs
└── {domain}/
    └── rendering/
        └── {Output}Renderer.mjs
```

---

## Adapter Implementation Patterns

### Constructor Pattern

Adapters receive config values and system services via constructor:

```javascript
export class OpenAIAdapter {
  #apiKey;
  #baseUrl;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.apiKey - OpenAI API key
   * @param {string} [config.baseUrl='https://api.openai.com/v1']
   * @param {Object} deps
   * @param {HttpClient} deps.httpClient - System HTTP client
   * @param {Object} [deps.logger=console]
   */
  constructor(config, deps) {
    if (!config.apiKey) throw new Error('apiKey required');
    if (!deps.httpClient) throw new Error('httpClient required');

    this.#apiKey = config.apiKey;
    this.#baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;
  }
}
```

### Port Implementation

Adapters implement port interfaces from `3_applications/*/ports/`:

```javascript
import { IMessagingGateway } from '#applications/shared/ports/IMessagingGateway.mjs';

export class TelegramMessagingAdapter extends IMessagingGateway {
  // Implement all port methods
  async sendMessage(conversationId, text, options = {}) {
    // Translate to Telegram-specific format
    const payload = {
      chat_id: this.#extractChatId(conversationId),
      text,
      parse_mode: options.parseMode || 'HTML'
    };

    return this.#callApi('sendMessage', payload);
  }
}
```

### Hydration Pattern (Datastores)

Datastores translate between storage format and domain entities:

```javascript
export class YamlFoodLogDatastore extends IFoodLogDatastore {

  // Storage -> Domain
  #hydrate(userId, rawData) {
    return NutriLog.from({
      id: rawData.id,
      userId,
      meal: rawData.meal,
      items: rawData.items,
      status: rawData.status,
      createdAt: rawData.created_at  // Format translation
    });
  }

  // Domain -> Storage
  #dehydrate(nutriLog) {
    return {
      id: nutriLog.id,
      meal: nutriLog.meal,
      items: nutriLog.items,
      status: nutriLog.status,
      created_at: nutriLog.createdAt  // Format translation
    };
  }
}
```

---

## Error Handling

### Translate Vendor Errors

Adapters catch vendor-specific errors and translate to generic errors. Vendor details stay in logs, not in thrown errors:

```javascript
async sendMessage(conversationId, text) {
  try {
    return await this.#callApi('sendMessage', payload);
  } catch (error) {
    // Log vendor-specific details
    this.#logger.error?.('telegram.sendMessage.failed', {
      conversationId,
      telegramError: error.description,
      errorCode: error.error_code
    });

    // Throw generic error - no vendor details leak upward
    const wrapped = new Error('Failed to send message');
    wrapped.code = this.#mapErrorCode(error.error_code);
    wrapped.isTransient = this.#isTransient(error);
    throw wrapped;
  }
}
```

### Error Code Mapping

Map vendor codes to generic codes that application layer can handle:

```javascript
#mapErrorCode(vendorCode) {
  const mapping = {
    400: 'INVALID_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    429: 'RATE_LIMITED',
    500: 'SERVICE_ERROR',
    503: 'SERVICE_UNAVAILABLE'
  };
  return mapping[vendorCode] || 'UNKNOWN_ERROR';
}
```

### Transient vs Permanent Errors

Flag transient errors so application layer can decide on retry:

```javascript
#isTransient(error) {
  // Network failures
  if (error.code === 'ECONNRESET') return true;
  if (error.code === 'ETIMEDOUT') return true;

  // Rate limits, server errors
  if (error.status === 429) return true;
  if (error.status >= 500) return true;

  return false;
}
```

### Rules

| Rule | Rationale |
|------|-----------|
| Log vendor details at adapter level | Debugging needs specifics |
| Throw generic errors upward | Application layer vendor-agnostic |
| Include `code` on all errors | Enables programmatic handling |
| Include `isTransient` flag | Application decides retry policy |
| Never swallow errors silently | At minimum log, then rethrow or handle |

---

## JSDoc Conventions

### Gateway Adapter JSDoc

```javascript
/**
 * OpenAI API adapter implementing IAIGateway.
 *
 * Translates IAIGateway calls to OpenAI API format.
 * Supports chat completions, vision, transcription, and embeddings.
 *
 * @class OpenAIAdapter
 * @implements {IAIGateway}
 *
 * @example
 * const adapter = new OpenAIAdapter(
 *   { apiKey: 'sk-...' },
 *   { httpClient, logger }
 * );
 * const response = await adapter.chat(messages);
 */
export class OpenAIAdapter {
```

### Datastore Adapter JSDoc

```javascript
/**
 * YAML-based NutriLog persistence.
 *
 * Implements IFoodLogDatastore for YAML file storage.
 * Handles hydration/dehydration between YAML format and NutriLog entities.
 *
 * @class YamlFoodLogDatastore
 * @implements {IFoodLogDatastore}
 *
 * @example
 * const datastore = new YamlFoodLogDatastore(
 *   { dataRoot: '/data' },
 *   { fileIO, logger }
 * );
 * const log = await datastore.findById(userId, logId);
 */
export class YamlFoodLogDatastore {
```

### Method JSDoc

```javascript
/**
 * Send a message to a conversation.
 *
 * @param {string} conversationId - Target conversation
 * @param {string} text - Message content
 * @param {Object} [options]
 * @param {string} [options.parseMode='HTML'] - Text formatting mode
 * @returns {Promise<{messageId: string}>}
 * @throws {Error} code=RATE_LIMITED if rate limit exceeded
 * @throws {Error} code=SERVICE_ERROR if service unavailable
 */
async sendMessage(conversationId, text, options = {}) {
```

### Required JSDoc Elements

| Element | Required On | Purpose |
|---------|-------------|---------|
| `@class` + description | All adapter classes | What this adapter does |
| `@implements` | All adapters | Which port it implements |
| `@param` / `@returns` | All public methods | Input/output contract |
| `@throws` with codes | Methods that throw | Document error conditions |
| `@example` | Constructor | Show typical instantiation |

---

## Anti-Patterns Summary

| Anti-Pattern | Example | Fix |
|--------------|---------|-----|
| **Raw HTTP client imports** | `import axios from 'axios'` | Use `#system/services/HttpClient` |
| **Raw file I/O imports** | `import fs from 'fs/promises'` | Use `#system/utils/FileIO` |
| **Importing ConfigService** | `configService.getSecret('API_KEY')` | Receive config via constructor |
| **Cross-adapter imports** | `import { TelegramAdapter } from '../telegram/...'` | Extract shared logic to system |
| **Importing use cases** | `import { LogFood } from '#applications/.../usecases'` | Application calls adapter, not reverse |
| **Business logic in adapter** | `if (calories > 500) { flagAsHeavy() }` | Move to domain or application layer |
| **Vendor errors leaking up** | `throw new Error('Telegram: ' + error.description)` | Translate to generic error with code |
| **Swallowed errors** | `catch (e) { }` | Log then rethrow or handle explicitly |
| **Hardcoded paths** | `const file = '/data/users/' + id` | Use dataRoot from constructor config |
| **Format logic in domain** | `toJSON()` / `fromJSON()` in entity | Hydration/dehydration in adapter |
| **Missing port interface** | Adapter class without `extends IPort` | Always implement declared port |
| **Generic naming** | `DataAdapter`, `ApiClient` | Use vendor/format in name: `YamlFoodLogDatastore` |
