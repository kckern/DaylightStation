# Auth Layer Design v2

## Overview

Three-scope authentication and authorization layer for DaylightStation. All access control flows through a unified IAM role system — household network trust, user JWT tokens, and system admin access all resolve to the same role-based permission model.

This document extends the original auth layer design with onboarding, user lifecycle, and invitation flows.

## Scope Model

Three concentric scopes, unified by IAM roles:

```
┌─────────────────────────────────────┐
│  SYSTEM  (sysadmin role + JWT)      │
│  ┌───────────────────────────────┐  │
│  │  HOUSEHOLD  (domain + LAN)   │  │
│  │  ┌─────────────────────────┐ │  │
│  │  │  USER  (JWT + role)     │ │  │
│  │  └─────────────────────────┘ │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Household scope** — auto-grants IAM roles when request satisfies:
- `Host` header matches a configured household domain
- `req.ip` is a private range (10.x, 172.16-31.x, 192.168.x, ::1, ::ffff:127.x)

**User scope** — JWT Bearer token in `Authorization` header. Token roles merge with any household-granted roles.

**System scope** — same JWT mechanism; the user holds a role (e.g., `sysadmin`) that grants access to system-level apps.

### Merged Role Resolution

Household trust doesn't bypass IAM — it **grants** IAM roles. All sources merge:

```
Request from household LAN  →  auto-assigned roles: [kiosk]
Request with JWT             →  token roles: [parent]
Request from LAN + JWT      →  merged roles: [kiosk, parent]
                                  → effective apps: union of both
```

## Auth Config

Single source of truth: `data/system/config/auth.yml`

```yaml
# Role definitions — each role grants access to a list of apps
roles:
  sysadmin:
    apps: ["*"]
  admin:
    apps: [admin, finance, config, scheduler, devices, members]
  parent:
    apps: [fitness, finance, lifelog]
  member:
    apps: [fitness, lifelog]
  kiosk:
    apps: [tv, office, content, display, play, queue, stream, canvas, device]

# Household auto-granted roles when on LAN + household domain
household_roles:
  default: [kiosk]

# App-to-route mapping (routers not listed are unrestricted/public)
app_routes:
  admin:     [admin/*]
  finance:   [finance/*]
  config:    [config/*]
  scheduler: [scheduling/*]
  fitness:   [fitness/*]
  lifelog:   [lifelog/*]
  tv:        [list/*, play/*, queue/*, stream/*]
  office:    [display/*, canvas/*]
  content:   [content/*]
  device:    [device/*]

# JWT config
jwt:
  issuer: daylight-station
  expiry: 10y
  algorithm: HS256
  # secret: auto-generated on first boot if missing
```

Role definitions are config-file only — not editable via the Admin UI. The Admin app assigns existing roles to users but cannot create or modify role definitions.

### User Profile Addition

Existing user profiles gain a `roles` field:

```yaml
# data/users/kckern/profile.yml
username: kckern
household_id: default
roles: [sysadmin]
```

### Password Storage

Password hashes are stored per-user in `data/users/{username}/auth/login.yml`:

```yaml
password_hash: "$2b$12$..."
invite_token: null
invited_at: 2026-02-12T00:00:00Z
invited_by: null               # null for first-boot admin
last_login: 2026-02-12T10:30:00Z
```

This sits alongside existing per-service auth files (`strava.yml`, `github.yml`, etc.) in the user's `auth/` directory but uses a distinct filename to separate system login credentials from service credentials.

## First Boot Onboarding

### Detection

Backend checks for any user with a `login.yml` file containing a `password_hash`. If none exist, the system is in setup mode.

`GET /api/v1/auth/setup-status` returns `{ needsSetup: true }`. The frontend checks this on load and redirects to the setup wizard when true.

### Wizard Flow

```
┌──────────────────────────────────┐
│                                  │
│       DaylightStation            │
│                                  │
│    Welcome to your new station.  │
│                                  │
│        [ Get Started ]           │
│                                  │
└──────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────┐
│                                  │
│    Create Admin Account          │
│                                  │
│   Username  [____________]       │
│   Password  [____________]       │
│   Confirm   [____________]       │
│                                  │
│           [ Next ]               │
│                                  │
└──────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────┐
│                                  │
│    Name Your Household           │
│                                  │
│   Household Name                 │
│   [________________________]     │
│                                  │
│         [ Finish Setup ]         │
│                                  │
└──────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────┐
│                                  │
│    Your station is ready.        │
│                                  │
│    You can add members, devices, │
│    and configure apps from the   │
│    Admin panel.                  │
│                                  │
│        [ Go to Station ]         │
│                                  │
└──────────────────────────────────┘
```

### What Gets Created

`POST /api/v1/auth/setup` (only works when `needsSetup` is true):

| File | Contents |
|------|----------|
| `data/users/{username}/profile.yml` | `username`, `household_id: default`, `roles: [sysadmin]`, `type: owner`, `group: primary` |
| `data/users/{username}/auth/login.yml` | `password_hash` (bcrypt), `invited_by: null`, timestamps |
| `data/household/config/household.yml` | `name`, `head: {username}`, `users: [{username}]` |
| `data/system/config/auth.yml` | Default roles + auto-generated JWT secret (if not already present) |

The endpoint returns a JWT token so the user is immediately logged in.

## Member Invitation Flow

### Admin Generates Invite

In the Admin app (Household → Members), after creating a member:

1. Admin clicks "Generate Invite Link"
2. `POST /api/v1/auth/invite` with `{ username }` in body
3. Backend generates a cryptographically random token, stores it in `data/users/{username}/auth/login.yml`:

```yaml
invite_token: "a1b2c3d4e5f6..."
invited_at: 2026-02-12T10:30:00Z
invited_by: kckern
password_hash: null
```

4. Returns the invite URL: `/invite/{token}`
5. Admin copies and shares the link with the household member

### Member Accepts Invite

1. Member opens `/invite/{token}`
2. Frontend calls `GET /api/v1/auth/invite/:token` to validate
   - Valid: returns `{ username, displayName }` (pre-filled from profile)
   - Invalid/expired: returns 404
3. Member sees a form with display name (editable, pre-filled) and password fields
4. Member submits → `POST /api/v1/auth/invite/:token/accept` with `{ displayName, password }`
5. Backend:
   - Bcrypts the password → saves to `login.yml`
   - Updates `display_name` in `profile.yml` if changed
   - Clears `invite_token` from `login.yml`
   - Issues a JWT
6. Member is logged in and redirected to the main app

### Invite Link Properties

- **No expiry** — home system, not a public service
- **Single-use** — token cleared after password is set
- **Regeneratable** — admin can generate a new invite link, which replaces the old token
- **Re-invitable** — if a member already has a password, regenerating an invite resets their auth (clears password_hash, sets new invite_token)

## Admin App Enhancements

### Member Editor Additions

The existing `MemberEditor.jsx` gains:

**Roles section:**
- Multi-select dropdown populated from roles defined in `auth.yml`
- Saved to `profile.yml` as `roles: [parent, member]`
- Sysadmin role only assignable by other sysadmins

**Auth status display:**
- Shows whether the user has a password set
- When they were invited, by whom
- Last login timestamp
- All read from `login.yml`

**Invite link management:**
- "Generate Invite Link" button (if no password set and no pending invite)
- "Regenerate Invite Link" button (if invite pending)
- "Reset Auth & Re-invite" button (if password already set, with confirmation)

### Household Management (Sysadmin Only)

New system-level admin section for sysadmins:

- **Create Household** — name, assign head-of-household from existing users
- **List Households** — view all households on the system
- **Switch Household** — navigate between household admin views

## Middleware Pipeline

Runs on every `/api/v1/*` request, in order:

```
Request
  │
  ├─ 1. householdResolver        (existing, wire it in)
  │     Sets req.householdId from Host header
  │
  ├─ 2. networkTrustResolver     (new)
  │     Checks req.ip against private ranges
  │     If local + valid household → req.roles = [...household_roles[householdId]]
  │     If not local → req.roles = []
  │
  ├─ 3. tokenResolver            (new)
  │     Reads Authorization: Bearer <jwt>
  │     If valid → merges token roles into req.roles, sets req.user
  │     If missing/invalid → no-op (req.roles unchanged)
  │
  ├─ 4. permissionGate           (new)
  │     Looks up which app this route belongs to (from app_routes)
  │     Expands req.roles → effective app list
  │     If route's app is in the list → next()
  │     If route has no app mapping → next() (unrestricted)
  │     Otherwise → 401 (no token) or 403 (insufficient role)
  │
  └─ Route handler
```

**Exception:** Auth endpoints (`/api/v1/auth/*`) bypass the permissionGate — they are public by design (setup, login, invite acceptance, context).

## JWT Token Design

### Token Payload

```json
{
  "sub": "kckern",
  "hid": "default",
  "roles": ["sysadmin"],
  "iat": 1739318400,
  "exp": 1739318400 + 315360000
}
```

- `sub` — username
- `hid` — household ID
- `roles` — snapshotted at issuance (role config changes require new token)
- 10-year expiry — effectively permanent for a home system

### Signing Secret

Stored in `auth.yml` under `jwt.secret`. Auto-generated (random 64-byte hex) on first boot if missing.

### Revocation

No per-token revocation. To invalidate all tokens, rotate the JWT secret in `auth.yml`.

## API Endpoints

### Auth Router (`/api/v1/auth/`)

All auth endpoints are public (no permissionGate).

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `GET` | `/auth/setup-status` | Returns `{ needsSetup }` | None |
| `POST` | `/auth/setup` | First-boot wizard: create admin + household | Only when `needsSetup` is true |
| `POST` | `/auth/token` | Login with credentials, returns JWT | None |
| `GET` | `/auth/context` | Household branding + auth method info | None |
| `POST` | `/auth/invite` | Generate invite token for a user | Requires `admin` app access |
| `GET` | `/auth/invite/:token` | Validate invite, return user info | None |
| `POST` | `/auth/invite/:token/accept` | Set password via invite, returns JWT | None |

### Request/Response Examples

**Setup:**
```
POST /api/v1/auth/setup
{ "username": "kckern", "password": "...", "householdName": "The Kern Family" }
→ { "token": "eyJ..." }
```

**Login:**
```
POST /api/v1/auth/token
{ "username": "kckern", "password": "..." }
→ { "token": "eyJ..." }
```

**Generate Invite:**
```
POST /api/v1/auth/invite
Authorization: Bearer eyJ...
{ "username": "elizabeth" }
→ { "inviteUrl": "/invite/a1b2c3d4e5f6..." }
```

**Accept Invite:**
```
POST /api/v1/auth/invite/a1b2c3d4e5f6.../accept
{ "displayName": "Elizabeth", "password": "..." }
→ { "token": "eyJ..." }
```

## Frontend Integration

### API Client

Add token header to existing fetch wrapper in `frontend/src/lib/api.mjs`:

```javascript
const token = localStorage.getItem('ds_token');
if (token) headers['Authorization'] = `Bearer ${token}`;
```

### Kiosk Apps (TVApp, OfficeApp)

No changes. No token sent. Backend auto-grants kiosk roles from LAN trust.

### User-Scoped Apps (AdminApp, FinanceApp)

Wrapped with `<AuthGate>`:

```jsx
<AuthGate app="finance">
  <FinanceApp />
</AuthGate>
```

`AuthGate` checks localStorage for a valid token with the required app permission. If missing or insufficient, renders `LoginScreen`.

### Auth Context Endpoint

`GET /api/v1/auth/context` — public, no token required:

```json
{
  "householdId": "default",
  "householdName": "The Kern Family",
  "authMethod": "password",
  "isLocal": true
}
```

Used by the login screen to show household branding and determine which auth method component to render.

### Login Screen

Modular login form at `frontend/src/modules/Auth/LoginScreen.jsx`:

```
┌──────────────────────────────┐
│                              │
│      The Kern Family         │  ← from /auth/context
│       DaylightStation        │
│                              │
│   Username  [____________]   │
│                              │
│   ┌────────────────────────┐ │
│   │  <AuthMethod />        │ │  ← pluggable: PasswordInput, PinInput, etc.
│   └────────────────────────┘ │
│                              │
│        [ Sign In ]           │
│                              │
└──────────────────────────────┘
```

The credential component is swappable based on `authMethod` from the context endpoint. First implementation: `PasswordInput` (standard password field).

### Auth Utilities

`frontend/src/lib/auth.js`:
- `getToken()` — read from localStorage
- `getUser()` — decode JWT payload
- `getUserApps()` — expand roles → app list
- `hasApp(appName)` — permission check
- `clearToken()` — logout

## User Lifecycle

```
                    ┌─────────────┐
                    │  No System  │
                    │   Users     │
                    └──────┬──────┘
                           │
                    First boot detected
                           │
                           ▼
                    ┌─────────────┐
                    │ Setup Wizard│
                    │ (3 steps)   │
                    └──────┬──────┘
                           │
              Creates admin + household
                           │
                           ▼
              ┌────────────────────────┐
              │   Active Sysadmin      │
              │   (JWT issued)         │
              └────────────┬───────────┘
                           │
              Admin creates member in Admin app
                           │
                           ▼
              ┌────────────────────────┐
              │   Member Created       │
              │   (profile.yml only,   │
              │    no auth yet)        │
              └────────────┬───────────┘
                           │
              Admin generates invite link
                           │
                           ▼
              ┌────────────────────────┐
              │   Invite Pending       │
              │   (invite_token set    │
              │    in login.yml)       │
              └────────────┬───────────┘
                           │
              Member opens link, sets password
                           │
                           ▼
              ┌────────────────────────┐
              │   Active Member        │
              │   (password set,       │
              │    JWT issued)         │
              └────────────────────────┘
```

## New Files

| File | Purpose |
|------|---------|
| `data/system/config/auth.yml` | Roles, app_routes, JWT config, household_roles |
| `data/users/{username}/auth/login.yml` | Password hash, invite token, timestamps |
| `backend/src/4_api/middleware/networkTrustResolver.mjs` | Private IP check, assign household roles |
| `backend/src/4_api/middleware/tokenResolver.mjs` | Parse JWT, merge user roles |
| `backend/src/4_api/middleware/permissionGate.mjs` | Expand roles → apps, enforce route access |
| `backend/src/4_api/v1/routers/auth.mjs` | Auth endpoints (setup, login, invite, context) |
| `frontend/src/lib/auth.js` | Token utilities |
| `frontend/src/modules/Auth/SetupWizard.jsx` | First-boot onboarding wizard |
| `frontend/src/modules/Auth/LoginScreen.jsx` | Modular login form |
| `frontend/src/modules/Auth/AuthGate.jsx` | Wrapper for user-scoped apps |
| `frontend/src/modules/Auth/InviteAccept.jsx` | Invite link landing page |
| `frontend/src/modules/Auth/methods/PasswordInput.jsx` | Password auth method |

## Modified Files

| File | Change |
|------|--------|
| `backend/src/app.mjs` | Wire auth middleware into pipeline |
| `frontend/src/lib/api.mjs` | Add Bearer token header to fetch wrapper |
| `frontend/src/Apps/AdminApp.jsx` | Wrap with AuthGate, add role assignment UI |
| `frontend/src/modules/admin/household/MemberEditor.jsx` | Add roles, auth status, invite link sections |
| `data/users/{username}/profile.yml` | Add `roles` field |

## Unchanged

- All 43 existing API router files — no edits needed
- TVApp, OfficeApp — no changes
- Existing `householdResolver.mjs` — wired in, not rewritten

## Open Decisions

- **Auth method for login** — password is first implementation, but PIN/device-grant can be added later via the pluggable `<AuthMethod />` slot
- **Multi-household admin UI details** — sysadmin can create households and assign heads, but exact UI layout deferred to implementation
