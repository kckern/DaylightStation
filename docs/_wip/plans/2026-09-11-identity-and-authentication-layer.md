# Identity — knowing which adult, not keeping anyone out

**Status:** planned, not started.
**Settled in conversation 2026-09-11**, including two corrections recorded in §2
so they are not re-derived.

---

## 1. What this is for

The teacher PIN is a band-aid. Not because it is insecure — because **it is a
shared secret standing in for "which adult is this," and it cannot answer that.**
Everyone who knows the four digits is "the teacher."

The gap is **attribution and scoping**, not defence:

- Every LAN request today is an anonymous `sysadmin`. Nothing in the system can
  say which adult did anything.
- Health resolves to head-of-household unconditionally. That one line is why it
  is single-user, and it is what blocks a second adult later.
- The teacher console needs to know *who*, and asks for a PIN because there is
  nowhere else to get it.

So: a light login that establishes **identity**, not a wall.

---

## 2. What already exists — and two corrections

**There is a five-stage auth pipeline** on every `/api/v1` request
(`app.mjs:589-623`): `requestLogger` → `deviceResolver` → `householdResolver` →
`networkTrustResolver` → `tokenResolver` → `permissionGate`. It works. Roles
expand to apps, `app_routes` maps routes to apps, and unmapped routes are
unrestricted.

`data/system/config/auth.yml` **already encodes the kiosk/adult split**:
`kiosk` grants tv, office, content, display, play, queue, stream, canvas,
device, fitness, requirements; `admin` and `parent` grant the adult apps. A
router census re-derives what this file already states — do not bother.

### Correction 1 — "nothing enforces auth" was wrong

It is enforced. The pipeline above is mounted and correct. The reason an
unauthenticated `curl` gets 200 is §2's next paragraph, not an absent gate.

### Correction 2 — "the internet can reach sysadmin" was wrong

`networkTrustResolver` grants `sysadmin` to any private socket peer, and every
request through the reverse proxy presents one. That looks alarming and is not,
**in this topology**: remote access is WireGuard only, so a VPN client *is* a
LAN client, plus one deliberate IP pinhole for a work VPN which is to be treated
as equivalent. There is no untrusted path to the box.

**The LAN-trust grant is the perimeter working as designed. Do not "fix" it.**
Changing it would break daily use to defend against an attacker who cannot reach
the machine.

---

## 3. Explicitly out of scope

Recorded so it is not reopened:

- **Perimeter security.** WireGuard is the boundary. Cloudflare's WAF and the
  work-IP pinhole are deliberate, understood, and sufficient.
- **Kiosk escape.** Tablets run Fully Kiosk in kiosk mode. If a child escapes
  it, hijacks the URL, and reaches an adult route, that is accepted risk and a
  **physical/OS-level concern on the client**, not this codebase's.
- **Child authentication.** Honour system, permanently. Children have no
  browser, no password, no PIN, no passkey. The disincentive to impersonation is
  that it gives you the wrong history, difficulty and progress.
- **A child-facing finance app**, if it ever exists, is a separate application.

---

## 4. Decisions

| # | Decision |
|---|---|
| 1 | A light **login establishes identity**, not a gate |
| 2 | **Passkey preferred**; password fallback carries TOTP (6-digit) |
| 3 | Session on a long-lived HttpOnly cookie — one sign-in, every adult app |
| 4 | Sessions listable and **revocable from Admin** |
| 5 | **Health user-scoped**; Finance stays household-scoped |
| 6 | **Teacher PIN retires** — the console reads the signed-in adult |

---

## 5. The work

**A. Login that establishes who.**
`AuthService`, accounts, roles, invites and `/api/v1/auth/*` already exist and
an owner account already has a password. What is missing is a session a browser
carries automatically: `/auth/token` sets an HttpOnly cookie, and
`tokenResolver` reads that cookie in addition to the `Authorization` header.
Passkeys land as a new method in `frontend/src/modules/Auth/methods/`, which
already holds `PasswordInput.jsx` and is shaped as a plug-in slot.

*Open, and only for this item:* passkeys bind to one RP ID, and adults reach the
app on `daylightlocal.kckern.net` at home/VPN and `daylightstation.kckern.net`
through the work pinhole. Settle which origin (or shared suffix) when building
this — not before.

**B. Principal becomes the signed-in user.**
`DefaultPrincipalResolver.resolve()` answers head-of-household unconditionally.
Once a session exists it answers the authenticated user, falling back to
head-of-household for kiosk and unauthenticated contexts. Health becomes
multi-adult-ready without a single Health file changing. Finance is unaffected —
it is household-scoped by intent.

**C. Retire the PIN.**
`TeacherGate`'s base tier becomes "the signed-in adult" instead of "knows the
PIN." Keep `TeacherCapabilitySessions`' step-up model — one-use grants scoped to
action *and* resource, idle and absolute timeouts, the closed action set — it is
good, and it becomes genuinely per-person once the base tier is an identity.
`teacher.pin` leaves `school.yml`. `print.teacherPin` is a different secret for a
different job and stays.

**D. Sessions in Admin.** List and revoke. Small once A exists.

A → B → C, then D. B is inert before A (with no session there is no user to
resolve to). Nothing here is urgent; nothing here is a wall.

---

## Related

- `backend/src/4_api/middleware/networkTrustResolver.mjs` — the LAN-trust grant,
  and the comment that correctly deferred this decision
- `backend/src/4_api/middleware/permissionGate.mjs` + `data/system/config/auth.yml`
  — the role/app model that already exists
- `backend/src/3_applications/common/context/DefaultPrincipalResolver.mjs` — the
  one line making Health single-user
- `backend/src/3_applications/school/TeacherCapabilitySessions.mjs` — the step-up
  model to keep
