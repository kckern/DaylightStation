# Shopping Receipt Harvester - Design Document

## Overview

The Shopping Harvester (`shopping.mjs`) automatically extracts purchase data from email receipts in Gmail, normalizes them using AI, and saves itemized transaction data to YAML files.

**Key Features:**
- 📧 Scans Gmail for shopping receipts from known retailers
- 🤖 Uses AI (OpenAI via IAIGateway) to extract & standardize line items
- 📊 Saves structured YAML for budget analysis and spending insights
- 🔄 Incremental sync (only new receipts since last run)

## Data Flow

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐     ┌────────────┐
│   Gmail     │────▶│ shopping.mjs │────▶│  IAIGateway   │────▶│ YAML File  │
│  (Receipts) │     │  (Harvester) │     │ (Extraction)  │     │ (Output)   │
└─────────────┘     └──────────────┘     └───────────────┘     └────────────┘
```

## File Structure

### Module Location
```
backend/lib/shopping.mjs
```

### Output Location
```
data/users/{username}/lifelog/shopping.yml
```

### Output Schema
```yaml
# shopping.yml
meta:
  lastSync: "2025-12-31T18:00:00-06:00"  # Local timezone
  timezone: "America/Chicago"
  totalReceipts: 42
  totalItems: 287

receipts:
  - id: "amazon_2025-12-25_abc123"
    source: "amazon"
    email_id: "18d9abc123456"
    date: "2025-12-25"
    datetime: "2025-12-25T14:30:00-06:00"  # Local timezone
    merchant: "Amazon.com"
    order_id: "112-1234567-8901234"
    subtotal: 45.99
    tax: 3.68
    shipping: 0.00
    total: 49.67
    currency: "USD"
    items:
      - name: "USB-C Cable 6ft"
        quantity: 2
        unit_price: 9.99
        total_price: 19.98
      - name: "Notebook Journal"
        quantity: 1
        unit_price: 14.99
        total_price: 14.99
```

## Household Configuration

Retailer search terms are configured per-household in the household config YAML, allowing each household to customize which receipts to track.

### Config Location
```
data/households/{hid}/config.yml
```

### Config Schema
```yaml
# In household config.yml
shopping:
  enabled: true
  timezone: "America/Chicago"  # For timestamp formatting
  retailers:
    - id: amazon
      name: "Amazon"
      senders:
        - "shipment-tracking@amazon.com"
        - "auto-confirm@amazon.com"
        - "digital-no-reply@amazon.com"
      keywords:
        - "order"
        - "shipment"
    - id: target
      name: "Target"
      senders:
        - "orders@target.com"
        - "receipts@target.com"
      keywords:
        - "order"
        - "receipt"
    - id: walmart
      name: "Walmart"
      senders:
        - "help@walmart.com"
        - "orders@walmart.com"
      keywords:
        - "order"
    - id: costco
      name: "Costco"
      senders:
        - "costco.com"
      keywords:
        - "order"
        - "receipt"
    - id: instacart
      name: "Instacart"
      senders:
        - "instacart.com"
      keywords:
        - "receipt"
        - "delivery"
```

### Adding Custom Retailers

Users can add any retailer by adding entries to their household config:

```yaml
# Example: Adding local grocery store
shopping:
  retailers:
    # ... existing retailers ...
    - id: heb
      name: "H-E-B"
      senders:
        - "noreply@heb.com"
        - "curbside@heb.com"
      keywords:
        - "order"
        - "pickup"

## Architecture

### Module Interface

```javascript
/**
 * Shopping Receipt Harvester
 * @module backend/lib/shopping
 */

import { google } from 'googleapis';
import { userSaveFile, userLoadFile, userLoadAuth, getDefaultUsername, householdLoadFile } from './io.mjs';
import { createLogger } from './logging/logger.js';
import { getAIGateway, systemMessage, userMessage } from './ai/index.mjs';
import { configService } from './config/ConfigService.mjs';

/**
 * Main harvest function signature (matches other harvesters)
 * @param {object} logger - Logger instance
 * @param {string} guidId - Request ID for tracing
 * @param {object} req - Express request object
 *   - req.targetUsername: Override target user
 *   - req.query.full: If 'true', re-fetch all receipts (ignore lastSync)
 *   - req.query.retailer: Filter to specific retailer(s)
 * @returns {Promise<object>} Harvest result with receipt count
 */
export default async function harvestShopping(logger, guidId, req) {
    // Implementation
}
```

### Core Components

#### 1. Gmail Search Service
```javascript
/**
 * Build Gmail search query for receipts from household config
 * @param {object} options
 * @param {object[]} options.retailers - Retailer configs from household YAML
 * @param {Date} options.since - Only emails after this date (local timezone)
 * @param {string} options.timezone - User's timezone for date formatting
 * @returns {string} Gmail search query
 */
function buildReceiptQuery(options) {
    const { retailers, since, timezone } = options;
    
    // Build query from household config
    const retailerQueries = retailers.map(r => {
        const senderQuery = r.senders.map(s => `from:${s}`).join(' OR ');
        const keywordQuery = r.keywords?.length 
            ? `(${r.keywords.map(k => `subject:${k}`).join(' OR ')})` 
            : '';
        return `(${senderQuery})${keywordQuery ? ` ${keywordQuery}` : ''}`;
    });
    
    let query = `(${retailerQueries.join(' OR ')})`;
    
    if (since) {
        // Format date in local timezone for Gmail query
        const localDate = moment(since).tz(timezone).format('YYYY/MM/DD');
        query += ` after:${localDate}`;
    }
    
    return query;
}
```

#### 2. Receipt Parser
```javascript
/**
 * Extract email content suitable for AI processing
 * @param {object} message - Gmail message object
 * @returns {object} Parsed email data
 */
function parseEmailContent(message) {
    return {
        id: message.id,
        subject: extractHeader(message, 'Subject'),
        from: extractHeader(message, 'From'),
        date: extractHeader(message, 'Date'),
        body: extractBody(message),  // Plain text or cleaned HTML
        snippet: message.snippet
    };
}
```

#### 3. AI Extraction Service
```javascript
/**
 * Use AI to extract structured receipt data
 * @param {object} email - Parsed email content
 * @param {string} retailer - Retailer identifier
 * @returns {Promise<object>} Structured receipt data
 */
async function extractReceiptData(email, retailer) {
    const ai = getAIGateway();
    
    const systemPrompt = `You are a receipt parsing assistant. Extract itemized purchase data from email receipts.

Output JSON schema:
{
  "merchant": "string - Store name",
  "order_id": "string - Order/confirmation number",
  "date": "string - YYYY-MM-DD format",
  "time": "string - HH:mm format (24hr) if available, else null",
  "items": [
    {
      "name": "string - Item name",
      "quantity": "number",
      "unit_price": "number - Price per unit",
      "total_price": "number - quantity * unit_price"
    }
  ],
  "subtotal": "number",
  "tax": "number",
  "shipping": "number",
  "total": "number",
  "currency": "string - USD, EUR, etc."
}

Rules:
- If a field is not found, use null
- Prices should be numbers without currency symbols
- Extract time if present in the receipt`;`

    const messages = [
        systemMessage(systemPrompt),
        userMessage(`Extract receipt data from this ${retailer} email:\n\n${email.body}`)
    ];

    return ai.chatWithJson(messages, { 
        model: 'gpt-4o-mini',  // Cost-effective for structured extraction
        maxTokens: 2000,
        temperature: 0.1       // Low temp for consistent parsing
    });
}
```

#### 4. Deduplication Logic
```javascript
/**
 * Generate unique receipt ID
 * @param {object} receipt - Receipt data
 * @returns {string} Unique identifier
 */
function generateReceiptId(receipt) {
    const parts = [
        receipt.source,
        receipt.date,
        receipt.order_id || receipt.email_id
    ].filter(Boolean);
    
    return parts.join('_').replace(/[^a-z0-9_-]/gi, '');
}

/**
 * Merge new receipts with existing data
 * @param {object[]} existing - Existing receipts from file
 * @param {object[]} incoming - Newly parsed receipts
 * @returns {object[]} Merged & deduped receipts
 */
function mergeReceipts(existing, incoming) {
    const existingIds = new Set(existing.map(r => r.id));
    const newReceipts = incoming.filter(r => !existingIds.has(r.id));
    
    return [...existing, ...newReceipts].sort((a, b) => 
        new Date(b.date) - new Date(a.date)
    );
}
```

## API Integration

### Harvest Router Registration

```javascript
// In harvest.mjs
import shopping from '../lib/shopping.mjs';

const harvesters = {
    // ... existing harvesters
    shopping: (logger, guidId, req) => shopping(logger, guidId, req),
};

// Timeout config
const HARVEST_TIMEOUTS = {
    // ... existing
    shopping: 300000,  // 5 minutes (AI calls can be slow)
};
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/harvest/shopping` | Run full shopping harvest |
| `GET` | `/harvest/shopping?full=true` | Re-sync all receipts |
| `GET` | `/harvest/shopping?retailer=amazon` | Filter to specific retailer |
| `GET` | `/harvest/shopping?user=alice` | Harvest for specific user |

### Response Format

```json
{
  "success": true,
  "receipts": {
    "processed": 12,
    "new": 3,
    "skipped": 9,
    "errors": 0
  },
  "lastSync": "2025-12-31T12:00:00Z"
}
```

## Error Handling

### Error Types

| Error | HTTP Code | Handling |
|-------|-----------|----------|
| Gmail auth failed | 401 | Return auth error, suggest re-auth |
| Gmail rate limit | 429 | Return cooldown response |
| AI extraction failed | 500 | Log error, skip receipt, continue |
| Parse error | 500 | Save raw email for manual review |

### Fallback Strategy

```javascript
async function processReceipt(email, retailer) {
    try {
        return await extractReceiptData(email, retailer);
    } catch (error) {
        logger.warn('shopping.extraction.failed', { 
            emailId: email.id, 
            retailer,
            error: error.message 
        });
        
        // Save to pending queue for manual review
        return {
            id: email.id,
            source: retailer,
            status: 'extraction_failed',
            raw_subject: email.subject,
            raw_snippet: email.snippet,
            error: error.message
        };
    }
}
```

## Configuration

### Loading Household Config

```javascript
import { householdLoadFile } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import moment from 'moment-timezone';

/**
 * Load shopping config for user's household
 * @param {string} username - Target username
 * @returns {object} Shopping config with retailers and timezone
 */
function loadShoppingConfig(username) {
    const householdId = configService.getHouseholdForUser(username);
    const config = householdLoadFile(householdId, 'config');
    
    if (!config?.shopping?.enabled) {
        throw new Error('Shopping harvester not enabled for this household');
    }
    
    return {
        timezone: config.shopping.timezone || 'America/Chicago',
        retailers: config.shopping.retailers || []
    };
}

/**
 * Format timestamp in user's local timezone
 * @param {Date|string} date - Date to format
 * @param {string} timezone - IANA timezone string
 * @returns {string} ISO 8601 with timezone offset
 */
function formatLocalTimestamp(date, timezone) {
    return moment(date).tz(timezone).format();
}
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GOOGLE_CLIENT_ID` | OAuth app client ID | Yes |
| `GOOGLE_CLIENT_SECRET` | OAuth app secret | Yes |
| `GOOGLE_REDIRECT_URI` | OAuth redirect URI | Yes |
| `OPENAI_API_KEY` | OpenAI API key | Yes |

### User Auth File

```yaml
# data/users/{username}/auth/google.yml
refresh_token: "1//0abc..."
```

### Household Config File

```yaml
# data/households/{hid}/config.yml
shopping:
  enabled: true
  timezone: "America/Chicago"
  retailers:
    - id: amazon
      name: "Amazon"
      senders: ["shipment-tracking@amazon.com", "auto-confirm@amazon.com"]
      keywords: ["order"]
    # ... more retailers
```

## Testing Strategy

### Unit Tests

```javascript
// backend/tests/shopping.test.mjs
describe('Shopping Harvester', () => {
    describe('buildReceiptQuery', () => {
        it('should build query for all retailers', () => {});
        it('should add date filter when since provided', () => {});
        it('should filter to specific retailer', () => {});
    });

    describe('extractReceiptData', () => {
        it('should parse Amazon receipt correctly', () => {});
        it('should handle missing fields gracefully', () => {});
        it('should return null for unrecognized format', () => {});
    });

    describe('mergeReceipts', () => {
        it('should dedupe by receipt ID', () => {});
        it('should sort by date descending', () => {});
    });
});
```

### Integration Tests

```javascript
describe('Shopping Harvest Integration', () => {
    it('should fetch and parse real Gmail receipts', async () => {
        // Requires test Gmail account with sample receipts
    });

    it('should handle rate limits gracefully', () => {});
    it('should timeout after configured limit', () => {});
});
```

### Mock AI Gateway

For testing, use a mock gateway that returns predictable responses:

```javascript
import { isAIGateway } from '../lib/ai/index.mjs';

const mockAIGateway = {
    chat: async () => 'mock response',
    chatWithImage: async () => 'mock vision response',
    chatWithJson: async (messages) => {
        // Return mock receipt based on input
        const content = messages[1]?.content || '';
        if (content.includes('Amazon')) {
            return MOCK_AMAZON_RECEIPT;
        }
        return MOCK_GENERIC_RECEIPT;
    },
    transcribe: async () => 'mock transcription',
    embed: async () => [0.1, 0.2, 0.3]
};

// Validate mock implements interface
console.assert(isAIGateway(mockAIGateway), 'Mock must implement IAIGateway');
```

## Implementation Plan

### Phase 0: AI Provider Refactor (Pre-requisite)
- [x] Create `backend/lib/ai/` directory
- [x] Create `errors.mjs` with AI-specific error classes
- [x] Move `IAIGateway.mjs` interface and helpers
- [x] Adapt `OpenAIGateway.mjs` with local imports
- [x] Create `index.mjs` with singleton factory
- [x] Update chatbots to re-export from new location
- [x] Add deprecation warning to `gpt.mjs`
- [x] Tests for new AI module

### Phase 1: MVP (Week 1)
- [x] Create `shopping.mjs` with Gmail search
- [x] Implement AI extraction for Amazon receipts
- [x] Add to harvest router
- [x] Basic deduplication
- [x] Unit tests

### Phase 2: Expand Retailers (Week 2)
- [x] Add patterns for all retailers (Amazon, Target, Walmart, Costco, Instacart, H-E-B, Best Buy, Home Depot, Apple)
- [x] Ensure categories are not used
- [x] Add `?retailer=` filter support
- [x] Add config to household config via ssh
- [x] Integration tests (12 tests)

### Phase 3: Polish (Week 3)
- [ ] Error recovery queue for failed extractions
- [ ] Batch processing for efficiency
- [ ] Rate limiting for AI calls
- [ ] Dashboard integration (frontend)

## Budget Considerations

### AI Costs

| Model | Input Tokens | Output Tokens | Est. Cost/Receipt |
|-------|--------------|---------------|-------------------|
| gpt-4o-mini | ~500 | ~300 | ~$0.0003 |
| gpt-4o | ~500 | ~300 | ~$0.006 |

**Recommendation:** Use `gpt-4o-mini` for extraction (sufficient accuracy, 20x cheaper).

### Gmail API Limits

- 25,000 queries/day (plenty for personal use)
- 500 messages/batch (use pagination for large syncs)

## Security Notes

1. **Token Storage:** Google refresh tokens stored in user-specific auth files
2. **Email Content:** Raw email bodies are NOT persisted; only extracted data
3. **AI Privacy:** Only necessary email content sent to OpenAI
4. **Error Sanitization:** API responses never include raw tokens or full email bodies

## Future Enhancements

1. **Receipt Images:** Use `chatWithImage` to parse photo receipts
2. **Budget Integration:** Auto-categorize spending with budget.mjs
3. **Notifications:** Alert on unusual purchases
4. **Multi-account:** Support multiple Gmail accounts per user
5. **Receipt Search:** Full-text search across all receipts

## AI Provider Refactor

As part of this feature, we will refactor the AI gateway out of `chatbots/` into a shared `backend/lib/ai/` location, making it available to all backend modules.

### Current State (Before)

```
backend/
├── lib/
│   └── gpt.mjs                           # Legacy standalone (askGPT, askGPTWithJSONOutput)
├── chatbots/
│   ├── _lib/errors/
│   │   └── InfrastructureError.mjs       # Error classes (ExternalServiceError, RateLimitError, etc.)
│   ├── application/ports/
│   │   └── IAIGateway.mjs                # Interface definition
│   └── infrastructure/ai/
│       └── OpenAIGateway.mjs             # Implementation (depends on chatbots/_lib)
```

**Problems:**
- `OpenAIGateway` buried in chatbots namespace
- Awkward import path: `from '../chatbots/infrastructure/ai/OpenAIGateway.mjs'`
- Depends on chatbots-specific error classes
- Legacy `gpt.mjs` duplicates functionality

### Target State (After)

```
backend/lib/ai/
├── index.mjs                 # Barrel export + singleton factory
├── IAIGateway.mjs            # Interface definition (moved from chatbots)
├── OpenAIGateway.mjs         # Implementation (refactored imports)
├── errors.mjs                # AI-specific errors (extracted)
└── helpers.mjs               # systemMessage, userMessage, etc.
```

### New Module: `backend/lib/ai/index.mjs`

```javascript
/**
 * AI Gateway Module
 * 
 * Provides a unified interface for AI/LLM operations across the entire backend.
 * 
 * Usage:
 *   import { getAIGateway, systemMessage, userMessage } from './ai/index.mjs';
 *   
 *   const ai = getAIGateway();
 *   const response = await ai.chatWithJson([
 *     systemMessage('Extract data from text'),
 *     userMessage(emailContent)
 *   ]);
 * 
 * @module lib/ai
 */

import { OpenAIGateway } from './OpenAIGateway.mjs';
import { createLogger } from '../logging/logger.js';

// Re-export interface and helpers
export * from './IAIGateway.mjs';
export * from './errors.mjs';

// Singleton instance (lazy-loaded)
let _gateway = null;

/**
 * Get the shared AI gateway instance
 * Creates on first call, reuses thereafter
 * 
 * @param {object} [options] - Override default config
 * @returns {OpenAIGateway}
 */
export function getAIGateway(options = {}) {
    if (!_gateway) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY not configured');
        }
        
        _gateway = new OpenAIGateway(
            { 
                apiKey,
                model: options.model || 'gpt-4o',
                maxTokens: options.maxTokens || 2000,
            },
            { 
                logger: createLogger({ source: 'backend', app: 'ai' })
            }
        );
    }
    return _gateway;
}

/**
 * Create a new AI gateway instance with custom config
 * Use this when you need different settings than the default
 * 
 * @param {object} config - Gateway config
 * @param {object} [options] - Additional options
 * @returns {OpenAIGateway}
 */
export function createAIGateway(config, options = {}) {
    return new OpenAIGateway(config, options);
}

// Default export for convenience
export default { getAIGateway, createAIGateway };
```

### New Module: `backend/lib/ai/errors.mjs`

```javascript
/**
 * AI-specific error classes
 * @module lib/ai/errors
 */

/**
 * Base AI error
 */
export class AIError extends Error {
    constructor(message, context = {}) {
        super(message);
        this.name = 'AIError';
        this.context = context;
        this.timestamp = new Date().toISOString();
    }
}

/**
 * External AI service error (OpenAI API failure)
 */
export class AIServiceError extends AIError {
    constructor(service, message, context = {}) {
        super(`${service}: ${message}`, { service, ...context });
        this.name = 'AIServiceError';
        this.service = service;
        this.httpStatus = 502;
        this.retryable = true;
    }
}

/**
 * Rate limit error
 */
export class AIRateLimitError extends AIError {
    constructor(service, retryAfter = 60, context = {}) {
        super(`Rate limit exceeded for ${service}. Retry after ${retryAfter}s`, { 
            service, retryAfter, ...context 
        });
        this.name = 'AIRateLimitError';
        this.retryAfter = retryAfter;
        this.httpStatus = 429;
        this.retryable = true;
    }
}

/**
 * Timeout error
 */
export class AITimeoutError extends AIError {
    constructor(operation, timeoutMs, context = {}) {
        super(`AI operation timed out after ${timeoutMs}ms: ${operation}`, { 
            operation, timeoutMs, ...context 
        });
        this.name = 'AITimeoutError';
        this.httpStatus = 504;
        this.retryable = true;
    }
}
```

### Migration Steps

1. **Create `backend/lib/ai/` directory** with new modules
2. **Copy & adapt `OpenAIGateway.mjs`** - update imports to use local errors
3. **Move `IAIGateway.mjs`** interface and helpers
4. **Update chatbots imports** to use `../../lib/ai/index.mjs`
5. **Deprecate `backend/lib/gpt.mjs`** - add deprecation warning, keep for backward compat
6. **Update shopping.mjs** to use clean import path

### Import Changes

**Before (awkward):**
```javascript
import { OpenAIGateway } from '../chatbots/infrastructure/ai/OpenAIGateway.mjs';
```

**After (clean):**
```javascript
import { getAIGateway, systemMessage, userMessage } from './ai/index.mjs';
```

### Backward Compatibility

Chatbots will re-export from the new location:

```javascript
// backend/chatbots/infrastructure/ai/index.mjs
export * from '../../../lib/ai/index.mjs';
```

## Related Files

- [gmail.mjs](backend/lib/gmail.mjs) - Gmail authentication pattern
- [backend/lib/ai/](backend/lib/ai/) - Shared AI gateway (NEW)
- [harvest.mjs](backend/routers/harvest.mjs) - Harvester router
- [budget.mjs](backend/lib/budget.mjs) - Budget integration target
