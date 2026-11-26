# Daylight Station identity, access, and policy scope

Implementation brief for review, 2026-11-26. The decisions under “Product contract” come from the design conversation. The defaults, interfaces, and rollout below are proposed engineering and product choices.

## Product contract

- One installation can serve multiple households.
- Personal browser apps require a signed-in user. Admin requires a signed-in adult owner or admin of the active household.
- Browser session expiration is configurable. A ten-year lifetime is an acceptable setting for a local installation. A signed-in person opening Health sees and updates their own records by default.
- Kids have no login credentials. A future teen login cannot grant administrative authority.
- Kiosks never prompt for browser login. Piano and School can trust a tap or card for participation. Selected games and overrides can require a biometric match with user or admin authority.
- Anyone in the room can use the ordinary room display. Only subapps that need a participant select one.
- Named and unnamed guests can play Piano, do guest work in School, and use a heart-rate monitor in Fitness. Neither kind of guest earns Fitness rings.
- Content Filter, State Gates, and other feature policies can be assigned to individual people or roles as well as wider scopes.

## Taxonomy

| Dimension | Values and meaning |
|---|---|
| Ownership scope | Installation → household → person. A resource also has a type and ID, e.g. the garage device, a film, a session, or a learner's work. System configuration, household finances, and an individual's health record have different owners. |
| Caller | Account with a live session, registered device, service with a credential, or uncredentialed caller. Browsers, native clients, Telegram, and WebSocket are ways to connect. Each operation declares the caller types it accepts. |
| Relationship to this household | Member with a household person ID, named guest in the people directory, or anonymous participant with a slot in this session. A room with nobody selected has an empty audience. A person can have different relationships in different households. |
| Authority | Installation owner/operator governs installation operations. Household owner and household admin are assignments in one household. Ordinary members can hold specific grants such as teacher, driver, or game player. A household owner may also be the installation owner. |
| Age and enrollment | Adult, child, future teen, or unknown. Account eligibility, School enrollment, and Fitness program enrollment are separate facts. A household member with no account can receive rings or be a learner. A named guest has a durable directory identity even if an app retains no personal history. |
| Surface and evidence | Personal browser session, unattended kiosk, room display, service ingress, or background job. Evidence can include a device binding, a self-identified tap/card, a verified user session, an authenticated service, or a fresh biometric match. Each proves a different fact. |
| People involved | The caller requests the action. The participant plays or learns. The resource owner owns the record. The audience receives the content. An approver can authorize a specific action for another person. Multiple participants can share a session. |
| Policy assignment | A household can target a person, household role, age/guest category, room/device, or household default. Installation defaults can supply a baseline. Every assignment names an action or domain policy and its applicable resource. |

For example, a child selects their own card on the garage kiosk. The device requests a game for that child. If the game requires adult approval, its approver is the adult who scans their finger. The child stays the player and policy subject. The next game makes its own access decision.

### Human participation and authority in one household

| Person in the active household | Personal browser apps in v1 | AdminApp | Kiosk activity | Fitness rings | Admin biometric override |
|---|---|---|---|---|---|
| Adult household owner | With login and app grant | Yes, with live login | As selected participant | If enrolled/eligible | With matching fingerprint and action grant |
| Adult household admin | With login and app grant | Yes, with live login | As selected participant | If enrolled/eligible | With matching fingerprint and action grant |
| Ordinary adult member | With login and app grant | Denied | As selected participant | If enrolled/eligible | Denied |
| Child member | No credentials | Denied | Tap/card for ordinary work or play | If enrolled/eligible | Denied |
| Teen member | No credentials in v1 | Always denied, including a future signed-in teen | Same as other household participants | If enrolled/eligible | Denied |
| Named guest | Guest directory entry only | Denied | Piano, School practice, HR under a known guest identity | Never | Denied |
| Unnamed guest | Activity seat only | Denied | Piano, School practice, HR for this session | Never | Denied |

The first two rows describe an adult **and** a role assignment. Installation ownership alone does not fill either row in another household. A registered device or service uses its own action allowlist. A user-scoped biometric lock can authorize an eligible player who has no browser account.

## Matrix of actions

| Action | Entry and proof | Who or what determines the result |
|---|---|---|
| Open Media, Health, Home, Auto, Finance, Feed, or Life | Live browser session plus grant for the app | Resolve the active membership. Health and personal history use the authorized person. Finance and household controls use that household. App entry and the right to read or change a particular record are separate. |
| Open any Admin page or invoke its administrative operations | Live browser session for an adult with household owner/admin authority | Applies to direct URLs, alternate mounts, localhost and API access. Ordinary adult, child, future authenticated teen, guest, screen and bot cannot open Admin. Installation administration has an additional installation grant. |
| Use the School teacher console | Signed-in adult plus the existing teacher gate and any action-specific confirmation | Its dedicated browser route is separate from the login-free learner portal. An Admin-hosted teacher view must satisfy both boundaries. |
| Play Piano or do guest School work | Household kiosk. Tap/card for a person, pick Guest, or create an anonymous seat | Guest School practice is a real activity. A trust-based learner claim admits the ordinary work configured for that learner on that station. Gradebooks, private files, enrollment changes and teacher history require their own authority. |
| Use a Fitness HR monitor | Household kiosk with a participant assignment for this workout | Show each participant's live HR. Only eligible household participants feed the ring calculation, history, dashboard and payout consumers. Check each seat even when guests and members share a workout. |
| Start a protected game / apply an override | Kiosk starts a challenge for the exact operation | A user-scoped unlock requires the authorized user. An admin-scoped unlock requires a matched, eligible adult owner/admin with the relevant grant. Which games need which proof is a household policy. Preserve current lock settings on migration. |
| Show the room screen / launch a subapp | Open room view scoped to its provisioned household or an explicitly open presentation | No person by default. A subapp can request participants for its own actions. It gets its declared data projection and can return to the room view with no selected person. |
| Receive a bot update / run a scheduled job | Credential for that integration or service, bound to household and permitted operations | A Telegram bot handling a person's request must additionally resolve the sender and their grant. An autonomous scheduled operation uses its own grant. |
| Play filtered media / evaluate a state gate | Authorized caller, declared audience and resource | Resolve the affected person's or group's policy. Permissions to author, activate, attest, override, or inspect someone else's policy are distinct from using it. |

## Defaults proposed for this rollout

1. **Account and person identity.** An account is installation-wide and can link to explicitly granted memberships in more than one household. Each browser session is active in exactly one household. Use configured household origins for selection. A person visiting another household can have a separate guest identity there. Never link names, avatars, card labels, or Telegram handles automatically. Preserve the existing participant wire IDs (`user`, `guest`, `anonymous`) and existing household rosters.
2. **Authority and age.** Only known adults can receive v1 browser credentials. Enrollment is explicit. Only an eligible adult owner can delegate household admin/owner authority, and an ownership transfer must leave an eligible owner. A household admin can manage ordinary memberships and invites within their grants. Household roles do not grant access to another household or automatic access to someone else's health records. Use current membership and eligibility at action time, including on role changes. Birthdays do not issue credentials. Unknown age cannot satisfy an adult requirement. The School domain keeps its existing age and teacher rules.
3. **Guest history.** A named guest can be recognized next visit. Start with session-only guest School practice and HR participation. An ordinary session record may retain its existing participant snapshot. A new personal guest history, graded record, or reward requires a separate explicit domain policy. An unnamed guest gets an opaque seat per activity session and can never resolve to a durable person by display name. Archiving a named guest preserves historical snapshots and prevents new selections.
4. **Device trust.** Provision a kiosk or managed display once, with a household-bound credential, outside the participant flow. Keep plain room rendering available on an ad hoc screen using only explicitly open content. A room network or client-declared device name can assist discovery. Private feeds, device commands, credit-bearing writes and biometric approvals require a registered device or an authorized personal session. Normal kiosk activity needs no human password, login redirect, or login cookie. If a station is unprovisioned, show its available open view or station status.
5. **Scope of biometric consent.** Bind the challenge to household, device, reader, activity session, participant/beneficiary, action, resource and operation ID. A confirmed grant is single-use and expires at the earliest of 60 seconds after confirmation, the existing operation's shorter proof window, or a session/participant/policy change. Recheck the approver's current grant at use. A duplicate operation can return its stored result. Timeout or loss of the reader leaves ordinary play available. A fingerprint or an account belonging to a teen cannot authorize an admin action. First-finger enrollment of a privileged identity requires an already authorized enrollment process.

## Routing a request to the right data

Opening an app, choosing whose data it should use, and authorizing an operation on that data are distinct decisions. For a normal Health request the server resolves the subject before opening a store.

1. Resolve the household from its configured origin and validate the browser session for that household. Load the account's current membership and its stable household person ID.
2. Use that person as the subject of the Health request. An explicit request to act for another person requires a current grant for that subject, household and operation. Reading and changing a record are separate grants. Being a household owner or admin grants neither automatically.
3. Resolve the subject's storage key through the membership, then open the household runtime and that person's stores. Use the same subject for reads, lists, creates, updates, deletes, attachment bytes and derived results. A member with no measurements gets an empty history. A missing or ambiguous owner mapping stops the operation before a store is opened. A display name, chart selection, query parameter or remembered username cannot establish ownership.
4. Keep the actor and subject through the whole operation. A caregiver entering a reading writes to the patient's record and the audit identifies the caregiver. Scope browser snapshots, pending writes, deduplication and subscriptions to the household and subject, and to the acting account where data is private to that session. On a switch, discard late responses and reauthorize pending work against its original owner.

| Resource | How Daylight chooses the data |
|---|---|
| Health readings, nutrition, photos, weight history, coach chat and dashboards | The authorized household person owns the inputs and the derived results. Existing per-user stores can keep their files behind a verified membership-to-storage mapping. A login in a second household opens its separately mapped person. |
| Health imports and background work | Bind the provider account or enrolled device to the household and intended person. Carry that binding through harvesting, queued work, retries and publication. If a shared scale cannot identify a person, hold the measurement for assignment or skip the personal write. An administrator connecting an integration does not become the subject of its data. |
| Open room display | An approved projection selects the permitted fields and audience. Opening a Health widget on the wall does not select a patient or expose the private Health API. |

The proposed multi-household default gives each membership its own Health record. Whether one person should have a continuous history across households is a product decision. Any shared record would need an explicit identity link and consent covering the participating households.

For migration, retain a legacy per-user directory when its owner is unambiguous. Report ambiguous directories for an explicit mapping before enabling that person's data. Verify with two adults in one household and a same-named person in a second household. Each must have different stored readings, including after an import, browser switch and restart.

## Application access matrix

These are proposed response and action boundaries. A household can grant a narrower role, person or resource scope. A person's preference can change the arrangement of data they may see. A grant can change which data the server returns. Classify the operation and its actual effects, including reads that contact a provider or operate a device.

| Surface | Whose data the server returns | Actions that need their own authority |
|---|---|---|
| Health | The person's readings, nutrition, attachments and derived charts. A delegated view names the patient. | Read, record, edit, delete, import and share by subject. |
| Life, Lifelog, Journalist and Work | The person's plans, goals, journal, work context, correspondence and briefings. A household roster provides only the directory fields needed for an authorized selector. | View a record, add an entry, change a plan, export or invoke an agent for that subject. An agent carries the same subject into its tools, memory and output. |
| Feed and Triage | Articles can share a source. Subscriptions, read/saved state, annotations, offline editions, inbox cards, counts and action history belong to a person. | Read, annotate or change subscriptions in Feed. Inspect a Triage card separately from sending, archiving, closing or undoing an external action. |
| Home and cameras | Household rooms/devices with viewer-specific fields and actions, plus the viewer's own layout. Show only approved cameras and independently authorized live images or recordings. | Read current state, read history, change a device, activate an approved scene, view or control a particular camera, save one's own view, or edit the household dashboard. |
| Finance | Household budgets and shared obligations. A granted category total is one projection. Accounts, balances, transactions, memos, payroll and mortgage details have narrower audiences. Identify an earner/account owner before exposing personal details. | Read a summary or an account's details, edit memos/pairs, fetch provider data, categorize, compile, sync payroll or administer connections. |
| Auto | A granted vehicle can expose fuel, odometer and maintenance due dates. GPS, trips, recordings, named places and document contents have independent audiences. Identify a driver only with an established association. | View overview or location, retrieve a document, log fuel or service, edit/delete a record or manage places. |
| Media and live channels | Catalog, household favorites and a shared queue can stay shared. Personal watched state and resume positions follow a viewer. Room playback, its current item and local queue follow the target screen/session. | Browse, curate shared favorites, enqueue/reorder/clear, play, cast/move between authorized screens, manage channels or administer the fleet. A room play creates personal history only for an explicitly attributed viewer. |
| Calendar, tasks, Agenda, Gratitude and Weekly Review | Combine sources after applying their sharing rules. A family event may show its title. A private event may contribute an explicitly shared busy interval. A review can show an approved learner showcase or contribution. Keep raw reflections, recordings and drafts with their authorized review audience. | Read a projection, contribute as an identified participant, run a household agenda, edit a source event/agenda, review a draft or publish to a room. |
| School and teacher console | A learner's assignments and progress follow the selected learner. A guest gets a practice session. A teacher's view is bounded by their authority over the requested learners and records. | Practice, submit assigned work, inspect a gradebook, edit enrollment or publish a showcase. Ordinary learner entry uses tap/card. The browser teacher route requires a signed-in eligible adult. |
| Piano, Fitness and games | Piano progress follows the participant. Fitness returns live HR for assigned workout seats. Only an eligible enrolled member receives rings and durable personal rewards. Games have activity-specific participants, hosts and verifiers. | Join/play, save personal progress, award credit, host a session or approve a specific protected action. A biometric approver and the player can be different people. |
| Room framework, HomeLine and Share | An open screen has no selected person. A paired screen gets approved room data. Calls and shares expose admitted destinations and the caller's or target device's own active session/job. | Discover a destination, call/wake/join/end, share to a screen or control it. The proposed personal `/call` route uses browser sign-in. A paired intercom or TV uses its device grant and call lease. |
| Admin, personal account, and installation settings | Admin sees authorized household membership, session, credential and policy metadata. A signed-in person can manage their own sessions. Installation settings require an installation grant. | Separate member enrollment, role delegation, credential revocation, policy activation, household creation and ownership transfer. Entry to Admin grants no personal content access. |
| Bots, native phone/car, integrations, jobs and live events | Bind service/device, household, intended person or resource, and authorized recipient. A personal phone WebView follows browser rules. A native upload, Telegram command or background job supplies its own verified context. | Distinguish reading, commanding, forwarding, sending and subscribing. Keep the original scope on a retry, widget refresh, notification, download or reconnect. |

### Home as a household app with personal views

Keep one household inventory and default dashboard. Store a person's chosen start view, pins and ordering under their household membership. The API applies the household dashboard rules and the viewer's room, entity and field grants first. Generate lists, room names, counts, energy summaries, history, timelines and action buttons from the permitted data. The browser may rearrange that result. An explicitly authorized aggregate such as a household power total can have its own projection and grant.

For a future signed-in teen, an example household could grant the current kitchen temperature and garage-light state, plus edits to the teen's own pins. The teen opens Home read-only for those devices. A parent may separately grant control of the garage light. Neither permission reveals private-room motion, camera recordings, or a general Home Assistant command interface. A saved pin loses visibility as soon as its data grant is withdrawn. This example does not enable teen credentials in v1.

Keep the same rule on direct URLs, optimistic UI, underlying command endpoints and subscriptions. Scene activation needs authority for the scene and its declared effects. Restrict a routine with indeterminate effects to a separately granted administrative operation. A house dashboard in the kitchen has its own room projection even if a parent previously used that browser.

## Browser sign-in and session lifetime

Use one sign-in for the permitted personal apps on a household hostname. Check `GET /api/v1/auth/me` before mounting the requested app or fetching private data. A 401 opens sign-in and returns the person to their validated local deep link. A 403 shows the denied action or app. A failed session check shows a retry state. At the root URL, show the person's permitted apps. Kiosks and room displays use their own surface rules.

Use the host-only `daylight_session` cookie with `HttpOnly`, `SameSite=Lax`, `Path=/` and `Secure` over deployed HTTPS. Keep existing cross-site request checks on cookie-authenticated mutations. Browser login, owner claim and invite acceptance set the cookie and confirm the session with the server. Keep bearer issuance for explicit native or CLI clients. Browser JavaScript needs no access or refresh token in localStorage, sessionStorage, IndexedDB or a URL. Cosmetic preferences may persist. Private cached records require a confirmed account, household and subject before display.

**Proposed settings.** Start with a ten-year absolute lifetime and an idle timeout that is off by default. The installation setting is `browserSessions: {absoluteLifetime: "10y", idleTimeout: null}`. A household can override either field. An omitted field inherits and an explicit `null` disables the optional idle timeout. Show the effective settings and their source in Admin → Identity & Access → Browser sessions.

Time starts at sign-in. A shorter policy caps existing sessions using their original issue time or last qualifying activity. A longer policy applies to new sign-ins. When idle expiry is enabled, user activity can extend it within the absolute deadline. Background polling and socket heartbeats cannot. Deadlines survive a server restart.

Keep the signed token's expiration within the server deadline and require a live session record and current grants for every protected operation. Reissue the cookie on a validated visit within the remaining lifetime. Browsers can limit a cookie's retention or clear it sooner. Someone returning after the cookie has disappeared signs in again. Chrome, for example, caps an individual cookie at 400 days. [Chrome cookie lifetime documentation](https://developer.chrome.com/blog/cookie-max-age-expires)

Logout revokes the server session and clears the cookie. Notify other tabs without sending a credential. On logout, expiry or account/household change, close private subscriptions, clear the previous private view and recheck on browser Back or tab restore. Losing an app or delegated grant takes effect on the server immediately, including while a long-lived session exists.

### Entry and recovery states

| Situation | What the person sees |
|---|---|
| First installation or a newly staged household | A designated adult accepts a one-use owner claim for that installation/household. A normal restart goes straight to the existing login state. A local installation operator can recover a lost sole owner through a separate recovery operation. |
| Opening a private URL, restoring a tab or switching households | A pending view until the server confirms the session and current grant. A signed-out visitor signs in once and returns to the requested local page. At the root, show the apps available in this household. |
| Signed in without the requested grant | An access-denied view with a way to reach allowed apps. If the person has no app grants, explain who in the household can grant access. On denial of a single action, keep other allowed actions available. |
| Session expired or revoked, or server unreachable | Expiry or revocation clears private content and leads to sign-in. Failed validation because of a network or server problem shows retry. An online check is required before revealing a restored private view. |
| Kiosk, room screen or a protected kiosk action | Open the station view. Prompt for a participant only where the feature needs one. A protected action can ask for a single biometric approval. An unpaired station offers its open view or pairing status. |
| Invited, suspended or returning member | An eligible adult accepts a household-specific invite. Used, expired or canceled links offer a route to request a replacement. Suspension ends that membership's access. Restoring it requires an authorized decision and fresh session. Keep historical attribution. |

### Administration journeys

Admin → Identity & Access opens on People for the active household. Provide invitations, roles and app permissions, policy assignments, stations and service credentials, browser sessions, and access history. Reuse the household member and session screens. A household admin works within their delegable grants. Only an eligible owner can assign household owner/admin. Keep age, household relationship, app enrollment and login status as separate fields.

Show why access is effective and what would change before applying or revoking a grant. Removing a direct grant can leave access through a role. Show the exact household, person or role, resource and action. Policy simulation can compare proposed and current access for a person, room or device. The ability to edit a policy is independently delegable only by an actor authorized to grant it. Audit who changed access and when, without including the protected records themselves.

## Access and policy decisions

The server resolves the household, caller and resource owner before loading private data. A registered surface sets the permitted actor types and evidence. A user-supplied header, URL, subject ID, role list or profile selector is input to validate. Equal labels or IDs in another household do not identify the same resource. Personal and kiosk actions sharing media, config, or School routes have distinct operations. For device operations an ambient browser cookie cannot promote the kiosk.

Every grant names a principal or role, an action and a target scope. Match the current household membership, person, ownership relation and resource. Deny an unregistered action or unmatched allow. An explicit applicable denial wins over grants. House boundaries, credential rules, adult-only administration and guest ring eligibility are invariants even for an owner. The only exception mechanism targets an individually declared overridable domain restriction. A decision to perform one override never confers a new role.

**Policy assignment and use.** Keep IAM authorization, State Gates evidence and Content Filter effects in their existing domains. The shared resolver selects obligations for the affected audience. State Gates evaluates its existing subject, period, publisher and validity rules. Content Filter applies its existing profile, film, and cue logic. A successful IAM check alone does not satisfy a required domain condition.

| Selector or condition | Proposed resolution |
|---|---|
| Content profile for one viewer | Resolve the replaceable default in order of person, role/age/guest group, device, room, household, installation. Equally specific conflicting bindings for an overlapping audience are rejected on activation. Immutable floors remain applicable. |
| Several viewers, or a station with a room floor | If required profiles agree, use that profile. Otherwise use a household-authored group profile explicitly approved for the full set of required profiles/floors. If no such profile is approved, hold that playback. Effects such as muting and hiding picture have no universal ordering. An empty room audience uses its room default. |
| Gates scoped to a role or person | Collect all matching required entitlement IDs, deduplicate, and evaluate them for the actual canonical domain subjects and period. An adult approving for a learner leaves the learner as the gate subject. Preserve each entitlement's authored failure posture. Missing required configuration or a missing applicable subject prevents that protected action. |
| Choosing a participant by tap/card | Apply the chosen participant's settings for normal play and credit. On an unattended surface the declared room/kiosk floor still applies. Relaxing a mandatory policy needs its own declared authority and proof. |
| Policy edits | Owners/admins with the policy-edit grant can preview the effective result, validate all references, and activate a version for their household. Use an expected revision, keep the previous valid revision on failure, and record who changed it. |

**Worked example.** Household A assigns the family filter to its lounge, a kids profile to the child group, and an individual profile to one learner. That learner's replaceable default comes from the individual assignment. The lounge floor still participates. If the learner's games also require the existing School-day entitlement, the kiosk evaluates that entitlement for this learner in A. An adult's one-game biometric approval can satisfy only the restriction identified in the challenge. Household B can give the same role name a different policy.

A household policy could express those assignments in this form. The containing household store supplies the tenant. The action catalog supplies the permitted surface and proof. The profile IDs in this example refer to profiles defined by this household.

```yaml
schema: household-access/v1
revision: 7
grants:
  - id: admin-film-library
    grantee: {kind: role, id: admin}
    action: media.read
    scope: household
    resource: {type: library, id: films}
    effect: allow
bindings:
  - {id: family-default, action: media.play, target: {kind: household}, profileId: family}
  - {id: admin-default, action: media.play, target: {kind: role, id: admin}, profileId: adult}
  - {id: kids-default, action: media.play, target: {kind: age, id: child}, profileId: kids}
  - {id: sam-viewer, action: media.play, target: {kind: person, id: sam}, profileId: sam-custom}
  - {id: lounge-floor, action: media.play, target: {kind: room, id: lounge}, floorProfileId: family}
  - {id: kids-game, action: game.startProtected, target: {kind: age, id: child}, requiredEntitlement: piano.games}
groupProfiles:
  - {profiles: [family, sam-custom], use: family-and-sam}
  - {profiles: [family, kids], use: family-and-child}
```

In this example only eligible adults can hold the `admin` role. For grants, `scope` is `system`, `household`, `self` or `resource`. Exact-resource grants include a type and ID. A grant with an optional resource selector on a broader scope narrows that grant. Supported grantees include household-scoped roles, people, accounts, devices and services. The persisted configuration references registered actions, subjects, targets and profiles. A caller-supplied role or room cannot select a more permissive rule.

## Isolation, observability and rollout

- Resolve a known household from an exact configured origin or a validated device/service binding. Allow a designated single-household entry only on an explicitly configured origin or ingress. In multi-household mode an unmapped or ambiguous request gets no default household. Reject mismatches between origin, credential, membership, runtime, and stored owner before side effects.
- Use the active household in persistence, app configuration, integration credentials, sessions, jobs, idempotency, caches, media tickets, device registries, subscriptions and broadcasts. One process can compose one runtime per household and share explicitly installation-wide services. A module still bound to the boot household is unavailable to other households until migrated.
- Produce a structured decision record with household, caller type/id, action, resource type/id, affected subject and approver where appropriate, allow/deny reason, and policy revision. Limit access to the record. Redact credentials, raw card/fingerprint IDs, biometric material, HR samples, finance/health payloads and private message bodies.
- Run old and proposed decisions side by side on synthetic data first, then in explicit observation mode per surface. Preserve working login-free kiosks and existing stricter owner checks throughout rollout. Use fixtures with two households and deliberately identical person, guest, room, device, film and sensor labels. Do not activate a second tenant on an unpartitioned surface. Retain the last enforced policy or close the affected protected operation if a rollback is needed.

## Existing code and prior decisions

The existing cookie, account records and Admin session UI provide the starting point. The session store currently uses installation storage and the LAN middleware supplies roles. Host resolution and several app factories can fall back to the default household. The bootstrap owner record can lack a birthyear. Preflight must identify that case and let an authorized installation operator confirm the eligible adult before enforcing Admin. An unverified age or conflicting age declarations for a linked account cannot confer adult authority. The September roadmap treated login primarily as attribution. This design adds an application authorization boundary for personal apps while keeping the established perimeter and trust-based participant experience.

Read the existing project references [the identity model](../../../__docs/reference/core/identity-model.md), `__docs/reference/core/configuration.md`, `__capabilities/content-catalog/docs/participant-launch.md`, `__docs/reference/fitness/fingerprint-unlock.md`, `__docs/reference/core/content-filter.md`, and `__docs/reference/state-gates/policy-authoring.md`. Earlier design history is in `ops:docs/roadmap/2026-09-11-identity-and-authentication-layer.md`. The [implementation plan](../plans/2026-11-26-identity-and-access.md) lists the code owners and cutover order.
