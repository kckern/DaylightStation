# Identity and authentication — making the layer we already have real

**Status:** planned, not started. Census complete (§4).
**Decided in conversation 2026-09-11.** Every §3 decision is settled; §7 lists
what is genuinely still open.

---

## 1. The problem, stated accurately

A complete authentication system already exists in this codebase and **nothing
on the server enforces it.**

What is built: `AuthService` (password digests, roles, household ids), an
account repository, an invite flow, a first-boot setup wizard, `/api/v1/auth/*`
(`setup`, `token`, `claim`, `context`, `invite`), `LoginScreen`,
`PasswordInput`, and an `AuthGate` component. Live state reports
`needsSetup: false, authMethod: "password"` — an owner account exists with a
password already set.

What is not: **any v1 router that verifies the token.** `bearerAuth` exists but
is wired only to the agent HTTP mounts (`mountAgentHttp.mjs`). `AuthGate` is
mounted on exactly one app — `AdminApp.jsx:141` — and it is a frontend
component, so it hides a screen and guards no data.

Verified 2026-09-11 against the running container, no credentials presented:

```
GET /api/v1/finance/accounts     200  real balances, incl. the mortgage
GET /api/v1/admin/household      200  household config, head, user list
GET /api/v1/admin/integrations   200  every integration's config
GET /api/v1/health/day?date=…    200  the day's food log
```

**This is why the teacher PIN felt like a band-aid: it is one.** It was built as
a parallel authorization system because the real one was never connected. The
work here is not to design an identity layer. It is to finish and enforce the
one that exists, and then delete the thing that grew up beside it.

---

## 2. The threat model this is actually for

Self-hosted. LAN is trusted; remote access is VPN-only; Cloudflare's WAF
whitelists the home IP. So this layer is **not** the thing standing between the
household and the internet, and it should not be built as though it were.

What it is for, in order:

1. **Attribution.** Nothing today can say which adult did what. Every
   consequential write should name a person.
2. **Blast radius.** A guest device, a misconfigured VPN client, or a
   compromised phone should not reach `/admin/config` or the camera feeds.
3. **Separation of the two adults** that will exist later — Health is
   per-person, Finance is household-wide.

**Children are explicitly not in this list.** They have no browser. They reach
only kiosks and screens, and everything they may do is reachable there without
logging in. Child identity is **honour-system by design**: the natural
disincentive is that impersonation gives you the wrong history, the wrong
difficulty, and the wrong progress. No child ever gets a password, a PIN, or a
passkey.

Because the perimeter does the heavy lifting, the adult gate should be **light**:
sign in once per device, stay signed in, step up only for the genuinely
destructive verbs.

---

## 3. Decisions taken

| # | Decision | Settled |
|---|---|---|
| 1 | Server-side enforcement of the existing JWT — the whole gap | yes |
| 2 | Session carried by a long-lived HttpOnly cookie, not a stored bearer token | yes |
| 3 | Sessions are listable and **revocable from the Admin view** | yes |
| 4 | Health becomes user-scoped; Finance stays household-scoped | yes |
| 5 | Teacher PIN retires — its base tier becomes "authenticated adult" | yes |
| 6 | **Passkeys are the preferred credential** | yes |
| 7 | If a password is used, it carries **TOTP 2FA (6-digit)** | yes |
| 8 | Mixed routers get sorted out properly — refactor where needed | yes |
| 9 | Kiosk routes stay public, and become **kiosk-scoped** | yes |
| 10 | The WS bus carries **adult-scoped commands** (remote unlock, curfew override) | yes |

A child-facing finance app, if it ever exists, is a **separate application**,
not a scope of this one.

---

## 4. The router census

62 v1 routers. Classified by which frontend surface actually calls them —
kiosk surfaces (`screen-framework`, Piano kiosk, Fitness, School child app,
Gaming) against adult surfaces (Admin, Finance, Health, Feed, Home, the School
teacher console, Auth).

### Adult only — gate outright (8)

`auth` · `feed` · `finance` · `health` · `lifelog` · `playback-hub` ·
`siblings` · `sync`

`auth` is the exception within the exception: its login endpoints must stay
reachable unauthenticated or nobody can ever sign in. Gate everything under it
*except* `setup-status`, `setup`, `token`, `claim`, and the invite-accept pair.

### Kiosk only — stay public, kiosk-scoped (17)

`art` · `economy` · `emulator` · `entitlements` · `feedback` · `gaming` ·
`health-dashboard` · `home` · `launch` · `local` · `piano` · `piano-games` ·
`play` · `presentation` · `proxy` · `qrcode` · `test`

`health-dashboard` is read by e-ink screens and is **not** the Health app; the
name collision is a trap worth renaming later.

### Mixed — need scoping, not whole-router gating (12)

The finding that shapes the design: **almost every mixed router is mixed
because kiosks READ while adults WRITE.** The boundary is method and sub-path,
not router identity.

| Router | What the kiosk needs | What the adult needs | Split |
|---|---|---|---|
| `admin` | `admin/apps` — piano kiosk reads its own app config | everything else: config, household, integrations, scheduler | move the kiosk read out of `/admin` entirely |
| `camera` | `camera/doorbell` — a screen action shows the door | every other feed, Home app | sub-path allowlist |
| `content` | `content/launch-targets` | content management | read/write |
| `device` | `device/config`, `device/<self>` | device control, remote commands | **self-scoped** read vs any-device write |
| `display` | `display/plex` | — | read |
| `fitness` | the whole child-facing surface | session admin, history | read/activity vs admin |
| `info` | `info/files`, `info/plex` | — | read |
| `list` | `list/files`, `list/plex`, `list/watchlist` | list management | read vs write |
| `queue` | `queue/plex` | queue management | read vs write |
| `school` | `school/lifecycle`, `school/selfservice` | `school/teacher/**` | clean prefix split |
| `screens` | its own screen config | screen management | self-scoped read |
| `static` | `static/img`, `static/users` | — | read |

`admin/apps` is the one genuine refactor: a kiosk should never call anything
under `/admin`, and the fact that it does is how that router ended up in this
column. The config read it needs belongs somewhere public.

---

## 5. The model

Three layers, named separately, because collapsing them is what produced the
PIN.

**Presence** — which human is probably here. Card tap, fingerprint, the piano
user chip, self-selection, which screen you are standing at. Ambient, cheap,
spoofable **by design**. Drives personalization and attribution only. Kiosks
and children live entirely here and nothing reachable from presence alone
grants anything.

**Account** — a real per-adult identity. One credential, every app, long-lived
on personal devices.

**Elevation** — authorization for one destructive act. Short, scoped, audited.

`TeacherCapabilitySessions` is already a good implementation of *elevation* —
idle and absolute timeouts, one-use grants scoped to action **and** resource
id, a closed step-up set, a 403-replay loop, refusals that cannot strand a
dialog. **Keep the model; replace its credential and lift it out of School.**

### Scopes

Rather than a binary gate, four scopes, because the census says the boundary is
read-vs-write:

| Scope | Means | Carried by |
|---|---|---|
| `public:read` | content, media, lists, art, static | nothing |
| `kiosk:self` | a device reading/writing **its own** state and the child activity it hosts | device identity header, already present as `fleet:<name>` |
| `adult` | every adult app and every write that is not household administration | session cookie |
| `adult:admin` | config editing, household, integrations, scheduler, device control | session cookie + role |

`kiosk:self` is what makes "public" stop meaning "anyone with the URL."
A screen may read its own config; it may not read another screen's, and it may
not reach `/admin`.

### Credentials

- **Passkey first.** Platform authenticator — Face ID / Touch ID / Windows
  Hello. Nothing to mint for anyone, nothing to type, nothing to shoulder-surf,
  per-person, revocable. `frontend/src/modules/Auth/methods/` currently holds
  exactly one file (`PasswordInput.jsx`) and is already shaped as a pluggable
  method slot, so this is additive.
- **Password + TOTP** as the alternate and the recovery path. A password
  manager holds the password; the 6-digit code covers the case where it leaks.
- **No shared secrets anywhere.** The teacher PIN is deleted, not improved.

**Passkeys bind to one RP ID (one domain).** This household serves adult apps
on both `daylightlocal.kckern.net` and `daylightstation.kckern.net`; a passkey
registered on one will not work on the other. **Adult surfaces must settle on a
single canonical domain** before passkeys land, or every adult registers twice.
This is the one decision that has to be made before step 4 rather than during it.

### Sessions

HttpOnly, `SameSite=Lax`, Secure, long-lived (30 days, renewed on use) on
personal devices. Automatic on every request, shared across every adult app on
the canonical domain, invisible to JS, survives reloads.

Server-side session records — id, user, device label, user agent, created,
last seen — so the Admin view can **list and revoke** them (decision 3). A
revoked session is refused on its next request; there is no token that outlives
the record.

Shared kiosks never hold an adult session. Not for lack of a mechanism — as a
rule, because children have unlimited physical access and unlimited time, and a
screen in a hallway is the one place an adult session must not live.

---

## 6. The WebSocket bus

The bus is a **second front door** and gating HTTP alone would leave it as the
bypass. It also has a real requirement the HTTP gate does not: adults need to
send **admin-scoped commands** to kiosks remotely — unlock a curfew, release a
lock, override a gate, drive a biometric enrolment — from a phone, without
walking to the screen.

So the bus needs the same three-scope treatment, not a blanket gate:

- **Subscribe (kiosk):** a screen subscribes to its own topics. Unauthenticated,
  device-scoped. Unchanged from today.
- **Publish (device):** hardware relays publish their own readings. Device
  identity, unchanged.
- **Command (adult):** anything that changes what a kiosk is allowed to do —
  unlock, override, enrol — requires the adult session, is attributed to the
  person, and is audited.

`subscribeAuthorized` already exists for Home Line calls and is the nearest
precedent for a per-topic credential; the command tier should follow its shape
rather than invent a second one.

---

## 7. Still open

1. **The canonical adult domain** (§5, passkeys). Needs a decision before
   step 4.
2. **`health-dashboard` vs `health`** — the name collision is a footgun; worth
   renaming the e-ink one while the scoping work is open.
3. **What a revoked session does to an in-flight WS connection.** Closing it
   immediately is correct and slightly more work than letting it lapse.
4. **Whether `adult:admin` is a role on the account or a step-up.** With two
   adults who are both administrators it makes no practical difference today;
   it will if a third adult is ever added who should not edit config.

---

## 8. Sequence

**Step 1 — enforce (closes the whole gap).**
`requireAdult` middleware verifying the existing JWT, mounted on the eight
adult-only routers and the adult halves of the twelve mixed ones. Kiosk routers
untouched. This is the only step that changes the security posture, and it is
independent of every credential decision below.

**Step 2 — session shape.**
`/auth/token` additionally sets the HttpOnly cookie; server-side session
records; `requireAdult` accepts the cookie. Bearer tokens keep working for the
agent mounts.

**Step 3 — user-scoped principal.**
`DefaultPrincipalResolver` currently answers head-of-household unconditionally,
which is *why* Health is implicitly one person's. Once a session exists the
principal becomes the authenticated user, falling back to head-of-household
only in kiosk contexts. Health becomes multi-adult-ready without a single
Health file changing. Finance stays household-scoped.

**Step 4 — passkeys + TOTP.**
New methods in `modules/Auth/methods/`. Requires the canonical-domain decision.

**Step 5 — retire the PIN.**
`TeacherGate`'s base tier becomes "authenticated adult"; step-up becomes
re-auth. `teacher.pin` leaves `school.yml`. `print.teacherPin` is a different
secret for a different purpose and stays.

**Step 6 — sessions in Admin.**
List and revoke. Small once step 2 exists.

**Step 7 — the bus.**
Scope subscribe/publish/command per §6.

Steps 1–3 are one change: same plumbing, and together they close the gap and
make Health correct. 4–7 are follow-ons that can land independently.

---

## Related

- [`../../reference/school/teacher.md`](../../reference/school/teacher.md) §1 —
  the capability/step-up model being generalized
- `backend/src/3_applications/auth/AuthService.mjs` — what already exists
- `backend/src/3_applications/school/TeacherCapabilitySessions.mjs` — the
  elevation model to lift
- `backend/src/3_applications/common/context/DefaultPrincipalResolver.mjs` —
  the one-line reason Health is single-user
