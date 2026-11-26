# Service, device and realtime access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authorize devices, bots, callbacks, jobs, CLI operations and live events within the household and resources they serve.

**Architecture:** Reuse each protocol's verification mechanism and translate its verified result into the common access context. Bind human delegation separately from workload authority. Partition dispatch, event delivery, retained state and retry keys using the same trusted household.

**Tech Stack:** Node.js ≥22.13, ES modules, Express 5, React, the existing YAML stores and Vitest. Also uses the installed Android JVM, WebSocket, MQTT and Telegram adapters.

**Spec:** [Identity, access, and policy scope](../specs/2026-11-26-identity-and-access-design.md). Start with the [foundation and rollout order](2026-11-26-identity-and-access.md).

## Global Constraints

- One installation can serve multiple households.
- Personal browser apps require a signed-in user. Admin requires a signed-in adult owner or admin of the active household.
- Kids have no login credentials. A future teen login cannot grant administrative authority.
- Kiosks never prompt for browser login. Piano and School can trust a tap or card for participation. Selected games and overrides can require a biometric match with user or admin authority.
- Named and unnamed guests can play Piano, do guest work in School, and use a heart-rate monitor in Fitness. Neither kind of guest earns Fitness rings.

## Review Focus

1. A household rotates a device/service credential while it has a live connection or queued work. Refuse its next action and stop delivery (S1/S4/S5).
2. Two Telegram senders share a group, or one sender uses a private chat with a different bot. Bind the actual sender, bot, household and permitted destination (S2).
3. A callback/poll retry arrives after a household changes configuration. Resolve it to its enrolled resource, preserving native acknowledgements and idempotency (S2/S3).
4. Two household garages use the same MQTT topic suffix or WS wildcard/snapshot. Only the authorized subscribers in that household receive it (S4).
5. Two jobs share an ID or a CLI/agent supplies an arbitrary user ID. Preserve the initiating actor, task identity and consent through retry (S5).

---

F1–F5 supply membership, explicit household runtime, operation catalog and decisions. S1 feeds browser/kiosk device authentication. S4 supplies protected reader events to K5. A service-side 200 may mean an external callback was acknowledged. Acceptance checks recorded dispatches and writes as well as the response status.

## File structure and task order

| Task | Responsibility and principal code owner |
|---|---|
| S1 | Enroll and revoke household device and service credentials · `__app_modules/household/supervision/server/adapters/KioskSessionAuthority.mjs` |
| S2 | Authorize Telegram transport, sender and conversation independently · `__backend/src/4_api/v1/middleware/messagingWebhookValidation.mjs` |
| S3 | Bind provider callbacks and physical bridges to enrolled targets · `__app_modules/wellness/fitness/server/adapters/strava/StravaWebhookAdapter.mjs` |
| S4 | Enforce publish, subscribe, replay and reconnect on live transports · `__backend/src/1_adapters/eventbus/WebSocketEventBus.mjs` |
| S5 | Run jobs, agents and CLI operations with explicit delegated scope · `__backend/src/3_applications/scheduling/SchedulerOrchestrator.mjs` |

Source paths and test commands are relative to the DaylightStation checkout. New tests below use Vitest unless a command specifies another runner. Each assertion block lists the cases for the named test file. Build test inputs locally using the listed fixtures and real owner interfaces.

### S1. Enroll and revoke household device and service credentials

**Files**

- Create `__backend/src/3_applications/auth/ServiceCredentialRegistry.mjs`.
- Create `__backend/src/1_adapters/YamlServiceCredentialStore.mjs`.
- Create `__backend/src/4_api/v1/routers/admin/accessCredentials.mjs`.
- Modify `__app_modules/household/supervision/server/adapters/KioskSessionAuthority.mjs`.
- Modify `__backend/src/4_api/middleware/screenIdentityResolver.mjs`.
- Modify `__backend/src/1_adapters/notification/NetworkTrustPushDeviceAuth.mjs`.
- Modify `__backend/src/4_api/v1/routers/device.mjs`.
- Modify `__capabilities/quick-input/server/api/quickInputRoute.mjs`.
- Modify `_extensions/daylight-android/core/src/main/java/net/kckern/daylight/core/backend/BackendHttp.java`.
- Modify `__backend/src/4_api/v1/routers/admin/index.mjs`.
- Test `tests/isolated/api/access/deviceServiceCredentials.test.mjs`.

**Interfaces**

- Consumes F2 runtime/registered device config, F3 surface grants, the existing kiosk session, phone install key, service secret references and admin/operator provisioning authority.
- Produces `registry.verify({credential,usage,originHouseholdId}) -> {householdId,kind:'device'|'service',id,version,grants}` or null. `issue`, `rotate` and `revoke` require the household management grant. Existing provider verifiers return equivalent trusted records. Bind enrollment/rotation/revocation to `POST /api/v1/admin/access/credentials`, `/:id/rotate`, and `/:id/revoke` under the same mount. Return verifier metadata after issuance. Emit the one-time enrollment value only on initial creation.

- [ ] Write `an unattended device renews only its own scopes and revocation closes the session` with these assertions.

  ```js
  expect(station.actor).toEqual({kind:'device',id:'garage'})
  expect(foreignSameLabel).toBeNull()
  expect(oldKeyAfterRotation).toBeNull()
  expect(deviceOpeningAdmin.effect).toBe('deny')
  expect(queuedPhoneUpload.owner).toEqual({householdId:'a',personId:'sam'})
  expect([reboundPhone.replayedForNewPerson, carReader.controlDispatches]).toEqual([0,0])
  expect(renewed.personLoginPrompts).toBe(0)
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/deviceServiceCredentials.test.mjs`. Expect failure on header-only device access or unscoped rotation.
- [ ] Assign each caller a credential ID, purpose/audience, household, allowed actions/targets and key version. Store verifier digests or credential references using the installed household auth store. Provision with one-use, expiring enrollments approved outside kiosk/display interactions. Allow explicit short, versioned overlap on planned provider-key rotation and support immediate revocation.
- [ ] Reuse the kiosk credential/bootstrap and its short-lived kiosk token. Verify issuer, audience, kind, household and live key version. Absence of a person cookie is normal. Bind managed screens for commands/private projections and phone installs for permitted upload, push and device-inbox operations. An install key for an Android deep link alone cannot identify an adult web user.
- [ ] Route Android backend HTTP and kiosk/native renewal through the bound credential. Keep the upload queue's operation IDs, push callbacks and long-poll acknowledgements. Preserve existing provider-specific device credentials and narrowly validated webhook/callback ingress. Keep enrollment secrets out of URLs, browser logs and shared config projections.
- [ ] Run `npm run test:file -- tests/isolated/api/access/deviceServiceCredentials.test.mjs && node --test __capabilities/quick-input/server/api/quickInputRoute.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(auth): enroll scoped device and service credentials"`.

### S2. Authorize Telegram transport, sender and conversation independently

**Files**

- Create `__backend/src/3_applications/auth/TelegramDelegation.mjs`.
- Modify `__backend/src/4_api/v1/middleware/messagingWebhookValidation.mjs`.
- Modify `__backend/src/4_api/v1/middleware/messagingWebhookIdempotency.mjs`.
- Modify `__backend/src/1_adapters/telegram/createBotWebhookHandler.mjs`.
- Modify `__backend/src/1_adapters/telegram/IInputEvent.mjs`.
- Modify `__backend/src/1_adapters/messaging/YamlConversationStateDatastore.mjs`.
- Modify `__app_modules/household/homebot/server/adapters/HomeBotInputRouter.mjs`.
- Modify `__app_modules/personal/journalist/server/application/services/JournalistInputRouter.mjs`.
- Modify `__app_modules/wellness/nutribot/server/application/services/NutribotInputRouter.mjs`.
- Modify `__backend/src/5_composition/integrations/SystemBotLoader.mjs`.
- Test `tests/isolated/api/access/telegramDelegation.test.mjs`.

**Interfaces**

- Consumes S1 credential for the specific bot, Telegram sender `from.id`, actual chat ID and bot ID, existing verified private-message Work/Knowledge checks, explicit household sender/chat bindings.
- Produces `resolveTelegramDelegation({verifiedBot,chatId,senderId,operation}) -> {ctx,delegatedPersonId,replyChatId}` or refusal. The effective operations are the intersection of bot grant, delegated member grant and permitted conversation disclosure.

- [ ] Write `a verified group message retains the real sender and destination` with these assertions.

  ```js
  expect(twoConcurrentMessages.map(x=>x.delegatedPersonId)).toEqual(['sam','other'])
  expect(unknownSender.effects).toHaveLength(0)
  expect([wrongBot.effects,ambiguousHouse.effects,privateReportToGroup.effects]).toEqual([[],[],[]])
  expect(callbackActor).toBe(personWhoPressed)
  expect(duplicate.deliveryCount).toBe(1)
  expect(oldConversation.replyChatId).toBe(groupChatId)
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/telegramDelegation.test.mjs`. Expect failure on conversation-as-user fallback or cross-request retained event.
- [ ] Require a verified configured webhook secret for an enabled bot before deduplication, forwarding or handling. For a dedicated bot resolve its registered household. For a shared bot require exactly one enrolled household/chat or unambiguous approved private binding before resolving a user. Bind sender from the update or callback and authorize its action. Unknown/ambiguous senders may receive only an explicitly public response. Never create a personal `_unknown` record.
- [ ] Pass the verified immutable context per update through Homebot, Nutribot and Journalist, including callbacks, edits and replies. Remove conversation-as-person defaults and request-global mutable event state. Use the provider chat ID for reply routing and preserve existing bot/chat conversation keys inside a verified household namespace. Keep stronger Work and Knowledge requirements for private, authored messages.
- [ ] Partition deduplication, conversation persistence and outbound routing by `(hid,botId,chatId)` plus update/operation ID. Preserve Telegram's expected acknowledgement and retry behavior. Treat a forwarded update or a changed group participant as fresh evidence. Only an authorized human delegate can perform a personal mutation.
- [ ] Run `npm run test:file -- tests/isolated/api/access/telegramDelegation.test.mjs && npm run test:jest -- --runInBand --runTestsByPath tests/unit/suite/adapters/telegram/IInputEvent.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(messaging): scope Telegram calls to bot sender and chat"`.

### S3. Bind provider callbacks and physical bridges to enrolled targets

**Files**

- Create `__backend/src/3_applications/auth/IntegrationBindings.mjs`.
- Modify `__app_modules/wellness/fitness/server/adapters/strava/StravaWebhookAdapter.mjs`.
- Modify `__backend/src/1_adapters/harvester/fitness/WithingsHarvester.mjs` and `__app_modules/wellness/health/server/composition/app-runtime.mjs` at personal import and shared-scale routing.
- Modify `__app_modules/wellness/fitness/server/composition/api-runtime.mjs`.
- Modify `__backend/src/4_api/v1/routers/admin/oauth.mjs`.
- Modify `__app_modules/household/camera/server/api/camera.mjs`.
- Modify `__app_modules/household/donow/server/api/donow.mjs`.
- Modify `__app_modules/household/supervision/server/adapters/ApprovalCallbackAuthority.mjs`.
- Modify `__app_modules/learning/school/server/adapters/schoolcalc/SchoolCalcRelayCredentialVerifier.mjs`.
- Modify `__capabilities/device-dispatch/server/application/TriggerDispatchService.mjs`.
- Modify `__backend/src/5_composition/modules/ConfigDeviceBlueprintFactory.mjs`.
- Test `tests/isolated/api/access/integrationBindings.test.mjs`.

**Interfaces**

- Consumes S1 integration/bridge registry and F2 strict per-household adapters. Each provider keeps its existing state, callback nonce, signature, registered destination or authenticated follow-up verification.
- Produces `IntegrationBindings.resolve({provider,registrationId,externalOwnerId,direction}) -> {householdId,serviceId,resource}` or refusal. Verified events are enqueued with the resolved scope and retry key.

- [ ] Write `duplicate provider or physical events select the same authorized resource once` with these assertions.

  ```js
  expect(stravaAccepted.athleteId).toBe(boundAthlete)
  expect(ambiguousProvider.enqueues).toBe(0)
  expect(oneTimeState.reuseAccepted).toBe(false)
  expect(schoolRelay.targetHousehold).toBe('b')
  expect(foreignCamera.writes).toBe(0)
  expect(retry.count).toBe(1)
  expect(withingsTarget).toMatchObject({householdId:'b',resource:{kind:'person',id:'sam'}})
  expect([ambiguousScale.personalWrites, reassignedProvider.staleJobWrites]).toEqual([0,0])
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/integrationBindings.test.mjs`. Expect failure on default-head enrichment or unchecked device destinations.
- [ ] Bind Strava subscription/athlete IDs, Withings state, camera source, DoNow/HA target, supervision action nonce and SchoolCalc relay to the specific household and purpose. Preserve lossless provider IDs, quick acknowledgement and expected challenge responses. Where a provider supplies an unverifiable notification, use it as a hint for a scoped authoritative provider fetch before material writes. A provider callback that cannot carry a human session uses a dedicated service endpoint with bound one-time state. Move provider registration to it before closing any old Admin alias. The operator who initiates the flow still passes Admin authorization.
- [ ] Reject a missing or ambiguous binding before dispatch. Validate both inbound event authority and outbound destination authority. Incrementally provision older Piano/Fully/physical relay paths. Classify read-only discovery separately from an enrolled command. Resolve any device auth reference using the selected household.
- [ ] For personal measurements, bind the external provider subject or explicit device assignment to a household person. Persist the target and binding revision with the event. Open that person's store via F2 and use the credential belonging to that integration. A shared scale with no established subject cannot create a personal record. Preserve an intentionally single-person device through an explicit assignment during migration. Verify a Withings import while another adult is signed in and a retry after the provider is unlinked or reassigned.
- [ ] Persist household and integration identity before queueing. Key replay protection by household/provider/subscription/external event. Retain stronger provider-specific consent, callback and retry checks, and prevent the dev webhook forwarding path from widening access.
- [ ] Run `npm run test:file -- tests/isolated/api/access/integrationBindings.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(integrations): bind provider and bridge events to target households"`.

### S4. Enforce publish, subscribe, replay and reconnect on live transports

**Files**

- Create `__backend/src/3_applications/eventbus/HouseholdTopicPolicy.mjs`.
- Modify `__backend/src/1_adapters/eventbus/WebSocketEventBus.mjs`.
- Modify `__backend/src/3_applications/eventbus/ClientIngressService.mjs`.
- Modify `__backend/src/1_adapters/eventbus/transports/MqttEventTransport.mjs`.
- Modify `__backend/src/1_adapters/hardware/mqtt-sensor/MQTTSensorAdapter.mjs`.
- Modify `__backend/src/1_adapters/hardware/mqtt-selector/index.mjs`.
- Modify `frontend/src/services/WebSocketService.js`.
- Modify `__backend/src/app.mjs`.
- Test `tests/isolated/api/access/realtimeIsolation.test.mjs`.

**Interfaces**

- Consumes F2 household runtime and F3 decisions, S1 credential/session versions, existing HomeLine connection leases, retained snapshot stores and scanner ingress verification.
- Produces `HouseholdTopicPolicy.authorize({ctx,direction,topic,resource})` handles `publish|subscribe|deliver|replay`. Translate wire topic names to a household-owned internal bus namespace and retain owner/participant qualifiers for private topics.

- [ ] Write `a reconnect or wildcard only receives allowed messages in its own household` with these assertions.

  ```js
  expect(subA.frames.map(x=>x.marker)).toEqual(['a-public','a-own'])
  expect(forgedIdentify.controlPublished).toBe(false)
  expect(afterRevoke.frames).toHaveLength(0)
  expect(mqttB.deliveriesToA).toBe(0)
  expect(retainedPrivateReplay.delivered).toBe(false)
  expect(validHomeLineLease.delivered).toBe(true)
  expect([restrictedHomeStream.hiddenEntityFrames, otherViewer.resumePositionFrames]).toEqual([0,0])
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/realtimeIsolation.test.mjs`. Expect failure on unpartitioned wildcard, identify, snapshot or broadcast.
- [ ] Apply the same F3 resource projection to snapshot, replay and live delivery as the corresponding HTTP read. Verify a read-only Home viewer receives the admitted entities, a withdrawn camera grant ends its feed, and private Media progress never appears on the household broadcast. Include retained messages published before a role change.
- [ ] Bind the WS connection on handshake or an authenticated registration exchange, using browser session, registered kiosk/phone/service, or the narrow open-display grant. Retain Origin checks and authenticated native clients without an Origin. Treat `identify` as a routing hint inside the authenticated scope. Apply topic grants to both inbound commands and outbound delivered/replayed frames, including wildcard, direct-to-device, snapshots and internal bridge broadcasts.
- [ ] Partition subscriber maps, native routing IDs, queues, retained messages, liveness and MIDI/HR/scanner frames by household and authorized device/participant. Preserve existing stronger HomeLine leases. Drop private frames and close/revalidate streams on expiry, revocation, audience or household changes, and re-prove authorization on reconnect. Browser logout clears queued messages/subscriptions.
- [ ] Authenticate MQTT connections and bind provider/topic subscriptions to configured household namespaces, broker ACLs and adapter-side validation. A shared broker must have distinguishable authorized topics/connections. Restrict reader results to the verifier and requestor. Reject unpartitionable shared feeds for the second household.
- [ ] Run `npm run test:file -- tests/isolated/api/access/realtimeIsolation.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(eventbus): isolate subscriptions publications and replay"`.

### S5. Run jobs, agents and CLI operations with explicit delegated scope

**Files**

- Create `__backend/src/3_applications/auth/WorkloadContext.mjs`.
- Modify `__backend/src/3_applications/scheduling/SchedulerOrchestrator.mjs`.
- Modify `__backend/src/1_adapters/scheduling/AgentAssignmentScheduler.mjs`.
- Modify `__backend/src/4_api/v1/routers/scheduling.mjs`.
- Modify `__capabilities/agent-runtime/server/application/AgentOrchestrator.mjs`.
- Modify `__capabilities/agent-runtime/server/api/mountAgentHttp.mjs`.
- Modify `__capabilities/agent-runtime/server/api/createAgentMemoryRouter.mjs`.
- Modify `__app_modules/wellness/health/server/composition/coaching.mjs` where a household-head default selects a coaching subject.
- Modify `__app_modules/household/concierge/server/application/policy/ConciergePolicyEvaluator.mjs`.
- Modify `cli/dscli.mjs`.
- Modify `cli/_bootstrap.mjs`.
- Modify `__backend/src/app.mjs`.
- Test `tests/isolated/api/access/workloadIsolation.test.mjs`.

**Interfaces**

- Consumes F2 runtime and scoped stores, S1 service credential and target allowlist, originating account and explicit delegation when supplied.
- Produces `createWorkloadContext({householdId,serviceId,initiator,delegatedPersonId,operationId}) -> ctx` from verified bindings. Scheduled, manual, legacy, delayed and retried work retain the household/service/operation identity.

- [ ] Write `two jobs with the same ID never share state or an agent's memory owner` with these assertions.

  ```js
  expect(storedRuns.map(x=>[x.householdId,x.jobId])).toEqual([['a','daily'],['b','daily']])
  expect(retry.delegate).toEqual(original.delegate)
  expect(revokedBeforeExecution.effectCount).toBe(0)
  expect(callerSuppliedForeignUser.status).toBe(404)
  expect(unscopedCliWrite.executed).toBe(false)
  expect(satelliteTools).toEqual(registeredToolGrant)
  expect([replayedJournal.subjectPersonId, workSummary.subjectPersonId]).toEqual([originalPerson,originalPerson])
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/workloadIsolation.test.mjs`. Expect failure on boot-household or default-head workload context.
- [ ] Partition scheduler/agent assignments, queues, receipts, locks, retries and audit by `(hid,serviceId,operationId)`. Verify current service permissions and any user delegation when admitting and again before the side effect. Resolve automatic runs from per-household config. A manual trigger must also check the operator's right to start that job, including legacy cron routes.
- [ ] Use the same rule for native agent run/stream/background routes, memory, and tool calls. Ignore body-selected authority. Resolve a separate person target only with an explicit grant. Preserve the `/v1` voice satellite bearer and existing per-satellite tool policy. Keep private results and partial streaming frames attached to the initiating scope.
- [ ] Run a Health Coach job for one household person with all browsers closed. Assert that its input history, generated dashboard, notification destination and retried writes belong to the same authorized person. Recheck a changed binding or delegated grant before writing or delivering the result.
- [ ] Make ordinary privileged CLI operations call an authenticated server API with explicit household and account/service identity. Bind intentionally offline maintenance to a separately authorized local operator with an explicit target. A CLI option or log origin label alone supplies no grant. Document rotate/revoke and safe requeue examples for the installed integrations. Offline-owner recovery is a distinct installation operation. Its credential cannot be used by a device or exchanged for a household participant identity.
- [ ] Run `npm run test:file -- tests/isolated/api/access/workloadIsolation.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(auth): carry workload identity through jobs agents and CLI"`.
