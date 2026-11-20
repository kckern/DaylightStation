# Network Exposure Guidelines

How to configure DNS, firewalls, and access control for DaylightStation.

**Related code:** `__backend/src/4_api/v1/routers/`, `__backend/src/0_system/http/middleware/`

---

## Quick Reference

### DNS

| Subdomain | Proxied | Resolves To | Purpose |
|-----------|---------|-------------|---------|
| `*.example.com` | Yes | Cloudflare edge | Production access |
| `local.example.com` | No | `{LAN_SERVER_IP}` | LAN access (works offline) |

### Firewall Rule

Block all traffic unless:
- Home IP (`{YOUR_HOME_IP}`)
- Work VPN (`{WORK_VPN_RANGE}`)
- Webhook source IPs (see [Webhook Source IPs](#webhook-source-ips))

### Access Policies

| App | Domain Pattern | Policy |
|-----|----------------|--------|
| Main Site Protection | `*.example.com` | Home + Work IPs only |
| Webhook Bypass | `.../*/webhook` | Webhook source IPs |
| Local API | `local.example.com` | Everyone (LAN-only by design) |

### Bot Webhook URLs

| Bot | Webhook URL |
|-----|-------------|
| Nutribot | `https://app.example.com/api/v1/nutribot/webhook` |
| Journalist | `https://app.example.com/api/v1/journalist/webhook` |
| Homebot | `https://app.example.com/api/v1/homebot/webhook` |

See `data/system/config/chatbots.yml` for bot configuration and secret tokens.

### Public Endpoints

| Endpoint | Purpose | Access |
|----------|---------|--------|
| `/api/v1/nutribot/report` | Daily nutrition report | Requires auth |

No route is open to everyone. The IFTTT image route `/api/v1/nutribot/pinhole` and its everyone-bypass were retired on 2026-11-17; the backend answers that path 404. A perimeter that still lets `/pinhole` through should drop that rule.

---

## Security Model

### Defense in Depth

```
Internet → DNS → CDN/Proxy → Firewall → Access Control → Application
                     │           │            │              │
                  Optional    Edge-level   Auth layer    Your code
                  (Cloudflare) blocking    (Zero Trust)
```

### Layer Responsibilities

| Layer | Purpose | What It Blocks |
|-------|---------|----------------|
| DNS | Routes traffic to server | Nothing (routing only) |
| CDN/Proxy | DDoS protection, SSL termination | Optional edge filtering |
| Firewall | Network-level blocking | Unknown IPs, blocked ranges |
| Access Control | Authentication requirement | Unauthenticated requests |
| Application | Business logic validation | Invalid tokens, bad input |

### Key Principle

Each layer adds protection but shouldn't be your only defense:
- Firewall allows webhook IPs → Access Control still validates path
- Access Control bypasses webhook paths → Application still validates the secret token

If one layer fails, others still protect.

---

## Configuration by Layer

### DNS

#### Basic Setup

Point your domain to your server:

```
# A record for apex domain
example.com → {YOUR_HOME_IP}

# Wildcard for subdomains
*.example.com → CNAME → example.com
```

#### Proxied vs Direct

| Mode | Traffic Flow | Use Case |
|------|--------------|----------|
| Proxied | User → Cloudflare → Your Server | Main app (hides origin IP, DDoS protection) |
| Direct | User → Your Server | LAN access, protocols that need direct connection |

#### Local Access Pattern

For LAN access with valid SSL that works even when internet is down:

```
local.example.com → CNAME → {DYNAMIC_DNS_HOST} → A → {LAN_SERVER_IP}
```

**Why this works:**
1. **Real domain** — `local.example.com` is valid, so you can obtain a trusted SSL certificate
2. **Private IP** — Points to LAN IP, only reachable on your network
3. **No proxy** — Direct connection, doesn't require Cloudflare/internet
4. **No cert warnings** — Browser trusts the cert because domain name matches

**Why SSL matters locally:**

Modern browsers require HTTPS for sensitive APIs:
- `getUserMedia()` (camera/microphone)
- `navigator.geolocation`
- Service Workers (PWA/offline)
- Clipboard API (write access)

Without valid SSL, these features fail silently or show permission errors.

**Internet-down fallback:**

When internet is down, DNS won't resolve. Add to `/etc/hosts`:
```
{LAN_SERVER_IP}  local.example.com
```

---

### Reverse Proxy

A reverse proxy routes requests to the correct container based on domain name.

```
Internet → Reverse Proxy (port 443) → Docker Container (port 3111)
                │
                ├── app.example.com → daylight-station:3111
                ├── other.example.com → other-app:8080
                └── local.example.com → daylight-station:3111 (LAN only)
```

**Benefits:**
- Single entry point for all HTTPS traffic
- SSL termination in one place
- Domain-to-container routing
- Load balancing (if needed)

#### Proxy Options

| Proxy | Pros | Cons |
|-------|------|------|
| **nginx** | Battle-tested, flexible, widely documented | Manual config, separate cert management |
| **Caddy** | Automatic HTTPS, simple config | Less flexible than nginx |
| **Traefik** | Docker-native, auto-discovery | Steeper learning curve |
| **nginx-proxy-manager** | GUI-based, easy Let's Encrypt | Extra abstraction layer |

#### Example: nginx Configuration

```nginx
# /etc/nginx/sites-available/daylight
server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3111;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

#### SSL Certificate Options

```
Internet (HTTPS) → Reverse Proxy (SSL termination) → Docker (HTTP, port 3111)
```

| Method | How It Works |
|--------|--------------|
| **Let's Encrypt** | Use certbot, Caddy, or NPM; requires port 80/443 for validation; auto-renews |
| **Cloudflare Origin** | Cloudflare terminates at edge; origin cert on your proxy; encrypted to origin |
| **Wildcard cert** | Single cert for `*.example.com`; works for all subdomains including `local` |

---

### Firewall

#### Default Deny Principle

Block all traffic except explicitly allowed sources:

```
DEFAULT: BLOCK all traffic
ALLOW: Home IP ({YOUR_HOME_IP})
ALLOW: Work VPN ({WORK_VPN_RANGE})
ALLOW: Webhook source IPs for webhook paths
```

#### Webhook Source IPs

External services that send webhooks publish their IP ranges:

| Platform | IP Ranges | Documentation |
|----------|-----------|---------------|
| Telegram | `91.108.0.0/16`, `149.154.0.0/16` | [Telegram Webhooks](https://core.telegram.org/bots/webhooks) |
| Discord | Various | [Discord IPs](https://discord.com/developers/docs/topics/gateway) |
| Slack | Various | [Slack IPs](https://api.slack.com/docs/slack-ip-ranges) |
| GitHub | Various | [GitHub Meta API](https://api.github.com/meta) |

Always check official documentation for current IP ranges.

#### Example: Cloudflare Firewall Expression

```
(ip.src ne {YOUR_HOME_IP} and not ip.src in {{WORK_VPN_RANGE}})
  and not ip.src in {{WEBHOOK_SOURCE_IPS}}
```

#### Example: iptables

```bash
# Default deny
iptables -P INPUT DROP

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow from home IP
iptables -A INPUT -s {YOUR_HOME_IP} -j ACCEPT

# Allow webhook source IPs on port 443
iptables -A INPUT -s 91.108.0.0/16 -p tcp --dport 443 -j ACCEPT
iptables -A INPUT -s 149.154.0.0/16 -p tcp --dport 443 -j ACCEPT
```

---

### Access Control

Beyond firewalls, access control requires authentication for protected paths.

```
Request → Firewall (allows through) → Access Control → Application
                                            │
                                     "Who are you?"
                                            │
                              ┌─────────────┴─────────────┐
                              │                           │
                         Bypass policy              Require login
                         (whitelisted IP)           (show login page)
```

#### Path-Specific Policies

| Path Pattern | Access Policy | Who Can Access |
|--------------|---------------|----------------|
| `*.example.com` | IP whitelist | Home, Work IPs only |
| `/api/v1/*/webhook` | Webhook bypass | Webhook source IPs only |

#### Precedence

More specific paths take precedence over wildcards:

```
*.example.com                              → Requires whitelisted IP
app.example.com/api/v1/*/webhook           → Webhook source IPs bypass
```

#### Example: Cloudflare Access

```bash
# Create Access app for webhook paths
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  -d '{
    "name": "Webhook Source Bypass",
    "domain": "example.com/api/v1/*/webhook",
    "type": "self_hosted"
  }'

# Add bypass policy for webhook source IPs
curl -X POST ".../access/apps/$APP_ID/policies" \
  -d '{
    "name": "Webhook IP Bypass",
    "decision": "bypass",
    "include": [
      {"ip": {"ip": "91.108.0.0/16"}},
      {"ip": {"ip": "149.154.0.0/16"}}
    ]
  }'
```

---

### Cross-site requests (application layer)

The firewall and access policies decide who may reach the app. They do not stop
a household member's own browser from being used against it: any page they open
(another site, an ad, an embedded frame) can send requests to the app's hostname,
and those requests arrive through the reverse proxy from a private address, which
`networkTrustResolver` treats as `sysadmin`. Two pieces of app-wide middleware in
`app.mjs` close that, both from `0_system/http/middleware/crossSiteGuard.mjs`:

**`crossSiteGuard`** runs before CORS, the body parsers and every router. For
`POST`, `PUT`, `PATCH` and `DELETE` it decides from the headers alone:

| Request | Result |
|---------|--------|
| `Origin` is on `http.allowed_origins` | allowed |
| `Sec-Fetch-Site: same-origin` (the app's own page) or `none` (typed or bookmarked) | allowed |
| `Sec-Fetch-Site: same-site` or `cross-site` | `403 { "error": "cross-site-refused" }` |
| No `Sec-Fetch-Site`, `Origin` names the host the request was sent to | allowed |
| No `Sec-Fetch-Site`, `Origin` names another host or port, or is `null` | `403` |
| Neither header | allowed |

`Sec-Fetch-Site` is set by the browser and page script cannot change it; every
current browser and WebView sends it. The `Origin` comparison is the fallback
for older WebViews. It uses the request's own `Host`, so every hostname the app
is reached by (LAN IP, local DNS name, proxied hostname) works for its own pages
with nothing to configure; `X-Forwarded-Host` counts only when Express's
`trust proxy` trusts the peer. The reverse proxy must pass `Host` through (Nginx
Proxy Manager does by default); one that rewrites `Host` to the container name
would make older WebViews' writes fail this check.

Non-browser callers (CLIs, Home Assistant `rest_command`s, the playback hub,
relay firmware, the Android app's native code, Telegram/Strava webhooks) send
neither header and are not affected.

**Reads are isolated too** for paths under `/api` and `/admin`, by any method
(`GET`, `HEAD`, `OPTIONS` included). Many routes still act on a `GET` (Home
Assistant scripts, device power and volume, prints, TTS), so another site must
not be able to load them:

| Request to `/api/...` or `/admin...` | Result |
|---------|--------|
| `Origin` is on `http.allowed_origins` | allowed |
| `Sec-Fetch-Site: same-site` or `cross-site`, `Sec-Fetch-Mode` not `navigate` (an `<img>`, `<video>`, `<script>`, `fetch`) | `403`, reason `cross-site-read` |
| `Sec-Fetch-Site: same-site` or `cross-site`, a navigation into a frame (`Sec-Fetch-Dest` `iframe`, `frame`, `embed`, `object`) | `403`, reason `cross-site-frame` |
| `Sec-Fetch-Site: same-site` or `cross-site`, a top-level navigation (a link, a Telegram button, an OAuth callback) | allowed |
| `Sec-Fetch-Site: same-origin` or `none`, or no `Sec-Fetch-Site` | allowed |

No path is exempt. Nothing on another origin embeds the API: checked
2026-11-20 across the data tree (the only absolute app URLs are in feedback
error traces), Home Assistant's configuration and dashboards (its calls are
`rest_command`s and an integration, all server-side), the extensions (native
or server-side callers) and the frontend (relative URLs only). A future embed
on another origin (a dashboard `<img>` of a proxied photo, say) needs either
its origin on `http.allowed_origins` (for `fetch`/CORS) or a named exemption
in `crossSiteGuard.mjs`; a plain `<img>` sends no `Origin`, so only an
exemption works for it. Plain-http LAN pages (`http://<lan-ip>:<port>`) are
not affected, since browsers send `Sec-Fetch-*` only to secure origins.

Each refusal logs `security.cross-site-refused` (warn, sampled at 20 a minute)
with `method`, `path`, `origin`, `secFetchSite`, `secFetchMode`,
`secFetchDest` and `reason` (`sec-fetch-site`, `origin-null`,
`origin-mismatch`, `cross-site-read`, `cross-site-frame`).

**CORS** answers only the origins on `http.allowed_origins` (default: none).
Same-origin pages need no CORS headers. Before 2026-11-20 the handler was
`cors()` with defaults, which sent `Access-Control-Allow-Origin: *` to every
site, so any page could also read API responses from a household browser.

The quick-input routes (`selfGuarded` in `app.mjs`) are skipped by both: they
refuse other origins themselves, in their own response shape
([quick-input.md](quick-input.md)).

To let a page on another origin call the API, list it in `system.yml`
(see [configuration.md](configuration.md#systemyml-base-configuration)):

```yaml
http:
  allowed_origins:
    - https://other-app.example.com
```

**Framing.** The built frontend's pages (the SPA and every static `.html`
page beside it: sim panel, arcade film, probes, labs) are served with
`Content-Security-Policy: frame-ancestors 'self'` plus `http.allowed_origins`
(`setFrontendDocumentHeaders` in `4_api/middleware/platformHttp.mjs`), so another
site cannot load the household's screens in a frame and lure clicks through
them. Nothing in the household was found framing the app (Home Assistant's
dashboards do not reference it; Homarr's database could not be read).
`http.frame_ancestors: false` turns the header off
([configuration.md](configuration.md#systemyml-base-configuration)).

**The event-bus WebSocket (`/ws`)** checks the handshake in `verifyClient`
(`WebSocketEventBus`, using `webSocketOriginRefusal` from the same file).
Browsers let any page open a WebSocket to any host, so without it a page on
another site could read every broadcast (heart-rate telemetry, presence) and
send client messages.

| Handshake `Origin` | Result |
|---------|--------|
| none | allowed: Node `ws` (fitness controller, simulators), Python `websockets` (piano recorder), native apps |
| `null` (sandboxed frame, `data:` page) | `403` |
| any other non-http(s) value | allowed: arduinoWebSockets, the library in every relay firmware (barcode, kitchen, OMR, pressure mat, OBD, TI calculator), sends `Origin: file://` |
| on `http.allowed_origins` | allowed |
| http(s), `Sec-Fetch-Site: same-origin` | allowed |
| any other http(s) | allowed when its host is the handshake's `Host`, or the first `X-Forwarded-Host` if the peer is loopback, link-local or private (the reverse proxy; the same peers Express's `trust proxy` trusts). The browser sets `Origin` and the WebSocket API lets a page set no headers, so the match cannot be forged |

The frontend connects to `/ws` on its own origin; in dev Vite's `/ws` proxy
keeps the browser's `Host`. Refusals log `security.ws-origin-refused` (warn,
sampled) with `origin`, `secFetchSite`, `host`, `ip`, `reason`;
`eventbus.client_connected` now records each client's `origin`.

**State changes are `POST` only** on the admin routes that used to answer a
`GET`: `/api/v1/admin/ws/restart`, `/api/v1/admin/ws/broadcast` (and `POST` to
`/api/v1/admin/ws` as its alias; a `GET` query string no longer broadcasts),
and `/api/v1/dev/proxy_toggle`. The unauthenticated second mount of the event
bus admin router at `/admin/ws` (outside `/api/v1`, so outside the auth
pipeline) is gone.

**Feed links** (FreshRSS, RSS headlines) are other people's data and are
rendered as anchors and as an iframe sandboxed with `allow-scripts
allow-same-origin`. `__app_modules/media/feed/shared/webLink.mjs` admits only
absolute http(s) URLs, at ingest and again at render, and the iframe also
refuses any URL on the app's own origin, where that sandbox pair would let the
framed page drive the app. A refused link shows as plain text.

**Feed images** are other people's data too, and an `<img>` on the app's own
origin is a same-origin GET that the cross-site guard never sees. At ingest
(`externalImageLink`: the feed HTML sanitizer, the FreshRSS hero image, RSS
headline images) only absolute http(s) URLs outside `/api` and `/admin`, on
any host, are kept. At render (`feedImageSrc`, through `safeImage` in the
feed's `cards/utils.js`) a URL on the app's origin loads only if it is one of
the read-only image endpoints the app's own sources use (`/api/v1/proxy/...`
for Immich assets, Plex library metadata and photos, Komga composites and book
page images (`.../books/<id>/pages/<n>` only), Reddit, ABS items,
Libby covers and media; `/api/v1/static`; `/api/v1/feed/icon` and `/image`);
an external URL whose path is under `/api` or `/admin` goes through the image
proxy, whose SSRF guard refuses private targets.

**Path spelling.** Express routes paths case-insensitively, so every
path-prefix security decision (the read isolation above, `permissionGate`'s
`app_routes`) compares `canonicalRoutePath` (`shared/contracts/http/routePath.mjs`):
lower-case, percent-decoded, single slashes, no trailing slash or dots. It
matches at least every spelling Express routes the same way.

**Not covered yet** (both pending the conversion of action `GET`s, such as
the HA script runner, device on/off/volume, prints and TTS, to `POST`):

- A page on any site can aim an `<img>` at the app's **plain-http LAN address**
  (`http://<lan-ip>:<port>/api/...`). Browsers send no `Sec-Fetch-*` to an
  insecure origin, so read isolation cannot see it; Chrome blocks such
  requests to private addresses from public pages (Private Network Access),
  but Firefox and Safari send them. The same applies to an older WebView that
  sends no fetch metadata.
- A **top-level cross-site navigation** still reaches `/api` `GET`s, by
  design: Telegram buttons and OAuth callbacks need it. A link someone clicks,
  or a page that navigates itself, can fire an action `GET` that way.
- DNS rebinding: the app accepts any `Host`. A rebinding attacker's page is
  same-origin with itself, so these checks pass it. Closing that needs a
  `Host` allow-list.

---

## Patterns

### Webhook Integration

External services (Telegram, Discord, etc.) send events to your webhook URL.

#### Security Layers

1. **Firewall** — Allow webhook source IPs (see [Webhook Source IPs](#webhook-source-ips))
2. **Access Control** — Bypass policy for `/api/v1/*/webhook` paths
3. **Application** — Validate secret token in request header

#### Secret Token Validation

```javascript
// Header name varies by platform:
// - Telegram: X-Telegram-Bot-Api-Secret-Token
// - Discord: X-Signature-Ed25519
// - Slack: X-Slack-Signature
const headerToken = req.headers['x-webhook-secret'];
if (headerToken !== expectedSecretToken) {
  return res.status(200).json({ ok: true }); // Silent rejection
}
```

**Return 200 on auth failure** to prevent:
- Information leakage (attacker doesn't know if token is wrong)
- Platform retry loops (non-200 causes retries)

#### Registering a Webhook

```bash
# Telegram example
curl "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d "url=https://example.com/api/v1/mybot/webhook" \
  -d "secret_token=$(openssl rand -hex 32)"
```

---

### Public Endpoint Pattern

For an integration that can't authenticate and has no static IPs. None is in use today; prefer a caller that can send a device header or a signed request.

#### Design Principles

1. **Dedicated path** — One exact path, not a wildcard suffix shared by other routes
2. **Firewall bypass** — Allow all IPs to that path only
3. **Access bypass** — Skip authentication for that path only
4. **Application protection** — Rate limit, validate input, log everything

#### Security Checklist for Public Endpoints

- [ ] Validate input (URL format, size limits)
- [ ] Log requests (IP, user agent, timestamp)
- [ ] Rate limit (prevent abuse)
- [ ] Scope narrowly (only expose what's needed)

```javascript
logger.info('public.request', {
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  imgDomain: new URL(imgUrl).hostname,
});
```

---

### Local Access Pattern

Access DaylightStation on your LAN with valid SSL, even when internet is down.

#### Setup

1. **DNS record** — `local.example.com` → `{LAN_SERVER_IP}` (not proxied)
2. **SSL cert** — Use wildcard (`*.example.com`) or dedicated cert
3. **Fallback** — Add to `/etc/hosts` for offline access

See [Local Access Pattern](#local-access-pattern) in DNS section for details.

---

### Dev Proxy Pattern

Forward production webhook traffic to your local dev machine without changing webhook URLs.

#### The Challenge

- Webhook providers need a public URL
- Changing webhook URLs requires API calls
- Some providers rate-limit URL changes
- Testing requires the full network stack

#### Solution

Toggle production to forward webhooks to your dev machine:

```
Telegram → Production Server → [Dev Proxy] → Your Local Machine
                                    ↓
                         Toggle ON: Forward to LOCAL_DEV_HOST
                         Toggle OFF: Handle locally (production)
```

#### Setup

1. **Configure LOCAL_DEV_HOST** in production:
   ```yaml
   # In secrets.yml or environment
   LOCAL_DEV_HOST: "192.168.1.100:3112"  # Your dev machine's LAN IP
   ```

2. **Ensure connectivity** — Dev machine must be reachable from production (same network or VPN)

3. **Toggle proxy:**
   ```bash
   # Enable (forwards webhooks to dev)
   curl -X POST "https://app.example.com/api/v1/dev/proxy_toggle"

   # Check status
   curl "https://app.example.com/api/v1/dev/proxy_status"

   # Disable (back to production handling)
   curl -X POST "https://app.example.com/api/v1/dev/proxy_toggle"
   ```

#### Workflow

```
1. Start local dev server (port 3112)
2. Toggle proxy ON in production
3. Send test message to bot
4. Request flows: Telegram → Prod → Dev Proxy → Your Machine
5. Debug locally with full request context
6. Toggle proxy OFF when done
```

#### Security Notes

- Only works for configured webhook routes
- Requires `LOCAL_DEV_HOST` to be set
- Protected by Access policies (whitelisted IPs only)
- Toggle state resets on server restart

**Related code:** `__backend/src/4_api/v1/middleware/createDevProxy.mjs`

---

## Remote Access

To access protected endpoints from remote devices (phone, laptop away from home), use a VPN.

### How It Works

```
Phone (anywhere) → VPN tunnel → Home router ({YOUR_HOME_IP}) → Internet
                                        ↓
                              Request appears from {YOUR_HOME_IP}
                                        ↓
                              Firewall/Access: ✓ Allowed
```

With VPN active, your remote device's traffic exits from your home IP, automatically passing IP whitelist policies.

### Options

| Solution | Pros | Cons |
|----------|------|------|
| **WireGuard** | Fast, lightweight, self-hosted | Requires setup, port forwarding |
| **Tailscale** | Zero-config, works behind NAT | Third-party dependency |

### Setup Tips

- **WireGuard** — Run on router or Raspberry Pi; forward UDP port 51820
- **Tailscale** — Install on home server + remote devices; uses relay if direct fails
- **Split tunneling** — Route only `*.example.com` through VPN to preserve local speed

---

## Operations

### Troubleshooting

#### Webhook Returns 403

1. **Check firewall** — Is source IP in allowed list?
2. **Check access control** — Is path bypassed for this IP?
3. **Check application** — Is secret token correct?
4. **Check platform status:**
   ```bash
   curl "https://api.telegram.org/bot$TOKEN/getWebhookInfo" | jq .last_error_message
   ```

#### Can't Reach Server

1. **DNS resolution:** `dig example.com`
2. **Port open:** `nc -zv example.com 443`
3. **Firewall logs:** Check if requests are being blocked
4. **Access logs:** Check if requests reach the proxy

#### Dev Proxy Not Working

1. **Check LOCAL_DEV_HOST** — Is it set in production?
   ```bash
   curl "https://app.example.com/api/v1/dev/proxy_status"
   ```
2. **Check connectivity** — Can production reach your dev machine?
   ```bash
   # From production server
   curl "http://{LOCAL_DEV_HOST}/api/v1/nutribot/health"
   ```
3. **Check dev server** — Is it running on the expected port?
4. **Check toggle state** — Resets on server restart

#### Debug Cloudflare

```bash
curl -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -d '{"query":"query { viewer { zones(filter: {zoneTag: \"$ZONE_ID\"}) {
       firewallEventsAdaptive(filter: { datetime_gt: \"2026-01-27T00:00:00Z\" },
       limit: 50) { action clientIP clientRequestPath } } } }"}'
```

---

### Checklists

#### Adding a New Webhook

- [ ] **Firewall** — Add source IPs to allow list
- [ ] **Access Control** — Create bypass policy for path + IPs
- [ ] **Application** — Implement secret token validation
- [ ] **Register** — Set webhook URL with secret token
- [ ] **Test** — Verify webhook receives and processes requests
- [ ] **Monitor** — Check logs for errors

#### Adding a Public Endpoint

- [ ] **Firewall** — Add the exact path to the bypass list
- [ ] **Access Control** — Create "everyone bypass" policy for path
- [ ] **Application** — Add route with input validation, logging, rate limiting
- [ ] **Test** — Verify endpoint works from external source
- [ ] **Document** — Update Quick Reference section above
