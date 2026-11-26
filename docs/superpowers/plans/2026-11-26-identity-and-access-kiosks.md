# Household kiosks, participation and biometric approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people use Piano, School and Fitness without signing in and protect the particular actions that require stronger proof.

**Architecture:** Bind a station to its household, attach a validated participant roster to its activity, and keep eligibility decisions in the application that records the outcome. Bind a verified reader match to the one protected command that requested it.

**Tech Stack:** Node.js ≥22.13, ES modules, Express 5, React, the existing YAML stores and Vitest.

**Spec:** [Identity, access, and policy scope](../specs/2026-11-26-identity-and-access-design.md). Start with the [foundation and rollout order](2026-11-26-identity-and-access.md).

## Global Constraints

- One installation can serve multiple households.
- Personal browser apps require a signed-in user. Admin requires a signed-in adult owner or admin of the active household.
- Kids have no login credentials. A future teen login cannot grant administrative authority.
- Kiosks never prompt for browser login. Piano and School can trust a tap or card for participation. Selected games and overrides can require a biometric match with user or admin authority.
- Named and unnamed guests can play Piano, do guest work in School, and use a heart-rate monitor in Fitness. Neither kind of guest earns Fitness rings.

## Review Focus

1. An idle timer, reload or move to a different kiosk restores the first roster member and credits the wrong person. Use an explicit in-scope claim or guest (K1/K2).
2. Named or unnamed visitors enter School from the ordinary locked Portal. Guest practice must be usable without creating learner, enrollment, grade or coin records (K3).
3. A strap moves from a guest to a member mid-workout while a second guest is present. Live, saved and reconstructed rings must agree without losing HR (K4).
4. A match arrives after the game, participant or reader changes, or the same match reaches two challenges. Only the intended pending command can proceed once (K5/K6).
5. A recognized person without the required grant, a future teen, or an unverified enrollment becomes an override approver. Refuse on the server and retain ordinary kiosk use (K5/K6).

---

F1–F5 supply the context and access service. S1 supplies unattended device authentication. P2 supplies State Gates for features that use entitlements. K1–K4 can be exercised with the device adapter injected. K5–K6 use the signed scanner ingress from the physical controller. Use fake sensors/readers only in implementation tests.

## File structure and task order

| Task | Responsibility and principal code owner |
|---|---|
| K1 | Bind a trusted selection to a kiosk activity · `__capabilities/household-identity/server/application/PeopleDirectory.mjs` |
| K2 | Preserve guest Piano play and person-owned progress · `__app_modules/learning/piano/browser/PianoApp.jsx` |
| K3 | Make guest School work reachable on the household Portal · `__app_modules/learning/school/browser/SchoolApp.jsx` |
| K4 | Keep Fitness HR for every seat and award rings only to eligible members · `__app_modules/wellness/fitness/browser/hooks/fitness/ParticipantRoster.js` |
| K5 | Bind verified reader matches to one pending action · `__app_modules/wellness/fitness/satellites/fitness-controller/src/server.mjs` |
| K6 | Enforce biometric requirements at protected game and override actions · `__app_modules/wellness/fitness/server/api/fitness.mjs` |

Source paths and test commands are relative to the DaylightStation checkout. New tests below use Vitest unless a command specifies another runner. Each assertion block lists the cases for the named test file. Build test inputs locally using the listed fixtures and real owner interfaces.

### K1. Bind a trusted selection to a kiosk activity

**Files**

- Create `__capabilities/household-identity/server/application/KioskParticipants.mjs`.
- Create `__capabilities/household-identity/server/api/kioskParticipants.mjs`.
- Modify `__capabilities/household-identity/server/application/PeopleDirectory.mjs`.
- Modify `__capabilities/household-identity/portable/participants.mjs`.
- Modify `__capabilities/household-identity/browser/ParticipantPicker.jsx`.
- Modify `__backend/src/4_api/utils/participantHttp.mjs`.
- Modify `__backend/src/5_composition/participants/installedRuntime.mjs`.
- Modify `__backend/src/4_api/v1/routers/api.mjs`.
- Test `__capabilities/household-identity/server/api/kioskParticipants.test.mjs`.

**Interfaces**

- Consumes Verified `(householdId,deviceId)` from S1, PeopleDirectory, portable participant contexts and the activity's own roster. Device enrollment happens outside the participant flow.
- Produces `KioskParticipants.select({householdId,deviceId,activityId,expectedRevision,selection,source}) -> participant-context/v1`. `source` is `tap|card|sensor|guest`. Server-issued scope and revision bind the selection to this activity/device. `GET/PUT /api/v1/kiosk/activities/:id/participants` expose a projected roster and validated selection. `POST /api/v1/kiosk/activities` opens a server-owned activity for an allowed app on this device and returns `{activityId,revision}`. Close it on domain end or idle. An active domain session adopts the same scoped handle.

- [ ] Write `switching an activity or device cannot restore someone else's claim` with these assertions.

  ```js
  expect(seats.map(p=>p.identity.kind)).toEqual(['user','guest','anonymous','anonymous'])
  expect(new Set(seats.map(p=>p.participant_id)).size).toBe(4)
  expect(staleClaim.status).toBe(409)
  expect(otherKiosk.status).toBe(404)
  expect(archivedGuestSelectable).toBe(false)
  expect(roomAfterExit.participants).toEqual([])
  expect([pianoData.actor.kind, pianoData.subjectPersonId]).toEqual(['device',selectedLearner])
  expect([unknownGuestHasPersonalStore, ordinaryRoomHasPersonalStore]).toEqual([false,false])
  ```

- [ ] Run `npm run test:file -- __capabilities/household-identity/server/api/kioskParticipants.test.mjs`. Expect failure on missing activity-bound selection.
- [ ] Keep the established `user`, `guest:id`, and `anon:scope:slot` runtime formats. Resolve named references using the active household. Mint anonymous keys per activity/seat and preserve two simultaneous guests. Return only app-approved display data. The existing host-only guest directory and edit API stay restricted. Keep the per-activity context ID as a consistency check. Authorization always reads the server's actual scope and membership.
- [ ] Keep participant state on the server keyed by `(hid,deviceId,activityId)` with a revision. Resolve card scans through the installed reader and NFC mapping. A picker or URL can request a selection but cannot assign privileges or an approver. Partition browser memory/storage by household, device and activity, clear on scope/idle/leave, and drop pending commands when the selected person changes. Reject an activity ID presented by any other station or household even if the participant IDs match.
- [ ] Mount the projected kiosk endpoints under F5 and use the existing Agenda participant adapter when Agenda opened the activity. Validate its household, device, launch scope and revision before reuse. Return a station/selection state on failure, never a human login screen.
- [ ] Resolve F3's data context separately for each seat or learner when accessing durable progress. Bind writes to the selected participant, action and activity revision. A guest practice session or HR seat uses its activity-scoped data. A biometric approval changes only the authorized action. Test that a prior learner's response or pending save cannot update the next person's screen or record after a tap/card switch.
- [ ] Run `npm run test:file -- __capabilities/household-identity/server/api/kioskParticipants.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(kiosk): scope participant selection to the active station"`.

### K2. Preserve guest Piano play and person-owned progress

**Files**

- Modify `__app_modules/learning/piano/browser/PianoApp.jsx`.
- Modify `__app_modules/learning/piano/browser/PianoKiosk/PianoUserContext.jsx`.
- Modify `__app_modules/learning/piano/browser/PianoKiosk/PianoMenu.jsx`.
- Modify `__app_modules/learning/piano/browser/PianoKiosk/useSchoolGameAccess.js`.
- Modify `__app_modules/learning/piano/server/api/piano.mjs`.
- Modify `__app_modules/learning/piano/server/adapters/YamlPianoStudioDatastore.mjs` at `isKnownUser`.
- Modify `__docs/reference/piano/README.md`.
- Test `__app_modules/learning/piano/browser/PianoKiosk/PianoUserContext.test.jsx`.
- Test `tests/isolated/api/access/pianoParticipation.test.mjs`.

**Interfaces**

- Consumes K1 selection, F2 scoped personal storage, the existing Piano program, MIDI, challenge and School-game rules.
- Produces `piano.play` permits guest/member play. `piano.progress.write` targets the active eligible member. Public kiosk writes require the registered station and current activity. `piano.take.record` retains the existing guest take as an activity artifact.

- [ ] Write `an unclaimed Piano opens as Guest and a valid card starts the correct member's work` with these assertions.

  ```js
  expect(freshPiano.player.kind).toBe('anonymous')
  expect([guestFreePlay.ok,guestTake.saved]).toEqual([true,true])
  expect(guestCheckpoint.status).toBe(403)
  expect(cardSelection.personId).toBe('sam')
  expect(memberHistoryWrites).toEqual([{householdId:'a',personId:'sam'}])
  expect(screen.queryByLabelText('Password')).toBeNull()
  ```

- [ ] Run `npm run test:file -- __app_modules/learning/piano/browser/PianoKiosk/PianoUserContext.test.jsx tests/isolated/api/access/pianoParticipation.test.mjs`. Expect failure on the current first-roster-member default or installation-wide known-user check.
- [ ] Replace automatic first-member selection with a valid current kiosk claim or Guest. Treat a desk-card/tap or recognized deep link on a provisioned kiosk as trust-based participation. A stale `piano:user:<pianoId>` selection alone cannot establish a new household claim.
- [ ] Validate attempts, challenges, takes, personal Studio reads, checkpoints and enrollments against the server's participant and action. Preserve existing permissive guest play, session-associated guest takes and uncredited authorized challenge results. Partition new recordings/downloads by household and activity or member. Map old shared Guest recordings only to their known historical household, without exposing them via the next guest's session.
- [ ] Preserve existing School-gated Games rules and domain teacher gates. Only actions configured to need a biometric challenge request one. Include the change to Piano's player-selection and progress reference with the code.
- [ ] Run `npm run test:file -- __app_modules/learning/piano/browser/PianoKiosk/PianoUserContext.test.jsx tests/isolated/api/access/pianoParticipation.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(piano): preserve guest play and scope personal progress"`.

### K3. Make guest School work reachable on the household Portal

**Files**

- Modify `__app_modules/learning/school/browser/SchoolApp.jsx`.
- Modify `__app_modules/learning/school/browser/identity/SchoolProfileContext.jsx`.
- Modify `__app_modules/learning/school/server/api/school.mjs`.
- Modify `__app_modules/learning/school/server/application/SchoolService.mjs` at `openSession`.
- Modify `__app_modules/learning/school/server/adapters/progress/ConfiguredSchoolLearningDirectory.mjs`.
- Modify `__app_modules/learning/school/server/application/TeacherGate.mjs`.
- Modify `__capabilities/device-dispatch/server/domain/services/NfcResolver.mjs`.
- Modify `__app_modules/learning/school/server/api/schoolLifecycle.mjs`.
- Modify `__app_modules/money/economy/server/api/economy.mjs`.
- Modify `__docs/reference/school/README.md`.
- Test `tests/isolated/api/access/schoolGuestPractice.test.mjs`.
- Test `__app_modules/learning/school/browser/SchoolApp.test.jsx`.

**Interfaces**

- Consumes K1 station selection, School's configured learner directory, existing null-user generic bank practice and teacher/enrollment gates.
- Produces `school.practice` starts and grades a guest practice session in memory. `school.assignedWork` requires an eligible claimed learner and their assigned bank. `school.enroll` uses the signed-in adult teacher surface and existing teacher guard.

- [ ] Write `a guest finishes a practice exercise from the locked portal without claiming a learner` with these assertions.

  ```js
  expect([named.result.correct,unnamed.result.correct]).toEqual([true,true])
  expect([enrollmentWrites,gradeWrites,rewardWrites]).toEqual([0,0,0])
  expect(guestAssignedBank.status).toBe(403)
  expect(learnerCard.validAssignedWork).toBe(true)
  expect(teacherMutationFromKiosk.status).toBe(403)
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/schoolGuestPractice.test.mjs __app_modules/learning/school/browser/SchoolApp.test.jsx`. Expect failure on the missing Portal guest path or unchecked student/teacher substitution.
- [ ] Offer Guest practice in locked and open Portal modes. Bind a named guest or fresh anonymous seat to a server-owned practice session and use the generic-bank `userId:null` path. Supply practice materials with a real answer/feedback loop. Use guest-safe copies only when a normally assigned activity explicitly offers practice.
- [ ] Keep personal NFC cards and taps sufficient for ordinary learner work within the device's household. Check the server's active claim, existing learner enrollment, grant and session for attributed submissions. Migrate stored `school:user` and per-tab launches only when the active household and kiosk match. The teacher console derives its actor from the signed-in browser and applies TeacherGate. A kiosk choice of teacher name cannot authorize its APIs.
- [ ] Cover renewal, idle reset, a guest-to-member switch, cross-household bank/session access and duplicate submission. Preserve School's existing graded records, print/companion codes and scoped launch grants. Document guest vs enrolled outcomes in the School reference. For `go/<learner>/<program>` and fresh direct-launch grants, retain authorized self-service cards/codes but require an explicit issuer and intended learner/device. Gate bank views, purchases, deposits and adjustments by their separate actions and keep a learner claim out of teacher-only operations.
- [ ] Run `npm run test:file -- tests/isolated/api/access/schoolGuestPractice.test.mjs __app_modules/learning/school/browser/SchoolApp.test.jsx`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(school): expose uncredited guest practice on the portal"`.

### K4. Keep Fitness HR for every seat and award rings only to eligible members

**Files**

- Create `__app_modules/wellness/fitness/shared/ringEligibility.mjs`.
- Modify `__app_modules/wellness/fitness/browser/hooks/fitness/ParticipantRoster.js`.
- Modify `__app_modules/wellness/fitness/browser/hooks/fitness/TreasureBox.js` at `_awardRings`.
- Modify `__app_modules/wellness/fitness/browser/hooks/fitness/FitnessSession.js`.
- Modify `__app_modules/wellness/fitness/browser/hooks/fitness/PersistenceManager.js`.
- Modify `__app_modules/wellness/fitness/server/application/services/FitnessUserHydrator.mjs`.
- Modify `__app_modules/wellness/fitness/server/application/services/SessionService.mjs`.
- Modify `__app_modules/wellness/fitness/server/adapters/persistence/YamlSessionDatastore.mjs`.
- Modify `__app_modules/wellness/fitness/server/application/measures/fitnessRingsProvider.mjs`.
- Modify `__docs/reference/fitness/guest-mode.md`.
- Test `__app_modules/wellness/fitness/shared/ringEligibility.test.mjs`.
- Test `tests/isolated/api/access/fitnessGuestCredit.test.mjs`.

**Interfaces**

- Consumes K1 typed participant and occupant assignment over time, active household membership and the existing Fitness eligibility config. Retained legacy sessions can contain `is_guest`, category or `coins`.
- Produces `ringEligibility({participant,membership,programEligible}) -> boolean` used for `fitness.rings.earn`. `fitness.hr.participate` permits guest seats. Preserve per-seat HR and zone history across strap changes.

- [ ] Write `one member and two guests retain three HR tracks but only the member earns rings` with these assertions.

  ```js
  expect(live.hrTracks).toHaveLength(3)
  expect(live.rings).toEqual({sam:4})
  expect(saved.teamRings).toBe(4)
  expect(reloaded.weeklyRings).toEqual({sam:4})
  expect(guestEpochBeforeHandoff.rings).toBe(0)
  expect(forgedGuestRingWrite.acceptedCredit).toBe(0)
  ```

- [ ] Run `npm run test:file -- __app_modules/wellness/fitness/shared/ringEligibility.test.mjs tests/isolated/api/access/fitnessGuestCredit.test.mjs`. Expect failure on the guest interval/bonus award, reassignment transfer or rehydration.
- [ ] Determine eligibility per participant and occupancy interval. A household member borrowing a strap can earn normally. Named guests, unnamed guests and unassigned sensor placeholders retain HR/zones and applicable group challenge participation with zero personal, team, projected or bonus rings attributable to them.
- [ ] Apply the same rule to interval and bonus awards, device reassignment/transfer, serialized rosters, live ring tiles, server saves, weekly measures and reward/standings projections. Trust server-resolved participant identity and membership instead of a submitted `is_guest`, label or totals. Reconcile submitted totals with eligible intervals before publishing credit. Also bind the garage Health dashboard and standings reads to the limited Fitness projections. A sensor's ownership or a configured Family display category cannot establish ring eligibility.
- [ ] Support legacy reads with proof of household membership/typed identity at the recorded time, or an unambiguous migration mapping. Ambiguous historical guest labels and shared names receive no new credit. Preserve raw historical sessions/HR and detect ambiguous old totals in preview instead of rewriting records silently.
- [ ] Run `npm run test:file -- __app_modules/wellness/fitness/shared/ringEligibility.test.mjs tests/isolated/api/access/fitnessGuestCredit.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "fix(fitness): exclude guests from ring awards and projections"`.

### K5. Bind verified reader matches to one pending action

**Files**

- Create `__backend/src/3_applications/auth/BiometricApprovals.mjs`.
- Modify `__app_modules/wellness/fitness/satellites/fitness-controller/src/server.mjs`.
- Modify `__app_modules/wellness/fitness/server/adapters/eventbus/TrustedScannerVerifier.mjs` at `accept`.
- Modify `__app_modules/wellness/fitness/server/application/identityRelay.mjs`.
- Modify `__app_modules/wellness/fitness/server/application/AdminInterventionAuthority.mjs`.
- Modify `__app_modules/wellness/fitness/server/composition/api-runtime.mjs`.
- Modify `__app_modules/household/supervision/server/application/ApprovalWorkflow.mjs`.
- Test `tests/isolated/api/access/biometricApprovals.test.mjs`.

**Interfaces**

- Consumes S1 device/reader enrollment, S4 restricted event ingress, K1 activity revision, F1 current approver eligibility. Reuse `_extensions/fingerprint/src/signScan.mjs`, the trusted verifier and purpose-bound supervision workflow.
- Produces `begin({ctx,action,resource,beneficiary,operationId}) -> {challengeId,expiresAt}`. `confirm({challengeId,verifiedMatch}) -> approvalId`. `consume({ctx,action,resource,operationId,approvalId})` atomically admits one matching operation, or returns its previous outcome.

- [ ] Write `one physical scan admits one operation for the intended person on the intended kiosk` with these assertions.

  ```js
  expect(unsigned.approved).toBe(false)
  expect(otherReader.approved).toBe(false)
  expect(afterPlayerSwitch.approved).toBe(false)
  expect(teenAsAdmin.approved).toBe(false)
  expect(await Promise.all([submit(),submit()])).toEqual([receipt,receipt])
  expect(effectCalls).toBe(1)
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/biometricApprovals.test.mjs`. Expect failure without the signed producer and command-bound approval.
- [ ] Wire the real controller's scan sender to the deployed signer and verifier with household/reader-specific keys. Serialize challenges for a physical reader, arm it for a specific challenge, and bind a challenge nonce to the signed match or authenticated reader exchange. Preserve free-running scans as attribution only where appropriate. Reject stale/unmatched results, replayed nonces, different readers, service simulation in production and conflicting pending challenges.
- [ ] Record household, device, reader, activity + participant revision, beneficiary, matched approver, action, resource, operation ID, revision and expiry server-side. A user-only rule checks self or the explicit named user policy. An admin rule requires the matched known adult owner/admin with the action grant. A more specific lock may further narrow the eligible set. Retain an existing shorter proof window such as the 15-second intervention proof. Drop unconsumed challenges on restart.
- [ ] Atomically reserve/consume against an idempotent domain operation with its receipt. Recheck membership, lock, policy revision and scope before execution, including retries/revocation. Use each effect owner's operation key/journal for crash recovery. An uncertain non-idempotent hardware effect requires reconciliation before retry. Keep samples/templates on their existing reader and never record the signed match in generic client logs.
- [ ] Run `npm run test:file -- tests/isolated/api/access/biometricApprovals.test.mjs && node --test _extensions/fingerprint/test/signScan.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(auth): bind verified biometric matches to kiosk commands"`.

### K6. Enforce biometric requirements at protected game and override actions

**Files**

- Modify `__app_modules/wellness/fitness/server/api/fitness.mjs`.
- Modify `__app_modules/wellness/fitness/browser/components/FitnessGameGate.jsx`.
- Modify `__app_modules/wellness/fitness/browser/identity/IdentityProvider.jsx`.
- Modify `__app_modules/wellness/fitness/browser/player/FitnessPlayer.jsx`.
- Modify `__app_modules/wellness/fitness/browser/widgets/EmulatorGame/EmulatorGameWidget.jsx`.
- Modify `__app_modules/wellness/fitness/browser/widgets/FitnessSessionDetailWidget/useRecapUnlock.js`.
- Modify `__app_modules/wellness/fitness/server/application/usecases/ManageAccess.mjs`.
- Modify `__app_modules/games/arcade/server/adapters/BiometricArcadeGameAuthorization.mjs`.
- Modify `__docs/reference/fitness/fingerprint-unlock.md`.
- Test `tests/isolated/api/access/kioskProtectedActions.test.mjs`.

**Interfaces**

- Consumes F3 guarded effects and K5 approvals, current household game/lock config and existing supervision epochs.
- Produces `game.startProtected`, `fitness.override`, `fitness.emulator.save.write`, `fitness.recap.play`, and `fingerprint.enrollPrivileged` use their server action descriptor. Kiosk UI handles `{reason:'approval_required',challengeId}` in place and clears it on cancel, timeout, target change or completion.

- [ ] Write `self and admin unlocks differ and a successful override leaves the kiosk a device` with these assertions.

  ```js
  expect([selfSave.status,otherSave.status,childOverride.status,adminOverride.status]).toEqual([200,403,403,200])
  expect(acceptedOverride.actorId).toBe(adminPersonId)
  expect(acceptedOverride.beneficiaryId).toBe(childPersonId)
  expect(plainBrowserVerdict.applied).toBe(false)
  expect(noReader.freePlayAvailable).toBe(true)
  expect(kioskBrowserUser).toBeNull()
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/kioskProtectedActions.test.mjs`. Expect failure on browser-only approval or promotion of the participant.
- [ ] Adapt existing device-owned game starts, emulator save ownership, Skyline skip-ahead writes, governance/skip, protected recaps, emergency operations and Arcade authorization at the server effect or protected resource-read boundary. A UI event such as `fitness.identity.detected` may update the prompt. A field such as `unlockedBy` cannot authorize the write. Keep game-specific unlock durations for an already admitted game/session while requiring a new grant for a different operation.
- [ ] For enrollment of an admin/owner's first finger, require an already authorized adult administrator's enrollment grant, or the installation owner's controlled provisioning action outside the kiosk. Never allow self-identification alone to enroll a privileged template. Keep the existing self/admin checks for subsequent management. Audit approvals and enrollment by actor, beneficiary and household.
- [ ] Render a local finger prompt with distinct timeout/unavailable/permission states. Cancel an outstanding request on navigation, participant/household change or device revocation. Exercise the normal kiosk entry points with no browser credentials and verify no LoginScreen mounts.
- [ ] Run `npm run test:file -- tests/isolated/api/access/kioskProtectedActions.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(kiosk): enforce protected actions at their effect owners"`.
