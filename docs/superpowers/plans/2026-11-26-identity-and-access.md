# Daylight Station identity and access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every surface an enforceable action policy while supporting several isolated households on the same installation.

**Architecture:** Extend the current account, session, household and participant services. Resolve the caller, household, affected people and resource on the server, then let the owning app enforce its domain policy. Each surface cuts over once its actual clients pass the two-household matrix.

**Tech Stack:** Node.js ≥22.13, ES modules, Express 5, React, the existing YAML stores and Vitest.

**Spec:** [Identity, access, and policy scope](../specs/2026-11-26-identity-and-access-design.md).

## Global Constraints

- One installation can serve multiple households.
- Personal browser apps require a signed-in user. Admin requires a signed-in adult owner or admin of the active household.
- Kids have no login credentials. A future teen login cannot grant administrative authority.
- Kiosks never prompt for browser login. Piano and School can trust a tap or card for participation. Selected games and overrides can require a biometric match with user or admin authority.
- Named and unnamed guests can play Piano, do guest work in School, and use a heart-rate monitor in Fitness. Neither kind of guest earns Fitness rings.
- Content Filter, State Gates, and other feature policies can be assigned to individual people or roles as well as wider scopes.

## Review Focus

1. An unrecognized origin or a credential for household A selects B's boot-time default adapter. Expect denial before data access (F2/F5).
2. Duplicate names or a shared adult account carry a role or personal file into a second household. Expect independent memberships and storage handles (F1/F2).
3. An invited child or a future authenticated teen receives Admin through stale roles. Expect both issuance and privilege checks at the server (F3/F4/F5).
4. A second browser uses an invalidated session, or an administrator revokes a session in a different household. Expect isolation across scopes and immediate revocation in scope (F4/F6).
5. A previously unclassified operation or rollback recreates a broad LAN role. Expect coverage failure or a closed protected action (F5/F6).

---

## Rollout order

Implement F1–F5 first. The four linked plans share those interfaces and can then proceed independently. Coordinate edits to the composition root. Integrate the common device binding before exercising managed kiosks, and the policy adapters before enabling policy-governed actions. F6 is the installed acceptance and cutover gate for the whole project.

Use the [application access matrix](../specs/2026-11-26-identity-and-access-design.md#application-access-matrix) to identify each resource owner, audience and operation. The [entry and recovery states](../specs/2026-11-26-identity-and-access-design.md#entry-and-recovery-states) cover browser, bootstrap, station and lost-session journeys. B2a owns personal records, B2b Finance/Auto, B2c Home, and B2d Media history and queues. B3 owns room projections, B5 membership mutations and B6 the dedicated Admin workflows. Android, Telegram, jobs and live transports consume the same server decisions in S1–S5.

| Track | Independently reviewable result |
|---|---|
| [Browser apps and room displays](2026-11-26-identity-and-access-surfaces.md) | Personal apps, Admin, direct links, widgets and private media all enforce their intended audience. |
| [Kiosks and biometric approval](2026-11-26-identity-and-access-kiosks.md) | Piano, School and Fitness support trust-based participation, guest rules and scoped approvals. |
| [Policy assignment and enforcement](2026-11-26-identity-and-access-policies.md) | Role/person/room bindings select the intended Content Filter and State Gates policy. |
| [Services and realtime access](2026-11-26-identity-and-access-services.md) | Telegram, unattended devices, jobs, native clients and push/pull transports enforce household grants. |

## Shared interfaces

`Membership = {householdId,personId,accountId,storageKey,ageClass,roles,active,revision}`. Account, credential and durable person records have independent lifecycles. System authority is a separate assignment. Store household access records under the household's `auth/` directory. Keep the installation account index, bootstrap state, and explicitly installation-wide roles in protected system storage.

`AccessContext = {householdId,surface,actor,membership,deviceId,activity,participants,evidence,delegation,initiator,approval}`. `surface` is `browser|kiosk|room|service|job`. `actor = {kind,id}` uses `account|device|service|anonymous`. Optional fields have value `null`. `participants` is an ordered list of existing participant snapshots and can be empty. `activity` carries its ID and revision. `evidence` holds verified proof kinds, opaque references and expirations. `delegation` binds an acting service or account to a specific person and narrower grant. `initiator` preserves the original operator for a queued action. The source of a self-identification (tap/card/assignment) is recorded with the server activity session. An `approval` handle references a server record. Never accept this object as a trusted request body.

`ActionDescriptor = {id,scope,surfaces,callerKinds,proof,policyDomain?}`. Scope is `system|household|person`. Resource identity is supplied separately. Proof is a per-action set of accepted methods, including `session`, `device`, `self_claim`, `biometric_self`, `biometric_user`, `biometric_admin`, `service`, or `open`. An authenticated service or device has its own addressable identity and allowlist. Trusted member facts are loaded independently of whether the person has a browser credential. Use action names listed in the track tests as the initial action catalog.

`DataContext = {householdId,actor,subjectPersonId,resource,audience,projectionId,policyRevision}` is resolved on the server for one operation. `resource` is F3's verified `ResourceRef`. A personal operation requires a verified subject in that household. A household inventory or open room can have `subjectPersonId:null`. `audience` describes who receives the result. `projectionId` names the domain's registered response shape. Multiple projections in one dashboard share the verified caller and can select different authorized owners. A local username, browser preference or approver cannot supply this context.

Source baseline for this plan is `d96b2b26d2`. Read the existing pipeline in `__backend/src/app.mjs` around the `Auth System` block, the route registrations in `__backend/src/4_api/v1/routers/api.mjs` and the September auth roadmap cited in the spec. This is a change in application access requirements. Use the installed session cookie, household data and guest directory as migration inputs.

## File structure and task order

| Task | Responsibility and principal code owner |
|---|---|
| F1 | Resolve memberships and import the installed directory · `__backend/src/3_applications/auth/ports/IAuthAccountRepository.mjs` |
| F2 | Bind requests, repositories, and runtimes to one household · `__backend/src/4_api/middleware/householdResolver.mjs` |
| F3 | Evaluate action, authority, relationship and proof separately · `shared/contracts/access.mjs` |
| F4 | Scope account issuance, invitations and revocable sessions · `__backend/src/3_applications/auth/AuthService.mjs` |
| F5 | Classify entry points and install the server enforcement boundary · `__backend/src/4_api/middleware/permissionGate.mjs` |
| F6 | Rehearse all tracks and activate enforcement per household · `__docs/reference/core/identity-model.md` |

Source paths and test commands are relative to the DaylightStation checkout. New tests below use Vitest unless a command specifies another runner. Each assertion block lists the cases for the named test file. Build test inputs locally using the listed fixtures and real owner interfaces.

### F1. Resolve memberships and import the installed directory

**Files**

- Create `__backend/src/3_applications/auth/MembershipDirectory.mjs`.
- Create `__backend/src/1_adapters/auth/YamlMembershipRepository.mjs`.
- Create `__backend/src/3_applications/auth/LegacyIdentityImport.mjs`.
- Create `tests/_fixtures/access/twoHouseholds.mjs`.
- Modify `__backend/src/3_applications/auth/ports/IAuthAccountRepository.mjs`.
- Modify `__backend/src/1_adapters/auth/DataServiceAuthAccountRepository.mjs`.
- Modify `__capabilities/household-identity/server/application/PeopleDirectory.mjs` at `list`.
- Modify `__capabilities/household-identity/server/application/HouseholdUserProjection.mjs` at `getHouseholdUsers`.
- Test `__backend/src/3_applications/auth/LegacyIdentityImport.test.mjs`.

**Interfaces**

- Consumes ConfigService.getAllHouseholdIds(), getHouseholdUsers(hid), existing account/profile records and the household-owned named guest store.
- Produces `MembershipDirectory.member(hid, personId)` and `.forAccount(hid, accountId)` return an active `Membership | null`. `LegacyIdentityImport.preview()` returns `{digest, conflicts, changes}`. `.apply(digest)` installs an agreed mapping exactly once. `MembershipDirectory.forLogin(hid,loginName)` resolves the account for a unique login alias inside that household.

- [ ] Write `imports each household with distinct identities and stable legacy data references` with these assertions. Use temporary YAML stores. The fixture exports `makeTwoHouseholds()` with IDs `a` and `b`, duplicate local person `sam`, duplicate room/device `garage`, named guest `lee`, a child `kid`, an unknown-age profile and one account explicitly linked to both households.

  ```js
  expect(directory.member('a', 'sam').storageKey).not.toBe(directory.member('b', 'sam').storageKey)
  expect(directory.forAccount('a', shared.id).roles).toEqual(['owner'])
  expect(directory.forAccount('b', shared.id).roles).toEqual(['member'])
  expect(secondApply.changes).toEqual([])
  expect(conflictingImport.conflicts).toContainEqual(expect.objectContaining({code:'ambiguous_legacy_owner'}))
  expect(missingAgeOwner.readyForAdminCutover).toBe(false)
  expect(directory.forLogin('a','sam')).not.toBe(directory.forLogin('b','sam'))
  ```

- [ ] Run `npm run test:file -- __backend/src/3_applications/auth/LegacyIdentityImport.test.mjs`. Expect failure on distinct membership/storage mapping.
- [ ] Create versioned membership records keyed by `(hid, personId)` with `accountId` nullable, `storageKey`, `ageClass`, `roles`, `active`, and revision. Use the existing household roster as membership and ordering authority. Resolve display/profile reads through a household-bound adapter. Use a unique opaque storage key for new same-named people. A shared login may point to separate people and storage keys. Allow the same local login name in different households. Enforce one normalized login alias per account membership inside a household and keep the account ID installation-unique.
- [ ] Stage the import under the installed single writer. Preserve credential digests and existing personal data paths for unambiguous legacy owners. Translate verified owner/administrative assignments explicitly. Flag ambiguous identities, conflicting age declarations and missing eligible owners for resolution. Never promote LAN roles, the first person on a roster, or an app-specific lock list to installation authority. The bootstrap path historically wrote an owner without a birthyear. Permit an authorized installation operator to confirm that specific adult through controlled provisioning before cutover. An account linked in two households must have consistent trusted age eligibility. A conflict or unknown value cannot satisfy an adult requirement.
- [ ] Use atomic writes and a last-written version marker for resumable apply. Require the same source digest on commit and retain a private before-image. Keep original passwords, history and guest IDs usable through their adapters.
- [ ] Run `npm run test:file -- __backend/src/3_applications/auth/LegacyIdentityImport.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(auth): map accounts to household memberships"`.

### F2. Bind requests, repositories, and runtimes to one household

**Files**

- Create `__backend/src/5_composition/HouseholdRuntimeRegistry.mjs`.
- Create `__backend/src/1_adapters/auth/ScopedPersonData.mjs`.
- Modify `__backend/src/4_api/middleware/householdResolver.mjs`.
- Modify `__backend/src/0_system/config/ConfigService.mjs` at `getHouseholdIntegration`.
- Modify `__backend/src/1_adapters/persistence/files/DataService.mjs`.
- Modify `__backend/src/5_composition/integrations/IntegrationLoader.mjs` at `loadForHousehold`.
- Modify `__backend/src/5_composition/participants/installedRuntime.mjs` at `installParticipantRuntime`.
- Modify `__backend/src/app.mjs` at `defaultHouseholdId`.
- Test `__backend/src/5_composition/HouseholdRuntimeRegistry.test.mjs`.

**Interfaces**

- Consumes F1 membership/storage keys, configured origin mapping, a verified device/service binding when present, and existing per-household integration loader.
- Produces `resolveHousehold({originHouseholdId, credentialHouseholdId, configuredHouseholds}) -> hid` or typed failure. `HouseholdRuntimeRegistry.forHousehold(hid, surfaceId)` supplies scoped stores/adapters or reports unavailable. `ScopedPersonData.forPerson(hid, personId)` resolves an authorized storage handle.

- [ ] Write `two concurrent requests read distinct stores and an unknown origin resolves neither` with these assertions.

  ```js
  expect(await Promise.all([home('a').read('garage'), home('b').read('garage')])).toEqual(['a-only','b-only'])
  expect(() => resolveHousehold({originHouseholdId:'a',credentialHouseholdId:'b',configuredHouseholds:['a','b']})).toThrow()
  expect(await unmappedHost()).toHaveProperty('status',404)
  expect(missingIntegrationInB).toBeNull()
  expect(defaultHouseholdReader).not.toHaveBeenCalled()
  ```

- [ ] Run `npm run test:file -- __backend/src/5_composition/HouseholdRuntimeRegistry.test.mjs`. Expect failure on the default-household singleton or integration fallback.
- [ ] Normalize the configured host/origin through the trusted ingress configuration, validate any credential binding independently and require agreement. On a shared service ingress the verified credential can choose the household. On a browser route validate the configured origin even with a cookie. Treat unknown or ambiguous origin as unavailable for household data.
- [ ] Compose household-owned routers, stores, caches, subscriptions, job owners and integrations with an explicit `hid`. Add a strict integration lookup for protected use. Share only explicitly installation-wide facilities. Existing factories bound to the boot household serve only that household until their track supplies its factory. Make installation-wide routes explicit.
- [ ] Preserve existing logical local person IDs in domain records while translating to the registered unique storage key at user-file boundaries. Require the household for reads, writes, enumeration, deduplication and paths, including direct filesystem adapters. Validate IDs with existing safe path helpers.
- [ ] Run `npm run test:file -- __backend/src/5_composition/HouseholdRuntimeRegistry.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(auth): resolve explicit household runtimes"`.

### F3. Evaluate action, authority, relationship and proof separately

**Files**

- Create `shared/contracts/access.mjs`.
- Create `__backend/src/3_applications/auth/AccessPolicy.mjs`.
- Create `__backend/src/3_applications/auth/AccessService.mjs`.
- Create `__backend/src/1_adapters/auth/YamlAccessPolicyStore.mjs`.
- Test `__backend/src/3_applications/auth/AccessPolicy.test.mjs`.

**Interfaces**

- Consumes F1 memberships and F2 ownership. Descriptors are server-owned. `ResourceRef = {type,id,householdId,ownerId?}`. Use `householdId:null` only for an installation-scoped resource.
- Produces `decideAccess(ctx, action, resource, policy) -> Decision` is pure. `AccessService.authorize(ctx, action, resource) -> Promise<Decision>` adds current membership and domain obligations. `.runAuthorized({ctx,action,resource,operationId}, effect)` checks again at the effect boundary. `Decision = {effect:'allow'|'deny'|'challenge',reason,policyRevision}`. `store.read(hid)` supplies an immutable, versioned snapshot. `.activate(hid,expectedRevision,candidate)` validates the policy, commits atomically or returns a conflict.
- Produce `AccessService.resolveDataContext(ctx,action,resource,projectionId)` for registered data operations. Return the server-resolved `DataContext` after the current grant and required proof are satisfied, otherwise return a typed refusal or challenge. Reuse the ownership resolver and decision implementation above. The domain defines its allowed fields, rows and legitimate aggregates. The caller cannot choose a broader projection by naming it.

- [ ] Write `authorization intersects household, surface, proof, grant and subject` with these assertions.

  ```js
  expect(decide(teenWithAdminRole,'admin.enter').effect).toBe('deny')
  expect(decide(ordinaryAdult,'admin.enter').effect).toBe('deny')
  expect(decide(adultOwner,'admin.enter').effect).toBe('allow')
  expect(decide(deviceWithAdultSelected,'admin.enter').effect).toBe('deny')
  expect(decide(eligiblePlayer,'game.startProtected').effect).toBe('challenge')
  expect(decide(adultOwner,'unknown.action').effect).toBe('deny')
  ```

- [ ] Run `npm run test:file -- __backend/src/3_applications/auth/AccessPolicy.test.mjs`. Expect failure on the new decision table.
- [ ] Define the `AccessContext` and `ActionDescriptor` contracts below. Support grants to roles, people, accounts, devices or services on an action plus installation, household, self or exact resource. Evaluate tenant/actor invariants first, explicit denies next, then matching grants and required proof. Use `membership.roles` freshly resolved for the target household. Unknown age fails the adult check. The spec's sample fixes the grant and binding field names. Match exact IDs on the resolved resource. A `self` relationship compares the owner to the current membership's person ID. An installation grant cannot satisfy a household requirement. Seed scoped, explicit grants from the F1 import and the reviewed legacy role definitions. Ship the grant store, revision guard and base schema here so the foundation can operate while domain bindings are still empty. P1 adds domain validators to this store.
- [ ] Add a no-effects decision API and a guarded effect API. The latter invokes the operation only after domain authorization, consuming any required approval at commit. Uninstalled required evidence/policy adapters yield `unavailable`. Emit structured decision events with the spec redaction rules. Keep changes to a policy from resurrecting cached privileges.
- [ ] In the same access policy tests, assert distinct data contexts for self, delegated patient, restricted household viewer, kiosk participant and empty-audience room. Attempt to select an unregistered projection or substitute an approver as subject. Expect refusal before private store access. Verify that resource-specific write permission does not follow from a list or summary grant.
- [ ] Run `npm run test:file -- __backend/src/3_applications/auth/AccessPolicy.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(auth): evaluate typed access decisions"`.

### F4. Scope account issuance, invitations and revocable sessions

**Files**

- Modify `__backend/src/3_applications/auth/AuthService.mjs`.
- Modify `__backend/src/3_applications/auth/defaultAuthenticationConfiguration.mjs` for the browser session settings.
- Modify `__backend/src/1_adapters/auth/DataServiceAuthSessionStore.mjs`.
- Modify `__backend/src/4_api/middleware/tokenResolver.mjs`.
- Modify `__backend/src/4_api/v1/routers/auth.mjs`.
- Modify `__backend/src/app.mjs` at `createAuthRouter`.
- Test `tests/isolated/api/access/accountLifecycle.test.mjs`.
- Test `__backend/src/1_adapters/auth/DataServiceAuthSessionStore.test.mjs`.

**Interfaces**

- Consumes F1 eligible account membership, F2 active household, F3 authority for invitation and session management.
- Produces `GET /api/v1/auth/me` returns `{householdId,accountId,personId,apps,policyRevision}` for a live account. `sessionStore.resolve({sid,accountId,householdId,now})`, `.list({householdId,accountId?})` and `.revoke({sid,householdId,accountId?})` verify scope. Existing token, cookie, logout, invite and sessions URLs continue to work for eligible callers.
- Provide a cookie-only browser sign-in (`POST /api/v1/auth/session`, same login fields, 204 with `Set-Cookie`). Keep the existing explicit bearer login contract for native/CLI clients. Browser setup, claim and invite acceptance use the same cookie-only response mode. Return `Cache-Control: no-store` on session responses. Read the effective installation or household `browserSessions` settings defined in the [browser session design](../specs/2026-11-26-identity-and-access-design.md#browser-sign-in-and-session-lifetime).

- [ ] Write `credential lifecycle is restricted to eligible people and the active tenant` with these assertions.

  ```js
  expect([childInvite.status, childClaim.status, teenLoginToday.status]).toEqual([403,403,403])
  expect(memberInvite.status).toBe(403)
  expect(wrongHouseInviteAcceptance.status).toBe(404)
  expect(concurrentAccepts.filter(r=>r.status===200)).toHaveLength(1)
  expect(crossHouseSessionRows).toEqual([])
  expect([revokedMe.status, expiredMe.status, sidlessBrowser.status]).toEqual([401,401,401])
  ```

- [ ] Exercise browser time with an injected clock. Use a ten-year absolute lifetime with idle expiry disabled, then a household override of two hours absolute and fifteen minutes idle. Assert that a valid visit can renew the cookie past its first retention window, the original hard deadline never moves, polling does not extend idle time, and an expired or revoked session cannot renew. Reopen the store between requests. Shorten a policy, lengthen it again, and verify the earlier cap still applies to pre-existing sessions. Check cookie flags and absence of a bearer in browser responses.
- [ ] Test enrollment separately from ordinary login. Reissuing or canceling an invite invalidates its old secret. Accepting the first owner's claim on a staged household must be possible before normal sessions are admitted. Resume a partial claim idempotently. Restart and a missing password do not reopen public first setup. Recover a sole owner with an explicitly scoped local installation-operator action and a fresh one-time enrollment secret. Keep the existing password sign-in path. A verified change/reset of the installation account credential invalidates its old sessions across households. Suspending a membership or replacing its invite affects only that household.

- [ ] Run `npm run test:file -- tests/isolated/api/access/accountLifecycle.test.mjs __backend/src/1_adapters/auth/DataServiceAuthSessionStore.test.mjs`. Expect failure on scoped session lookup, enrollment or invite checks.
- [ ] Gate setup/claim on a one-time installation bootstrap authorization and verified designated adult owner, serialize concurrent first claims, and close bootstrap after use. Gate invite issue, accept and ordinary login on current eligibility and the selected household. Use a hashed, one-use, expiring invite bound to the target account/membership. Never invalidate an existing account password merely by creating an invite for another membership. Commission via a local-only `identity-access bootstrap-owner` operation using the installed writer and a single-use enrollment secret tied to the designated adult. Hash the enrollment secret at rest. A household admin linking an existing account in another household must obtain proof of the existing account and consent to the new link. A membership invite cannot reset a shared account's password. Route the existing `{username,password}` payload to `AuthService.login({householdId,loginName,password})` using the verified origin and scoped login alias. After token verification project `req.user.sub` as this household's person ID for legacy domain adapters and expose `accountId` explicitly. A device or service never supplies legacy `req.user`.
- [ ] Bind a session record and its signed token to the account, household and configured absolute deadline. Persist issue time, effective deadline and last qualifying activity. Validate positive durations and allow an absent idle timeout. Use the active signing key even for a first-boot session. Require a live `sid` and fresh membership on cookie and supported human bearer paths. Refuse malformed credentials cleanly. Require service credentials on machine routes after their migration. An existing sid-bearing session can migrate only if account, household, trusted age and its original remaining lifetime are uniquely recoverable. Reauthenticate other humans. Inventory sidless machine clients for S1/S5 before retiring their compatibility path.
- [ ] Renew the host-only cookie on validated visits, up to the lesser of 400 days and remaining server lifetime. Check idle and absolute deadlines before touching the record. Serialize policy shortening, renewal and revocation so a stale request cannot reopen a session. Bound a migrated legacy session by its original issuance window. The configurable policy applies to new sessions independently of the legacy 30-day cookie.
- [ ] Expose own devices by default. Require the household administrative action for listing/revoking other members' sessions. Scope 'others' to the intended account and household. Revocation, demotion, aging corrections, archive and logout invalidate subsequent requests and live consumers. Use an atomic durable store and serialize touches/renewals with revokes. Preserve HttpOnly, SameSite, trusted HTTPS settings and existing cross-site middleware.
- [ ] Run `npm run test:file -- tests/isolated/api/access/accountLifecycle.test.mjs __backend/src/1_adapters/auth/DataServiceAuthSessionStore.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(auth): bind sessions and enrollment to eligible memberships"`.

### F5. Classify entry points and install the server enforcement boundary

**Files**

- Create `__backend/src/4_api/middleware/accessGuard.mjs`.
- Create `__backend/src/5_composition/access/surfaceCatalog.mjs`.
- Create `scripts/access/check-surface-coverage.mjs`.
- Modify `__backend/src/4_api/middleware/permissionGate.mjs`.
- Modify `__backend/src/4_api/middleware/networkTrustResolver.mjs`.
- Modify `__backend/src/4_api/middleware/screenIdentityResolver.mjs`.
- Modify `__backend/src/4_api/v1/routers/api.mjs` at `createApiRouter`.
- Modify `__backend/src/app.mjs`.
- Modify `__backend/src/3_applications/auth/defaultAuthenticationConfiguration.mjs`.
- Modify `__backend/src/4_api/utils/participantHttp.mjs`.
- Test `tests/isolated/api/access/surfaceCoverage.test.mjs`.

**Interfaces**

- Consumes F2 household runtimes, F3 decisions, F4 verified human sessions. Reuse `canonicalRoutePath` for canonical route families and Express's matched method/route for exact action identity.
- Produces `requireAction(action, resolveResource)` resolves the stored owner and calls AccessService before handling a request. `registerSurface({surfaceId,channel,operation,action,owner,projectionId?})` accounts for registered entry points, including aliases. Data-bearing operations declare a named projection, including an explicit public projection for open data. Command-only operations declare their target and effect. `check-surface-coverage` fails on uncovered executable operations.
- For each operation that accesses data, use the registered resource owner's resolver to select the store as well as authorize the request. Record whether it opens installation, household, person or projected display data. A mixed app such as Media has separate entries for its shared library and personal history. Require an owner mapping for each protected read and write.
- Scope search, sort order, counts, facets and pagination to the admitted rows before returning them. Bind cursors and cached results to the household, effective viewer/subject, projection and authorization revision as applicable. Test that a cursor or cached response from a wider grant cannot be used by a narrower viewer. Serve a deliberately shared aggregate only from its registered projection.

- [ ] Write `aliases agree and a newly mounted operation cannot become implicitly public` with these assertions.

  ```js
  expect(inventory.unclassified).toEqual([])
  expect(inventory.dataOperationsWithoutProjection).toEqual([])
  expect(inventory.effectsWithoutTarget).toEqual([])
  expect(checkWithUndeclaredMethod.ok).toBe(false)
  expect([lanAdmin.status, localhostAdmin.status, remoteAdmin.status]).toEqual([401,401,401])
  expect([ordinaryAdultAdmin.status, futureTeenAdmin.status]).toEqual([403,403])
  expect(adminHouseholdBFromA.status).toBe(404)
  expect(publicPing.status).toBe(200)
  expect(ordinaryAdultAgendaMigration.status).toBe(403)
  expect(privilegedHandlerCalls).toBe(0)
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/surfaceCoverage.test.mjs`. Expect failure on the baseline route map's unrestricted/unclassified cases.
- [ ] Capture the actual mounted method/handler names in the full-feature synthetic boot, with registrations for optional modules and aliases. Cover SPA/direct/embedded routes, registration outside the v1 map, public assets versus data-bearing streams, HTTP upgrades/topics, service/CLI/job entry and dev-only endpoints. The initial catalog classifies every operation as explicit public/bootstrap, account, device/room, service/job, or unavailable in production. A mixed router must classify individual methods, including HEAD/OPTIONS, by their effective behavior.
- [ ] Install the guard before handlers and alternate mounts. Derive the surface from its operation and verified caller. On personal routes refuse missing or invalid identity (401), and an authenticated caller with insufficient privileges (403). Hide foreign-owned resources (404). Map an in-kiosk biometric prompt to a structured 409, a missing required service to 503. Preserve response shapes needed by native clients. Keep room/device selection distinct even if a browser cookie exists.
- [ ] Make enforcement activate per registered surface. Maintain existing stricter checks in observation mode. For enforced operations remove LAN/localhost roles, raw token roles, and open-on-miss behavior as authority. Migrate any remaining legacy consumers before removing the old pipeline. Gate both Admin HTTP and its alternate administrative operations during the first browser cutover. This includes `/admin/agenda-migration` mounted directly in `app.mjs` before the central admin router. Replace the narrow legacy host-role check for admin-owned authoring, including Agenda, without upgrading gaming hosts/parents to Admin. Remove kiosk grants for whole Finance and Lifelog prefixes as their projections move.
- [ ] Run `npm run test:file -- tests/isolated/api/access/surfaceCoverage.test.mjs && node scripts/access/check-surface-coverage.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(auth): classify and enforce registered surface actions"`.

### F6. Rehearse all tracks and activate enforcement per household

**Files**

- Create `__docs/runbooks/identity-access-rollout.md`.
- Create `cli/identity-access.cli.mjs`.
- Modify `__docs/reference/core/identity-model.md`.
- Modify `__docs/reference/core/network-exposure.md`.
- Test `tests/isolated/api/access/installedAccess.test.mjs`.
- Test `tests/isolated/api/access/accessCutover.test.mjs`.
- Test `tests/isolated/e2e/browser-platform/household-access.runtime.test.mjs`.

**Interfaces**

- Consumes F1–F5 and the completed browser/display, kiosks, policy, and service/realtime plans. Run against a temporary two-household installation with fake readers and integrations.
- Produces `identity-access preview|activate|rollback --household <hid> --surface <id>` talks to the installed writer with an explicit operator grant. Preview produces a redacted compatibility diff, source digest, unresolved conflicts and enrollment readiness. Activation and rollback require an expected revision.

- [ ] Write `installed action matrix survives migration, revocation and rollback` with these assertions.

  ```js
  expect(preview.productionWrites).toBe(0)
  expect(ambiguousMembershipActivation.status).toBe(409)
  expect(matrixAfterRestart).toEqual(expectedAcrossBothHouseholds)
  expect(deniedAfterRollback).toContain('anonymous:admin.enter')
  expect(postRevokeDeliveries).toHaveLength(0)
  expect(serializedAudit).not.toContain(secretSentinel)
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/installedAccess.test.mjs tests/isolated/api/access/accessCutover.test.mjs`. Expect failure when the full installed matrix, restart or rollback crosses a boundary.
- [ ] Exercise the matrix through the production router, real session store, domain adapter, WS dispatcher and UI entry with temporary data. Repeat using overlapping person, guest, device, sensor, film and Telegram binding labels. Include open room render, teen with stale role, mixed workout, isolated School guest practice, biometric cancellation, role-targeted filter, missing gate, session revocation and service rotation. Inspect private YAML and mock outbound effects alongside responses. Exercise the built frontend through the isolated browser-platform harness with explicit allowed/denied account fixtures. Couple browser journeys with independently asserted server-side effects in the installed test. Existing localhost Admin tests receive an explicit eligible fixture.
- [ ] Implement preview, versioned activation and rollback on the installed writer. Compare old/new denials and affected interfaces by action and household. Validate owner bootstrap, device provisioning, service owners and migration of legacy tokens before promotion. Preserve active game/learning sessions or drain those sessions before switching their writes. If reverting, select the last valid enforced revision or disable only that protected operation. Never revert to anonymous LAN admin.
- [ ] In the existing isolated browser-platform fixture, sign in two adults on the same browser in sequence, plus a same-named person in another household. Save a different medical reading for each, reopen Health, and inspect the underlying test stores. Check that browser Back, a restored tab, a late response, and a session revocation cannot reveal the previous person's data. An empty fourth profile opens with no readings.
- [ ] Drive contract cases from the application matrix through the installed adapters. Compare the actual HTTP body, stored writes, published frames and provider/device calls. Include a restricted Home viewer, summary-only Finance, a vehicle without a location grant, two private Feed/Life histories, a shared Media queue beside personal resume state, and a calendar item withheld from a room. Use synthetic eligibility for the future-teen grant tests and separately assert that v1 never issues that teen a browser session.
- [ ] Require the coverage report to reconcile SPA routes, direct app IDs, screen widgets, API aliases, media bytes, WS/MQTT subscriptions, mobile/CLI commands, provider callbacks and background work against the installed registrations. For each data-bearing surface, require at least one allowed and one denied audience fixture, an owner/projection, and proof that refusal stops downstream effects. Keep unclassified optional surfaces unavailable until their owner declares the contract.
- [ ] Document commands, rollback markers, interpretation of shadow decisions, enrollment recovery and per-surface acceptance. Release gates are zero unclassified production operations, zero cross-household reads/writes/deliveries in the corpus, all kiosk paths usable without login, and verified owner access after restart. Remove legacy authority only when every enrolled caller has migrated.
- [ ] Run `npm run test:file -- tests/isolated/api/access/installedAccess.test.mjs tests/isolated/api/access/accessCutover.test.mjs && npm run build --prefix frontend && npm run test:browser-platform -- --project=chromium household-access.runtime.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(auth): rehearse and activate household access controls"`.
