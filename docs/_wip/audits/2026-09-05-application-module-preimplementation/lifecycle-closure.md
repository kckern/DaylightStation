# Lifecycle registration accounting

Source-only completion of PRE-2.2.3, together with the
[provider/widget review](provider-lifecycle-review.md). This closes registration
inventory, not lifecycle parity or full shutdown testing. No controller,
WebSocket connection, provider, schedule or CLI command was started.

`lifecycle-closure.json` links source hashes, exact call IDs and incoming source
consumers. It accounts for all 96 recognized calls in the proposed Gratitude and
foundation files through 15 file-specific policies. Its supplementary AST pass
records 83 property callbacks, constructors and named lifecycle helpers that a
simple `.on()`/`.subscribe()` scan would miss. These are candidate declarations,
not counts of installed instances. The full 5,326-call repository index remains
in `registration-review.json` for impacts outside this first move set.

## Affected lifetimes

| Owner/mechanism | Current source behavior to preserve |
|---|---|
| Request logger and image-download stream | Response finish/close share a once-only guard; stream finish/error handlers settle a local promise. Neither is a product singleton with a new global disposer. |
| Canvas factory | Each invocation attempts process-global font registration before creating its canvas. There is no registration cache or deregistration here. Native package identity and font paths matter. |
| Publication wrappers | Publish through injected capabilities; they do not register listeners. Only Gratitude's wrapper belongs in the Gratitude split. |
| Gratitude and WebSocket context | Payload callback is a single slot. Effect cleanup releases listeners/subscriptions; action timers and delayed persistence are not all cancelled. Unsubscribe is not transport shutdown. |
| Legacy frontend API sockets | Separate path-keyed sockets, not the shared WebSocketService instance. Duplicate subscribe returns the old unsubscribe; closing only OPEN sockets leaves CONNECTING behavior distinct. |
| Logging diagnostics/probes | Start/stop own frame/interval/observer handles; buffered transport has no returned dispose, and deferred recorder idle callbacks use a guard rather than cancellation. |
| Admin forms | Unsaved state is registered by component ID, unload handlers follow dirty state, and click-away cleanup removes the same callback. Shared context/hook identity must remain stable. |
| Shared WebSocket service | Logical unsubscribe removes subscribers; disconnect can trigger onclose reconnection and does not clear every timer. A relocation must not invent stronger teardown semantics. |

Policies retain precise source anchors and affected-call IDs rather than treating
all operations in a file as the same resource. Existing browser cases corroborate
selected Gratitude lifetimes; the untested rows remain future verification work.

## Controller construction, schedules and shutdown

Eight service/entrypoint lifetime records distinguish actual implementations:
WebSocketEventBus, PressureMatAdapter, ScreenContentTracker,
CommandHandlerLivenessService, system Scheduler, AmbientSchedulerService,
AgentAssignmentScheduler and entrypoint monitors. Source-backed missing cleanup
is an explicit disposition, not an omitted inventory row.

The two scheduler classes are not interchangeable. The system scheduler is built
in `app.mjs`, with app and environment gates. The agent scheduler is built in
bootstrap and receives 15 registration declarations: 14 standalone task calls
and one registered-agent loop whose assignments/schedules are data-dependent.
Each declaration preserves key, cron/reference, callback span and source guards.
These are not 15 necessarily enabled jobs, nor is the agent loop one runtime job.

There are 14 explicit controller termination bindings: five server-close
listeners and nine SIGTERM listeners. Their exact AST callback spans identify
stop/dispose/flush calls, including progress-sync flush before dispose. These are
independent callbacks, not an awaited shutdown coordinator. Do not infer that a
SIGTERM listener closes the HTTP server, that an early startup failure invokes
all cleanup, or that a service's `stop()` method has been wired merely because it
exists. Several reviewed services have no app/main shutdown invocation; others
stop processing without unsubscribing their constructor-owned callback.

`serverMain.mjs` is effectful at module evaluation: it installs crash handlers and
loads dotenv. The entrypoint also starts monitors without retaining every cleanup
handle. Source inspection is allowed; importing these files as passive fixtures
is not. `unref()` allows process exit; it does not cancel a timer.

## CLI contributions

All 202 non-test CLI source files are indexed without execution, including five
non-JavaScript files. Each row links incoming consumers and distinguishes argv
reads, parser declarations, action callback spans, conditional guards and the
15 previously inventoried switch dispatches. A file without recognized argument
handling is labeled helper/self-contained command, **not inert**. Stable operator
entry paths are recorded even when there is no incoming JavaScript import.

External script callers and satellite wire/build contracts are separate PRE-2.3
work. This inventory does not approve moving CLI paths or prove every operator
invocation has been found.

## Future acceptance requirements

Any changeset affecting these resources must name its impacted call IDs and test
start, repeated start, cleanup and failure ordering where applicable. Preserve
known missing teardown and existing publication/callback semantics unless a
separate behavior-change task is approved. No new LoA exemption follows from an
existing loader's placement or a shared service's broad consumer population.
