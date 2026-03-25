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

### Health Coach Agent (`3_applications/agents/health-coach/`)
- `HealthCoachAgent.mjs` - Main agent class (extends BaseAgent)
- `assignments/DailyDashboard.mjs` - Daily dashboard preparation assignment
- `assignments/MorningBrief.mjs` - Daily reconciliation-aware nutrition brief (scheduled 10am)
- `assignments/NoteReview.mjs` - Per-accept coaching review (event-triggered, default silent)
- `assignments/EndOfDayReport.mjs` - Daily report coaching commentary (event-triggered)
- `assignments/WeeklyDigest.mjs` - Weekly trend summary (scheduled Sunday 7pm)
- `assignments/ExerciseReaction.mjs` - Post-exercise context message (Strava webhook-triggered)
- `tools/HealthToolFactory.mjs` - Weight, nutrition, workout tools (5 tools)
- `tools/FitnessContentToolFactory.mjs` - Plex content browsing, program state (3 tools)
- `tools/DashboardToolFactory.mjs` - Dashboard write, goals, coaching notes (3 tools)
- `tools/ReconciliationToolFactory.mjs` - Reconciliation summary, adjusted nutrition, coaching history (3 tools)
- `tools/MessagingChannelToolFactory.mjs` - Channel message delivery (1 tool)
- `schemas/dashboard.mjs` - Dashboard output JSON Schema
- `schemas/coachingMessage.mjs` - Output schema for coaching messages (should_send, text, parse_mode)
- `prompts/system.mjs` - System prompt
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

### Tests (`tests/isolated/agents/` and `tests/live/`)
- `isolated/agents/AgentOrchestrator.test.mjs` - 12 tests
- `isolated/agents/EchoAgent.test.mjs` - 10 tests
- `isolated/agents/framework/WorkingMemoryState.test.mjs` - 17 tests
- `isolated/agents/framework/YamlWorkingMemoryAdapter.test.mjs` - 5 tests
- `isolated/agents/framework/ToolFactory.test.mjs` - 4 tests
- `isolated/agents/framework/OutputValidator.test.mjs` - 9 tests
- `isolated/agents/framework/Assignment.test.mjs` - 4 tests
- `isolated/agents/framework/BaseAgent.test.mjs` - 10 tests
- `isolated/agents/framework/Scheduler.test.mjs` - 6 tests
- `isolated/agents/health-coach/dashboard-schema.test.mjs` - 5 tests
- `isolated/agents/health-coach/HealthToolFactory.test.mjs` - 7 tests
- `isolated/agents/health-coach/FitnessContentToolFactory.test.mjs` - 5 tests
- `isolated/agents/health-coach/DashboardToolFactory.test.mjs` - 5 tests
- `isolated/agents/health-coach/DailyDashboard.test.mjs` - 8 tests
- `isolated/agents/health-coach/HealthCoachAgent.test.mjs` - 8 tests
- `isolated/agents/health-coach/MorningBrief.test.mjs` - Nutrition brief assignment tests
- `isolated/agents/health-coach/NoteReview.test.mjs` - Coaching review assignment tests
- `isolated/agents/health-coach/EndOfDayReport.test.mjs` - Daily report assignment tests
- `isolated/agents/health-coach/WeeklyDigest.test.mjs` - Weekly digest assignment tests
- `isolated/agents/health-coach/ExerciseReaction.test.mjs` - Exercise reaction assignment tests
- `isolated/agents/health-coach/ReconciliationToolFactory.test.mjs` - Reconciliation tools tests
- `isolated/agents/health-coach/MessagingChannelToolFactory.test.mjs` - Messaging channel tools tests
- `live/agent/health-coach-assignment.test.mjs` - Integration tests for health coach assignments

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/agents` | List registered agents |
| POST | `/agents/:agentId/run` | Run agent synchronously |
| POST | `/agents/:agentId/run-background` | Run agent async (fire-and-forget) |
| GET | `/agents/:agentId/assignments` | List agent assignments |
| POST | `/agents/:agentId/assignments/:assignmentId/run` | Manually trigger assignment |
| GET | `/health-dashboard/:userId/:date` | Read agent-generated dashboard |
| GET | `/health-dashboard/:userId` | Read today's dashboard |

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
- Health Coach Plan: `docs/plans/2026-02-14-health-coach-agent.md`
- Smoke test: `docs/runbooks/agents-smoke-test.md`
