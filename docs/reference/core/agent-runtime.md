# Shared agent runtime contracts

The application layer uses `IAgentRuntime`, `ITool`, `IAgentRunRuntime`,
`IAgentStateStore`, and `AgentInteractions`. Vendor SDK construction belongs in
`1_adapters/agents`; even coaching commentary now uses the shared runtime.

Pinned SDK set: Mastra core **1.64.0**, memory **1.28.2**, libSQL **1.22.3**,
Zod **4.5.4**. Docker and `.nvmrc` select Node **22.23.2** (minimum 22.13.0).
Both root/backend lockfiles are updated; existing memory DBs are not rebuilt by
this feature. The cleanup workflow has its own SQLite file.

## Execution

`execute` preserves `output`, `toolCalls` and `turnId`, adding `runId`, `status`,
`structured`, usage and optional interaction/evaluation data. Options include
`signal`, `limits: { timeoutMs, maxToolCalls, maxSteps }`, `toolAllowlist`,
`modelSettings`, and `outputSchema` (JSON Schema). Context is mapped to SDK request
context inside the adapter; reserved resource/thread identities are set from the
trusted owner/thread context, not caller-provided SDK keys.

Schemas use a Standard Schema bridge backed by Ajv instead of the former lossy
JSON-Schema-to-Zod converter. Nested properties, arrays, enums, integer/range and
required/additional-property constraints survive. Tool input and successful output
are validated at the boundary; structured model output fails closed on invalid data.

`createTool` additionally accepts `outputSchema`, `suspendSchema`, `resumeSchema`,
`requireApproval`, `toModelOutput`, and `transform`. Tool execution context carries
the cancellation signal, `toolCallId`, resume data, and `requestInput`. Input
processors/output processors supplied by the memory factory are actually attached
to the SDK agent. Existing disabled-by-default memory features remain opt-in;
upgrading the SDK does not automatically activate extra memory-model calls.

Streaming preserves text/tool/finish events and adds input-required/error events.
Repeated calls of the same tool are correlated by tool-call ID. A stalled model or
iterator is raced against cancellation/deadline; late tools see an aborted signal.
Application mutations must still enforce their own commit-time fences: aborting a
promise cannot undo an external write already performed by a tool.

Optional `hooks` expose `onToolResult`, `onResult`, `onError`, and `evaluate`.
`evaluate` may return application-owned scores on a completed result; hook failures
are logged and bounded to one second each. No vendor evaluation platform is needed.
SDK diagnostics are routed through the structured application logger. Existing
transcript persistence remains in place.

## Durable work and questions

`IAgentRunRuntime` provides register/start/get/resume/cancel/recover. The Mastra
adapter persists workflow snapshots with owner identity, including suspension and
resumption. Start rejects an existing run ID reused for different input. An active
checkpoint uses SDK restart; a failed terminal step is explicitly re-entered using
its saved input (SDK restart alone does **not** retry that terminal step).

`AgentInteractions` is a separate durable application record, not a Telegram
conversation state. It supports choice, free-text and dismiss responses; versioned
answers; idempotency keys with payload fingerprints; a persisted answering intent;
bounded recovery; and duplicate suppression across surfaces. Applications own the
question's authority scope and revalidate it when applying an answer.

Fire-and-forget `executeInBackground` remains for compatibility; use managed runs
for work that must survive restart. These additions do not install Redis, Temporal,
Inngest, MCP servers, agent delegation, workspaces, or a new messaging platform.
