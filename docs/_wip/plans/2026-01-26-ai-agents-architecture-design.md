# AI Agents Architecture Design

> **Status:** Implemented in `refactor/ddd-migration` branch (feature-ai-agents worktree)

> Design for integrating autonomous AI agents into DaylightStation's DDD architecture.

---

## Decision Summary

**Agents live in `3_applications/agents/`** - they are application-layer services that use AI reasoning instead of scripted rules.

**Why not a separate `5_agents/` layer?**
- API layer needs to invoke agents (dependency direction)
- Other applications need to invoke agents for background tasks
- Avoids plugin/registry complexity
- Consistent DI patterns throughout

---

## Architecture Overview

```
4_api/              → HTTP entry points (invoke agents via AgentOrchestrator)
3_applications/     → Use cases + agents (peers with nutribot, journalist, etc.)
2_adapters/         → External services including MastraAdapter
1_domains/          → Pure business logic
0_infrastructure/   → Foundation + bootstrap wiring
```

**Key insight:** Agents are not entry points - they're application-level services accessed via entry points (HTTP, webhooks, scheduled jobs, other apps).

---

## Directory Structure

```
backend/src/
├── 0_infrastructure/
│   └── bootstrap.mjs              # Wires agents at startup
├── 1_domains/
│   └── (no agent-specific domains needed initially)
├── 2_adapters/
│   └── agents/
│       ├── MastraAdapter.mjs      # IAgentRuntime implementation
│       └── index.mjs
├── 3_applications/
│   ├── agents/
│   │   ├── ports/
│   │   │   ├── IAgentRuntime.mjs
│   │   │   ├── ITool.mjs
│   │   │   └── IMemoryStore.mjs
│   │   ├── common/
│   │   │   ├── tools/
│   │   │   │   ├── ApplicationTools.mjs
│   │   │   │   ├── DataQueryTools.mjs
│   │   │   │   └── SystemTools.mjs
│   │   │   └── prompts/
│   │   │       └── safety.mjs
│   │   ├── health-advisor/
│   │   │   ├── HealthAdvisorAgent.mjs
│   │   │   ├── prompts/
│   │   │   └── index.mjs
│   │   ├── config-manager/
│   │   ├── data-cleanup/
│   │   └── AgentOrchestrator.mjs
│   ├── nutribot/
│   ├── journalist/
│   └── homebot/
└── 4_api/
    └── handlers/
        └── agents.mjs             # HTTP endpoints for agents
```

---

## Port Interfaces

### IAgentRuntime

```javascript
// 3_applications/agents/ports/IAgentRuntime.mjs
export const IAgentRuntime = {
  /**
   * Execute an agent with given input
   * @param {Object} options
   * @param {Object} options.agent - Agent instance
   * @param {string} options.input - User input / task description
   * @param {Array} options.tools - Available tools
   * @param {string} options.systemPrompt - Agent persona/instructions
   * @param {Object} [options.memory] - Conversation memory (optional)
   * @returns {Promise<{output: string, toolCalls: Array}>}
   */
  async execute(options) {},

  /**
   * Execute agent in background (fire-and-forget with callback)
   * @param {Object} options - Same as execute
   * @param {Function} [onComplete] - Called when done
   * @returns {Promise<{taskId: string}>}
   */
  async executeInBackground(options, onComplete) {},
};
```

### ITool

```javascript
// 3_applications/agents/ports/ITool.mjs
export const ITool = {
  name: '',           // Unique identifier
  description: '',    // What the tool does (for AI to understand)
  parameters: {},     // JSON Schema for inputs

  /**
   * Execute the tool
   * @param {Object} params - Validated parameters
   * @param {Object} context - Execution context (userId, etc.)
   * @returns {Promise<any>}
   */
  async execute(params, context) {},
};
```

### IMemoryStore

```javascript
// 3_applications/agents/ports/IMemoryStore.mjs
export const IMemoryStore = {
  async getConversation(agentId, conversationId) {},
  async saveMessage(agentId, conversationId, message) {},
  async clearConversation(agentId, conversationId) {},
};
```

---

## Individual Agent Structure

```
agents/
└── health-advisor/
    ├── HealthAdvisorAgent.mjs    # Agent definition
    ├── tools/                     # Agent-specific tools (optional)
    │   └── HealthMetricsTools.mjs
    ├── prompts/
    │   ├── system.mjs             # System prompt / persona
    │   └── instructions.mjs       # Task-specific instructions
    └── index.mjs                  # Exports
```

### Agent Definition Example

```javascript
// health-advisor/HealthAdvisorAgent.mjs
export class HealthAdvisorAgent {
  static id = 'health-advisor';
  static description = 'Analyzes health data across nutrition, fitness, and sleep';

  constructor(deps) {
    this.#nutribot = deps.nutribotUseCases;
    this.#fitness = deps.fitnessUseCases;
    this.#agentRuntime = deps.agentRuntime;  // Injected, not imported
    this.#logger = deps.logger;
  }

  getTools() {
    return [
      ...ApplicationTools.forNutribot(this.#nutribot),
      ...ApplicationTools.forFitness(this.#fitness),
      ...HealthMetricsTools.all(),
    ];
  }

  getSystemPrompt() {
    return systemPrompt;  // From ./prompts/system.mjs
  }

  async run(input, options = {}) {
    return this.#agentRuntime.execute({
      agent: this,
      input,
      tools: this.getTools(),
      systemPrompt: this.getSystemPrompt(),
      ...options,
    });
  }
}
```

---

## AgentOrchestrator

Central service for invoking agents:

```javascript
// agents/AgentOrchestrator.mjs
export class AgentOrchestrator {
  #agents = new Map();
  #agentRuntime;
  #logger;

  constructor(deps) {
    this.#agentRuntime = deps.agentRuntime;
    this.#logger = deps.logger || console;
  }

  /**
   * Register an agent (called at bootstrap)
   */
  register(AgentClass, dependencies) {
    const agent = new AgentClass(dependencies);
    this.#agents.set(AgentClass.id, agent);
    this.#logger.info?.('agent.registered', { agentId: AgentClass.id });
  }

  /**
   * Run agent synchronously (wait for result)
   */
  async run(agentId, input, context = {}) {
    const agent = this.#getAgent(agentId);
    return agent.run(input, { context });
  }

  /**
   * Run agent in background (returns immediately)
   */
  async runInBackground(agentId, input, context = {}) {
    const agent = this.#getAgent(agentId);
    return this.#agentRuntime.executeInBackground(
      { agent, input, tools: agent.getTools(), systemPrompt: agent.getSystemPrompt() },
      (result) => this.#logger.info?.('agent.background.complete', { agentId, result })
    );
  }

  /**
   * List available agents (for discovery/admin)
   */
  list() {
    return Array.from(this.#agents.values()).map(a => ({
      id: a.constructor.id,
      description: a.constructor.description,
    }));
  }

  #getAgent(agentId) {
    const agent = this.#agents.get(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return agent;
  }
}
```

---

## Shared Tools

Tools wrap existing capabilities for agent use:

```javascript
// agents/common/tools/ApplicationTools.mjs
export const ApplicationTools = {
  /**
   * Create tools for nutribot use cases
   */
  forNutribot(useCases) {
    return [
      {
        name: 'get_nutrition_report',
        description: 'Get nutrition summary for a date range',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
          },
          required: ['userId', 'startDate', 'endDate'],
        },
        async execute(params, context) {
          return useCases.getReportAsJSON.execute(params);
        },
      },
    ];
  },

  forFitness(useCases) {
    return [
      {
        name: 'get_recent_workouts',
        description: 'Get workout sessions for a user',
        // ...
      },
    ];
  },
};
```

```javascript
// agents/common/tools/SystemTools.mjs
export const SystemTools = {
  forConfig(configRepository) {
    return [
      {
        name: 'read_config',
        description: 'Read a configuration value',
        parameters: { /* ... */ },
        async execute({ scope, key }, context) {
          return configRepository.get(scope, key);
        },
      },
    ];
  },

  forLogs(logReader) {
    return [
      {
        name: 'search_logs',
        description: 'Search application logs',
        // ...
      },
    ];
  },
};
```

**Key principle:** Tools are the security boundary - agents can only do what their tools allow.

---

## MastraAdapter

The only place Mastra SDK is imported:

```javascript
// 2_adapters/agents/MastraAdapter.mjs
import { Mastra } from 'mastra';

export class MastraAdapter {
  #mastra;
  #logger;

  constructor(deps) {
    this.#logger = deps.logger || console;
    this.#mastra = new Mastra({ /* config */ });
  }

  #translateTools(tools, context) {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
      execute: async (params) => tool.execute(params, context),
    }));
  }

  async execute({ agent, input, tools, systemPrompt, context = {} }) {
    const mastraTools = this.#translateTools(tools, context);

    const result = await this.#mastra.agent({
      name: agent.constructor.id,
      instructions: systemPrompt,
      tools: mastraTools,
    }).generate(input);

    return {
      output: result.text,
      toolCalls: result.toolCalls || [],
    };
  }

  async executeInBackground(options, onComplete) {
    const taskId = crypto.randomUUID();

    setImmediate(async () => {
      try {
        const result = await this.execute(options);
        onComplete?.(result);
      } catch (error) {
        this.#logger.error?.('agent.background.error', { taskId, error: error.message });
        onComplete?.({ error: error.message });
      }
    });

    return { taskId };
  }
}
```

**Swapping frameworks:** Write a `LangChainAdapter.mjs` implementing the same interface, change bootstrap.

---

## Bootstrap Wiring

```javascript
// 0_infrastructure/bootstrap.mjs
import { MastraAdapter } from '#adapters/agents/MastraAdapter.mjs';
import { AgentOrchestrator } from '#applications/agents/AgentOrchestrator.mjs';
import { HealthAdvisorAgent } from '#applications/agents/health-advisor/index.mjs';

export function bootstrapAgents(context) {
  const { nutribotContainer, fitnessContainer, configRepository, logger } = context;

  const agentRuntime = new MastraAdapter({ logger });

  const agentOrchestrator = new AgentOrchestrator({ agentRuntime, logger });

  agentOrchestrator.register(HealthAdvisorAgent, {
    nutribotUseCases: {
      getReportAsJSON: nutribotContainer.getGetReportAsJSON(),
    },
    fitnessUseCases: {
      getRecentWorkouts: fitnessContainer.getRecentWorkouts(),
    },
    agentRuntime,
    logger,
  });

  return agentOrchestrator;
}
```

---

## Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Agent class | `{Purpose}Agent.mjs` | `HealthAdvisorAgent.mjs` |
| Agent folder | `kebab-case` | `health-advisor/` |
| Tool factory | `{Domain}Tools.mjs` | `ApplicationTools.mjs` |
| Port interface | `I{Noun}.mjs` | `IAgentRuntime.mjs` |

---

## Usage Examples

### From API handler

```javascript
// 4_api/handlers/agents.mjs
router.post('/agents/:agentId/run', async (req, res) => {
  const result = await agentOrchestrator.run(req.params.agentId, req.body.input);
  res.json(result);
});
```

### From another application (background task)

```javascript
// In NutribotContainer or a use case
await this.#agentOrchestrator.runInBackground('pattern-analyzer', { userId });
```

### From scheduled job

```javascript
// In scheduler
scheduler.schedule('0 6 * * *', () => {
  agentOrchestrator.run('daily-briefing', { userId: 'default' });
});
```

---

## Design Benefits

1. **Accessible from anywhere** - API, other apps, scheduled jobs can invoke agents
2. **Framework-agnostic** - Swap Mastra for LangChain by writing new adapter
3. **Security via tools** - Agents can only do what their tools allow
4. **Consistent patterns** - Same DI and port/adapter approach as rest of codebase
5. **No circular dependencies** - Agents are peers with other apps, not above them
