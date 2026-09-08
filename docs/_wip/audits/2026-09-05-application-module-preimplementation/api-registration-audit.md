# HTTP registration accounting

This closes the source-inventory question in PRE-2.2.1, not controller runtime
parity. `assembled-api.json` and `api-registration-audit.json` are the reproducible
machine-readable records. Sources and generator/inventory inputs are hashed;
`audit-packet.mjs` refuses stale derived inputs. Review is by the investigator,
not a new independent adversarial reviewer.

## Reconciled populations

| Population | Accounting |
|---|---|
| Main API route map | 79 entries: 76 statically resolved factory returns; three keys never supplied by this composition |
| Ordinary route registrations | 1,049 source-reachable method/pattern rows, including nested factories, ten post-factory School mounts, finite Piano chess mounting, direct agent memory/meta and legacy admin |
| Middleware/opaque arguments | All 50 have source-backed dispositions; two arguments describe one computed Piano mount, not two middleware functions |
| Agent helper registrations | Three source templates per registered native agent, plus two literal concierge routes |
| Direct app GET registrations | `/build.txt` and the missing-configuration catchall; these are outside the ordinary router count |
| App ordering | 24 direct calls plus the two helper-install sites, sorted by source position and retaining conditions |

These are overlapping descriptions of source registrations, not a sum of unique
deployed URLs. Conditional registrations are not claimed to be active. The
settings lookup `app.get('canvasBasePath')` has only one argument and is excluded.

The unsupplied keys are `messaging`, `tts` and `queries`. There are no spreads or
assignments providing them at this baseline. `createApiRouter` mounts a map entry
only when its supplied router is truthy. This says nothing about whether earlier
middleware or static fallback can answer such a URL. Dedicated tests demonstrate
both omitted and explicitly supplied keys without executing application startup.

## Order is part of the contract

Each ordinary endpoint retains its HTTP method, original pattern, full prefix
chain, source location, ordered handler arguments, lexical conditions, router
identity and local registration order. Parent mounts retain their registration
sources and parent-stack positions. A child router's local error translator does
not replace parent/global error handling. Reconstruct the stack from these links;
do not sort endpoints alphabetically and use that as a migration recipe.

The global order is: COOP/COEP → CORS → JSON/urlencoded parsing → websocket-path
handling → build metadata/missing-config handling. Missing configuration returns
from app construction before the remaining registrations. For the configured
branch, `/api/v1` adds request logging → device → household → network trust →
token → permission gate. Direct admin and agent mounts follow at their recorded
positions; webhook dev proxies and concierge are later. Conditional Docker
static/SPA handling precedes the final API mount. Global error translation is
last. The JSON parser's earlier strictness is not reversed by a later local
`express.json({strict:false})` declaration.

Middleware dispositions include local error transformers, body parsers, Life
username resolution, School capability injection, SchoolCalc ingress auth,
tracing, the language-alias header and proxy handlers. Source references preserve
each local error body/status mapping and whether it calls `next(error)`.

## Registrations that literal route counts miss

`mountAgentHttp` mounts `/api/v1/agents/${agentId}/run`, `/run-stream` and
`/run-background` once per ID returned by the orchestrator's installed list.
`${agentId}` is a source-time substitution, **not** an Express `:agentId` request
parameter. The inventory deliberately does not fabricate private deployment IDs.
The app binding relies on the existing `/api/v1` auth pipeline and supplies no
extra helper auth middleware.

Concierge mounts POST `/v1/chat/completions` and GET `/v1/models` inside a guarded
creation/mount block. It supplies satellite bearer authentication; it is outside
the `/api/v1` permission prefix. Its wire-format module, context extractor and
advertised-model provider are separate from native agent JSON/SSE contracts.
Failed construction logs `concierge.mount_failed`, rather than guaranteeing these
routes exist. The isolated helper tests verify supplied auth ordering, not the
production token verifier or configured satellite registry.

`router.use` proxy prefixes accept matching methods, not only GET. Plex, Immich
and Audiobookshelf return 503 if their required passthrough is absent; Reddit and
Komga return a cacheable 200 SVG placeholder. Plex's thumbnail rewrite runs before
its passthrough. The legacy `/api/v1/plex_proxy` is separately conditional on
host/token and reuses the proxy service. These registrations must not disappear
because they are absent from `.get()`/`.post()` counts.

## Preserve existing quirks; do not repair them incidentally

The direct `/admin/ws` mount currently passes `{eventBus}`, while the factory
expects `{eventBusAdministration}`. The isolated tests reproduce 503 from its
status/restart/broadcast endpoints. This is recorded baseline behavior, not
permission to fix it during relocation. Empty-query GET at its root calls
`next()`; despite the comment, it does not redirect to `/status`.

Express's implicit HEAD suppresses the body, not the handler. Gratitude's `/new`
still publishes; an enabled admin `/restart` still restarts the supplied fake
capability. Router-only OPTIONS can advertise GET/HEAD, but global default CORS
ends normal preflight first with 204. ALL and USE handlers can also intercept
methods. Preserve optional Express patterns such as `/card/print{/:location}`
and wildcard forms; braces are not literal URL characters.

## Executable evidence and remaining gates

The 12 `CASE-REG-*` cases execute the original API/proxy/admin/agent helper code
with actual Express and Node response serialization over a memory-only stream.
No socket, provider, printer or household controller is started. The existing
Gratitude wire cases use the same new HTTP harness. Its first run exposed a
test-harness omission: IncomingMessage was not marked complete when the body
ended, so Node treated it as an aborted socket. The harness was corrected and
the failed/cancelled receipt retained; it is not a product regression or red proof.

Current results are selected by fresh hashes in `evidence-index.json`. Neither
these cases nor the static inventory certifies complete authentication, every
request/error combination, configured activation, actual static serving or a
relocated candidate. Those remain verification/implementation gates. Provider,
scheduler, websocket and cleanup wiring remain PRE-2.2.3; storage/resources and
satellite protocols remain PRE-2.3.
