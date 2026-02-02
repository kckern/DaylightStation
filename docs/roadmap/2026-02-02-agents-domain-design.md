# Agents Domain Design

> Autonomous AI agents with framework-agnostic abstractions

**Last Updated:** 2026-02-02
**Status:** Design Complete, Ready for Implementation

---

## Overview

DaylightStation's agent system provides autonomous AI assistants that can interact with adapters, manage workflows, and collaborate with users through constrained interfaces. The architecture abstracts away the underlying framework (currently Mastra) through port interfaces, allowing future provider swaps.

**Core Question Answered:** "How do we build agents that can control home automation, curate media libraries, coach life planning, and assist with configuration — all through a consistent, provider-agnostic interface?"

---

## Design Principles

### 1. Mastra as Gold Standard

Mastra's interfaces are considered the gold standard for agent frameworks. Our port interfaces mirror Mastra's API with one key difference: **JSON Schema instead of Zod** for framework independence.

```
Mastra Interface          Our Port Interface          Difference
─────────────────         ──────────────────          ──────────
Step (Zod schemas)    →   IStep (JSON Schema)     →   Schema format only
Workflow              →   IWorkflow               →   Schema format only
MastraMemory          →   IMemory                 →   Schema format only
Tool (Zod)            →   ITool (JSON Schema)     →   Already implemented
```

The adapter's only job: **translate JSON Schema ↔ Zod**. Everything else passes through.

### 2. Agents as UI Collaborators

For copilot-style agents that interact with UIs, the agent sends structured commands to the UI rather than writing directly to storage. This enables:

- Native undo/redo in the browser
- Preview before commit
- Real-time collaboration between agent and user
- Validation before save

### 3. Tool Factories for Adapter Access

Agents access external systems through tool factories that wrap existing adapters. This creates a clean security boundary — agents can only do what their tools allow.

---

## Port Interfaces

### IStep

Mirrors Mastra's `Step` interface for workflow steps:

```javascript
// backend/src/3_applications/agents/ports/IStep.mjs

/**
 * Port interface for workflow steps
 * Mirrors Mastra's Step interface with JSON Schema instead of Zod
 */
export const IStep = {
  /** @type {string} Unique identifier */
  id: '',

  /** @type {string} Optional description */
  description: '',

  /** @type {Object} JSON Schema for input */
  inputSchema: {},

  /** @type {Object} JSON Schema for output */
  outputSchema: {},

  /** @type {Object|undefined} JSON Schema for resume data (human-in-the-loop) */
  resumeSchema: undefined,

  /** @type {Object|undefined} JSON Schema for suspend payload */
  suspendSchema: undefined,

  /** @type {Object|undefined} JSON Schema for workflow state this step uses */
  stateSchema: undefined,

  /**
   * Execute the step
   * Mirrors Mastra's ExecuteFunctionParams
   * @param {Object} params
   * @param {string} params.runId - Workflow run ID
   * @param {string} params.workflowId - Parent workflow ID
   * @param {Object} params.inputData - Validated input
   * @param {Object} params.state - Workflow state
   * @param {Function} params.setState - Update workflow state
   * @param {Object} [params.resumeData] - Data from resume (if resuming)
   * @param {Function} params.suspend - Call to pause for human input
   * @param {Object} params.context - Execution context (userId, etc.)
   * @param {Function} params.getStepResult - Get result from previous step
   * @returns {Promise<Object>} Output matching outputSchema
   */
  async execute(params) {},
};

/**
 * Helper to create a step definition
 */
export function createStep({ id, description, inputSchema, outputSchema, resumeSchema, suspendSchema, stateSchema, execute }) {
  return { id, description, inputSchema, outputSchema, resumeSchema, suspendSchema, stateSchema, execute };
}

/**
 * Type guard for IStep
 */
export function isStep(obj) {
  return (
    obj &&
    typeof obj.id === 'string' &&
    typeof obj.execute === 'function'
  );
}
```

### IWorkflow

Mirrors Mastra's `Workflow` class with builder pattern:

```javascript
// backend/src/3_applications/agents/ports/IWorkflow.mjs

/**
 * Port interface for workflow definitions
 * Mirrors Mastra's Workflow class with JSON Schema instead of Zod
 */
export const IWorkflow = {
  /** @type {string} Unique identifier */
  id: '',

  /** @type {string} Optional description */
  description: '',

  /** @type {Object} JSON Schema for workflow input */
  inputSchema: {},

  /** @type {Object} JSON Schema for workflow output */
  outputSchema: {},

  /** @type {Object|undefined} JSON Schema for workflow state */
  stateSchema: undefined,

  /** @type {IStep[]} Step definitions used by this workflow */
  steps: [],

  /**
   * Build the workflow graph using builder pattern
   * Called by runtime to construct the execution graph
   *
   * @param {WorkflowBuilder} builder - Provides .then(), .branch(), .parallel()
   * @returns {WorkflowBuilder} The configured builder
   */
  build(builder) {},
};

/**
 * Builder interface for workflow construction
 * Mirrors Mastra's fluent API
 */
export const IWorkflowBuilder = {
  /** Chain a step sequentially */
  then(step) { return this; },

  /** Branch based on condition */
  branch(condition, branches) { return this; },

  /** Execute steps in parallel */
  parallel(steps) { return this; },

  /** Loop while condition is true */
  loop(condition, step) { return this; },

  /** Nest another workflow as a step */
  workflow(workflow) { return this; },

  /** Finalize the workflow definition */
  commit() {},
};

/**
 * Helper to create a workflow definition
 */
export function createWorkflow({ id, description, inputSchema, outputSchema, stateSchema, steps, build }) {
  return { id, description, inputSchema, outputSchema, stateSchema, steps, build };
}
```

### IWorkflowRuntime

Mirrors Mastra's workflow execution:

```javascript
// backend/src/3_applications/agents/ports/IWorkflowRuntime.mjs

/**
 * Workflow run status - mirrors Mastra's WorkflowRunStatus
 */
export const WorkflowRunStatus = {
  SUCCESS: 'success',
  FAILED: 'failed',
  SUSPENDED: 'suspended',
  RUNNING: 'running',
  PAUSED: 'paused',
};

/**
 * Port interface for workflow execution
 * Implemented by MastraWorkflowAdapter
 */
export const IWorkflowRuntime = {
  /**
   * Start a workflow - mirrors Mastra's workflow.start()
   * @param {Object} options
   * @param {IWorkflow} options.workflow
   * @param {Object} options.inputData - Matches workflow.inputSchema
   * @param {Object} [options.context] - userId, householdId, etc.
   * @returns {Promise<WorkflowResult>}
   */
  async start(options) {},

  /**
   * Start with streaming - mirrors Mastra's workflow.startStream()
   * @returns {AsyncIterable<WorkflowEvent>}
   */
  async startStream(options) {},

  /**
   * Resume a suspended workflow - mirrors Mastra's workflow.resume()
   * @param {Object} options
   * @param {string} options.runId
   * @param {Object} [options.resumeData] - Data for the suspended step
   * @param {string} [options.step] - Which step to resume (if multiple suspended)
   * @returns {Promise<WorkflowResult>}
   */
  async resume(options) {},

  /**
   * Restart a failed/paused workflow - mirrors Mastra's workflow.restart()
   */
  async restart(options) {},

  /**
   * Get a workflow run by ID
   */
  async getRun(runId) {},

  /**
   * List runs with filters
   */
  async listRuns(filters) {},
};

/**
 * Workflow result - mirrors Mastra's WorkflowResult discriminated union
 */
export const WorkflowResult = {
  /** @type {WorkflowRunStatus} */
  status: '',

  /** @type {Object|undefined} Output if success */
  result: undefined,

  /** @type {Error|undefined} Error if failed */
  error: undefined,

  /** @type {Object|undefined} Suspend payload if suspended */
  suspendPayload: undefined,

  /** @type {Object} Step results keyed by step ID */
  stepResults: {},

  /** @type {Object} Final workflow state */
  state: {},

  /** @type {string} Run identifier */
  runId: '',
};

/**
 * Type guard for IWorkflowRuntime
 */
export function isWorkflowRuntime(obj) {
  return (
    obj &&
    typeof obj.start === 'function' &&
    typeof obj.resume === 'function' &&
    typeof obj.getRun === 'function'
  );
}
```

### IMemory

Mirrors Mastra's `MastraMemory` abstract class:

```javascript
// backend/src/3_applications/agents/ports/IMemory.mjs

/**
 * Thread structure - mirrors Mastra's StorageThreadType
 */
export const IThread = {
  /** @type {string} Unique identifier */
  id: '',

  /** @type {string} Resource/user this thread belongs to */
  resourceId: '',

  /** @type {string|undefined} Thread title */
  title: undefined,

  /** @type {Date} */
  createdAt: null,

  /** @type {Date} */
  updatedAt: null,

  /** @type {Object|undefined} Arbitrary metadata */
  metadata: undefined,
};

/**
 * Message structure - mirrors Mastra's MastraMessageV1
 */
export const IMessage = {
  /** @type {string} */
  id: '',

  /** @type {string} */
  threadId: '',

  /** @type {string|undefined} */
  resourceId: undefined,

  /** @type {'system'|'user'|'assistant'|'tool'} */
  role: '',

  /** @type {string|Object} Content (string or structured) */
  content: '',

  /** @type {'text'|'tool-call'|'tool-result'} */
  type: 'text',

  /** @type {Date} */
  createdAt: null,

  /** @type {string[]|undefined} Tool call IDs if type is tool-call/tool-result */
  toolCallIds: undefined,

  /** @type {string[]|undefined} Tool names */
  toolNames: undefined,

  /** @type {Object[]|undefined} Tool call arguments */
  toolCallArgs: undefined,
};

/**
 * Memory configuration - mirrors Mastra's MemoryConfig
 */
export const IMemoryConfig = {
  /** @type {number|false} Number of recent messages to include */
  lastMessages: 10,

  /** @type {boolean|Object} Semantic recall configuration */
  semanticRecall: false,

  /** @type {Object} Working memory configuration */
  workingMemory: {
    enabled: false,
    scope: 'resource', // 'resource' | 'thread'
    template: '',
  },

  /** @type {boolean} Prevent saving new messages */
  readOnly: false,
};

/**
 * Port interface for memory systems
 * Mirrors Mastra's MastraMemory abstract class
 */
export const IMemory = {
  /** @type {string} Memory instance identifier */
  id: '',

  // ─────────────────────────────────────────────────────────
  // Thread Management
  // ─────────────────────────────────────────────────────────

  /**
   * Get thread by ID - mirrors Mastra's getThreadById()
   */
  async getThreadById({ threadId }) {},

  /**
   * List threads - mirrors Mastra's listThreads()
   */
  async listThreads(params) {},

  /**
   * Save/update thread - mirrors Mastra's saveThread()
   */
  async saveThread({ thread, memoryConfig }) {},

  /**
   * Create a new thread - mirrors Mastra's createThread()
   */
  async createThread(params) {},

  /**
   * Delete a thread
   */
  async deleteThread(threadId) {},

  // ─────────────────────────────────────────────────────────
  // Message Management
  // ─────────────────────────────────────────────────────────

  /**
   * Save messages - mirrors Mastra's saveMessages()
   */
  async saveMessages({ messages, memoryConfig }) {},

  /**
   * Recall messages - mirrors Mastra's recall()
   * Retrieves messages with optional semantic search
   */
  async recall(params) {},

  /**
   * Delete messages
   */
  async deleteMessages(messageIds) {},

  // ─────────────────────────────────────────────────────────
  // Working Memory
  // ─────────────────────────────────────────────────────────

  /**
   * Get working memory - mirrors Mastra's getWorkingMemory()
   */
  async getWorkingMemory(params) {},

  /**
   * Update working memory - mirrors Mastra's updateWorkingMemory()
   */
  async updateWorkingMemory(params) {},

  /**
   * Get working memory template
   */
  async getWorkingMemoryTemplate(params) {},
};

/**
 * Type guard for IMemory
 */
export function isMemory(obj) {
  return (
    obj &&
    typeof obj.getThreadById === 'function' &&
    typeof obj.saveMessages === 'function' &&
    typeof obj.recall === 'function'
  );
}
```

### IStructuredOutput

For typed LLM responses:

```javascript
// backend/src/3_applications/agents/ports/IStructuredOutput.mjs

/**
 * Structured output configuration
 * Mirrors Mastra's structuredOutput option for agents and steps
 */
export const IStructuredOutput = {
  /** @type {Object} JSON Schema defining the output structure */
  schema: {},

  /** @type {string|undefined} Description to help the LLM understand the format */
  description: undefined,
};

/**
 * Helper to create a structured output definition
 */
export function createStructuredOutput({ schema, description }) {
  return { schema, description };
}

/**
 * Common structured output schemas for reuse
 */
export const CommonSchemas = {
  /** Yes/No decision with reasoning */
  decision: {
    type: 'object',
    properties: {
      decision: { type: 'boolean' },
      reasoning: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['decision', 'reasoning'],
  },

  /** Classification into categories */
  classification: {
    type: 'object',
    properties: {
      category: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      alternatives: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            confidence: { type: 'number' },
          },
        },
      },
    },
    required: ['category', 'confidence'],
  },

  /** Action to take */
  action: {
    type: 'object',
    properties: {
      action: { type: 'string' },
      parameters: { type: 'object' },
      reasoning: { type: 'string' },
    },
    required: ['action'],
  },
};
```

### Extended IAgentRuntime

The existing `IAgentRuntime` extended with structured output and streaming:

```javascript
// Addition to existing IAgentRuntime

export const IAgentRuntime = {
  /**
   * Execute an agent with given input
   * @param {Object} options
   * @param {Object} options.agent - Agent instance
   * @param {string} options.input - User input
   * @param {Array} options.tools - Available tools (ITool[])
   * @param {string} options.systemPrompt - Agent instructions
   * @param {Object} [options.context] - Execution context
   * @param {Object} [options.memory] - Memory configuration
   * @param {IStructuredOutput} [options.structuredOutput] - Constrain output format
   * @returns {Promise<{output: string|Object, toolCalls: Array}>}
   */
  async execute(options) {},

  /**
   * Execute with streaming - mirrors Mastra's agent.stream()
   * @param {Object} options - Same as execute
   * @returns {AsyncIterable<{type: string, content: any}>}
   */
  async stream(options) {},

  /**
   * Execute agent in background (fire-and-forget with callback)
   */
  async executeInBackground(options, onComplete) {},
};
```

---

## Tool Factories

### Base ToolFactory

```javascript
// backend/src/3_applications/agents/tools/ToolFactory.mjs

import { createTool } from '../ports/ITool.mjs';

/**
 * Base class for creating tools from adapters
 */
export class ToolFactory {
  #adapter;
  #logger;

  constructor(adapter, { logger } = {}) {
    this.#adapter = adapter;
    this.#logger = logger || console;
  }

  get adapter() {
    return this.#adapter;
  }

  /**
   * Wrap an adapter method as a tool
   */
  wrapMethod({ name, description, parameters, method, transform }) {
    const adapter = this.#adapter;
    const logger = this.#logger;

    return createTool({
      name,
      description,
      parameters,
      async execute(params, context) {
        try {
          const result = await adapter[method](params);
          return transform ? transform(result) : result;
        } catch (error) {
          logger.error?.(`tool.${name}.error`, { error: error.message });
          return { error: error.message };
        }
      },
    });
  }

  /**
   * Get all tools this factory provides
   * Subclasses override this
   */
  getTools() {
    return [];
  }
}
```

### HomeAssistantToolFactory

```javascript
// backend/src/3_applications/agents/tools/HomeAssistantToolFactory.mjs

import { ToolFactory } from './ToolFactory.mjs';
import { createTool } from '../ports/ITool.mjs';

/**
 * Creates agent tools from HomeAssistant adapter
 * Enables: "turn on the lights", "set thermostat to 72", etc.
 */
export class HomeAssistantToolFactory extends ToolFactory {
  getTools() {
    return [
      this.#createCallServiceTool(),
      this.#createGetStateTool(),
      this.#createListEntitiesTool(),
    ];
  }

  #createCallServiceTool() {
    return createTool({
      name: 'home_call_service',
      description: 'Control a Home Assistant device (turn on/off lights, set thermostat, lock doors, etc.)',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description: 'HA domain (light, switch, climate, lock, cover, etc.)',
          },
          service: {
            type: 'string',
            description: 'Service to call (turn_on, turn_off, toggle, set_temperature, etc.)',
          },
          entity_id: {
            type: 'string',
            description: 'Entity ID (e.g., light.living_room, climate.thermostat)',
          },
          data: {
            type: 'object',
            description: 'Optional service data (brightness, temperature, etc.)',
          },
        },
        required: ['domain', 'service', 'entity_id'],
      },
      execute: async (params, context) => {
        const { domain, service, entity_id, data } = params;
        try {
          await this.adapter.callService(domain, service, { entity_id, ...data });
          return { success: true, message: `Called ${domain}.${service} on ${entity_id}` };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    });
  }

  #createGetStateTool() {
    return createTool({
      name: 'home_get_state',
      description: 'Get the current state of a Home Assistant entity',
      parameters: {
        type: 'object',
        properties: {
          entity_id: {
            type: 'string',
            description: 'Entity ID to query',
          },
        },
        required: ['entity_id'],
      },
      execute: async (params, context) => {
        const state = await this.adapter.getState(params.entity_id);
        if (!state) return { error: `Entity ${params.entity_id} not found` };
        return {
          entity_id: state.entity_id,
          state: state.state,
          attributes: state.attributes,
          last_changed: state.last_changed,
        };
      },
    });
  }

  #createListEntitiesTool() {
    return createTool({
      name: 'home_list_entities',
      description: 'List available Home Assistant entities, optionally filtered by domain',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Filter by domain' },
          area: { type: 'string', description: 'Filter by area/room name' },
        },
      },
      execute: async (params, context) => {
        const entities = await this.adapter.listEntities(params);
        return {
          count: entities.length,
          entities: entities.slice(0, 50).map(e => ({
            entity_id: e.entity_id,
            name: e.attributes?.friendly_name || e.entity_id,
            state: e.state,
          })),
        };
      },
    });
  }
}
```

### PlexToolFactory (for MediaCurator)

```javascript
// backend/src/3_applications/agents/tools/PlexToolFactory.mjs

import { ToolFactory } from './ToolFactory.mjs';
import { createTool } from '../ports/ITool.mjs';

/**
 * Creates agent tools from Plex adapter
 * Focused on library curation: collections, deduplication, metadata management
 */
export class PlexToolFactory extends ToolFactory {
  getTools() {
    return [
      this.#createSearchTool(),
      this.#createGetItemTool(),
      this.#createListContainerTool(),
      this.#createCollectionTool(),
      this.#createFindDuplicatesTool(),
      this.#createBulkLabelTool(),
      this.#createLibraryAnalysisTool(),
    ];
  }

  #createSearchTool() {
    return createTool({
      name: 'plex_search',
      description: 'Search for media in Plex',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text' },
          mediaType: { type: 'string', enum: ['video', 'audio'] },
          limit: { type: 'number', default: 10 },
        },
        required: ['query'],
      },
      execute: async (params, context) => {
        const result = await this.adapter.search({
          text: params.query,
          mediaType: params.mediaType,
          take: params.limit || 10,
        });
        return {
          count: result.items.length,
          items: result.items.map(item => ({
            id: item.id,
            title: item.title,
            type: item.metadata?.type,
            year: item.metadata?.year,
          })),
        };
      },
    });
  }

  #createGetItemTool() {
    return createTool({
      name: 'plex_get_item',
      description: 'Get detailed information about a Plex item',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Plex item ID' },
        },
        required: ['id'],
      },
      execute: async (params, context) => {
        const item = await this.adapter.getItem(params.id);
        if (!item) return { error: `Item ${params.id} not found` };
        return {
          id: item.id,
          title: item.title,
          type: item.metadata?.type,
          summary: item.metadata?.summary,
          duration: item.duration,
        };
      },
    });
  }

  #createListContainerTool() {
    return createTool({
      name: 'plex_list_contents',
      description: 'List contents of a Plex container',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Container ID' },
          limit: { type: 'number', default: 20 },
        },
        required: ['id'],
      },
      execute: async (params, context) => {
        const items = await this.adapter.getList(params.id);
        const limited = items.slice(0, params.limit || 20);
        return {
          count: items.length,
          showing: limited.length,
          items: limited.map(item => ({
            id: item.id,
            title: item.title,
            type: item.metadata?.type || item.itemType,
          })),
        };
      },
    });
  }

  #createCollectionTool() {
    return createTool({
      name: 'plex_create_collection',
      description: 'Create or update a Plex collection based on criteria',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Collection name' },
          librarySection: { type: 'string' },
          criteria: {
            type: 'object',
            properties: {
              genres: { type: 'array', items: { type: 'string' } },
              years: { type: 'object', properties: { from: { type: 'number' }, to: { type: 'number' } } },
              actors: { type: 'array', items: { type: 'string' } },
              directors: { type: 'array', items: { type: 'string' } },
              ratingMin: { type: 'number' },
              labels: { type: 'array', items: { type: 'string' } },
            },
          },
          mode: { type: 'string', enum: ['create', 'update', 'replace'], default: 'create' },
        },
        required: ['name', 'librarySection', 'criteria'],
      },
      execute: async (params, context) => {
        // Implementation would query Plex and create collection
        return {
          collection: params.name,
          matchCount: 0, // Would be actual count
          action: params.mode,
          ready: true,
        };
      },
    });
  }

  #createFindDuplicatesTool() {
    return createTool({
      name: 'plex_find_duplicates',
      description: 'Find duplicate items in library',
      parameters: {
        type: 'object',
        properties: {
          librarySection: { type: 'string' },
          type: { type: 'string', enum: ['artist', 'album', 'track', 'movie', 'show'] },
          matchStrategy: { type: 'string', enum: ['exact', 'fuzzy', 'normalized'], default: 'normalized' },
          threshold: { type: 'number', minimum: 0, maximum: 1, default: 0.85 },
        },
        required: ['librarySection', 'type'],
      },
      execute: async (params, context) => {
        // Implementation would scan for duplicates
        return { duplicateGroups: [], totalGroups: 0, totalDuplicates: 0 };
      },
    });
  }

  #createBulkLabelTool() {
    return createTool({
      name: 'plex_bulk_label',
      description: 'Add or remove labels from multiple items',
      parameters: {
        type: 'object',
        properties: {
          librarySection: { type: 'string' },
          criteria: { type: 'object' },
          addLabels: { type: 'array', items: { type: 'string' } },
          removeLabels: { type: 'array', items: { type: 'string' } },
          dryRun: { type: 'boolean', default: true },
        },
        required: ['librarySection', 'criteria'],
      },
      execute: async (params, context) => {
        return {
          dryRun: params.dryRun,
          itemCount: 0,
          addLabels: params.addLabels || [],
          removeLabels: params.removeLabels || [],
        };
      },
    });
  }

  #createLibraryAnalysisTool() {
    return createTool({
      name: 'plex_analyze_library',
      description: 'Analyze library for insights and recommendations',
      parameters: {
        type: 'object',
        properties: {
          librarySection: { type: 'string' },
          analysis: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['genre_distribution', 'year_distribution', 'most_played', 'never_played', 'incomplete_series'],
            },
          },
        },
        required: ['librarySection', 'analysis'],
      },
      execute: async (params, context) => {
        return { library: params.librarySection, analysis: {} };
      },
    });
  }
}
```

### ConfigToolFactory

```javascript
// backend/src/3_applications/agents/tools/ConfigToolFactory.mjs

import { ToolFactory } from './ToolFactory.mjs';
import { createTool } from '../ports/ITool.mjs';

/**
 * Creates agent tools for configuration management
 * Used by Config Copilot for onboarding and setup wizards
 */
export class ConfigToolFactory extends ToolFactory {
  #configService;
  #configWriter;

  constructor({ configService, configWriter, logger }) {
    super(configService, { logger });
    this.#configService = configService;
    this.#configWriter = configWriter;
  }

  getTools() {
    return [
      this.#createGetConfigTool(),
      this.#createListHouseholdsTool(),
      this.#createGetHouseholdTool(),
      this.#createUpdateHouseholdTool(),
      this.#createListUsersTool(),
      this.#createGetUserTool(),
      this.#createUpdateUserTool(),
      this.#createListIntegrationsTool(),
      this.#createUpdateIntegrationTool(),
      this.#createValidateConfigTool(),
    ];
  }

  #createGetConfigTool() {
    return createTool({
      name: 'config_get_system',
      description: 'Get system-level configuration',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', enum: ['system', 'services', 'adapters', 'bots'] },
        },
      },
      execute: async (params, context) => {
        const config = this.#configService.getSafeConfig();
        return params.section ? (config[params.section] || {}) : config;
      },
    });
  }

  #createListHouseholdsTool() {
    return createTool({
      name: 'config_list_households',
      description: 'List all configured households',
      parameters: { type: 'object', properties: {} },
      execute: async (params, context) => {
        const households = this.#configService.getAllHouseholds();
        return {
          count: households.length,
          households: households.map(h => ({ id: h.id, name: h.name || h.id })),
        };
      },
    });
  }

  #createGetHouseholdTool() {
    return createTool({
      name: 'config_get_household',
      description: 'Get household configuration',
      parameters: {
        type: 'object',
        properties: {
          householdId: { type: 'string', default: 'default' },
        },
      },
      execute: async (params, context) => {
        const household = this.#configService.getHousehold(params.householdId || 'default');
        if (!household) return { error: 'Household not found' };
        return {
          id: params.householdId,
          name: household.name,
          integrations: Object.keys(household.integrations || {}),
        };
      },
    });
  }

  #createUpdateHouseholdTool() {
    return createTool({
      name: 'config_update_household',
      description: 'Update household configuration',
      parameters: {
        type: 'object',
        properties: {
          householdId: { type: 'string', default: 'default' },
          name: { type: 'string' },
          metadata: { type: 'object' },
        },
        required: ['householdId'],
      },
      execute: async (params, context) => {
        const { householdId, ...updates } = params;
        await this.#configWriter.updateHousehold(householdId, updates);
        return { success: true, householdId, updated: Object.keys(updates) };
      },
    });
  }

  #createListUsersTool() {
    return createTool({
      name: 'config_list_users',
      description: 'List all configured users',
      parameters: { type: 'object', properties: {} },
      execute: async (params, context) => {
        const users = this.#configService.getAllUsers();
        return { count: users.length, users: users.map(u => ({ id: u.id, name: u.name || u.id })) };
      },
    });
  }

  #createGetUserTool() {
    return createTool({
      name: 'config_get_user',
      description: 'Get user configuration',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
      },
      execute: async (params, context) => {
        const user = this.#configService.getUser(params.userId);
        if (!user) return { error: 'User not found' };
        return { id: params.userId, name: user.name, identities: Object.keys(user.identities || {}) };
      },
    });
  }

  #createUpdateUserTool() {
    return createTool({
      name: 'config_update_user',
      description: 'Update user configuration',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          name: { type: 'string' },
          identities: { type: 'object' },
          roles: { type: 'array', items: { type: 'string' } },
        },
        required: ['userId'],
      },
      execute: async (params, context) => {
        const { userId, ...updates } = params;
        await this.#configWriter.updateUser(userId, updates);
        return { success: true, userId };
      },
    });
  }

  #createListIntegrationsTool() {
    return createTool({
      name: 'config_list_integrations',
      description: 'List configured integrations for a household',
      parameters: {
        type: 'object',
        properties: { householdId: { type: 'string', default: 'default' } },
      },
      execute: async (params, context) => {
        const integrations = this.#configService.getHouseholdIntegrations(params.householdId || 'default');
        return {
          integrations: Object.entries(integrations || {}).map(([key, val]) => ({
            name: key,
            configured: !!val,
          })),
        };
      },
    });
  }

  #createUpdateIntegrationTool() {
    return createTool({
      name: 'config_update_integration',
      description: 'Configure an integration',
      parameters: {
        type: 'object',
        properties: {
          householdId: { type: 'string', default: 'default' },
          integration: { type: 'string' },
          config: { type: 'object' },
        },
        required: ['integration', 'config'],
      },
      execute: async (params, context) => {
        await this.#configWriter.updateIntegration(
          params.householdId || 'default',
          params.integration,
          params.config
        );
        return { success: true, integration: params.integration };
      },
    });
  }

  #createValidateConfigTool() {
    return createTool({
      name: 'config_validate',
      description: 'Validate configuration and check for issues',
      parameters: {
        type: 'object',
        properties: { householdId: { type: 'string', default: 'default' } },
      },
      execute: async (params, context) => {
        const issues = [];
        const hid = params.householdId || 'default';
        const household = this.#configService.getHousehold(hid);

        if (!household) {
          issues.push({ severity: 'error', message: `Household ${hid} not found` });
          return { valid: false, issues };
        }

        const integrations = this.#configService.getHouseholdIntegrations(hid);
        if (!integrations || Object.keys(integrations).length === 0) {
          issues.push({ severity: 'warning', message: 'No integrations configured' });
        }

        return { valid: !issues.some(i => i.severity === 'error'), issues };
      },
    });
  }
}
```

### LifeplanToolFactory

```javascript
// backend/src/3_applications/agents/tools/LifeplanToolFactory.mjs

import { ToolFactory } from './ToolFactory.mjs';
import { createTool } from '../ports/ITool.mjs';

/**
 * Creates agent tools for Lifeplan domain (JOP framework)
 */
export class LifeplanToolFactory extends ToolFactory {
  #lifeplanService;

  constructor({ lifeplanService, logger }) {
    super(lifeplanService, { logger });
    this.#lifeplanService = lifeplanService;
  }

  getTools() {
    return [
      this.#createGetPurposeTool(),
      this.#createSetPurposeTool(),
      this.#createGetValuesTool(),
      this.#createSetValuesTool(),
      this.#createRankValuesTool(),
      this.#createGetBeliefsTool(),
      this.#createAddBeliefTool(),
      this.#createGetGoalsTool(),
      this.#createAddGoalTool(),
      this.#createTransitionGoalTool(),
      this.#createGetQualitiesTool(),
      this.#createAddQualityTool(),
    ];
  }

  #createGetPurposeTool() {
    return createTool({
      name: 'lifeplan_get_purpose',
      description: "Get the user's life purpose statement",
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
      },
      execute: async (params, context) => {
        const plan = await this.#lifeplanService.getPlan(params.userId);
        return { purpose: plan?.purpose || null, hasPurpose: !!plan?.purpose?.statement };
      },
    });
  }

  #createSetPurposeTool() {
    return createTool({
      name: 'lifeplan_set_purpose',
      description: "Set the user's life purpose statement",
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          statement: { type: 'string' },
          groundedIn: { type: 'array', items: { type: 'string' } },
        },
        required: ['userId', 'statement'],
      },
      execute: async (params, context) => {
        await this.#lifeplanService.setPurpose(params.userId, {
          statement: params.statement,
          groundedIn: params.groundedIn,
        });
        return { success: true };
      },
    });
  }

  #createGetValuesTool() {
    return createTool({
      name: 'lifeplan_get_values',
      description: "Get the user's ranked values",
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
      },
      execute: async (params, context) => {
        const plan = await this.#lifeplanService.getPlan(params.userId);
        return { values: plan?.values || [], count: plan?.values?.length || 0 };
      },
    });
  }

  #createSetValuesTool() {
    return createTool({
      name: 'lifeplan_set_values',
      description: "Set the user's values",
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          values: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['id', 'name'],
            },
          },
        },
        required: ['userId', 'values'],
      },
      execute: async (params, context) => {
        await this.#lifeplanService.setValues(params.userId, params.values);
        return { success: true, count: params.values.length };
      },
    });
  }

  #createRankValuesTool() {
    return createTool({
      name: 'lifeplan_rank_values',
      description: 'Set the priority ranking of values',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          ranking: { type: 'array', items: { type: 'string' } },
        },
        required: ['userId', 'ranking'],
      },
      execute: async (params, context) => {
        await this.#lifeplanService.rankValues(params.userId, params.ranking);
        return { success: true };
      },
    });
  }

  #createGetBeliefsTool() {
    return createTool({
      name: 'lifeplan_get_beliefs',
      description: "Get the user's beliefs",
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          state: { type: 'string', enum: ['hypothesized', 'testing', 'confirmed', 'uncertain', 'refuted'] },
        },
        required: ['userId'],
      },
      execute: async (params, context) => {
        const plan = await this.#lifeplanService.getPlan(params.userId);
        let beliefs = plan?.beliefs || [];
        if (params.state) beliefs = beliefs.filter(b => b.state === params.state);
        return { beliefs, count: beliefs.length };
      },
    });
  }

  #createAddBeliefTool() {
    return createTool({
      name: 'lifeplan_add_belief',
      description: 'Add a new belief (if/then hypothesis)',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          id: { type: 'string' },
          if: { type: 'string' },
          then: { type: 'string' },
          foundational: { type: 'boolean', default: false },
        },
        required: ['userId', 'id', 'if', 'then'],
      },
      execute: async (params, context) => {
        const { userId, ...belief } = params;
        await this.#lifeplanService.addBelief(userId, { ...belief, state: 'hypothesized', confidence: 0.5 });
        return { success: true, beliefId: params.id };
      },
    });
  }

  #createGetGoalsTool() {
    return createTool({
      name: 'lifeplan_get_goals',
      description: "Get the user's goals",
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          state: { type: 'string', enum: ['dream', 'considered', 'ready', 'committed', 'paused', 'achieved', 'failed', 'abandoned'] },
        },
        required: ['userId'],
      },
      execute: async (params, context) => {
        const plan = await this.#lifeplanService.getPlan(params.userId);
        let goals = plan?.goals || [];
        if (params.state) goals = goals.filter(g => g.state === params.state);
        return { goals, count: goals.length };
      },
    });
  }

  #createAddGoalTool() {
    return createTool({
      name: 'lifeplan_add_goal',
      description: 'Add a new goal',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          id: { type: 'string' },
          name: { type: 'string' },
          quality: { type: 'string' },
          why: { type: 'string' },
          state: { type: 'string', enum: ['dream', 'considered'], default: 'dream' },
          deadline: { type: 'string' },
          metrics: { type: 'array', items: { type: 'string' } },
        },
        required: ['userId', 'id', 'name'],
      },
      execute: async (params, context) => {
        const { userId, ...goal } = params;
        await this.#lifeplanService.addGoal(userId, goal);
        return { success: true, goalId: params.id };
      },
    });
  }

  #createTransitionGoalTool() {
    return createTool({
      name: 'lifeplan_transition_goal',
      description: 'Transition a goal to a new state',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          goalId: { type: 'string' },
          newState: { type: 'string', enum: ['dream', 'considered', 'ready', 'committed', 'paused', 'achieved', 'failed', 'abandoned'] },
          reason: { type: 'string' },
        },
        required: ['userId', 'goalId', 'newState'],
      },
      execute: async (params, context) => {
        const result = await this.#lifeplanService.transitionGoal(params.userId, params.goalId, params.newState, params.reason);
        return { success: true, previousState: result.previousState };
      },
    });
  }

  #createGetQualitiesTool() {
    return createTool({
      name: 'lifeplan_get_qualities',
      description: "Get the user's qualities",
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
      },
      execute: async (params, context) => {
        const plan = await this.#lifeplanService.getPlan(params.userId);
        return { qualities: plan?.qualities || [], count: plan?.qualities?.length || 0 };
      },
    });
  }

  #createAddQualityTool() {
    return createTool({
      name: 'lifeplan_add_quality',
      description: 'Add a quality to cultivate',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          shadow: {
            type: 'object',
            properties: { name: { type: 'string' }, description: { type: 'string' } },
          },
        },
        required: ['userId', 'id', 'name'],
      },
      execute: async (params, context) => {
        const { userId, ...quality } = params;
        await this.#lifeplanService.addQuality(userId, quality);
        return { success: true, qualityId: params.id };
      },
    });
  }
}
```

---

## Agent Definitions

### BaseAgent

```javascript
// backend/src/3_applications/agents/BaseAgent.mjs

/**
 * Base class for agent definitions
 */
export class BaseAgent {
  static id = 'base';
  static description = 'Base agent';
  static toolFactories = [];

  #deps;
  #tools;

  constructor(deps = {}) {
    this.#deps = deps;
    this.#tools = null;
  }

  get deps() {
    return this.#deps;
  }

  getTools() {
    if (!this.#tools) {
      this.#tools = [];
      const factories = this.#deps.toolFactories || {};

      for (const factoryName of this.constructor.toolFactories) {
        const factory = factories[factoryName];
        if (factory) this.#tools.push(...factory.getTools());
      }

      this.#tools.push(...this.getAgentSpecificTools());
    }
    return this.#tools;
  }

  getAgentSpecificTools() {
    return [];
  }

  getSystemPrompt(context = {}) {
    throw new Error('Subclass must implement getSystemPrompt()');
  }

  getMemoryConfig() {
    return null;
  }

  getStructuredOutput() {
    return null;
  }
}
```

### Agent Summary

| Agent | ID | Tool Factories | Purpose |
|-------|-----|----------------|---------|
| **ConfigCopilotAgent** | `config-copilot` | `config` | Onboarding wizard, integration setup, validation |
| **LifeplanCoachAgent** | `lifeplan-coach` | `lifeplan` | JOP framework coaching, values discovery, goal setting |
| **HomeControllerAgent** | `home-controller` | `homeassistant` | Voice-style home automation commands |
| **MediaCuratorAgent** | `media-curator` | `plex` | Library curation, collections, deduplication |
| **TalosAgent** | `talos` | `plex`, `homeassistant` | Policy-gated assistant for constrained devices |

---

## UI Copilot Architecture

### The Pattern: Agent as UI Collaborator

For agents that interact with configuration UIs (like ConfigCopilotAgent), the agent sends structured commands to the UI rather than writing directly to YAML:

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER                                  │
│                                                                  │
│  ┌──────────────┐    commands     ┌──────────────────────────┐  │
│  │   Copilot    │ ──────────────► │   Form State             │  │
│  │   Chat       │ ◄────────────── │   (with undo stack)      │  │
│  └──────────────┘   current state └────────────┬─────────────┘  │
│         │                                      │                 │
│         │ WebSocket                            │ Save            │
└─────────┼──────────────────────────────────────┼─────────────────┘
          ▼                                      ▼
   Agent Runtime                           Config API
   (generates commands)                    (writes YAML)
```

### Why This Approach

| Concern | Direct YAML Write | UI Collaborator |
|---------|-------------------|-----------------|
| Undo | Complex (file versioning) | Trivial (state stack) |
| Preview | Requires diff UI | Native (it's the form) |
| Conflicts | Possible | Impossible |
| Validation | After save | Before save |
| User control | Feels automated | Feels assisted |

### Command Types

```javascript
const UICommands = {
  SET_FIELD: 'set_field',       // Set single field
  SET_FIELDS: 'set_fields',     // Set multiple fields atomically
  CLEAR_FIELD: 'clear_field',   // Clear a field
  NAVIGATE: 'navigate',         // Go to route/section
  SHOW_MESSAGE: 'show_message', // Display notification
  REQUEST_CONFIRM: 'request_confirmation', // Pause for approval
  HIGHLIGHT: 'highlight_field', // Draw attention
  VALIDATE: 'validate',         // Trigger validation
};
```

### Structured Output for UI Commands

```javascript
// ConfigCopilotAgent.getStructuredOutput()
{
  schema: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      commands: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: Object.values(UICommands) },
            path: { type: 'string' },
            value: {},
            to: { type: 'string' },
            text: { type: 'string' },
          },
        },
      },
      needsConfirmation: { type: 'boolean' },
    },
    required: ['message'],
  },
}
```

### Frontend Hooks

```javascript
// frontend/src/hooks/useUndoStack.js
export function useUndoStack(initialState) {
  const [state, setState] = useState(initialState);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const pushState = useCallback((newState) => {
    setUndoStack(prev => [...prev, state]);
    setRedoStack([]);
    setState(newState);
  }, [state]);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    setRedoStack(s => [...s, state]);
    setState(undoStack[undoStack.length - 1]);
    setUndoStack(s => s.slice(0, -1));
  }, [undoStack, state]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    setUndoStack(s => [...s, state]);
    setState(redoStack[redoStack.length - 1]);
    setRedoStack(s => s.slice(0, -1));
  }, [redoStack, state]);

  return { state, pushState, undo, redo, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
}

// frontend/src/hooks/useCopilotCommands.js
export function useCopilotCommands({ formState, setFormState, undoStack }) {
  const executeCommand = useCallback((command) => {
    switch (command.action) {
      case 'set_field':
        undoStack.push(formState);
        setFormState(prev => setPath(prev, command.path, command.value));
        break;
      case 'set_fields':
        undoStack.push(formState);
        setFormState(prev => {
          let next = { ...prev };
          for (const [path, value] of Object.entries(command.fields)) {
            next = setPath(next, path, value);
          }
          return next;
        });
        break;
      case 'navigate':
        navigate(command.to);
        break;
      case 'show_message':
        notifications.show({ message: command.text });
        break;
    }
  }, [formState, setFormState, undoStack]);

  return { executeCommand };
}
```

---

## Domain Architecture

### Layer Mapping

```
backend/src/
├── 0_system/
│   └── bootstrap.mjs                    # Agent registration
│
├── 3_applications/
│   └── agents/
│       ├── ports/
│       │   ├── IAgentRuntime.mjs        # Existing
│       │   ├── ITool.mjs                # Existing
│       │   ├── IStep.mjs                # New
│       │   ├── IWorkflow.mjs            # New
│       │   ├── IWorkflowRuntime.mjs     # New
│       │   ├── IMemory.mjs              # New (replaces IMemoryDatastore)
│       │   ├── IStructuredOutput.mjs    # New
│       │   └── index.mjs
│       │
│       ├── tools/
│       │   ├── ToolFactory.mjs          # Base class
│       │   ├── HomeAssistantToolFactory.mjs
│       │   ├── PlexToolFactory.mjs
│       │   ├── ConfigToolFactory.mjs
│       │   ├── LifeplanToolFactory.mjs
│       │   └── index.mjs
│       │
│       ├── BaseAgent.mjs                # Base class
│       │
│       ├── config-copilot/
│       │   ├── ConfigCopilotAgent.mjs
│       │   └── prompts/system.mjs
│       │
│       ├── lifeplan-coach/
│       │   ├── LifeplanCoachAgent.mjs
│       │   └── prompts/system.mjs
│       │
│       ├── home-controller/
│       │   ├── HomeControllerAgent.mjs
│       │   └── prompts/system.mjs
│       │
│       ├── media-curator/
│       │   ├── MediaCuratorAgent.mjs
│       │   └── prompts/system.mjs
│       │
│       ├── talos/
│       │   ├── TalosAgent.mjs
│       │   └── prompts/system.mjs
│       │
│       ├── AgentOrchestrator.mjs        # Existing
│       └── index.mjs
│
├── 1_adapters/
│   └── agents/
│       ├── MastraAdapter.mjs            # Existing
│       ├── MastraWorkflowAdapter.mjs    # New
│       └── MastraMemoryAdapter.mjs      # New
│
└── 4_api/
    └── v1/
        ├── routers/agents.mjs           # Existing
        └── ws/copilot.mjs               # New WebSocket endpoint
```

---

## Implementation Phases

### Phase 1: Port Interfaces

- [ ] Create IStep, IWorkflow, IWorkflowRuntime
- [ ] Create IMemory (replace IMemoryDatastore)
- [ ] Create IStructuredOutput
- [ ] Extend IAgentRuntime with streaming and structured output

### Phase 2: Tool Factories

- [ ] Create ToolFactory base class
- [ ] Implement HomeAssistantToolFactory
- [ ] Implement PlexToolFactory
- [ ] Implement ConfigToolFactory
- [ ] Implement LifeplanToolFactory

### Phase 3: Agent Definitions

- [ ] Create BaseAgent class
- [ ] Implement HomeControllerAgent (simplest)
- [ ] Implement MediaCuratorAgent
- [ ] Implement ConfigCopilotAgent
- [ ] Implement LifeplanCoachAgent
- [ ] Implement TalosAgent

### Phase 4: Mastra Adapters

- [ ] Extend MastraAdapter for structured output
- [ ] Create MastraWorkflowAdapter
- [ ] Create MastraMemoryAdapter

### Phase 5: UI Integration

- [ ] Create useUndoStack hook
- [ ] Create useCopilotCommands hook
- [ ] Create useCopilotSocket hook
- [ ] Create CopilotPanel component
- [ ] Integrate with AdminApp

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-02 | Initial design from brainstorming session |
