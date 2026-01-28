# Network Exposure Guidelines

How to configure DNS, firewalls, and access control for DaylightStation.

**Related code:** `backend/src/4_api/v1/routers/`, `backend/src/0_system/http/middleware/`

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
- Path ends with `/pinhole`

### Access Policies

| App | Domain Pattern | Policy |
|-----|----------------|--------|
| Main Site Protection | `*.example.com` | Home + Work IPs only |
| Webhook Bypass | `.../*/webhook` | Webhook source IPs |
| Pinhole Bypass | `.../*/pinhole` | Everyone |
| Local API | `local.example.com` | Everyone (LAN-only by design) |

### Bot Webhook URLs

| Bot | Webhook URL |
|-----|-------------|
| Nutribot | `https://app.example.com/api/v1/nutribot/webhook` |
| Journalist | `https://app.example.com/api/v1/journalist/webhook` |
| Homebot | `https://app.example.com/api/v1/homebot/webhook` |

See `data/system/apps/chatbots.yml` for bot configuration and secret tokens.

### Public Endpoints

| Endpoint | Purpose | Access |
|----------|---------|--------|
| `/api/v1/nutribot/pinhole` | IFTTT image upload | Public |
| `/api/v1/nutribot/report` | Daily nutrition report | Requires auth |

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
- Access Control bypasses pinhole → Application still validates input

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
ALLOW: Paths ending in /pinhole
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
  and not ends_with(http.request.uri.path, "/pinhole")
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
| `/api/v1/*/pinhole` | Public bypass | Everyone |

#### Precedence

More specific paths take precedence over wildcards:

```
*.example.com                              → Requires whitelisted IP
app.example.com/api/v1/*/webhook           → Webhook source IPs bypass
app.example.com/api/v1/nutribot/pinhole    → Everyone bypasses
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

### Pinhole Pattern

For integrations like IFTTT that can't use authentication or have no static IPs.

#### Design Principles

1. **Dedicated path** — Use `/pinhole` suffix (not `/webhook`)
2. **Firewall bypass** — Allow all IPs to this specific path
3. **Access bypass** — Skip authentication for this path
4. **Application protection** — Rate limit, validate input, log everything

#### Example: IFTTT Image Upload

```
IFTTT → https://app.example.com/api/v1/nutribot/pinhole?img_url=https://...
                                    │
                    Firewall: Allow (path ends with /pinhole)
                    Access: Bypass (everyone policy)
                    App: Validate input, log request, process image
```

#### Security Checklist for Public Endpoints

- [ ] Validate input (URL format, size limits)
- [ ] Log requests (IP, user agent, timestamp)
- [ ] Rate limit (prevent abuse)
- [ ] Scope narrowly (only expose what's needed)

```javascript
logger.info('pinhole.request', {
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
   curl "https://app.example.com/api/v1/dev/proxy_toggle"

   # Check status
   curl "https://app.example.com/api/v1/dev/proxy_status"

   # Disable (back to production handling)
   curl "https://app.example.com/api/v1/dev/proxy_toggle"
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

**Related code:** `backend/src/0_system/http/middleware/devProxy.mjs`

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

- [ ] **Firewall** — Add path to bypass list (e.g., `ends_with "/pinhole"`)
- [ ] **Access Control** — Create "everyone bypass" policy for path
- [ ] **Application** — Add route with input validation, logging, rate limiting
- [ ] **Test** — Verify endpoint works from external source
- [ ] **Document** — Update Quick Reference section above
