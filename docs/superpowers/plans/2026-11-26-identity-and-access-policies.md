# Person and role policy assignments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a household's access, content and entitlement rules to the intended participant or audience.

**Architecture:** Store validated bindings in one versioned household policy. The shared resolver selects policy references. The existing Content Filter and State Gates owners evaluate those references and keep their existing editing and evaluation semantics.

**Tech Stack:** Node.js ≥22.13, ES modules, Express 5, React, the existing YAML stores and Vitest.

**Spec:** [Identity, access, and policy scope](../specs/2026-11-26-identity-and-access-design.md). Start with the [foundation and rollout order](2026-11-26-identity-and-access.md).

## Global Constraints

- One installation can serve multiple households.
- Personal browser apps require a signed-in user. Admin requires a signed-in adult owner or admin of the active household.
- Kids have no login credentials. A future teen login cannot grant administrative authority.
- Kiosks never prompt for browser login. Piano and School can trust a tap or card for participation. Selected games and overrides can require a biometric match with user or admin authority.
- Named and unnamed guests can play Piano, do guest work in School, and use a heart-rate monitor in Fitness. Neither kind of guest earns Fitness rings.
- Content Filter, State Gates, and other feature policies can be assigned to individual people or roles as well as wider scopes.

## Review Focus

1. An individual policy and two equally specific role rules disagree. Resolve a valid person rule and reject ambiguity at activation (P1).
2. Two people watch one title under different filters, or an empty room has a floor. Use an explicitly approved combined profile or hold playback (P1/P3).
3. A participant asks for another household's filter or an unrestricted stream during a protected play. Preserve the active audience and its approved delivery mode (P3).
4. A learner's gate is missing, stale, or belongs to the approving adult. Evaluate the authoritative learner, period and configured failure posture (P2).
5. An admin edits rules concurrently with a participant switch, or loses their grant while editing. Reject stale edits and invalidate decisions at use (P1/P4).

---

After F1–F5 this track can ship the resolver and domain adapters behind observation mode. Kiosk and browser consumers pass the same context. The durable configuration owns *assignment*. Existing gate definitions, EDLs, title overrides and domain-specific editor controls stay with their current owners.

## File structure and task order

| Task | Responsibility and principal code owner |
|---|---|
| P1 | Resolve policy bindings and validate conflicting assignments · `__backend/src/1_adapters/auth/YamlAccessPolicyStore.mjs` |
| P2 | Apply State Gates to the affected participant and period · `__capabilities/state-gates/server/application/StateGatesEngine.mjs#getCurrentEntitlements` |
| P3 | Resolve a playback audience and enforce its selected profile · `__app_modules/media/media/server/composition/content-filter.mjs#createContentFilterRuntime` |
| P4 | Preview and activate access policies from household Admin · `__backend/src/4_api/v1/routers/admin/index.mjs` |

Source paths and test commands are relative to the DaylightStation checkout. New tests below use Vitest unless a command specifies another runner. Each assertion block lists the cases for the named test file. Build test inputs locally using the listed fixtures and real owner interfaces.

### P1. Resolve policy bindings and validate conflicting assignments

**Files**

- Create `__backend/src/3_applications/auth/ScopedPolicyBindings.mjs`.
- Modify `__backend/src/1_adapters/auth/YamlAccessPolicyStore.mjs`.
- Test `__backend/src/3_applications/auth/ScopedPolicyBindings.test.mjs`.

**Interfaces**

- Consumes F1 membership/directory, F3 AccessContext, household and installation policy snapshots. Named roles, people and resources are validated against their own household. F3 supplies the versioned grant store. This task adds domain binding validation and resolution.
- Produces `resolveBindings({ctx,action,resource,audience,policy}) -> {profileId,requiredEntitlements,overridable,revision}` or a typed denial. `validateBindings(candidate, catalog)` returns field errors. `store.activate(hid,expectedRevision,candidate)` returns the new revision or conflict.

- [ ] Write `person, role and room bindings produce deterministic audience obligations` with these assertions.

  ```js
  expect(forSam.profileId).toBe('sam-custom')
  expect(forSam.requiredEntitlements).toEqual(['piano.games','session.ready'])
  expect(emptyLounge.profileId).toBe('family')
  expect(mixedLounge.profileId).toBe('family-and-child')
  expect(noApprovedCombination.reason).toBe('audience_profile_conflict')
  expect(ambiguousRoleActivation.status).toBe(422)
  ```

- [ ] Run `npm run test:file -- __backend/src/3_applications/auth/ScopedPolicyBindings.test.mjs`. Expect failure on person/role resolution and group conflicts.
- [ ] Store `{schema:'household-access/v1',revision,grants,bindings,groupProfiles}` in household `auth/access.yml`. A binding has `id`, `action`, `target:{kind,id?}`, optional resource type/id and exactly one value: `profileId`, `floorProfileId` or `requiredEntitlement`. Target kinds are `system`, `household`, `room`, `device`, `role`, `age`, `guestKind`, `person`. `system` entries come only from installation policy. An entitlement binding may explicitly name its `overridable` operation.
- [ ] Implement the specificity and conflict rules in the spec. Select defaults per person, collect required floors for the actual room plus every audience member, and require an exact approved set in `groupProfiles:[{profiles:[...],use:...}]` when profiles differ. Resolve anonymous-seat and empty-audience defaults explicitly. Accumulate and deduplicate applicable entitlement IDs. Validate overlapping assignments on policy or membership changes, and handle unexpected runtime ambiguity as a denial.
- [ ] Serialize edits per household, require the previous revision, atomically persist a validated candidate, and keep the last valid revision on failure. Key cached resolutions by household, policy and membership revisions, action, resource, device and audience. Invalidate on participant changes.
- [ ] Run `npm run test:file -- __backend/src/3_applications/auth/ScopedPolicyBindings.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(auth): resolve scoped policy bindings"`.

### P2. Apply State Gates to the affected participant and period

**Files**

- Create `__capabilities/state-gates/server/application/AccessEntitlements.mjs`.
- Modify `__capabilities/state-gates/server/application/StateGatesEngine.mjs` at `getCurrentEntitlements`.
- Modify `__capabilities/state-gates/server/adapters/ingress/HttpStateGatesIdentityAdapter.mjs` at `actorFromRequest`.
- Modify `__capabilities/state-gates/server/adapters/auth/RoleStateGatesAdministrationAuthorizer.mjs`.
- Modify `__capabilities/state-gates/server/api/state-gates.mjs`.
- Modify `__capabilities/state-gates/server/api/admin/state-gates.mjs`.
- Modify `__backend/src/3_applications/auth/AccessService.mjs`.
- Modify `__docs/reference/state-gates/policy-authoring.md`.
- Test `__capabilities/state-gates/server/application/AccessEntitlements.test.mjs`.

**Interfaces**

- Consumes P1 bindings and F3 verified caller. Reuse StateGatesEngine.getCurrentEntitlements(hid, filters), the existing subject catalog and household timezone. F3 creates `__backend/src/3_applications/auth/AccessService.mjs` before this task.
- Produces `AccessEntitlements.check({ctx,resource,bindings,subjects,period}) -> {allowed,reason,validUntil,degraded}`. A role selects the rule. The existing learner, household, room or device ID identifies the evaluated state.

- [ ] Write `a child's gate belongs to the child after an adult scan` with these assertions.

  ```js
  expect(queried).toMatchObject({householdId:'a',subject:{kind:'learner',id:'kid'}})
  expect(outcomes).toMatchObject({satisfied:true,unsatisfied:false,indeterminateClosed:false,indeterminateOpen:true})
  expect(missingRequired.allowed).toBe(false)
  expect(guestWithNoApplicableBinding.allowed).toBe(true)
  expect(adultApprovalForOtherGate.allowed).toBe(false)
  expect(foreignAttestation.status).toBe(404)
  expect(requiredWrongSubjectKind.allowed).toBe(false)
  ```

- [ ] Run `npm run test:file -- __capabilities/state-gates/server/application/AccessEntitlements.test.mjs`. Expect failure when the approving actor replaces the affected learner or network authority is used.
- [ ] Map each matched binding to its declared domain subject. Validate its subject kind, household and period before requesting the existing entitlement decision. Keep the domain's four states and configured failure posture. A required binding whose subject/decision cannot be resolved is unavailable. If a household did not bind an entitlement to guests, guest School practice needs no learner record.
- [ ] Guard queries, transition replay, attestations, retractions and policy activation with separate IAM actions and target filters. Verify service publishers and authorized operator roles independently. Reserve `network_trust` for observation-only compatibility, and pass the resolved actor on externally initiated writes. Retain domain revision, idempotency, publication provenance, and supervision checks.
- [ ] Add applicable requirements to the effect guard, carrying the earliest validity boundary. Consume an authorized override only for the explicitly overridable binding and its exact resource. A denied permission, foreign household, ineligible admin, or another active gate remains binding.
- [ ] Run `npm run test:file -- __capabilities/state-gates/server/application/AccessEntitlements.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(state-gates): evaluate household policy for the affected subject"`.

### P3. Resolve a playback audience and enforce its selected profile

**Files**

- Create `__app_modules/media/media/server/application/content-filter/PlaybackAudiencePolicy.mjs`.
- Modify `__app_modules/media/media/server/composition/content-filter.mjs` at `createContentFilterRuntime`.
- Modify `__app_modules/media/media/server/api/contentFilter.mjs`.
- Modify `__app_modules/media/media/server/application/content-filter/usecases/GetContentFilter.mjs` at `execute`.
- Modify `__app_modules/media/media/browser/content-filter/useFilterData.js`.
- Modify `__app_modules/media/media/browser/content-filter/videoPresentation.jsx`.
- Modify `__app_modules/media/media/server/api/stream.mjs`.
- Modify `__capabilities/playback/server/api/play.mjs`.
- Modify `__docs/reference/core/content-filter.md`.
- Test `tests/isolated/api/access/filteredPlayback.test.mjs`.

**Interfaces**

- Consumes P1 audience resolution, B3/B4 projected room/media operations and the existing content-filter reader. An approved play references one household, audience/session and title.
- Produces `PlaybackAudiencePolicy.forPlay({ctx,resource,audience}) -> {profileId,policyRevision,required,delivery}`. Content Filter returns the household profile selected for the admitted play. Explicit profile preview has its own adult administrative action.

- [ ] Write `participants receive their resolved filter on fetch and media delivery` with these assertions.

  ```js
  expect(childPlayback.profileId).toBe('kids')
  expect(clientRequestedAdult.profileId).toBe('kids')
  expect(approvedMixed.profileId).toBe('family-and-child')
  expect(missingRequiredEdl.playable).toBe(false)
  expect(downgradeThroughRawStream.status).toBe(403)
  expect(profileBWasRead).toBe(false)
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/filteredPlayback.test.mjs`. Expect failure on caller-selected/default-household profile or an alternate private delivery path.
- [ ] Bind the repository, filter jobs and per-title queues to the selected household. Treat the existing family profile/film/cue resolution as the effective filter content after server profile selection. Pass the resolved audience from play, cast, resume and the screen session. Keep an admin preview operation for editors who intentionally audition a particular profile.
- [ ] Carry `policyRevision`, audience and delivery constraints through a server-issued play authorization. A filter preference can use the existing player. For a mandatory rule allow only a delivery path that actually enforces the required rendition or a household-approved managed player inside the declared trust boundary. Refuse an unfiltered direct/raw/download/alternate-provider URL to an untrusted client. An unimplemented rendition or missing required EDL holds that play. Keep filter bypass and alternate track controls behind their declared permissions.
- [ ] Invalidate/re-evaluate when the audience, active policy or membership changes, including a cast to another room. Partition private response/art/stream caches by household and authorized play so a previous user cannot retrieve the prior policy or bytes.
- [ ] Run `npm run test:file -- tests/isolated/api/access/filteredPlayback.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(media): bind playback filters to the authorized audience"`.

### P4. Preview and activate access policies from household Admin

**Files**

- Create `__backend/src/4_api/v1/routers/admin/accessPolicy.mjs`.
- Create `frontend/src/modules/Admin/Household/AccessPolicies.jsx`.
- Modify `__backend/src/4_api/v1/routers/admin/index.mjs`.
- Modify `frontend/src/Apps/AdminApp.jsx`.
- Modify `frontend/src/modules/Admin/AdminNav.jsx`.
- Test `tests/isolated/api/access/policyAdministration.test.mjs`.
- Test `frontend/src/modules/Admin/Household/AccessPolicies.test.jsx`.

**Interfaces**

- Consumes F3/F4 Admin checks, P1 validated store, P2/P3 domain catalogs. The API and UI share the policy revision.
- Produces `GET /admin/access-policy`, `POST /admin/access-policy/preview`, and `PUT /admin/access-policy` below `/api/v1`. Preview is read-only and shows matched rule IDs, subjects, effects and reasons. Activation requires `If-Match` and `policy.manage`.

- [ ] Write `only the active household administrator can preview and activate a valid policy` with these assertions.

  ```js
  expect(preview.changedFiles).toEqual([])
  expect(preview.matchingRules).toContain('kid-in-lounge')
  expect(revokeDirectGrant.effectiveSourcesAfter).toEqual(['role:media-viewer'])
  expect([preview.privateRows, preview.deviceEffects]).toEqual([[],[]])
  expect([stale.status,demoted.status,teen.status,foreignTarget.status]).toEqual([409,403,403,404])
  expect(activeAfterInvalid.revision).toBe(previous.revision)
  expect(audit.change).toMatchObject({householdId:'a',actorId:adminId,revision:nextRevision})
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/policyAdministration.test.mjs frontend/src/modules/Admin/Household/AccessPolicies.test.jsx`. Expect failure on missing admin endpoints/preview and revision check.
- [ ] Mount the operations under the Admin guard. Add a scoped editor that names the household, subject (person, role or group), action, resource and rule. Preview a representative affected person/room with the resolver, identify applicable floors, and show actionable validation/conflict errors. Never use a preview as a credential or issue an override from this API.
- [ ] Expose the editor and Check access through B6 using the same preview service. Show current/proposed effective decisions, matched direct and inherited sources, remaining grants and affected capabilities. Include a read-only Home example and an attempted change to a protected teen/guest invariant. Recheck delegation authority for role or policy administration changes. The preview can explain a Health restriction without reading the protected record.
- [ ] Validate ownership of all referenced people, guests, devices, policies and entitlements. Reject unsupported roles and privilege assignment via the general config editor. Recheck the editor's live authority on save, persist atomically, and report the previous/new revision in structured audit events. Refresh affected sessions and subscriptions. Require the live adult Admin decision for preview and save, including policy authoring endpoints that live outside the Admin namespace.
- [ ] Run `npm run test:file -- tests/isolated/api/access/policyAdministration.test.mjs frontend/src/modules/Admin/Household/AccessPolicies.test.jsx`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(admin): preview and activate household access policies"`.
