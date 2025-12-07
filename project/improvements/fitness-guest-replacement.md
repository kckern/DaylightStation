# Fitness Guest Replacement & Zone Handling

This note captures how guests replace existing users on heart rate devices within the fitness stack, how their configuration (especially heart rate zones) is loaded, and how the system attempts to revert devices back to the original owners. File references:

- `frontend/src/context/FitnessContext.jsx`
- `frontend/src/hooks/fitness/UserManager.js`
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx`
- `frontend/src/hooks/useFitnessSession.js` (re-exports)

## 1. Baseline User & Zone Configuration

1. `FitnessProvider` (context) derives `usersConfig` and `zoneConfig` from `fitnessConfiguration`.
2. On any configuration change, `session.userManager.configure(usersConfig, zoneConfig)` runs.
3. `UserManager.configure` iterates the `primary/secondary/family/friends` lists and calls `registerUser` for each, passing:
   - `globalZones`: the `zoneConfig` array supplied by the provider.
   - `zoneOverrides`: per-user `zones` defined in the config, if any.
4. Each `User` instance (in `UserManager.js`):
   - Builds `zoneConfig = buildZoneConfig(globalZones, zoneOverrides)`.
   - Seeds `zoneSnapshot` and `currentData` via `deriveZoneProgressSnapshot` at a resting heart rate.
   - Tracks cumulative metrics and zone-bucket counts.
5. `session.userCollections`, `deviceOwnership`, `userZoneProfiles`, and `userVitalsMap` are exposed through `FitnessContext` for UI consumption.

## 2. Guest Replacement Lifecycle

### 2.1 Trigger Path

1. `FitnessUsersList` renders each heart rate device. Clicking a card invokes `handleAvatarClick`, which calls `onRequestGuestAssignment` upstream.
2. Eventually `FitnessContext.assignGuestToDevice(deviceId, assignment)` executes (e.g., from a modal). This normalizes the device id and forwards to `session.userManager.assignGuest`.

### 2.2 Assigning/Replacing a Guest (`UserManager.assignGuest`)

1. Device ids are stringified (`key`).
2. **Clearing guests** (`assignment` falsy):
   - Look up the stored entry in `guestAssignments`.
   - Remove the map entry.
   - If the guest user exists and its `hrDeviceId` still matches `key`, assign `user.hrDeviceId = existing.prevHrDeviceId ?? null`.
3. **Applying a guest** (`assignment` truthy):
   - Fetch or create a `User` keyed by `slugifyId(guestName)`.
   - If the guest is new: instantiate with `_defaultZones` (copied from the last `configure` call) and optional `metadata.zones` overrides.
   - If the guest already exists and `_defaultZones` are known: rebuild their `zoneConfig` using `buildZoneConfig(_defaultZones, metadata.zones)`.
   - Record the previous HR device (`previousHrDeviceId`). Because `guestUser.hrDeviceId` is overwritten immediately, the stored `prevHrDeviceId` ends up being `null` when reassigning the same device.
   - Persist `{ name, prevHrDeviceId, ...metadata }` in `guestAssignments`.
4. `FitnessContext.assignGuestToDevice` triggers `forceUpdate`, causing React consumers to re-render with new guest data.

### 2.3 Aftermath in the UI layer

- `FitnessContext` exposes a snapshot of `session.userManager.guestAssignments` (converted into a plain object for serialization safety).
- `FitnessUsersList` converts that snapshot back into a `Map` to simplify lookups when rendering.
- Device labels (`hrOwnerMap`, `hrDisplayNameMap`) use guest entries first, then roster/config fallbacks.
- When multiple guests successively occupy the same device, the new assignment simply overwrites the previous `guestAssignments` entry; prior guest `User` objects remain in `session.userManager.users` but lose their `hrDeviceId` only if they are explicitly cleared.

## 3. Loading Guest Config & Heart Rate Zones

1. **Default zones:** `_defaultZones` is set to the `zoneConfig` array passed into `UserManager.configure`. Every ad-hoc guest gets this array unless overrides are provided at assignment time.
2. **Per-guest overrides:** If `assignment` includes a `zones` array, `buildZoneConfig(_defaultZones, assignment.zones)` merges the overrides. This is currently the only pathway for customizing guest zones.
3. **Zone snapshots:** Newly created guests call `deriveZoneProgressSnapshot` immediately, so they expose baseline zone metadata even before telemetry arrives.
4. **Context exports:**
   - `session.userZoneProfiles` (Map) surfaces `{ name, zoneConfig, zoneSnapshot }` for each user, including guests, allowing the UI to reason about overrides.
   - `userVitalsMap` (built in `FitnessContext`) copies `User.currentData`, so zone colors and ranges flow through React state.
5. **UI consumption:**
   - `FitnessUsersList` tries `userZoneProgress`, `participantRoster`, and `userVitals` to determine the current zone.
   - If no zone data is available, it calls `deriveZoneFromHR`, which re-implements threshold logic by iterating `zones` + the per-user profile map. This mirrors the backend logic but risks divergence if `buildZoneConfig` rules change.

## 4. Subsequent Guest Swaps & Original User Restoration

### 4.1 Replacing a guest with another guest

- Calling `assignGuestToDevice` with a **new guest name** on the same device simply overwrites `guestAssignments[key]`.
- The previous guest’s `User` remains registered in `session.userManager.users`. Because `prevHrDeviceId` is set to `null` (the assignment compares against the same device id), the previous guest loses its HR binding but retains zone/state data.
- There is no automatic cleanup of stale guest users or their accumulated telemetry.

### 4.2 Restoring the original configured user

- The system does **not** track which configured/primary user owned the device before a guest took over.
- Clearing the guest (`assignGuest(deviceId, null)`) only restores the guest user’s `hrDeviceId` back to whatever `prevHrDeviceId` was recorded (usually `null`).
- As a result, the original configured user requires an external reassignment workflow (not implemented in these files). `replacedPrimaryPool` in `FitnessContext` attempts to surface displaced primaries if `assignment.baseUserName` is provided, but nothing re-applies that binding.

## 5. Issues & Recommendations

### Observed Issues

1. **Original owners are never restored automatically.** `prevHrDeviceId` captures the guest’s previous device, not the displaced configured user, so clearing a guest leaves the device unassigned.
2. **`prevHrDeviceId` is almost always `null`.** When assigning the same device, the code compares `guestUser.hrDeviceId === key` and blanks out the stored value, defeating the restoration path.
3. **Guest and primary identity are conflated.** `guestAssignments` only stores the guest name and metadata. There is no explicit record of which configured profile was replaced, making reconciliation impossible without extra context (e.g., `baseUserName` must be manually provided in metadata).
4. **Zone logic is duplicated.** `UserManager` already computes per-user zone state, but `FitnessUsersList` re-derives zones via `deriveZoneFromHR`, which can drift from `buildZoneConfig`/`deriveZoneProgressSnapshot` behavior.
5. **Map → object → Map churn.** `guestAssignments` is converted to an object in `FitnessContext` and immediately back to a `Map` in `FitnessUsersList`, which is both inefficient and error-prone (non-string keys are silently dropped).
6. **Guest users linger indefinitely.** Former guests remain in `session.userManager.users`, inflating collections and leaking telemetry.
7. **Zone overrides require live metadata.** If a guest is reassigned later without passing the original `zones` metadata, their `zoneConfig` reverts to `_defaultZones`, potentially losing personalization.

### Recommendations (Targeting 4–5 Score Across Principles)

1. **Introduce a Device Assignment Ledger.** Replace ad-hoc `guestAssignments` with a typed ledger entry `{ deviceId, occupantSlug, occupantType, displacedSlug, overridesHash, updatedAt }`. The ledger becomes the single source of truth and surfaces read-only selectors to the UI, driving modularity and encapsulation.
2. **Define Stable Interfaces.** Wrap guest operations inside a `GuestAssignmentService` that exposes `assignGuest`, `moveGuest`, `restorePrimary`, and `cleanupGuests`, each returning `{ ok, code, payload }`. This segregates orchestration logic from presentation and clarifies error paths.
3. **Centralize Zone Resolution.** Move all heart rate zone math into `ZoneProfileStore` with APIs like `getZoneState(userSlug)` and `getThreshold(userSlug, zoneId)`. UI components read formatted zone view models instead of recomputing thresholds, eliminating DRY violations.
4. **Persist Guest Profiles.** Store guest-specific overrides (zones, avatar, preferences) in a `GuestProfileRepository` keyed by slug so reassignment rehydrates data automatically. This avoids leaking session internals to the UI and raises modularity.
5. **Enforce Presentation/Data Separation.** `FitnessContext` publishes only immutable DTOs (e.g., `DeviceCardViewModel`) assembled within the session layer. `FitnessUsersList` becomes a pure presenter, boosting scores for logic/presentation segregation.
6. **Add Lifecycle Guardrails.** Emit structured events (`ASSIGN_GUEST`, `RESTORE_PRIMARY`, `ZONE_OVERRIDE_APPLIED`) through an `EventJournal` interface so telemetry and tests can assert invariants, improving observability and interface clarity.
7. **Automated Cleanup & Auditing.** Schedule `cleanupOrphanGuests` and `reconcileAssignments` tasks that compare the ledger, device telemetry, and configured users, ensuring encapsulated data management and better DRY.

Executing these recommendations in tandem elevates the architecture toward 4–5 scores by consolidating state, clarifying interfaces, and removing duplicated logic.

## 6. Technical Design (Proposed)

### 6.1 Data Model

- **UserRegistry**: authoritative `Map<slug, UserRecord>` containing both configured profiles and transient guests. Each record stores `hrDeviceId`, `cadenceDeviceId`, `zoneProfileId`, immutable metadata, and `ownershipHistory` (array of `{deviceId, assignedAt, releasedAt, eventId}`) for auditing.
- **DeviceAssignmentLedger**: normalized structure `{ deviceId: { occupantSlug, occupantType: 'primary'|'guest', displacedSlug, overridesHash, updatedAt, correlationId } }` living inside `FitnessSession`. This ledger replaces the plain `guestAssignments` map, enforces referential integrity, and drive read-only selectors for the UI.
- **ZoneProfileStore**: keyed by `slug`, containing `compiledZones`, `overrideHash`, `source`, and precomputed `zoneViewModel` objects. Compiling zones happens once per change and downstream consumers subscribe through `FitnessContext`.
- **GuestProfileRepository**: lightweight persistence (JSON file or backend API) that stores guest preferences, ensuring reassignments hydrate consistent metadata without UI intervention.
- **EventJournal**: append-only log capturing `ASSIGN_GUEST`, `RESTORE_PRIMARY`, `MOVE_GUEST`, `ZONE_OVERRIDE_APPLIED`, etc., so UI or analytics can reconstruct sequences and automated tests can assert invariants.

### 6.2 Lifecycle APIs

1. `assignDeviceOccupant(deviceId, occupantDescriptor)`
   - Validates descriptor shape via runtime schema helpers (e.g., JSON Schema or custom validators), ensuring `slug`, `displayName`, `occupantType`, and optional `zoneOverrides` meet contract.
   - Reads ledger entry; if someone else owns the device, sets `displacedSlug` and logs the transition with correlation ids.
   - Updates `UserRegistry`, `DeviceAssignmentLedger`, and `ZoneProfileStore` in a single transaction, then emits `ASSIGN_GUEST`/`MOVE_GUEST`.

2. `restoreDeviceOwner(deviceId)`
   - Uses ledger metadata to reinstate `displacedSlug`; if absent, queries `UserRegistry` for the configured owner and records a `RESTORE_PRIMARY` event.
   - Returns a structured response so the UI can confirm success or prompt manual reassignment.

3. `persistGuestProfile(slug, snapshot)`
   - Writes to `GuestProfileRepository`, capturing zone overrides, avatar, and preferences. Reassignments call this to ensure DRY persistence.

4. `cleanupOrphanGuests()`
   - Runs on a timer, comparing ledger/device telemetry against `UserRegistry`, pruning guests with no active assignments and archiving their history.

5. `reconcileAssignments()`
   - Cross-checks device telemetry, ledger entries, and configured users to detect drift; emits `RECONCILIATION_WARNING` events when mismatches appear, improving observability.

### 6.3 Context Exposure

- `FitnessContext` surfaces immutable selectors:
   - `useDeviceAssignments()` returns an array of DTOs `{ deviceId, occupantLabel, zoneBadge, statusIndicators }` built from the ledger, so the UI consumes presentation-ready data.
   - `useZoneProfiles()` yields memoized view models derived from `ZoneProfileStore`, eliminating Map/Object churn.
   - `useGuestOps()` exposes typed methods (`assignGuest`, `restorePrimary`, `moveGuest`, `cleanupGuests`, `reconcileAssignments`) that wrap `GuestAssignmentService`, keeping consumers away from session internals.
- Heart rate zone resolution is exclusively handled by `ZoneProfileStore` APIs (`getZoneState`, `getZoneThreshold`), and the context merely forwards results, ensuring DRY and consistency.

### 6.4 Failure Handling & Telemetry

- Lifecycle APIs return discriminated unions `{ ok: true, data } | { ok: false, code, message, correlationId }`, raising interface clarity to a 5 by describing every failure path explicitly.
- `EventJournal` entries carry correlation ids and payload hashes so websocket consumers reconcile optimistic UI updates with actual session state.
- `FitnessSession.ingestData` validates device payloads against the ledger; mismatches emit `ORPHAN_DEVICE`/`UNKNOWN_GUEST` events and trigger automatic reconciliation workflows.

### 6.5 Migration Strategy

1. **Dual-write phase:** Introduce the ledger and `GuestAssignmentService` while still updating legacy `guestAssignments` for compatibility; add unit tests asserting both remain in sync.
2. **UI adapter phase:** Update `FitnessUsersList` and related components to consume the new selectors/DTOs, turning them into pure presenters.
3. **Validation phase:** Use `EventJournal` telemetry and automated reconciliation tests to confirm no drift occurs; once stable, remove old structures and duplicated zone helpers.
4. **Durable profile phase:** Export existing guest data into `GuestProfileRepository` (file or API) and enable automatic hydration on assignment.
5. **Cleanup phase:** Enable periodic `cleanupOrphanGuests` and `reconcileAssignments` jobs, ensuring encapsulated, auditable data handling.

This design keeps device/user state authoritative within the session layer, gives the UI intent-based APIs, and prevents further drift in heart rate zone calculations.

## 7. Architecture Scorecard (Post-Design Target)

| Principle | Target Score (1-5) | How the Design Achieves It |
|-----------|--------------------|---------------------------|
| Modularity | 5 | Device Assignment Ledger + service layer isolate domain logic from React components, giving each layer a single responsibility. |
| Separation of Logic & Presentation | 5 | Context exposes view models/DTOs while UI renders them without rebuilding data, keeping logic in session/services only. |
| Encapsulation | 5 | Consumers interact through typed services (`GuestAssignmentService`, `ZoneProfileStore`), no longer mutating Maps directly. |
| Interface Clarity | 4 | Discriminated-union responses and runtime-validated inputs define precise contracts, reducing ambiguity in error handling. |
| DRY (Don’t Repeat Yourself) | 5 | Zone computations and guest mapping live solely in `ZoneProfileStore` and the ledger, eliminating duplicate logic in UI/context. |
| Data Normalization | 5 | Ledger + registries normalize all device/user relationships with durable identifiers and correlation ids. |
| Observability / Auditability | 4 | EventJournal with structured events, correlation ids, and reconciliation jobs provides traceability, aiming for near top-tier observability. |

Executing the outlined recommendations and design changes should elevate each principle toward the 4–5 range, aligning implementation quality with the desired architecture goals.

## 8. Phased Implementation Plan

1. **Foundations (Week 1)**
   - Add runtime schema validators for guest assignment payloads.
   - Build `GuestAssignmentService` interface + stub implementation that still delegates to existing `guestAssignments` for compatibility.
   - Introduce `DeviceAssignmentLedger` data structure alongside legacy storage (dual write).

2. **Ledger Adoption (Week 2)**
   - Update `UserManager.assignGuest` to route through the service and ledger.
   - Create selectors (`useDeviceAssignments`, `useZoneProfiles`) returning immutable DTOs fed by the ledger/zone store.
   - Add unit tests ensuring ledger entries mirror existing behavior (assignment, reassignment, clearing).

3. **Zone Centralization (Week 3)**
   - Implement `ZoneProfileStore` with compiled zone snapshots and helper APIs.
   - Remove duplicated zone logic from `FitnessUsersList`, swapping in the new selectors.
   - Ensure `FitnessContext` only exposes view models, keeping raw Maps internal.
   - ✅ `ZoneProfileStore` now drives immutable zone view models and targeted helpers (`getZoneProfile`, `getZoneState`).
   - ✅ `FitnessUsersList` consumes `useZoneProfiles`, dropping the bespoke `deriveZoneFromHR` logic.
   - ✅ `FitnessContext` publishes `zoneProfiles` DTOs while keeping the underlying Maps/session structures private.

4. **Observability & Cleanup (Week 4)**
   - Create `EventJournal` and emit structured events for every ledger mutation.
   - Add `cleanupOrphanGuests` and `reconcileAssignments` jobs, wired to telemetry alerts.
   - Instrument `FitnessSession.ingestData` to cross-check ledger assignments, emitting warnings on mismatches.
   - ✅ `EventJournal` now captures `ASSIGN_GUEST`, ledger sync, and mismatch events for downstream telemetry consumers.
   - ✅ `cleanupOrphanGuests` and `reconcileAssignments` run after ledger mutations, logging warnings when drift is detected.
   - ✅ `recordDeviceActivity` validates ledger occupants per device, emitting warnings for missing or conflicting assignments.

5. **Persistence & UI Finalization (Week 5)**
   - Treat `data/fitness/config.yaml` as the canonical `GuestProfileRepository` (static at runtime) and integrate it into the service for automatic hydration.
   - Update UI components (dialogs, lists) to rely solely on the new DTOs and service hooks; remove remaining legacy code paths.
   - Conduct end-to-end tests covering guest swaps, restorations, and failure modes; remove legacy `guestAssignments` once parity is verified.

Following this phased approach keeps risk manageable, provides measurable checkpoints, and ensures each architecture score target is addressed incrementally.

## Work Log

- Replaced legacy guestAssignments map with DeviceAssignmentLedger and GuestAssignmentService; added discriminated-union responses and correlation ids for guest ops.
- Centralized zone state in ZoneProfileStore and pushed immutable zone DTOs through FitnessContext and useZoneProfiles; removed duplicate HR->zone math from UI components.
- Updated FitnessSession, UserManager, and FitnessContext to hydrate from the ledger, enforce assignment reconciliation, and emit EventJournal telemetry (assign, reconcile, orphan warnings).
- Refactored UI presenters (FitnessSidebar/FitnessUsers/FullscreenVitalsOverlay) to consume ledger DTOs and zone view models; cleaned up Map/object churn.
- Added unit tests for DeviceAssignmentLedger, FitnessSession observability, and ZoneProfileStore; introduced npm test script in frontend package.
- Documented guest replacement design, scorecard goals, phased rollout, and remaining gaps; captured recommended next steps for cleanup/reconciliation and DTO-only presentation.
