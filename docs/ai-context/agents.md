# AI Agents Context

## Purpose

Autonomous AI agents that use LLM reasoning for complex tasks. Unlike rule-based bots (journalist, nutribot), agents can reason, use tools, and make decisions dynamically.

## Key Concepts

| Term | Definition |
|------|------------|
| **Agent** | Autonomous LLM-powered service with tools and system prompt |
| **AgentOrchestrator** | Central registry for agent registration and invocation |
| **Tool** | Function an agent can call (JSON Schema parameters) |
| **IAgentRuntime** | Port interface for LLM execution (framework-agnostic) |
| **MastraAdapter** | Mastra SDK implementation of IAgentRuntime |

## Architecture

```
4_api/routers/agents.mjs     → HTTP endpoints
3_applications/agents/       → AgentOrchestrator + individual agents
2_adapters/agents/           → MastraAdapter (Mastra SDK wrapper)
```

**Key principle:** Application layer has zero knowledge of Mastra. Could swap for LangChain by writing new adapter.

## File Locations

### Application Layer (`3_applications/agents/`)
- `AgentOrchestrator.mjs` - Central registration and invocation
- `ports/IAgentRuntime.mjs` - Runtime interface
- `ports/ITool.mjs` - Tool interface with `createTool()` helper
- `ports/IMemoryStore.mjs` - Conversation memory (reserved for future)
- `echo/EchoAgent.mjs` - Demo agent with echo and time tools
- `index.mjs` - Barrel exports

### Adapter Layer (`2_adapters/agents/`)
- `MastraAdapter.mjs` - Mastra SDK implementation
- `index.mjs` - Exports

### API Layer (`4_api/routers/`)
- `agents.mjs` - REST endpoints

### Bootstrap (`0_infrastructure/`)
- `bootstrap.mjs` - `createAgentsApiRouter()` function

### Tests (`tests/unit/agents/`)
- `AgentOrchestrator.test.mjs` - 10 tests
- `EchoAgent.test.mjs` - 10 tests

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/agents` | List registered agents |
| POST | `/agents/:agentId/run` | Run agent synchronously |
| POST | `/agents/:agentId/run-background` | Run agent async (fire-and-forget) |

## Creating a New Agent

### 1. Create agent directory

```
3_applications/agents/
└── my-agent/
    ├── MyAgent.mjs
    ├── prompts/
    │   └── system.mjs
    └── index.mjs
```

### 2. Define agent class

```javascript
// MyAgent.mjs
import { systemPrompt } from './prompts/system.mjs';
import { createTool } from '../ports/ITool.mjs';

export class MyAgent {
  static id = 'my-agent';
  static description = 'Does something useful';

  #agentRuntime;
  #logger;

  constructor(deps) {
    if (!deps.agentRuntime) throw new Error('agentRuntime is required');
    this.#agentRuntime = deps.agentRuntime;
    this.#logger = deps.logger || console;
  }

  getTools() {
    return [
      createTool({
        name: 'my_tool',
        description: 'Does a thing',
        parameters: {
          type: 'object',
          properties: {
            param: { type: 'string', description: 'Input param' }
          },
          required: ['param']
        },
        execute: async ({ param }, context) => {
          return { result: `Processed: ${param}` };
        }
      })
    ];
  }

  getSystemPrompt() {
    return systemPrompt;
  }

  async run(input, options = {}) {
    return this.#agentRuntime.execute({
      agent: this,
      input,
      tools: this.getTools(),
      systemPrompt: this.getSystemPrompt(),
      ...options
    });
  }
}
```

### 3. Register in bootstrap

```javascript
// In bootstrap.mjs createAgentsApiRouter()
import { MyAgent } from '../3_applications/agents/my-agent/index.mjs';

agentOrchestrator.register(MyAgent);
```

## Testing

```bash
# Unit tests
node --test backend/tests/unit/agents/*.test.mjs

# Smoke test
curl http://localhost:3112/agents
curl -X POST http://localhost:3112/agents/echo/run \
  -H "Content-Type: application/json" \
  -d '{"input": "Hello"}'
```

## Related Docs

- Design: `docs/plans/2026-01-26-ai-agents-architecture-design.md`
- Smoke test: `docs/runbooks/agents-smoke-test.md`
