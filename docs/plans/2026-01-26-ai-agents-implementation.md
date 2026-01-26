# AI Agents Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the AI agents infrastructure following the architecture design in `docs/plans/2026-01-26-ai-agents-architecture-design.md`.

**Architecture:** Agents live in `3_applications/agents/` with port interfaces for framework abstraction. MastraAdapter in `2_adapters/` wraps the Mastra SDK. AgentOrchestrator provides central invocation. A sample "echo" agent demonstrates the pattern.

**Tech Stack:** Mastra (`@mastra/core`), Zod (for tool schemas), existing DDD patterns

---

## Task 1: Install Mastra Dependencies

**Files:**
- Modify: `backend/package.json`

**Step 1: Install Mastra core package**

```bash
cd /root/Code/DaylightStation/.worktrees/feature-ai-agents/backend
npm install @mastra/core zod
```

**Step 2: Verify installation**

```bash
npm ls @mastra/core
```

Expected: Shows `@mastra/core` in dependency tree

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(agents): add mastra and zod dependencies"
```

---

## Task 2: Create Port Interfaces

**Files:**
- Create: `backend/src/3_applications/agents/ports/IAgentRuntime.mjs`
- Create: `backend/src/3_applications/agents/ports/ITool.mjs`
- Create: `backend/src/3_applications/agents/ports/IMemoryStore.mjs`
- Create: `backend/src/3_applications/agents/ports/index.mjs`

**Step 1: Create agents directory structure**

```bash
mkdir -p backend/src/3_applications/agents/ports
```

**Step 2: Write IAgentRuntime.mjs**

```javascript
// backend/src/3_applications/agents/ports/IAgentRuntime.mjs

/**
 * Port interface for agent execution runtime (framework-agnostic)
 * @interface IAgentRuntime
 */
export const IAgentRuntime = {
  /**
   * Execute an agent with given input
   * @param {Object} options
   * @param {Object} options.agent - Agent instance
   * @param {string} options.input - User input / task description
   * @param {Array} options.tools - Available tools (ITool[])
   * @param {string} options.systemPrompt - Agent persona/instructions
   * @param {Object} [options.context] - Execution context (userId, etc.)
   * @param {Object} [options.memory] - Conversation memory (optional)
   * @returns {Promise<{output: string, toolCalls: Array}>}
   */
  async execute(options) {},

  /**
   * Execute agent in background (fire-and-forget with callback)
   * @param {Object} options - Same as execute
   * @param {Function} [onComplete] - Called when done with result or error
   * @returns {Promise<{taskId: string}>}
   */
  async executeInBackground(options, onComplete) {},
};

/**
 * Type guard for IAgentRuntime
 * @param {any} obj
 * @returns {boolean}
 */
export function isAgentRuntime(obj) {
  return (
    obj &&
    typeof obj.execute === 'function' &&
    typeof obj.executeInBackground === 'function'
  );
}
```

**Step 3: Write ITool.mjs**

```javascript
// backend/src/3_applications/agents/ports/ITool.mjs

/**
 * Port interface for agent tools (framework-agnostic)
 * @interface ITool
 *
 * Tools define capabilities that agents can use.
 * The parameters property uses JSON Schema format.
 */
export const ITool = {
  /** @type {string} Unique identifier for the tool */
  name: '',

  /** @type {string} Description of what the tool does (for AI to understand) */
  description: '',

  /** @type {Object} JSON Schema for input parameters */
  parameters: {},

  /**
   * Execute the tool
   * @param {Object} params - Validated parameters matching the schema
   * @param {Object} context - Execution context (userId, householdId, etc.)
   * @returns {Promise<any>} Tool result
   */
  async execute(params, context) {},
};

/**
 * Type guard for ITool
 * @param {any} obj
 * @returns {boolean}
 */
export function isTool(obj) {
  return (
    obj &&
    typeof obj.name === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.execute === 'function'
  );
}

/**
 * Helper to create a tool definition
 * @param {Object} config
 * @param {string} config.name
 * @param {string} config.description
 * @param {Object} config.parameters - JSON Schema
 * @param {Function} config.execute
 * @returns {ITool}
 */
export function createTool({ name, description, parameters, execute }) {
  return {
    name,
    description,
    parameters: parameters || { type: 'object', properties: {} },
    execute,
  };
}
```

**Step 4: Write IMemoryStore.mjs**

```javascript
// backend/src/3_applications/agents/ports/IMemoryStore.mjs

/**
 * Port interface for agent conversation memory (framework-agnostic)
 * @interface IMemoryStore
 */
export const IMemoryStore = {
  /**
   * Get conversation history for an agent
   * @param {string} agentId - Agent identifier
   * @param {string} conversationId - Conversation/session identifier
   * @returns {Promise<Array<{role: string, content: string}>>}
   */
  async getConversation(agentId, conversationId) {},

  /**
   * Save a message to conversation history
   * @param {string} agentId
   * @param {string} conversationId
   * @param {Object} message - {role: 'user'|'assistant', content: string}
   * @returns {Promise<void>}
   */
  async saveMessage(agentId, conversationId, message) {},

  /**
   * Clear conversation history
   * @param {string} agentId
   * @param {string} conversationId
   * @returns {Promise<void>}
   */
  async clearConversation(agentId, conversationId) {},
};

/**
 * Type guard for IMemoryStore
 * @param {any} obj
 * @returns {boolean}
 */
export function isMemoryStore(obj) {
  return (
    obj &&
    typeof obj.getConversation === 'function' &&
    typeof obj.saveMessage === 'function' &&
    typeof obj.clearConversation === 'function'
  );
}
```

**Step 5: Write ports index.mjs**

```javascript
// backend/src/3_applications/agents/ports/index.mjs

export { IAgentRuntime, isAgentRuntime } from './IAgentRuntime.mjs';
export { ITool, isTool, createTool } from './ITool.mjs';
export { IMemoryStore, isMemoryStore } from './IMemoryStore.mjs';
```

**Step 6: Run linter to check syntax**

```bash
cd /root/Code/DaylightStation/.worktrees/feature-ai-agents
node --check backend/src/3_applications/agents/ports/index.mjs
```

Expected: No syntax errors

**Step 7: Commit**

```bash
git add backend/src/3_applications/agents/ports/
git commit -m "feat(agents): add port interfaces for agent runtime, tools, and memory"
```

---

## Task 3: Create MastraAdapter

**Files:**
- Create: `backend/src/2_adapters/agents/MastraAdapter.mjs`
- Create: `backend/src/2_adapters/agents/index.mjs`

**Step 1: Create agents adapter directory**

```bash
mkdir -p backend/src/2_adapters/agents
```

**Step 2: Write MastraAdapter.mjs**

```javascript
// backend/src/2_adapters/agents/MastraAdapter.mjs

/**
 * MastraAdapter - Implements IAgentRuntime using Mastra framework
 *
 * This is the ONLY file that imports the Mastra SDK.
 * All agent definitions use the abstract IAgentRuntime interface.
 */

import { Agent } from '@mastra/core/agent';
import { createTool as mastraCreateTool } from '@mastra/core/tools';
import { z } from 'zod';
import crypto from 'crypto';

/**
 * Convert JSON Schema to Zod schema (simplified)
 * @param {Object} jsonSchema
 * @returns {z.ZodType}
 */
function jsonSchemaToZod(jsonSchema) {
  if (!jsonSchema || jsonSchema.type !== 'object') {
    return z.object({});
  }

  const shape = {};
  const properties = jsonSchema.properties || {};
  const required = jsonSchema.required || [];

  for (const [key, prop] of Object.entries(properties)) {
    let zodType;

    switch (prop.type) {
      case 'string':
        zodType = z.string();
        if (prop.description) zodType = zodType.describe(prop.description);
        break;
      case 'number':
      case 'integer':
        zodType = z.number();
        if (prop.description) zodType = zodType.describe(prop.description);
        break;
      case 'boolean':
        zodType = z.boolean();
        if (prop.description) zodType = zodType.describe(prop.description);
        break;
      case 'array':
        zodType = z.array(z.any());
        if (prop.description) zodType = zodType.describe(prop.description);
        break;
      default:
        zodType = z.any();
    }

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  return z.object(shape);
}

export class MastraAdapter {
  #model;
  #logger;

  /**
   * @param {Object} deps
   * @param {string} [deps.model='openai:gpt-4o'] - Model identifier (provider:model format)
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(deps = {}) {
    this.#model = deps.model || 'openai:gpt-4o';
    this.#logger = deps.logger || console;
  }

  /**
   * Translate ITool[] to Mastra tool format
   * @param {Array} tools - ITool instances
   * @param {Object} context - Execution context
   * @returns {Object} Mastra tools object
   */
  #translateTools(tools, context) {
    const mastraTools = {};

    for (const tool of tools) {
      mastraTools[tool.name] = mastraCreateTool({
        id: tool.name,
        description: tool.description,
        inputSchema: jsonSchemaToZod(tool.parameters),
        execute: async (inputData) => {
          try {
            const result = await tool.execute(inputData, context);
            return result;
          } catch (error) {
            this.#logger.error?.('tool.execute.error', {
              tool: tool.name,
              error: error.message,
            });
            return { error: error.message };
          }
        },
      });
    }

    return mastraTools;
  }

  /**
   * Execute an agent synchronously
   * @implements IAgentRuntime.execute
   */
  async execute({ agent, input, tools, systemPrompt, context = {} }) {
    const mastraTools = this.#translateTools(tools || [], context);

    const mastraAgent = new Agent({
      name: agent.constructor.id,
      instructions: systemPrompt,
      model: this.#model,
      tools: mastraTools,
    });

    this.#logger.info?.('agent.execute.start', {
      agentId: agent.constructor.id,
      inputLength: input?.length,
      toolCount: Object.keys(mastraTools).length,
    });

    try {
      const response = await mastraAgent.generate(input);

      this.#logger.info?.('agent.execute.complete', {
        agentId: agent.constructor.id,
        outputLength: response.text?.length,
      });

      return {
        output: response.text,
        toolCalls: response.toolCalls || [],
      };
    } catch (error) {
      this.#logger.error?.('agent.execute.error', {
        agentId: agent.constructor.id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Execute an agent in background
   * @implements IAgentRuntime.executeInBackground
   */
  async executeInBackground(options, onComplete) {
    const taskId = crypto.randomUUID();

    this.#logger.info?.('agent.background.start', {
      taskId,
      agentId: options.agent?.constructor?.id,
    });

    setImmediate(async () => {
      try {
        const result = await this.execute(options);
        this.#logger.info?.('agent.background.complete', { taskId });
        onComplete?.(result);
      } catch (error) {
        this.#logger.error?.('agent.background.error', {
          taskId,
          error: error.message,
        });
        onComplete?.({ error: error.message });
      }
    });

    return { taskId };
  }
}

export default MastraAdapter;
```

**Step 3: Write adapters index.mjs**

```javascript
// backend/src/2_adapters/agents/index.mjs

export { MastraAdapter } from './MastraAdapter.mjs';
```

**Step 4: Verify syntax**

```bash
node --check backend/src/2_adapters/agents/MastraAdapter.mjs
```

Expected: No syntax errors (import errors are OK at this stage)

**Step 5: Commit**

```bash
git add backend/src/2_adapters/agents/
git commit -m "feat(agents): add MastraAdapter implementing IAgentRuntime"
```

---

## Task 4: Create AgentOrchestrator

**Files:**
- Create: `backend/src/3_applications/agents/AgentOrchestrator.mjs`

**Step 1: Write AgentOrchestrator.mjs**

```javascript
// backend/src/3_applications/agents/AgentOrchestrator.mjs

/**
 * AgentOrchestrator - Central service for agent registration and invocation
 *
 * This is the entry point for all agent operations. API handlers, other
 * applications, and scheduled jobs use this to run agents.
 */

export class AgentOrchestrator {
  #agents = new Map();
  #agentRuntime;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.agentRuntime - IAgentRuntime implementation
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(deps) {
    if (!deps.agentRuntime) {
      throw new Error('agentRuntime is required');
    }
    this.#agentRuntime = deps.agentRuntime;
    this.#logger = deps.logger || console;
  }

  /**
   * Register an agent (called at bootstrap)
   * @param {Function} AgentClass - Agent class with static id property
   * @param {Object} dependencies - Dependencies to inject into agent
   */
  register(AgentClass, dependencies) {
    if (!AgentClass.id) {
      throw new Error('Agent class must have static id property');
    }

    const agent = new AgentClass({
      ...dependencies,
      agentRuntime: this.#agentRuntime,
      logger: this.#logger,
    });

    this.#agents.set(AgentClass.id, agent);
    this.#logger.info?.('agent.registered', { agentId: AgentClass.id });
  }

  /**
   * Run agent synchronously (wait for result)
   * @param {string} agentId - Agent identifier
   * @param {string} input - User input / task description
   * @param {Object} [context={}] - Execution context (userId, etc.)
   * @returns {Promise<{output: string, toolCalls: Array}>}
   */
  async run(agentId, input, context = {}) {
    const agent = this.#getAgent(agentId);

    this.#logger.info?.('orchestrator.run', { agentId, contextKeys: Object.keys(context) });

    return agent.run(input, { context });
  }

  /**
   * Run agent in background (returns immediately)
   * @param {string} agentId - Agent identifier
   * @param {string} input - User input / task description
   * @param {Object} [context={}] - Execution context
   * @returns {Promise<{taskId: string}>}
   */
  async runInBackground(agentId, input, context = {}) {
    const agent = this.#getAgent(agentId);

    this.#logger.info?.('orchestrator.runInBackground', { agentId });

    return this.#agentRuntime.executeInBackground(
      {
        agent,
        input,
        tools: agent.getTools(),
        systemPrompt: agent.getSystemPrompt(),
        context,
      },
      (result) => {
        this.#logger.info?.('orchestrator.background.complete', {
          agentId,
          hasError: !!result.error,
        });
      }
    );
  }

  /**
   * List available agents (for discovery/admin)
   * @returns {Array<{id: string, description: string}>}
   */
  list() {
    return Array.from(this.#agents.values()).map((agent) => ({
      id: agent.constructor.id,
      description: agent.constructor.description || '',
    }));
  }

  /**
   * Check if an agent is registered
   * @param {string} agentId
   * @returns {boolean}
   */
  has(agentId) {
    return this.#agents.has(agentId);
  }

  /**
   * Get agent instance (internal)
   * @param {string} agentId
   * @returns {Object}
   */
  #getAgent(agentId) {
    const agent = this.#agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    return agent;
  }
}

export default AgentOrchestrator;
```

**Step 2: Verify syntax**

```bash
node --check backend/src/3_applications/agents/AgentOrchestrator.mjs
```

Expected: No syntax errors

**Step 3: Commit**

```bash
git add backend/src/3_applications/agents/AgentOrchestrator.mjs
git commit -m "feat(agents): add AgentOrchestrator for central agent invocation"
```

---

## Task 5: Create Sample Echo Agent

**Files:**
- Create: `backend/src/3_applications/agents/echo/EchoAgent.mjs`
- Create: `backend/src/3_applications/agents/echo/prompts/system.mjs`
- Create: `backend/src/3_applications/agents/echo/index.mjs`

**Step 1: Create echo agent directory**

```bash
mkdir -p backend/src/3_applications/agents/echo/prompts
```

**Step 2: Write system prompt**

```javascript
// backend/src/3_applications/agents/echo/prompts/system.mjs

export const systemPrompt = `You are Echo, a simple assistant that demonstrates the agent framework.

Your capabilities:
- You can echo back messages with timestamps
- You can use the get_current_time tool to fetch the current time
- You respond concisely and helpfully

When asked to echo something, use the echo_message tool and report the result.
When asked about the time, use the get_current_time tool.

Keep responses brief and friendly.`;

export default systemPrompt;
```

**Step 3: Write EchoAgent.mjs**

```javascript
// backend/src/3_applications/agents/echo/EchoAgent.mjs

/**
 * EchoAgent - A simple demonstration agent
 *
 * This agent demonstrates the agent framework patterns:
 * - Static id and description
 * - Tool definitions via getTools()
 * - System prompt via getSystemPrompt()
 * - Dependency injection via constructor
 */

import { createTool } from '../ports/ITool.mjs';
import { systemPrompt } from './prompts/system.mjs';

export class EchoAgent {
  static id = 'echo';
  static description = 'Simple demonstration agent that echoes messages and tells time';

  #agentRuntime;
  #logger;
  #timestampFn;

  /**
   * @param {Object} deps
   * @param {Object} deps.agentRuntime - IAgentRuntime implementation
   * @param {Function} [deps.timestampFn] - Function returning current timestamp string
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(deps) {
    if (!deps.agentRuntime) {
      throw new Error('agentRuntime is required');
    }
    this.#agentRuntime = deps.agentRuntime;
    this.#timestampFn = deps.timestampFn || (() => new Date().toISOString());
    this.#logger = deps.logger || console;
  }

  /**
   * Get tools available to this agent
   * @returns {Array<ITool>}
   */
  getTools() {
    return [
      createTool({
        name: 'echo_message',
        description: 'Echo a message back with a timestamp prefix',
        parameters: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message to echo',
            },
          },
          required: ['message'],
        },
        execute: async ({ message }, context) => {
          const timestamp = this.#timestampFn();
          const echoedMessage = `[${timestamp}] Echo: ${message}`;
          this.#logger.info?.('echo.tool.executed', { message, context });
          return { echoed: echoedMessage };
        },
      }),

      createTool({
        name: 'get_current_time',
        description: 'Get the current date and time',
        parameters: {
          type: 'object',
          properties: {},
        },
        execute: async (params, context) => {
          const timestamp = this.#timestampFn();
          return { currentTime: timestamp };
        },
      }),
    ];
  }

  /**
   * Get system prompt for this agent
   * @returns {string}
   */
  getSystemPrompt() {
    return systemPrompt;
  }

  /**
   * Run the agent with given input
   * @param {string} input - User message
   * @param {Object} [options={}]
   * @param {Object} [options.context] - Execution context
   * @returns {Promise<{output: string, toolCalls: Array}>}
   */
  async run(input, options = {}) {
    return this.#agentRuntime.execute({
      agent: this,
      input,
      tools: this.getTools(),
      systemPrompt: this.getSystemPrompt(),
      context: options.context || {},
    });
  }
}

export default EchoAgent;
```

**Step 4: Write index.mjs**

```javascript
// backend/src/3_applications/agents/echo/index.mjs

export { EchoAgent } from './EchoAgent.mjs';
export { systemPrompt } from './prompts/system.mjs';
```

**Step 5: Verify syntax**

```bash
node --check backend/src/3_applications/agents/echo/index.mjs
```

Expected: No syntax errors

**Step 6: Commit**

```bash
git add backend/src/3_applications/agents/echo/
git commit -m "feat(agents): add EchoAgent as demonstration agent"
```

---

## Task 6: Create Agents Application Index

**Files:**
- Create: `backend/src/3_applications/agents/index.mjs`

**Step 1: Write index.mjs**

```javascript
// backend/src/3_applications/agents/index.mjs

// Core
export { AgentOrchestrator } from './AgentOrchestrator.mjs';

// Ports
export * from './ports/index.mjs';

// Agents
export { EchoAgent } from './echo/index.mjs';
```

**Step 2: Verify syntax**

```bash
node --check backend/src/3_applications/agents/index.mjs
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/agents/index.mjs
git commit -m "feat(agents): add agents application index"
```

---

## Task 7: Create API Router for Agents

**Files:**
- Create: `backend/src/4_api/routers/agents.mjs`

**Step 1: Write agents router**

```javascript
// backend/src/4_api/routers/agents.mjs

/**
 * Agents API Router
 *
 * Endpoints:
 * - GET  /api/agents - List available agents
 * - POST /api/agents/:agentId/run - Run an agent synchronously
 * - POST /api/agents/:agentId/run-background - Run an agent in background
 */

import express from 'express';

/**
 * Create agents API router
 *
 * @param {Object} config
 * @param {Object} config.agentOrchestrator - AgentOrchestrator instance
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAgentsRouter(config) {
  const router = express.Router();
  const { agentOrchestrator, logger = console } = config;

  if (!agentOrchestrator) {
    throw new Error('agentOrchestrator is required');
  }

  /**
   * GET /api/agents
   * List all registered agents
   */
  router.get('/', (req, res) => {
    try {
      const agents = agentOrchestrator.list();
      res.json({ agents });
    } catch (error) {
      logger.error?.('agents.list.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/agents/:agentId/run
   * Run an agent synchronously
   * Body: { input: string, context?: object }
   */
  router.post('/:agentId/run', async (req, res) => {
    const { agentId } = req.params;
    const { input, context = {} } = req.body;

    if (!input) {
      return res.status(400).json({ error: 'input is required' });
    }

    try {
      logger.info?.('agents.run.request', { agentId, inputLength: input.length });

      const result = await agentOrchestrator.run(agentId, input, context);

      res.json({
        agentId,
        output: result.output,
        toolCalls: result.toolCalls,
      });
    } catch (error) {
      logger.error?.('agents.run.error', { agentId, error: error.message });

      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }

      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/agents/:agentId/run-background
   * Run an agent in background (returns immediately)
   * Body: { input: string, context?: object }
   */
  router.post('/:agentId/run-background', async (req, res) => {
    const { agentId } = req.params;
    const { input, context = {} } = req.body;

    if (!input) {
      return res.status(400).json({ error: 'input is required' });
    }

    try {
      logger.info?.('agents.runBackground.request', { agentId });

      const { taskId } = await agentOrchestrator.runInBackground(agentId, input, context);

      res.status(202).json({
        agentId,
        taskId,
        status: 'accepted',
      });
    } catch (error) {
      logger.error?.('agents.runBackground.error', { agentId, error: error.message });

      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }

      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

export default createAgentsRouter;
```

**Step 2: Verify syntax**

```bash
node --check backend/src/4_api/routers/agents.mjs
```

**Step 3: Commit**

```bash
git add backend/src/4_api/routers/agents.mjs
git commit -m "feat(agents): add API router for agent endpoints"
```

---

## Task 8: Add Bootstrap Wiring

**Files:**
- Modify: `backend/src/0_infrastructure/bootstrap.mjs`

**Step 1: Read current bootstrap.mjs to find insertion points**

Look for:
- Import section (around line 1-100)
- Router creation section (search for `createXxxRouter`)
- Export section

**Step 2: Add imports at the top of the file (after other application imports)**

Add after line ~97 (after Homebot imports):

```javascript
// Agent application imports
import { AgentOrchestrator, EchoAgent } from '../3_applications/agents/index.mjs';
import { MastraAdapter } from '../2_adapters/agents/index.mjs';
import { createAgentsRouter } from '../4_api/routers/agents.mjs';
```

**Step 3: Find the bootstrap function and add agent wiring**

Search for where other containers are created (NutribotContainer, JournalistContainer).
Add agent bootstrap code in the same section:

```javascript
// Bootstrap agents
function bootstrapAgents(context) {
  const { logger } = context;

  // Create Mastra adapter (implements IAgentRuntime)
  const agentRuntime = new MastraAdapter({
    model: process.env.OPENAI_MODEL || 'openai:gpt-4o',
    logger,
  });

  // Create orchestrator
  const agentOrchestrator = new AgentOrchestrator({
    agentRuntime,
    logger,
  });

  // Register echo agent (demonstration)
  agentOrchestrator.register(EchoAgent, {
    agentRuntime,
    logger,
  });

  return agentOrchestrator;
}
```

**Step 4: Wire the agents router**

Find where other routers are mounted (search for `app.use('/api/`).
Add:

```javascript
// Agents API
const agentOrchestrator = bootstrapAgents({ logger });
app.use('/api/agents', createAgentsRouter({ agentOrchestrator, logger }));
```

**Step 5: Verify syntax**

```bash
node --check backend/src/0_infrastructure/bootstrap.mjs
```

**Step 6: Commit**

```bash
git add backend/src/0_infrastructure/bootstrap.mjs
git commit -m "feat(agents): wire agent infrastructure into bootstrap"
```

---

## Task 9: Add Unit Tests for AgentOrchestrator

**Files:**
- Create: `backend/tests/unit/agents/AgentOrchestrator.test.mjs`

**Step 1: Create test directory**

```bash
mkdir -p backend/tests/unit/agents
```

**Step 2: Write unit tests**

```javascript
// backend/tests/unit/agents/AgentOrchestrator.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AgentOrchestrator } from '../../../src/3_applications/agents/AgentOrchestrator.mjs';

describe('AgentOrchestrator', () => {
  let mockAgentRuntime;
  let mockLogger;

  beforeEach(() => {
    mockAgentRuntime = {
      execute: async () => ({ output: 'test output', toolCalls: [] }),
      executeInBackground: async (opts, cb) => {
        setImmediate(() => cb({ output: 'background output', toolCalls: [] }));
        return { taskId: 'test-task-id' };
      },
    };

    mockLogger = {
      info: () => {},
      error: () => {},
    };
  });

  describe('constructor', () => {
    it('should throw if agentRuntime is not provided', () => {
      assert.throws(
        () => new AgentOrchestrator({}),
        /agentRuntime is required/
      );
    });

    it('should create with valid dependencies', () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });
      assert.ok(orchestrator);
    });
  });

  describe('register', () => {
    it('should register an agent with static id', () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      class TestAgent {
        static id = 'test-agent';
        static description = 'Test agent';
        constructor() {}
        getTools() { return []; }
        getSystemPrompt() { return 'test'; }
        async run() { return { output: 'test', toolCalls: [] }; }
      }

      orchestrator.register(TestAgent, {});
      assert.ok(orchestrator.has('test-agent'));
    });

    it('should throw if agent has no static id', () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      class BadAgent {
        constructor() {}
      }

      assert.throws(
        () => orchestrator.register(BadAgent, {}),
        /must have static id/
      );
    });
  });

  describe('list', () => {
    it('should return registered agents', () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      class AgentA {
        static id = 'agent-a';
        static description = 'Agent A';
        constructor() {}
        getTools() { return []; }
        getSystemPrompt() { return 'a'; }
        async run() { return { output: '', toolCalls: [] }; }
      }

      class AgentB {
        static id = 'agent-b';
        static description = 'Agent B';
        constructor() {}
        getTools() { return []; }
        getSystemPrompt() { return 'b'; }
        async run() { return { output: '', toolCalls: [] }; }
      }

      orchestrator.register(AgentA, {});
      orchestrator.register(AgentB, {});

      const list = orchestrator.list();
      assert.strictEqual(list.length, 2);
      assert.ok(list.some(a => a.id === 'agent-a'));
      assert.ok(list.some(a => a.id === 'agent-b'));
    });
  });

  describe('run', () => {
    it('should throw for unknown agent', async () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      await assert.rejects(
        () => orchestrator.run('nonexistent', 'hello'),
        /Agent not found/
      );
    });

    it('should run registered agent', async () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      let runCalled = false;

      class TestAgent {
        static id = 'test';
        constructor() {}
        getTools() { return []; }
        getSystemPrompt() { return 'test'; }
        async run(input, options) {
          runCalled = true;
          return { output: `received: ${input}`, toolCalls: [] };
        }
      }

      orchestrator.register(TestAgent, {});
      const result = await orchestrator.run('test', 'hello world');

      assert.ok(runCalled);
      assert.strictEqual(result.output, 'received: hello world');
    });
  });

  describe('has', () => {
    it('should return false for unregistered agent', () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      assert.strictEqual(orchestrator.has('nonexistent'), false);
    });

    it('should return true for registered agent', () => {
      const orchestrator = new AgentOrchestrator({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      class TestAgent {
        static id = 'exists';
        constructor() {}
        getTools() { return []; }
        getSystemPrompt() { return ''; }
        async run() { return { output: '', toolCalls: [] }; }
      }

      orchestrator.register(TestAgent, {});
      assert.strictEqual(orchestrator.has('exists'), true);
    });
  });
});
```

**Step 3: Run tests**

```bash
cd /root/Code/DaylightStation/.worktrees/feature-ai-agents
node --test backend/tests/unit/agents/AgentOrchestrator.test.mjs
```

Expected: All tests pass

**Step 4: Commit**

```bash
git add backend/tests/unit/agents/
git commit -m "test(agents): add unit tests for AgentOrchestrator"
```

---

## Task 10: Add Unit Tests for EchoAgent

**Files:**
- Create: `backend/tests/unit/agents/EchoAgent.test.mjs`

**Step 1: Write unit tests**

```javascript
// backend/tests/unit/agents/EchoAgent.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EchoAgent } from '../../../src/3_applications/agents/echo/EchoAgent.mjs';

describe('EchoAgent', () => {
  let mockAgentRuntime;
  let mockLogger;

  beforeEach(() => {
    mockAgentRuntime = {
      execute: async ({ agent, input, tools, systemPrompt }) => {
        return { output: `Executed with: ${input}`, toolCalls: [] };
      },
      executeInBackground: async () => ({ taskId: 'bg-task' }),
    };

    mockLogger = {
      info: () => {},
      error: () => {},
    };
  });

  describe('static properties', () => {
    it('should have id "echo"', () => {
      assert.strictEqual(EchoAgent.id, 'echo');
    });

    it('should have a description', () => {
      assert.ok(EchoAgent.description);
      assert.ok(EchoAgent.description.length > 0);
    });
  });

  describe('constructor', () => {
    it('should throw if agentRuntime is not provided', () => {
      assert.throws(
        () => new EchoAgent({}),
        /agentRuntime is required/
      );
    });

    it('should create with valid dependencies', () => {
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });
      assert.ok(agent);
    });
  });

  describe('getTools', () => {
    it('should return array of tools', () => {
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      const tools = agent.getTools();
      assert.ok(Array.isArray(tools));
      assert.ok(tools.length > 0);
    });

    it('should include echo_message tool', () => {
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      const tools = agent.getTools();
      const echoTool = tools.find(t => t.name === 'echo_message');

      assert.ok(echoTool);
      assert.ok(echoTool.description);
      assert.strictEqual(typeof echoTool.execute, 'function');
    });

    it('should include get_current_time tool', () => {
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      const tools = agent.getTools();
      const timeTool = tools.find(t => t.name === 'get_current_time');

      assert.ok(timeTool);
      assert.ok(timeTool.description);
      assert.strictEqual(typeof timeTool.execute, 'function');
    });
  });

  describe('tool execution', () => {
    it('echo_message should return timestamped message', async () => {
      const fixedTime = '2026-01-26T12:00:00.000Z';
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        timestampFn: () => fixedTime,
        logger: mockLogger,
      });

      const tools = agent.getTools();
      const echoTool = tools.find(t => t.name === 'echo_message');

      const result = await echoTool.execute({ message: 'Hello' }, {});

      assert.ok(result.echoed.includes(fixedTime));
      assert.ok(result.echoed.includes('Hello'));
    });

    it('get_current_time should return current time', async () => {
      const fixedTime = '2026-01-26T12:00:00.000Z';
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        timestampFn: () => fixedTime,
        logger: mockLogger,
      });

      const tools = agent.getTools();
      const timeTool = tools.find(t => t.name === 'get_current_time');

      const result = await timeTool.execute({}, {});

      assert.strictEqual(result.currentTime, fixedTime);
    });
  });

  describe('getSystemPrompt', () => {
    it('should return a non-empty string', () => {
      const agent = new EchoAgent({
        agentRuntime: mockAgentRuntime,
        logger: mockLogger,
      });

      const prompt = agent.getSystemPrompt();
      assert.strictEqual(typeof prompt, 'string');
      assert.ok(prompt.length > 0);
    });
  });

  describe('run', () => {
    it('should call agentRuntime.execute with correct params', async () => {
      let executeCalled = false;
      let capturedOptions = null;

      const trackingRuntime = {
        ...mockAgentRuntime,
        execute: async (options) => {
          executeCalled = true;
          capturedOptions = options;
          return { output: 'test', toolCalls: [] };
        },
      };

      const agent = new EchoAgent({
        agentRuntime: trackingRuntime,
        logger: mockLogger,
      });

      await agent.run('test input', { context: { userId: '123' } });

      assert.ok(executeCalled);
      assert.strictEqual(capturedOptions.input, 'test input');
      assert.strictEqual(capturedOptions.agent, agent);
      assert.ok(Array.isArray(capturedOptions.tools));
      assert.strictEqual(typeof capturedOptions.systemPrompt, 'string');
      assert.deepStrictEqual(capturedOptions.context, { userId: '123' });
    });
  });
});
```

**Step 2: Run tests**

```bash
node --test backend/tests/unit/agents/EchoAgent.test.mjs
```

Expected: All tests pass

**Step 3: Commit**

```bash
git add backend/tests/unit/agents/EchoAgent.test.mjs
git commit -m "test(agents): add unit tests for EchoAgent"
```

---

## Task 11: Integration Test (Manual Verification)

**Step 1: Start the development server**

```bash
cd /root/Code/DaylightStation/.worktrees/feature-ai-agents
npm run dev
```

**Step 2: Test the agents API endpoints**

In another terminal:

```bash
# List agents
curl http://localhost:3112/api/agents

# Expected: {"agents":[{"id":"echo","description":"..."}]}
```

```bash
# Run echo agent
curl -X POST http://localhost:3112/api/agents/echo/run \
  -H "Content-Type: application/json" \
  -d '{"input": "What time is it?"}'

# Expected: {"agentId":"echo","output":"...","toolCalls":[...]}
```

**Step 3: Document any issues found**

If the agent doesn't work as expected, document the error and fix before proceeding.

**Step 4: Stop dev server and commit any fixes**

```bash
# If fixes were needed
git add -A
git commit -m "fix(agents): integration test fixes"
```

---

## Task 12: Final Cleanup and Documentation

**Files:**
- Update: `docs/plans/2026-01-26-ai-agents-architecture-design.md` (mark as implemented)

**Step 1: Add implementation status to design doc**

Add at the top of the design document:

```markdown
> **Status:** Implemented in `feature/ai-agents` branch
```

**Step 2: Run all tests**

```bash
cd /root/Code/DaylightStation/.worktrees/feature-ai-agents
npm test
```

**Step 3: Final commit**

```bash
git add -A
git commit -m "docs(agents): mark design as implemented"
```

---

## Summary

| Task | Component | Files |
|------|-----------|-------|
| 1 | Dependencies | `package.json` |
| 2 | Port Interfaces | `3_applications/agents/ports/*` |
| 3 | MastraAdapter | `2_adapters/agents/*` |
| 4 | AgentOrchestrator | `3_applications/agents/AgentOrchestrator.mjs` |
| 5 | EchoAgent | `3_applications/agents/echo/*` |
| 6 | Application Index | `3_applications/agents/index.mjs` |
| 7 | API Router | `4_api/routers/agents.mjs` |
| 8 | Bootstrap Wiring | `0_infrastructure/bootstrap.mjs` |
| 9 | Orchestrator Tests | `tests/unit/agents/AgentOrchestrator.test.mjs` |
| 10 | EchoAgent Tests | `tests/unit/agents/EchoAgent.test.mjs` |
| 11 | Integration Test | Manual verification |
| 12 | Documentation | Design doc update |
