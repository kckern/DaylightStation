# Network Exposure Guidelines

How to configure DNS, firewalls, and access control for DaylightStation.

**Related code:** `backend/src/4_api/v1/routers/`, `backend/src/0_system/http/middleware/`

---

## Overview

DaylightStation requires careful network configuration to:
1. Protect private endpoints from unauthorized access
2. Allow external services (Telegram, IFTTT) to reach webhooks
3. Enable public APIs where needed

### Security Layers

```
Internet → DNS → CDN/Proxy → Firewall → Access Control → Application
                    │            │            │              │
                 Optional     Edge-level   Auth layer    Your code
                 (Cloudflare) blocking     (Zero Trust)
```

Each layer serves a different purpose:
- **DNS** - Routes traffic to your server
- **CDN/Proxy** - Optional; provides DDoS protection, caching, SSL termination
- **Firewall** - Blocks unwanted traffic at network edge
- **Access Control** - Requires authentication for protected paths
- **Application** - Your backend validation (secret tokens, API keys)

---

## DNS Configuration

### Basic Setup

Point your domain to your server's IP:

```
# A record for apex domain
example.com → {YOUR_HOME_IP}

# Wildcard for all subdomains
*.example.com → CNAME → example.com
```

### With a Proxy (Cloudflare, etc.)

When using a CDN/proxy, traffic flows through their servers:

```
User → Cloudflare (188.114.96.x) → Your Server ({YOUR_HOME_IP})
```

**Proxied vs Direct:**
- Proxied: Traffic goes through CDN (hides origin IP, provides DDoS protection)
- Direct: Traffic goes straight to your server (needed for some protocols)

| Subdomain | Proxied | Use Case |
|-----------|---------|----------|
| `*.example.com` | Yes | Main app, API endpoints |
| `local.example.com` | No | LAN access with valid SSL |

### Local Access with Valid SSL (daylightlocal pattern)

For home/LAN access that works even when internet is down:

```
local.example.com → CNAME → {DYNAMIC_DNS_HOST} → A → {LAN_SERVER_IP}
```

**Why this works:**
1. **Real domain** - `local.example.com` is a valid domain, so you can obtain a trusted SSL certificate
2. **Private IP** - Points to LAN IP ({LAN_SERVER_IP}), only reachable on your network
3. **No proxy** - Direct connection, doesn't require Cloudflare/internet
4. **No cert warnings** - Browser trusts the cert because domain name matches

**Why SSL matters locally:**

Modern browsers require HTTPS (not just HTTP) for sensitive APIs:
- **Camera/Microphone** - `getUserMedia()` blocked on HTTP
- **Geolocation** - `navigator.geolocation` blocked on HTTP
- **Service Workers** - Required for PWA/offline support
- **Clipboard API** - Write access requires secure context

Without valid SSL, these features fail silently or show permission errors. The daylightlocal pattern gives you full browser capabilities on your LAN.

**Internet-down fallback:**

When internet is down, DNS won't resolve. Add to `/etc/hosts`:
```
{LAN_SERVER_IP}  local.example.com
```

Now you can access `https://local.example.com` on your LAN with valid SSL, even with no internet connectivity.

---

## Remote Access (VPN)

To access protected endpoints from remote devices (phone, laptop, vacation home), use a VPN that routes traffic through your home IP.

### Recommended: WireGuard or Tailscale

| Solution | Pros | Cons |
|----------|------|------|
| **WireGuard** | Fast, lightweight, self-hosted | Requires setup, port forwarding |
| **Tailscale** | Zero-config, works behind NAT | Third-party dependency |

### How it Works

```
Phone (anywhere) → VPN tunnel → Home router ({YOUR_HOME_IP}) → Internet
                                        ↓
                              Request appears from {YOUR_HOME_IP}
                                        ↓
                              Firewall/Access: ✓ Allowed
```

With VPN active, your remote device's traffic exits from your home IP, automatically passing IP whitelist policies.

### Setup Tips

1. **WireGuard**: Run on your home router or a Raspberry Pi. Forward UDP port 51820.
2. **Tailscale**: Install on home server + remote devices. Uses relay if direct connection fails.
3. **Split tunneling**: Route only `*.example.com` traffic through VPN to preserve local internet speed.

---

## Firewall Rules

### Principle: Default Deny

Block all traffic except explicitly allowed sources:

```
DEFAULT: BLOCK all traffic
ALLOW: Home IP ({YOUR_HOME_IP})
ALLOW: Work VPN ({WORK_VPN_RANGE})
ALLOW: Webhook source IPs (Telegram, Discord, etc.) for webhook paths
ALLOW: Paths ending in /pinhole (public APIs)
```

### Webhook Source IP Ranges

External services that send webhooks publish their IP ranges. Whitelist these for webhook paths:

| Platform | IP Ranges | Documentation |
|----------|-----------|---------------|
| Telegram | `91.108.0.0/16`, `149.154.0.0/16` | [Telegram Webhooks](https://core.telegram.org/bots/webhooks) |
| Discord | Various | [Discord IPs](https://discord.com/developers/docs/topics/gateway) |
| Slack | Various | [Slack IPs](https://api.slack.com/docs/slack-ip-ranges) |
| GitHub | Various | [GitHub Meta API](https://api.github.com/meta) |

Always check official documentation for current IP ranges.

### Example Firewall Expression (Cloudflare syntax)

```
(ip.src ne {YOUR_HOME_IP} and not ip.src in {{WORK_VPN_RANGE}})
  and not ends_with(http.request.uri.path, "/pinhole")
  and not ip.src in {{WEBHOOK_SOURCE_IPS}}
```

This blocks traffic unless:
- From home IP, OR
- From work VPN range, OR
- Path ends with `/pinhole`, OR
- From webhook source IPs (e.g., Telegram, Discord)

### Generic Firewall (iptables)

If not using a CDN, configure your server firewall:

```bash
# Default deny
iptables -P INPUT DROP

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow from home IP
iptables -A INPUT -s {YOUR_HOME_IP} -j ACCEPT

# Allow webhook source IPs on port 443 (example: Telegram)
iptables -A INPUT -s 91.108.0.0/16 -p tcp --dport 443 -j ACCEPT
iptables -A INPUT -s 149.154.0.0/16 -p tcp --dport 443 -j ACCEPT
```

---

## Access Control (Zero Trust)

Beyond firewalls, use access control to require authentication for protected paths.

### Concept

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

### Path-Specific Policies

Different paths need different access levels:

| Path Pattern | Access Policy | Allowed |
|--------------|---------------|---------|
| `*.example.com` (wildcard) | IP whitelist | Home, Work IPs only |
| `/api/v1/*/webhook` | Webhook source bypass | Platform IPs only (Telegram, Discord, etc.) |
| `/api/v1/nutribot/pinhole` | Public bypass | Everyone (IFTTT, etc.) |

### Precedence

More specific paths take precedence over wildcards:

```
*.example.com                              → Requires whitelisted IP
app.example.com/api/v1/*/webhook           → Webhook source IPs bypass
app.example.com/api/v1/nutribot/pinhole    → Everyone bypasses (IFTTT, etc.)
```

### Cloudflare Access Example

```bash
# Create Access app for webhook paths
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  -d '{
    "name": "Webhook Source Bypass",
    "domain": "example.com/api/v1/*/webhook",
    "type": "self_hosted"
  }'

# Add bypass policy for webhook source IPs (example: Telegram)
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

### Alternative: nginx + Basic Auth

Without a Zero Trust provider, use nginx:

```nginx
location /api/v1/ {
    # Require auth by default
    auth_basic "Protected";
    auth_basic_user_file /etc/nginx/.htpasswd;

    # Bypass auth for webhooks from platform IPs (example: Telegram)
    satisfy any;
    allow 91.108.0.0/16;
    allow 149.154.0.0/16;
    deny all;
}

location ~ ^/api/v1/.*/pinhole$ {
    # Public access for pinhole endpoints
    auth_basic off;
    proxy_pass http://localhost:3111;
}
```

---

## Webhook Security

### Secret Token Validation

Even with IP whitelisting, validate webhook requests at the application layer:

```javascript
// Most platforms send a secret token header (varies by platform)
// Telegram: X-Telegram-Bot-Api-Secret-Token
// Discord: X-Signature-Ed25519
// Slack: X-Slack-Signature
const headerToken = req.headers['x-webhook-secret'];
if (headerToken !== expectedSecretToken) {
  return res.status(200).json({ ok: true }); // Silent rejection
}
```

**Important:** Return 200 on auth failure to prevent:
- Information leakage (attacker doesn't know if token is wrong)
- Platform retry loops (non-200 causes retries)

### Register Webhook with Secret Token (Telegram example)

```bash
curl "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d "url=https://example.com/api/v1/mybot/webhook" \
  -d "secret_token=$(openssl rand -hex 32)"
```

---

## Public API Endpoints (Pinhole Pattern)

For integrations like IFTTT that can't use authentication:

### Design

1. **Dedicated path** - `/api/v1/nutribot/pinhole` (not `/webhook`)
2. **Firewall bypass** - Allow all IPs to this specific path
3. **Access bypass** - Skip authentication for this path
4. **Rate limiting** - Protect against abuse (application layer)
5. **Logging** - Track all requests for security monitoring

### Example: IFTTT Image Upload (Nutribot)

IFTTT doesn't publish static IP ranges, so we can't whitelist by IP. Instead, use the pinhole pattern:

```
IFTTT → https://app.example.com/api/v1/nutribot/pinhole?img_url=https://...
                                    │
                    Firewall: Allow (path ends with /pinhole)
                    Access: Bypass (everyone policy)
                    App: Process image, log food to Nutribot
```

### Security Considerations

Public endpoints should:
- **Validate input** - Check URL format, size limits
- **Log requests** - IP, user agent, timestamp
- **Rate limit** - Prevent abuse
- **Scope narrowly** - Only expose what's needed

```javascript
// Enhanced logging for public endpoints
logger.info('pinhole.request', {
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  imgDomain: new URL(imgUrl).hostname,
});
```

---

## DaylightStation Configuration

### Current Setup (example.com)

**DNS:**
- `*.example.com` → Proxied through Cloudflare
- `local.example.com` → Direct (not proxied)

**Firewall Rule:**
```
Block unless:
- Home IP ({YOUR_HOME_IP})
- Work VPN ({WORK_VPN_RANGE})
- Webhook source IPs (e.g., Telegram: 91.108.0.0/16, 149.154.0.0/16)
- Path ends with /pinhole
```

**Access Apps:**
| App | Domain | Policy |
|-----|--------|--------|
| Main Site Protection | `*.example.com` | Home + Work IPs |
| Webhook Source Bypass | `.../*/webhook` | Platform IPs (Telegram, Discord, etc.) |
| Nutribot Pinhole | `.../nutribot/pinhole` | Everyone (IFTTT, etc.) |
| Local API | `local.example.com` | Everyone (LAN-only by design) |

**Local Access:**
- `local.example.com` → `{LAN_SERVER_IP}` (LAN IP via dynamic DNS)
- Bypasses Cloudflare entirely (not proxied)
- Works when internet is down (use `/etc/hosts` fallback)
- Valid SSL cert, no browser warnings

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

## Webhook Integration & Development

### The Challenge

Webhook providers (Telegram, Discord, etc.) need a public URL to send events to. During development, this creates friction:
- Changing webhook URLs on the provider requires API calls
- Some providers rate-limit webhook URL changes
- Testing requires the full network stack to be accessible

### Solution: Dev Proxy Toggle

DaylightStation includes a dev proxy that forwards production webhook traffic to your local dev machine without changing the webhook URL.

```
Telegram → Production Server → [Dev Proxy] → Your Local Machine
                                    ↓
                         Toggle ON: Forward to LOCAL_DEV_HOST
                         Toggle OFF: Handle locally (production)
```

### Setup

1. **Configure LOCAL_DEV_HOST** in production environment:
   ```yaml
   # In secrets.yml or environment
   LOCAL_DEV_HOST: "192.168.1.100:3112"  # Your dev machine's LAN IP
   ```

2. **Ensure dev machine is reachable** from production server (same network, or via VPN)

3. **Toggle proxy on** when ready to develop:
   ```bash
   # Enable - forwards webhooks to dev machine
   curl "https://app.example.com/api/v1/dev/proxy_toggle"

   # Check status
   curl "https://app.example.com/api/v1/dev/proxy_status"
   ```

4. **Toggle proxy off** when done:
   ```bash
   curl "https://app.example.com/api/v1/dev/proxy_toggle"
   ```

### How It Works

The dev proxy middleware intercepts webhook routes:

```javascript
// Applied to webhook paths in app.mjs
app.use('/nutribot/webhook', devProxy.middleware);
app.use('/journalist/webhook', devProxy.middleware);
app.use('/homebot/webhook', devProxy.middleware);
```

When enabled, requests are forwarded with:
- Original headers (including `X-Telegram-Bot-Api-Secret-Token`)
- Request body
- `X-Proxy-Source: daylight-ddd` header (to identify proxied requests)

### Development Workflow

```
1. Start local dev server (port 3112)
2. Toggle proxy ON in production
3. Send test message to bot
4. Request flows: Telegram → Prod → Dev Proxy → Your Machine
5. Debug locally with full request context
6. Toggle proxy OFF when done
```

### Security Considerations

- Dev proxy only works for configured webhook routes
- Requires `LOCAL_DEV_HOST` to be set (won't work without it)
- Only accessible from whitelisted IPs (protected by Access policies)
- Toggle state is in-memory (resets on server restart)

**Related code:** `backend/src/0_system/http/middleware/devProxy.mjs`

---

## Troubleshooting

### Webhook Returns 403

1. **Check firewall** - Is the source IP allowed?
2. **Check access control** - Is the path bypassed for this IP?
3. **Check application** - Is the secret token correct?

```bash
# Check Telegram webhook status
curl "https://api.telegram.org/bot$TOKEN/getWebhookInfo" | jq

# Look for last_error_message
```

### Can't Reach Server

1. **DNS resolution** - `dig example.com`
2. **Port open** - `nc -zv example.com 443`
3. **Firewall logs** - Check if requests are being blocked
4. **Access logs** - Check if requests reach the proxy

### Debug Cloudflare

```bash
# Query firewall analytics
curl -X POST "https://api.cloudflare.com/client/v4/graphql" \
  -d '{"query":"query { viewer { zones(filter: {zoneTag: \"$ZONE_ID\"}) {
       firewallEventsAdaptive(filter: { datetime_gt: \"2026-01-27T00:00:00Z\" },
       limit: 50) { action clientIP clientRequestPath } } } }"}'
```

### Dev Proxy Not Working

1. **Check LOCAL_DEV_HOST** - Is it set in production?
   ```bash
   curl "https://app.example.com/api/v1/dev/proxy_status"
   ```

2. **Check connectivity** - Can production reach your dev machine?
   ```bash
   # From production server
   curl "http://{LOCAL_DEV_HOST}/api/v1/nutribot/health"
   ```

3. **Check dev server is running** - Is your local server up on the expected port?

4. **Check proxy is enabled** - Toggle state resets on server restart

---

## Checklist: Adding a New Webhook

1. [ ] **Firewall** - Add source IPs to allow list
2. [ ] **Access Control** - Create bypass policy for path + IPs
3. [ ] **Application** - Implement secret token validation
4. [ ] **Register** - Set webhook URL with secret token
5. [ ] **Test** - Verify webhook receives and processes requests
6. [ ] **Monitor** - Check logs for errors

## Checklist: Adding a Public Endpoint

1. [ ] **Firewall** - Add path to bypass list (e.g., ends_with "/pinhole")
2. [ ] **Access Control** - Create "everyone bypass" policy for path
3. [ ] **Application** - Add route, implement input validation
4. [ ] **Logging** - Add security monitoring (IP, user agent)
5. [ ] **Rate Limiting** - Protect against abuse
6. [ ] **Document** - Update this guide with new endpoint
