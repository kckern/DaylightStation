# Automation Domain Design

> External automation integration with Huginn, Home Assistant, and future systems

**Last Updated:** 2026-02-03
**Status:** Design Complete, Ready for Implementation

---

## Overview

DaylightStation's automation domain provides a unified interface for receiving events from external automation systems (Huginn, Home Assistant, n8n, Node-RED) and triggering actions in those systems. This enables users to leverage their existing automation infrastructure while benefiting from DaylightStation's cross-domain awareness and AI capabilities.

**Core Question Answered:** "How do we integrate with external automation systems without reinventing what they already do well, while adding value through domain-aware synthesis?"

---

## Design Principles

### 1. External Systems as Peers, Not Replacements

DaylightStation treats Huginn and Home Assistant the same way it treats Plex: as external systems with their own strengths that DS connects to, not competes with.

**What external systems do better:**
- Huginn: 100+ pre-built agent types, visual scenario builder, mature retry/backoff
- Home Assistant: Device control, local automation engine, massive integration ecosystem
- n8n/Node-RED: Visual workflow builders, extensive node libraries

**What DaylightStation does better:**
- Cross-domain awareness (fitness + nutrition + calendar in one place)
- AI-powered processing (LLM agents can interpret, summarize, decide)
- Purpose-built presentation (TV, kiosk, thermal printer, Telegram)
- Domain-aware data model (events become typed entities, not generic JSON)

### 2. Generic Ports, Specific Adapters

Port interfaces (`IExternalEventSource`, `IAutomationGateway`) are implementation-agnostic. Huginn adapter implements them. Home Assistant adapter implements them. Tomorrow's n8n adapter implements them. Application layer doesn't care which.

### 3. Normalize at the Boundary

External event formats (Huginn JSON, HA state changes) get mapped to canonical `ExternalEvent` entities in the adapter layer. Domain logic never sees system-specific schemas.

### 4. Bidirectional by Design, Unidirectional for MVP

Interfaces support both directions from day one. MVP implements inbound (external → DS) only. Outbound (DS → external) is stubbed for future implementation.

---

## Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  4_api                                                          │
│    └── /api/v1/automation/webhook/{source}                      │
├─────────────────────────────────────────────────────────────────┤
│  3_applications/automation/                                     │
│    ├── ports/                                                   │
│    │     ├── IExternalEventSource.mjs      ← inbound            │
│    │     └── IAutomationGateway.mjs        ← outbound (stub)    │
│    ├── usecases/                                                │
│    │     ├── RouteExternalEvent.mjs                             │
│    │     └── TriggerExternalAutomation.mjs ← stub               │
│    └── AutomationService.mjs                                    │
├─────────────────────────────────────────────────────────────────┤
│  2_domains/automation/                                          │
│    ├── entities/                                                │
│    │     ├── ExternalEvent.mjs                                  │
│    │     └── AutomationRule.mjs            ← future             │
│    └── value-objects/                                           │
│          ├── EventMapping.mjs                                   │
│          └── TriggerCondition.mjs          ← future             │
├─────────────────────────────────────────────────────────────────┤
│  1_adapters/                                                    │
│    ├── huginn/                                                  │
│    │     ├── HuginnAdapter.mjs             (HTTP client)        │
│    │     ├── HuginnEventSource.mjs         (inbound)            │
│    │     ├── HuginnGateway.mjs             (outbound stub)      │
│    │     └── mappers/HuginnEventMapper.mjs                      │
│    └── home-automation/homeassistant/                           │
│          ├── HomeAssistantAdapter.mjs      (existing, unchanged)│
│          ├── HomeAssistantEventSource.mjs  (new, inbound)       │
│          └── HomeAssistantGateway.mjs      (new, outbound stub) │
└─────────────────────────────────────────────────────────────────┘
```

---

## Port Interfaces

### IExternalEventSource (Inbound)

```javascript
// backend/src/3_applications/automation/ports/IExternalEventSource.mjs

/**
 * Port interface for receiving events from external automation systems.
 * Implemented by: HuginnEventSource, HomeAssistantEventSource, etc.
 */
export const IExternalEventSource = {
  /**
   * Process an incoming event from the external system
   * @param {Object} rawPayload - Raw payload from webhook/API
   * @param {Object} context - Request context (source, timestamp, etc.)
   * @returns {Promise<ExternalEvent>} Normalized event entity
   */
  async receiveEvent(rawPayload, context) {},

  /**
   * List available event sources (agents, entities, etc.)
   * @returns {Promise<Array<{id: string, name: string, type: string}>>}
   */
  async listSources() {},

  /**
   * Validate webhook payload authenticity
   * @param {Object} payload - Raw payload
   * @param {string} signature - Signature/token from headers
   * @returns {boolean}
   */
  validatePayload(payload, signature) {},
};

/**
 * Type guard for IExternalEventSource
 */
export function isExternalEventSource(obj) {
  return (
    obj &&
    typeof obj.receiveEvent === 'function' &&
    typeof obj.listSources === 'function'
  );
}
```

### IAutomationGateway (Outbound)

```javascript
// backend/src/3_applications/automation/ports/IAutomationGateway.mjs

/**
 * Port interface for triggering actions in external automation systems.
 * Implemented by: HuginnGateway, HomeAssistantGateway, etc.
 *
 * NOTE: Stubbed for MVP. Full implementation in future phase.
 */
export const IAutomationGateway = {
  /**
   * Trigger an automation/scenario in the external system
   * @param {Object} trigger
   * @param {string} trigger.targetId - Scenario/automation ID to trigger
   * @param {Object} [trigger.payload] - Data to pass to the automation
   * @param {Object} [trigger.context] - Execution context
   * @returns {Promise<{success: boolean, triggerId?: string, error?: string}>}
   */
  async trigger(trigger) {},

  /**
   * List available automation targets (scenarios, scripts, etc.)
   * @returns {Promise<Array<{id: string, name: string, type: string}>>}
   */
  async listTargets() {},

  /**
   * Check if the external system is reachable
   * @returns {Promise<{available: boolean, latencyMs?: number}>}
   */
  async healthCheck() {},
};

/**
 * Type guard for IAutomationGateway
 */
export function isAutomationGateway(obj) {
  return (
    obj &&
    typeof obj.trigger === 'function' &&
    typeof obj.listTargets === 'function'
  );
}
```

---

## Domain Entities

### ExternalEvent

```javascript
// backend/src/2_domains/automation/entities/ExternalEvent.mjs

/**
 * Normalized event from an external automation system.
 *
 * Schema: Hybrid — typed when mapping exists, opaque fallback.
 */
export class ExternalEvent {
  #id;
  #source;
  #sourceId;
  #mapping;
  #payload;
  #raw;
  #metadata;
  #timestamp;

  /**
   * @param {Object} props
   * @param {string} props.id - Unique event ID (UUID)
   * @param {string} props.source - Source system ('huginn', 'homeassistant', etc.)
   * @param {string} props.sourceId - ID within source system (agent ID, entity ID)
   * @param {string|null} props.mapping - Domain mapping if known ('fitness_activity', etc.), null for pass-through
   * @param {Object} props.payload - Typed payload if mapping exists, raw otherwise
   * @param {Object} props.raw - Original payload (always preserved)
   * @param {Object} [props.metadata] - Routing hints, tags, etc.
   * @param {Date} props.timestamp
   */
  constructor(props) {
    this.#id = props.id;
    this.#source = props.source;
    this.#sourceId = props.sourceId;
    this.#mapping = props.mapping || null;
    this.#payload = props.payload;
    this.#raw = props.raw;
    this.#metadata = props.metadata || {};
    this.#timestamp = props.timestamp;
  }

  get id() { return this.#id; }
  get source() { return this.#source; }
  get sourceId() { return this.#sourceId; }
  get mapping() { return this.#mapping; }
  get payload() { return this.#payload; }
  get raw() { return this.#raw; }
  get metadata() { return this.#metadata; }
  get timestamp() { return this.#timestamp; }

  /** Whether this event has a domain mapping */
  get isMapped() { return this.#mapping !== null; }

  /** Create unique key for deduplication */
  get dedupeKey() {
    return `${this.#source}:${this.#sourceId}:${this.#payload?.externalId || this.#id}`;
  }

  toJSON() {
    return {
      id: this.#id,
      source: this.#source,
      sourceId: this.#sourceId,
      mapping: this.#mapping,
      payload: this.#payload,
      raw: this.#raw,
      metadata: this.#metadata,
      timestamp: this.#timestamp.toISOString(),
    };
  }
}

export default ExternalEvent;
```

### EventMapping (Value Object)

```javascript
// backend/src/2_domains/automation/value-objects/EventMapping.mjs

/**
 * Defines how an external event source maps to a domain type.
 * Loaded from configuration (convention + overrides).
 */
export class EventMapping {
  #source;
  #sourcePattern;
  #mapping;
  #routeTo;
  #transform;
  #priority;

  /**
   * @param {Object} props
   * @param {string} props.source - Source system ('huginn', 'homeassistant')
   * @param {string} props.sourcePattern - Pattern to match sourceId (glob or exact)
   * @param {string|null} props.mapping - Domain type to map to, null for pass-through
   * @param {string} [props.routeTo] - Target domain if not inferred from mapping
   * @param {string} [props.transform] - Transformer reference (e.g., 'huginn/strava')
   * @param {number} [props.priority=50] - Priority for deduplication (lower = higher priority)
   */
  constructor(props) {
    this.#source = props.source;
    this.#sourcePattern = props.sourcePattern;
    this.#mapping = props.mapping;
    this.#routeTo = props.routeTo;
    this.#transform = props.transform;
    this.#priority = props.priority ?? 50;
  }

  get source() { return this.#source; }
  get sourcePattern() { return this.#sourcePattern; }
  get mapping() { return this.#mapping; }
  get routeTo() { return this.#routeTo; }
  get transform() { return this.#transform; }
  get priority() { return this.#priority; }

  /**
   * Check if this mapping matches a given source and sourceId
   */
  matches(source, sourceId) {
    if (this.#source !== source) return false;

    // Exact match
    if (this.#sourcePattern === sourceId) return true;

    // Glob pattern (simple * matching)
    if (this.#sourcePattern.includes('*')) {
      const regex = new RegExp(
        '^' + this.#sourcePattern.replace(/\*/g, '.*') + '$'
      );
      return regex.test(sourceId);
    }

    return false;
  }
}

export default EventMapping;
```

---

## Configuration

### Convention-Based with YAML Overrides

```yaml
# data/system/config/automation.yml

# Conventions (built-in, no config needed):
# - Huginn agent named "strava-*" → fitness domain
# - Huginn agent named "rss-*" → content domain
# - HA entity "sensor.fitness_*" → fitness domain
# - HA entity "binary_sensor.presence_*" → presence domain

# Source priorities for deduplication (lower = higher priority)
priorities:
  native: 10      # Native harvesters win by default
  homeassistant: 20
  huginn: 30
  n8n: 40

# Explicit overrides (when conventions don't apply)
mappings:
  overrides:
    - source: huginn
      sourcePattern: "my-custom-fitness-agent"
      mapping: fitness_activity
      priority: 15  # Override to beat native

    - source: huginn
      sourcePattern: "news-aggregator"
      mapping: null  # Pass through as-is
      routeTo: content

    - source: homeassistant
      sourcePattern: "sensor.withings_*"
      mapping: fitness_measurement
      transform: homeassistant/withings

# Deduplication settings
deduplication:
  enabled: true
  window: 3600  # Seconds to check for duplicates
  keyFields:
    fitness_activity: ["externalId", "startTime"]
    fitness_measurement: ["externalId", "timestamp"]
```

### Webhook Secrets

```yaml
# data/system/secrets.yml

automation:
  webhooks:
    huginn:
      secretToken: "your-huginn-webhook-secret"
    homeassistant:
      secretToken: "your-ha-webhook-secret"
```

---

## Adapters

### HuginnAdapter

```javascript
// backend/src/1_adapters/huginn/HuginnAdapter.mjs

import { CircuitBreaker } from '../harvester/CircuitBreaker.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * HTTP client for Huginn API.
 * Shared by HuginnEventSource and HuginnGateway.
 */
export class HuginnAdapter {
  #baseUrl;
  #apiToken;
  #httpClient;
  #circuitBreaker;
  #logger;

  constructor(config, deps = {}) {
    if (!config?.baseUrl) {
      throw new InfrastructureError('HuginnAdapter requires baseUrl', {
        code: 'MISSING_CONFIG',
        field: 'baseUrl',
      });
    }

    this.#baseUrl = config.baseUrl.replace(/\/$/, '');
    this.#apiToken = config.apiToken;
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;

    this.#circuitBreaker = new CircuitBreaker({
      name: 'huginn',
      failureThreshold: 3,
      resetTimeoutMs: 60000,
      logger: this.#logger,
    });
  }

  /**
   * List all agents in Huginn
   */
  async listAgents() {
    return this.#circuitBreaker.execute(async () => {
      const response = await this.#httpClient.get(`${this.#baseUrl}/api/agents`, {
        headers: this.#authHeaders(),
      });
      return response.data.agents || [];
    });
  }

  /**
   * Get agent details
   */
  async getAgent(agentId) {
    return this.#circuitBreaker.execute(async () => {
      const response = await this.#httpClient.get(
        `${this.#baseUrl}/api/agents/${agentId}`,
        { headers: this.#authHeaders() }
      );
      return response.data.agent;
    });
  }

  /**
   * Trigger a manual agent run (for outbound)
   */
  async triggerAgent(agentId, payload = {}) {
    return this.#circuitBreaker.execute(async () => {
      const response = await this.#httpClient.post(
        `${this.#baseUrl}/api/agents/${agentId}/run`,
        payload,
        { headers: this.#authHeaders() }
      );
      return response.data;
    });
  }

  /**
   * Create a webhook event (for outbound scenarios)
   */
  async createEvent(agentId, payload) {
    return this.#circuitBreaker.execute(async () => {
      const response = await this.#httpClient.post(
        `${this.#baseUrl}/api/agents/${agentId}/events`,
        { event: payload },
        { headers: this.#authHeaders() }
      );
      return response.data;
    });
  }

  #authHeaders() {
    return {
      'Authorization': `Token ${this.#apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  get isCircuitOpen() {
    return this.#circuitBreaker.isOpen;
  }
}

export default HuginnAdapter;
```

### HuginnEventSource

```javascript
// backend/src/1_adapters/huginn/HuginnEventSource.mjs

import { ExternalEvent } from '../../2_domains/automation/entities/ExternalEvent.mjs';
import { HuginnEventMapper } from './mappers/HuginnEventMapper.mjs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Implements IExternalEventSource for Huginn.
 * Receives webhook events from Huginn and normalizes them.
 */
export class HuginnEventSource {
  #adapter;
  #mapper;
  #secretToken;
  #logger;

  constructor(config, deps = {}) {
    this.#adapter = deps.adapter;
    this.#mapper = deps.mapper || new HuginnEventMapper();
    this.#secretToken = config.secretToken;
    this.#logger = deps.logger || console;
  }

  /**
   * Process incoming webhook from Huginn
   * @implements IExternalEventSource.receiveEvent
   */
  async receiveEvent(rawPayload, context = {}) {
    this.#logger.debug?.('huginn.event.received', {
      agentId: rawPayload.agent_id,
      type: rawPayload.agent_type,
    });

    const event = new ExternalEvent({
      id: uuidv4(),
      source: 'huginn',
      sourceId: String(rawPayload.agent_id || rawPayload.agent_name || 'unknown'),
      mapping: this.#mapper.inferMapping(rawPayload),
      payload: this.#mapper.transformPayload(rawPayload),
      raw: rawPayload,
      metadata: {
        agentType: rawPayload.agent_type,
        agentName: rawPayload.agent_name,
        ...context,
      },
      timestamp: new Date(rawPayload.created_at || Date.now()),
    });

    return event;
  }

  /**
   * List available Huginn agents
   * @implements IExternalEventSource.listSources
   */
  async listSources() {
    if (!this.#adapter) {
      return [];
    }

    const agents = await this.#adapter.listAgents();
    return agents.map(agent => ({
      id: String(agent.id),
      name: agent.name,
      type: agent.type,
    }));
  }

  /**
   * Validate webhook signature
   * @implements IExternalEventSource.validatePayload
   */
  validatePayload(payload, signature) {
    if (!this.#secretToken) return true; // No secret configured
    return signature === this.#secretToken;
  }
}

export default HuginnEventSource;
```

### HuginnGateway (Stub)

```javascript
// backend/src/1_adapters/huginn/HuginnGateway.mjs

/**
 * Implements IAutomationGateway for Huginn.
 * Triggers Huginn scenarios/agents from DaylightStation.
 *
 * NOTE: Stubbed for MVP. Full implementation in future phase.
 */
export class HuginnGateway {
  #adapter;
  #circuitBreaker;
  #logger;

  constructor(config, deps = {}) {
    this.#adapter = deps.adapter;
    this.#logger = deps.logger || console;
  }

  /**
   * Trigger a Huginn agent/scenario
   * @implements IAutomationGateway.trigger
   */
  async trigger(trigger) {
    this.#logger.warn?.('huginn.gateway.stub', {
      message: 'Outbound triggering not yet implemented',
      targetId: trigger.targetId,
    });

    // Stub: return success but don't actually trigger
    return {
      success: false,
      error: 'Outbound triggering not yet implemented',
    };
  }

  /**
   * List available trigger targets
   * @implements IAutomationGateway.listTargets
   */
  async listTargets() {
    if (!this.#adapter) return [];

    // In full implementation, filter to agents that accept manual triggers
    const agents = await this.#adapter.listAgents();
    return agents
      .filter(a => a.can_receive_events)
      .map(a => ({
        id: String(a.id),
        name: a.name,
        type: 'agent',
      }));
  }

  /**
   * Check Huginn availability
   * @implements IAutomationGateway.healthCheck
   */
  async healthCheck() {
    if (!this.#adapter) {
      return { available: false };
    }

    try {
      const start = Date.now();
      await this.#adapter.listAgents();
      return {
        available: !this.#adapter.isCircuitOpen,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return { available: false };
    }
  }
}

export default HuginnGateway;
```

### HomeAssistantEventSource (New File)

```javascript
// backend/src/1_adapters/home-automation/homeassistant/HomeAssistantEventSource.mjs

import { ExternalEvent } from '../../../2_domains/automation/entities/ExternalEvent.mjs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Implements IExternalEventSource for Home Assistant.
 * Receives webhook events from HA automations.
 */
export class HomeAssistantEventSource {
  #secretToken;
  #logger;

  constructor(config, deps = {}) {
    this.#secretToken = config.secretToken;
    this.#logger = deps.logger || console;
  }

  /**
   * Process incoming webhook from Home Assistant
   * @implements IExternalEventSource.receiveEvent
   */
  async receiveEvent(rawPayload, context = {}) {
    this.#logger.debug?.('homeassistant.event.received', {
      entityId: rawPayload.entity_id,
      eventType: rawPayload.event_type,
    });

    const event = new ExternalEvent({
      id: uuidv4(),
      source: 'homeassistant',
      sourceId: rawPayload.entity_id || rawPayload.automation_id || 'unknown',
      mapping: this.#inferMapping(rawPayload),
      payload: this.#transformPayload(rawPayload),
      raw: rawPayload,
      metadata: {
        eventType: rawPayload.event_type,
        domain: rawPayload.entity_id?.split('.')[0],
        ...context,
      },
      timestamp: new Date(rawPayload.timestamp || Date.now()),
    });

    return event;
  }

  /**
   * List available HA entities (requires adapter with state access)
   * @implements IExternalEventSource.listSources
   */
  async listSources() {
    // Would need HomeAssistantAdapter injected to list entities
    // For now, return empty - sources are configured via YAML
    return [];
  }

  /**
   * Validate webhook signature
   * @implements IExternalEventSource.validatePayload
   */
  validatePayload(payload, signature) {
    if (!this.#secretToken) return true;
    return signature === this.#secretToken;
  }

  #inferMapping(payload) {
    const entityId = payload.entity_id || '';
    const domain = entityId.split('.')[0];

    // Convention-based mapping
    if (entityId.includes('fitness') || domain === 'sensor' && entityId.includes('withings')) {
      return 'fitness_measurement';
    }
    if (domain === 'binary_sensor' && entityId.includes('presence')) {
      return 'presence_event';
    }
    if (domain === 'media_player') {
      return 'media_event';
    }

    return null; // Pass through
  }

  #transformPayload(payload) {
    return {
      entityId: payload.entity_id,
      state: payload.new_state?.state,
      previousState: payload.old_state?.state,
      attributes: payload.new_state?.attributes,
      context: payload.context,
    };
  }
}

export default HomeAssistantEventSource;
```

### HomeAssistantGateway (New File, Stub)

```javascript
// backend/src/1_adapters/home-automation/homeassistant/HomeAssistantGateway.mjs

/**
 * Implements IAutomationGateway for Home Assistant.
 * Triggers HA automations/scripts from DaylightStation.
 *
 * NOTE: Stubbed for MVP. Full implementation in future phase.
 */
export class HomeAssistantGateway {
  #adapter;
  #logger;

  constructor(config, deps = {}) {
    this.#adapter = deps.adapter; // Existing HomeAssistantAdapter
    this.#logger = deps.logger || console;
  }

  /**
   * Trigger an HA automation or script
   * @implements IAutomationGateway.trigger
   */
  async trigger(trigger) {
    this.#logger.warn?.('homeassistant.gateway.stub', {
      message: 'Outbound triggering not yet implemented',
      targetId: trigger.targetId,
    });

    return {
      success: false,
      error: 'Outbound triggering not yet implemented',
    };

    // Future implementation:
    // const [domain, entityId] = trigger.targetId.split('.');
    // if (domain === 'automation') {
    //   await this.#adapter.callService('automation', 'trigger', { entity_id: trigger.targetId });
    // } else if (domain === 'script') {
    //   await this.#adapter.callService('script', 'turn_on', { entity_id: trigger.targetId, ...trigger.payload });
    // }
  }

  /**
   * List available trigger targets (automations, scripts)
   * @implements IAutomationGateway.listTargets
   */
  async listTargets() {
    if (!this.#adapter) return [];

    // Would query HA for automations and scripts
    // For now, return empty
    return [];
  }

  /**
   * Check HA availability
   * @implements IAutomationGateway.healthCheck
   */
  async healthCheck() {
    if (!this.#adapter) {
      return { available: false };
    }

    try {
      const start = Date.now();
      await this.#adapter.getState('sun.sun'); // Simple connectivity check
      return {
        available: true,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return { available: false };
    }
  }
}

export default HomeAssistantGateway;
```

---

## API Layer

### Webhook Endpoint

```javascript
// backend/src/4_api/v1/routers/automation.mjs

import { Router } from 'express';
import {
  tracingMiddleware,
  requestLoggerMiddleware,
  errorHandlerMiddleware,
  asyncHandler,
} from '#system/http/middleware/index.mjs';

/**
 * Create Automation Express Router
 */
export function createAutomationRouter(container, options = {}) {
  const router = Router();
  const { logger = console } = options;

  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  /**
   * Webhook endpoint for external automation systems
   * POST /api/v1/automation/webhook/:source
   */
  router.post('/webhook/:source', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const secretHeader = req.headers['x-webhook-secret'];

    // Get event source for this system
    const eventSource = container.getEventSource(source);
    if (!eventSource) {
      logger.warn?.('automation.webhook.unknown_source', { source });
      return res.status(200).json({ ok: true }); // Silent success
    }

    // Validate webhook
    if (!eventSource.validatePayload(req.body, secretHeader)) {
      logger.warn?.('automation.webhook.auth_failed', { source });
      return res.status(200).json({ ok: true }); // Silent success
    }

    // Process event
    const event = await eventSource.receiveEvent(req.body, {
      ip: req.ip,
      traceId: req.traceId,
    });

    // Route to appropriate domain
    const routeUseCase = container.getRouteExternalEvent();
    await routeUseCase.execute(event);

    res.status(200).json({ ok: true, eventId: event.id });
  }));

  /**
   * List configured sources
   * GET /api/v1/automation/sources
   */
  router.get('/sources', asyncHandler(async (req, res) => {
    const sources = container.listEventSources();
    res.json({ sources });
  }));

  router.use(errorHandlerMiddleware({ isWebhook: true }));

  return router;
}

export default createAutomationRouter;
```

---

## Deduplication

### DeduplicationService

```javascript
// backend/src/3_applications/automation/services/DeduplicationService.mjs

/**
 * Checks for duplicate events based on configured priority cascade.
 */
export class DeduplicationService {
  #config;
  #lifelogDatastore;
  #logger;

  constructor(deps) {
    this.#config = deps.config;
    this.#lifelogDatastore = deps.lifelogDatastore;
    this.#logger = deps.logger || console;
  }

  /**
   * Check if event should be processed or skipped due to duplicate
   * @param {ExternalEvent} event
   * @param {EventMapping} mapping
   * @returns {Promise<{proceed: boolean, reason?: string}>}
   */
  async shouldProcess(event, mapping) {
    if (!this.#config.deduplication?.enabled) {
      return { proceed: true };
    }

    const existingSource = await this.#findExistingSource(event, mapping);
    if (!existingSource) {
      return { proceed: true };
    }

    const existingPriority = this.#getPriority(existingSource);
    const incomingPriority = mapping?.priority ?? this.#getPriority(event.source);

    if (incomingPriority < existingPriority) {
      // Incoming has higher priority (lower number), allow override
      this.#logger.info?.('dedup.override', {
        eventId: event.id,
        existingSource,
        incomingSource: event.source,
      });
      return { proceed: true, override: true };
    }

    this.#logger.debug?.('dedup.skipped', {
      eventId: event.id,
      existingSource,
      reason: 'lower_priority',
    });
    return { proceed: false, reason: `Already exists from ${existingSource}` };
  }

  #getPriority(source) {
    return this.#config.priorities?.[source] ?? 50;
  }

  async #findExistingSource(event, mapping) {
    // Implementation depends on how lifelog stores source metadata
    // This is a simplified example
    const keyFields = this.#config.deduplication?.keyFields?.[mapping?.mapping] || ['externalId'];
    const key = keyFields.map(f => event.payload?.[f]).filter(Boolean).join(':');

    if (!key) return null;

    const existing = await this.#lifelogDatastore.findByExternalKey(
      mapping?.mapping,
      key,
      this.#config.deduplication?.window || 3600
    );

    return existing?.source || null;
  }
}

export default DeduplicationService;
```

---

## Implementation Phases

### Phase 1: Domain Foundation

- [ ] Create `2_domains/automation/` directory structure
- [ ] Implement `ExternalEvent` entity
- [ ] Implement `EventMapping` value object
- [ ] Create domain index exports

### Phase 2: Port Interfaces

- [ ] Create `3_applications/automation/ports/` directory
- [ ] Implement `IExternalEventSource` interface
- [ ] Implement `IAutomationGateway` interface (stub)
- [ ] Create port index exports

### Phase 3: Huginn Adapter

- [ ] Create `1_adapters/huginn/` directory
- [ ] Implement `HuginnAdapter` (HTTP client with circuit breaker)
- [ ] Implement `HuginnEventSource`
- [ ] Implement `HuginnEventMapper`
- [ ] Implement `HuginnGateway` (stub)
- [ ] Add to adapter index exports

### Phase 4: Home Assistant Extensions

- [ ] Create `HomeAssistantEventSource.mjs`
- [ ] Create `HomeAssistantGateway.mjs` (stub)
- [ ] Update `home-automation/homeassistant/index.mjs` exports

### Phase 5: Application Layer

- [ ] Create `3_applications/automation/` directory
- [ ] Implement `RouteExternalEvent` use case
- [ ] Implement `TriggerExternalAutomation` use case (stub)
- [ ] Implement `DeduplicationService`
- [ ] Implement `AutomationService` orchestrator
- [ ] Create `AutomationContainer` for dependency injection

### Phase 6: API & Configuration

- [ ] Create `/api/v1/automation/` router
- [ ] Extend `webhookValidationMiddleware` for generic sources
- [ ] Add `automation.yml` config schema
- [ ] Add webhook secrets to `secrets.yml` schema
- [ ] Register router in `app.mjs`

### Phase 7: Testing

- [ ] Unit tests for `ExternalEvent` entity
- [ ] Unit tests for `EventMapping` matching logic
- [ ] Unit tests for `HuginnEventSource`
- [ ] Unit tests for `DeduplicationService`
- [ ] Integration tests with mock Huginn webhooks

### Future: Outbound Implementation

- [ ] Implement `HuginnGateway.trigger()`
- [ ] Implement `HomeAssistantGateway.trigger()`
- [ ] Add automation rule evaluation engine
- [ ] Add UI for automation rule management

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-03 | Initial design from brainstorming session |
