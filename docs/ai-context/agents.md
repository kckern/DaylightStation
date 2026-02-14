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
| **BaseAgent** | Common lifecycle base class (memory, tools, assignments) |
| **ToolFactory** | Grouped tool creation base class |
| **WorkingMemoryState** | In-memory key-value store with TTL-based expiry |
| **Assignment** | Structured multi-step workflow template method |
| **OutputValidator** | JSON Schema validation with LLM self-correction retry |
| **Scheduler** | In-process cron for triggering agent assignments |

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

### Framework (`3_applications/agents/framework/`)
- `BaseAgent.mjs` - Common lifecycle (memory, tools, assignments)
- `ToolFactory.mjs` - Grouped tool creation base class
- `WorkingMemory.mjs` - WorkingMemoryState with TTL-based expiry
- `Assignment.mjs` - Structured workflow template method
- `OutputValidator.mjs` - JSON Schema validation with LLM retry
- `Scheduler.mjs` - Cron-based assignment triggering
- `ports/IWorkingMemory.mjs` - Memory persistence port

### Adapter Layer (`1_adapters/agents/`)
- `MastraAdapter.mjs` - Mastra SDK implementation
- `YamlWorkingMemoryAdapter.mjs` - YAML file persistence for working memory
- `index.mjs` - Exports

### API Layer (`4_api/routers/`)
- `agents.mjs` - REST endpoints

### Bootstrap (`0_system/`)
- `bootstrap.mjs` - `createAgentsApiRouter()` function

### Tests (`tests/unit/agents/`)
- `AgentOrchestrator.test.mjs` - 12 tests
- `EchoAgent.test.mjs` - 10 tests
- `framework/WorkingMemoryState.test.mjs` - 17 tests
- `framework/YamlWorkingMemoryAdapter.test.mjs` - 5 tests
- `framework/ToolFactory.test.mjs` - 4 tests
- `framework/OutputValidator.test.mjs` - 9 tests
- `framework/Assignment.test.mjs` - 4 tests
- `framework/BaseAgent.test.mjs` - 9 tests
- `framework/Scheduler.test.mjs` - 6 tests

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/agents` | List registered agents |
| POST | `/agents/:agentId/run` | Run agent synchronously |
| POST | `/agents/:agentId/run-background` | Run agent async (fire-and-forget) |
| GET | `/agents/:agentId/assignments` | List agent assignments |
| POST | `/agents/:agentId/assignments/:assignmentId/run` | Manually trigger assignment |

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

### 2. Define agent class (extending BaseAgent)

```javascript
import { BaseAgent } from '../framework/BaseAgent.mjs';
import { ToolFactory } from '../framework/ToolFactory.mjs';
import { createTool } from '../ports/ITool.mjs';

class MyToolFactory extends ToolFactory {
  static domain = 'my-domain';
  createTools() {
    return [
      createTool({
        name: 'my_tool',
        description: 'Does a thing',
        parameters: {
          type: 'object',
          properties: { param: { type: 'string' } },
          required: ['param']
        },
        execute: async ({ param }) => ({ result: `Processed: ${param}` })
      })
    ];
  }
}

export class MyAgent extends BaseAgent {
  static id = 'my-agent';
  static description = 'Does something useful';

  getSystemPrompt() { return 'You are a helpful agent.'; }

  registerTools() {
    this.addToolFactory(new MyToolFactory(this.deps));
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
- Agent Framework Design: `docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md`
- Implementation Plan: `docs/plans/2026-02-14-agent-framework.md`
- Smoke test: `docs/runbooks/agents-smoke-test.md`
