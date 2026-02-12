# Auth Layer Design

## Overview

Three-scope authentication and authorization layer for DaylightStation. All access control flows through a unified IAM role system — household network trust, user JWT tokens, and system admin access all resolve to the same role-based permission model.

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

### User Profile Addition

Existing user profiles gain a `roles` field:

```yaml
# data/users/kckern/profile.yml
username: kckern
household_id: default
roles: [sysadmin]
```

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

### Token Endpoint

`POST /api/v1/auth/token` — accepts credentials, returns `{ token }`. The authentication method is pluggable (password first, PIN/other methods later).

### Revocation

No per-token revocation. To invalidate all tokens, rotate the JWT secret in `auth.yml`.

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

## New Files

| File | Purpose |
|------|---------|
| `data/system/config/auth.yml` | Roles, app_routes, JWT config, household_roles |
| `backend/src/4_api/middleware/networkTrustResolver.mjs` | Private IP check, assign household roles |
| `backend/src/4_api/middleware/tokenResolver.mjs` | Parse JWT, merge user roles |
| `backend/src/4_api/middleware/permissionGate.mjs` | Expand roles → apps, enforce route access |
| `backend/src/4_api/v1/routers/auth.mjs` | `POST /auth/token`, `GET /auth/context` |
| `frontend/src/lib/auth.js` | Token utilities |
| `frontend/src/modules/Auth/LoginScreen.jsx` | Modular login form |
| `frontend/src/modules/Auth/AuthGate.jsx` | Wrapper for user-scoped apps |
| `frontend/src/modules/Auth/methods/PasswordInput.jsx` | Password auth method |

## Unchanged

- All 43 existing API router files — no edits needed
- TVApp, OfficeApp — no changes
- Existing `householdResolver.mjs` — wired in, not rewritten
- User profile structure — only addition is `roles` field

## Open Decisions

- **Auth method for login** — password is first implementation, but PIN/device-grant can be added later via the pluggable `<AuthMethod />` slot
- **Password storage** — bcrypt hash in user profile or separate auth store TBD at implementation time
