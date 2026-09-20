# Adaptive playback and media preparation

Status: design draft for user review; no implementation or deployment claimed.

## Objective and scope

Anyone in the household can press Play on available media and watch it reliably,
without the household operator troubleshooting formats, devices, or providers.

The user's explicit architectural constraint is that provider-specific behavior,
including all Plex mechanics, belongs under `backend/src/1_adapters/`.
The dependency rules in [DDD reference](../../reference/core/layers-of-abstraction/ddd-reference.md)
are authoritative. Content is a level-1 shared domain. It must not depend on the
level-2 media domain or on any provider implementation.

The intended outcome includes automatic preparation where possible, sustainable
quality selection, resource control, position-preserving recovery, and meaningful
failure reporting. Preparing media is a means to that outcome, not a replacement
for proving actual playback on household devices.

User-directed default: start playback optimistically through the ordinary path.
Do not make assessment, probing, validation or preparation a prerequisite for
ordinary playback. Preserve originals; create managed derivatives when an
assessment establishes a need; prefer uninterrupted playback over maximum quality;
show preparation progress when no sustainable path exists. Do not hide an
unplayable title to inflate the success rate. A user-requested unavailable title
remains visible with its actual status.

External outages, damaged originals, and inaccessible provider media cannot be
made playable by policy alone. Record these outcomes separately and include them
in attempted-play reporting. Never label them successful playback.

## Evidence and current seams

Inspected local revision: `df16b3d71`. Inspected deployment source revision:
`b9efaddcc215e63471ef9a6b402a286cdd85197d`. These are source observations,
not proof of the running container's build. Before implementation, reconcile the
deploy tree and verify the deployed build without overwriting unrelated work.

- `RegistryContentCatalogGateway` already hides source-method probing. Its
  `preparePlayback` currently resolves a stream URL; it is not a persistent
  rendition-preparation job. Preserve that distinction in naming and migration.
- `IPlaybackSessionGateway` is explicitly one-way playback reporting. Closing a
  report must not be assumed to stop a transcoder or release a stream.
- `media/PlaybackSession` identifies a reporting session by surface and content.
  Do not import it into content or silently replace its semantics. New playback
  attempts need their own unique generation and lifetime.
- `PlayResponseService` currently appends Plex offset/session URL parameters.
  Move this wire behavior behind an adapter as part of the affected flow.
- The player has a recovery ledger, health observations, and warmup handling.
  Integrate those mechanisms into one authority per session rather than adding a
  second independently firing retry loop.
- Current transcode helpers use static codec and bit-depth gates and caps. These
  are incident mitigations, not measured per-client compatibility guarantees.
- Prior documentation records failed hardware initialization in Plex's driver
  stack. Recheck the actual installed stack before treating this as current fact.
- The Mario investigation observed two software encoders and a proxy timeout.
  It did not establish encoder speed, ownership of the second session, or a
  conclusive cause. CPU utilization alone does not prove output starvation.

## Alternatives and recommendation

On-demand conversion minimizes storage but makes each playback depend on spare
compute. Converting all media ahead of time is predictable but duplicates work
and cannot apply to every remote or live provider. Use a hybrid: validated
originals and remuxes first, prepared compatible renditions where useful,
admitted on-demand conversion when sustainable, and provider-native adaptation
where that is all the provider exposes.

Do not replace the media server as a prerequisite. Do not make a working GPU a
prerequisite for the reliability policy. Acceleration changes available capacity;
it does not change the ownership or recovery rules.

## Domain model and boundaries

| Concept | Meaning |
|---|---|
| Source revision | Opaque identity of the actual source version; URL renewal alone is not a new revision |
| Rendition | A specific set of video, audio, subtitle, timing and delivery characteristics |
| Client profile | Versioned capabilities and observations for the renderer and device |
| Playback intent | Viewer, surface/slot, content, selected tracks, requested position and play/pause intent |
| Playback attempt | One generation opening and consuming a rendition for that intent |
| Readiness evidence | Validation for a source revision, rendition, client profile and relevant environment version |
| Preparation job | Durable work to produce and validate a managed rendition |

Pure selection and recovery policy belongs in `2_domains/content`. Time,
observations, budgets, and configured thresholds are supplied as inputs.
Application use cases under `3_applications/content` coordinate ports and persist
state. `4_api` performs HTTP mapping through injected dependencies.
`5_composition` wires dependencies only.

All provider identifiers, raw errors, driver checks, manifests, conversion
commands, absolute paths, and vendor URL manipulation remain in adapters.
Standard codec characteristics may cross the boundary as normalized media facts.
Domain and application code never branch on provider names or inspect provider
methods. Unknown facts are explicit, not guessed defaults.

## Application-owned ports

These are semantic responsibilities; implementation planning should reuse
existing ports where their meaning matches, not create a universal provider API.

| Responsibility | Operations and result contract |
|---|---|
| Playback source | Describe candidates; open an attempt; observe provider health; renew access; close an owned attempt |
| Preparation | Request an idempotent job; read progress; cancel; return unsupported when unavailable |
| Capacity | Atomically reserve, renew and release bounded conversion capacity; report unknown capacity explicitly |
| Repositories | Separate repositories for playback intent/attempt aggregate, preparation jobs and readiness evidence |

Description returns renditions and explicit supported operations. Opening returns
an opaque handle, actual selected characteristics when observable, conversion
mode (`none`, `remux`, `audio`, `video`, `unknown`), and a delivery descriptor.
Document operation results as discriminated variants: unsupported, unavailable,
preparing, opened, expired, or failed. Translate raw provider errors in adapters.
Never substitute a transport URL for a stable rendition identity.

A source adapter and a conversion adapter can be different services. Applications
pass opaque source references through ports; absolute file paths are resolved
inside infrastructure. Adapters do not import peer adapters. Infrastructure
bridges are assembled through composition and injected dependencies.

The existing reporting gateway continues to report confirmed playback. Reporting
failure does not invalidate a working stream; reporting success does not prove
decoded frames or resource cleanup.

## Optimistic start, selective assessment and learning

The fast path uses metadata and decisions already available from normal content
resolution plus locally cached risk evidence. It adds no mandatory ffprobe,
decoder benchmark, capability-network request, library scan or preparation wait.
Missing metadata or an absent readiness record does not itself trigger assessment.
Existing provider-required stream negotiation still happens; its safety constraints
are not bypassed by this optimistic policy.

Use these triggers for deeper assessment:

- A known-risk match from available metadata or learned evidence. Initial video
  seeds are HEVC, VP9 and AV1 at 1080-class resolution or above. Define that as
  width >=1920 OR height >=1080 so cropped widescreen and portrait media are
  covered. Codec profile, bit depth, HDR, frame rate and container refine the
  assessment; the seed is a suspicion, not an incompatibility verdict.
- The second distinct unexpected interruption within a rolling window.
- A definitive incompatibility such as a decoder rejecting the actual codec;
  do not wait for a second event when the first establishes failure.

Proposed configurable episode thresholds: no expected progress for >=1 second
after playback began opens an interruption; repeated waiting/stalled/error events
while it remains unresolved count once. Five continuous seconds of healthy
progress closes it. Two episodes starting within 120 seconds trigger assessment.
Keep counting across renderer remounts under the same playback intent. Exclude
user/application pauses, seeks and their bounded warmup, and hidden-tab suspension.
Missing frame counters do not prove a stall; use available progress/buffer signals.
An unresolved first stall or startup failure still has the existing bounded
timeout/recovery path (maximum 30 seconds after detection); the second-episode
rule must not strand a viewer forever in a first interruption.

Audio-only playback bypasses video risk rules and video preparation. It retains
basic health/URL recovery, with audio-specific assessment only on actual evidence
of an audio compatibility problem.

Known-risk assessment should run in the background at recruitment when cached
metadata matches. If it has not finished at Play, start normally unless existing
evidence already proves that path incompatible or unsustainable. Assessment never
implies conversion automatically, and it must yield resources to active playback.

Record outcomes, including successful normal playback, keyed to source revision,
client/renderer profile and environment version. Keep exact-item failures separate
from generalized patterns. Proposed conservative promotion: at least three distinct
source revisions across at least two titles on the same client profile show the
same attributed compatibility/conversion failure, with successful corrective
playback on at least two. Promote only the narrow observed feature combination to
an upfront-assessment rule, never to an unconditional transcode rule. Deduplicate
attempts from one incident; network-only and unknown-cause failures cannot promote
codec/container rules. Include sample counts and successes in confidence evidence.
Learned rules expire after seven days unless refreshed by qualifying evidence;
three subsequent healthy matching original-play sessions demote the rule. Client,
source or relevant provider configuration changes invalidate their scoped evidence.
These thresholds are initial policy settings to test, not measured constants.

## Selection and readiness after a trigger

Rank candidates by compatibility, sustainable delivery, user track choices,
quality and resource cost. Prefer a compatible original or lossless remux when
it meets the same sustainability requirement as a derivative. Do not silently
drop selected language, required subtitles, or required audio features to make a
candidate pass. Provide a visible explanation when those constraints preclude it.

When assessment is triggered, inspect exact codec/profile/level/bit depth, resolution, frame rate, dynamic range,
audio layout, container, selected tracks and timestamp integrity where available.
Browser capability APIs provide hints; actual decoded playback supplies evidence.
Unknown combinations outside a trigger play normally. Triggered assessments may
perform bounded validation; preparation requires evidence that a suitable
existing rendition or sustainable ordinary path is unavailable.

Readiness is scoped to source revision and client profile, with evidence timestamp
and configuration/version keys. Use `unknown`, `preparing`, `validated`, and
`unavailable` states. Validation does not guarantee future network availability.
Live and opaque sources expose their weaker evidence without claiming prepared
file guarantees. Keep usable originals available while preparation runs. These
readiness states describe assessment results, not an admission gate on all media.

## Attempt ownership and recovery

One authority owns attempt transitions per playback intent. Key ownership by
surface plus playback slot; composite playback may legitimately have multiple
slots. Two viewers of the same title are independent. Content ID is never a
sufficient deduplication key.

Every command and observation carries intent ID, attempt ID, generation and
sequence. Persist generation changes with compare-and-set semantics. Reject stale
observations, close late successful opens from superseded generations, and make
open/close requests idempotent. Restart reconciliation handles an external open
that succeeded before its acknowledgment was persisted.

Renew resource leases while the owning attempt is live. Losing a browser does not
depend on an unload event: expired leases trigger reconciliation and owned-resource
cleanup. A close timeout means cleanup is pending, not that capacity is free.
Never terminate another viewer's work or a provider session whose ownership is
unproven. Unsupported close/inspection requires conservative reservation expiry
and an explicit limitation, rather than pretending cleanup succeeded.

Use one shared recovery budget across remounts and renderer/backend actions.
Initial proposed limits: three replacement attempts per incident; reset the
incident only after 60 seconds of healthy playback; at most six replacements per
rolling ten minutes. Apply bounded backoff to transient failures. A known
incompatible combination is not retried without changed evidence.

Classify from correlated client and provider observations:

| Evidence | Response |
|---|---|
| Network delivery falls behind with available server output | Renderer adapts within available variants; avoid adding conversion work |
| Conversion produces less than playback consumes and buffer trends down | Switch to prepared rendition or cheaper admitted conversion; release superseded work |
| Decoder rejects rendition | Record scoped incompatibility and select a distinct compatible candidate |
| Access expires or provider session disappears | Renew or reopen at confirmed content position |
| Intentional pause, seek warmup or background throttling | Respect intent and distinct deadlines; do not count as sustained playback failure |
| Cause unknown | One bounded diagnostic recovery, then another supported path or explicit failure |

Native HLS/DASH adaptation stays inside the renderer. Backend policy changes
delivery paths only when needed. Lower bitrate alone is not assumed to solve
decode cost. Hardware success is established by observed processing, not a
configuration checkbox. CPU percentage alone cannot trigger a quality reduction.

Default replacement is break-before-make for scarce conversion resources. Permit
at most one overlapping replacement per intent only with an additional capacity
reservation and a finite deadline. Preserve pause, tracks and confirmed content
position; account for rendition time origins and do not silently rewind to zero.

## Preparation and adaptive delivery

Screen already-available recruitment metadata for known-risk matches; do not
probe every new or changed source. Only flagged sources or playback-triggered
assessments enter inspection. An existing-library sweep is opt-in and screens
cached metadata only, prioritizing requested and scheduled flagged content.
Deduplicate jobs by
source revision, output profile, track selection and preparation implementation
version. Prepare originals only when the source grants access for this operation.

Begin with a broadly compatible H.264 8-bit / AAC rendition for supported fleet
profiles, plus lower-cost variants where measurements justify them. This is a
tested fleet target, not a claim of universal codec support. Preserve aspect ratio
and timing, never upscale, and explicitly handle HDR-to-SDR conversion and
subtitle requirements. Validate outputs before atomic publication.

For managed adaptive sets, align segment boundaries and keyframes and validate
switching, seeking and audio continuity. A list of separate full-file URLs does
not count as seamless adaptive streaming. Use existing provider variants when
appropriate rather than producing redundant ones.

Run a bounded, resumable preparation queue below playback priority. Stop admitting
background work when playback lacks headroom; use cancellation/restart when the
engine cannot pause safely. Require a configured storage quota and free-space
reserve before enabling preparation. Evict only unpinned, reproducible derivatives;
never evict originals or files referenced by live attempts. Eviction invalidates
readiness. Partial outputs are never playable artifacts.

Where no sustainable path exists, retain the title and user intent, show actual
preparation progress (or an honest indeterminate state), and begin when ready if
the viewer still wants it. A failure provides retry after conditions change and a
diagnostic reference. Never silently skip a selected movie or loop forever.

## Observability and acceptance

Correlate source revision, intent, attempt, rendition, client profile, decision
reason, observed mode, buffer trend, decoded progress, recovery action and cleanup
result through the existing structured logger. Do not log credentials or signed
URLs. Measure all requested starts, including unsupported and preparation cases.

Proposed release criteria, to become executable tests in the implementation plan:

1. Representative fixtures cover H.264, HEVC 8/10-bit, AV1, VP9, high frame rate,
   HDR, unusual AAC layouts, alternate audio, text/image subtitles, bad timestamps,
   corrupted media and expiring URLs. Expected outcomes are explicit per fixture.
2. Exercise actual household browser/renderer profiles on supported devices.
   Validate Plex, filesystem delivery and remote adaptive delivery; exercise an
   opaque provider's limited contract. Inventory other enabled providers before
   declaring fleet coverage complete; do not exempt them by omission.
3. On the controlled LAN, each prepared test rendition starts within five seconds
   and plays at least 30 minutes (or its full duration when shorter) without
   unexpected rebuffering. Run a full-length film and repeated seeks as well.
4. Network reduction below the active variant but above a lower variant triggers
   adaptation and sustained playback. Capacity exhaustion triggers a sustainable
   path or preparation without an unbounded increase in conversions.
5. Inject renderer failure, slow conversion, expired access, provider restart,
   browser disconnect and delayed/out-of-order responses. Recovery must produce
   decoded progress or a useful terminal/preparing state within 30 seconds of
   detection; preparation itself may take longer and must remain observable.
6. Recoverable VOD switches preserve position within two seconds or one declared
   segment duration, whichever is greater, plus selected tracks and pause intent.
   Live streams use their advertised seek window, not fabricated VOD offsets.
7. Verify one authoritative attempt per intent, bounded overlap, no cross-viewer
   termination, and resource cleanup within the configured lease/reconciliation
   deadline. Include process death between external open and persistence.
8. Validate preparation crash recovery, idempotency, quota exhaustion, pinned
   artifacts, atomic publication, invalidation and original preservation.
9. Layer-boundary checks forbid provider branches and vendor wire construction
   in new shared policy/use cases. Provider adapters pass the same semantic
   contract suite with differing supported-operation results.
10. Compare observed startup, rebuffering, recovery and resource counts before and
    after rollout. Green policy tests alone do not establish the household goal.
11. Ordinary audio/video, including unflagged video with missing metadata, starts
    without an added assessment request or probe/preparation job. Measure the
    incremental local decision cost and end-to-end startup against the old path;
    proposed budgets are <=10ms p95 local decision time and <=100ms p95 added
    startup time across at least 30 paired runs per representative client profile.
12. One interruption emitting many events counts once; the second qualifying
    episode triggers exactly one assessment. Intentional pauses, seek warmup and
    suspension do not count. Definitive incompatibility escalates immediately,
    and an unresolved first stall times out. Test risk-rule promotion, negative
    evidence, expiry, demotion, invalidation and device scoping.

Thresholds above are proposed acceptance targets, not measured current behavior.
Record failures and adjust implementation or hardware capacity openly; do not
silently weaken the criteria to match a failing test.

## Delivery sequence and review state

Implement through separately reviewable increments while retaining the full goal:

1. Reconcile current source; inventory provider/client capabilities and capture
   reproducible playback baselines. Establish the shared rendition/attempt contract.
2. Implement selection, ownership, resource accounting and unified recovery;
   migrate existing reporting and renderer integration without dual retry owners.
3. Implement durable preparation, validation, storage management and adaptive sets.
4. Integrate all enabled provider paths, run fault/device acceptance, and roll out
   incrementally with a feature-controlled rollback. Reconcile owned resources on
   rollback; do not leave conversion work orphaned.

Each increment is progress, not completion of the objective. GPU repair can be
an independently verified adapter/infrastructure improvement. It cannot replace
the shared reliability work or its acceptance evidence.

Draft self-review: responsibilities and existing seams are identified; no provider
behavior is assigned to the domain; reporting and resource ownership remain
separate; readiness and preparation limitations are explicit; completion requires
real playback evidence. User review of this written design precedes the written
implementation plan and execution under the invoked brainstorming workflow.
