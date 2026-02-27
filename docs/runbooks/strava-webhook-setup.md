# Strava Webhook Setup

## Prerequisites

- Strava OAuth app with `activity:read_all` scope
- Credentials in `data/system/auth/strava.yml`:
  ```yaml
  client_id: 91629
  client_secret: <secret>
  verify_token: <choose-a-random-string>
  ```
- User refresh token in `data/users/{username}/auth/strava.yml`

## 1. Add verify_token

Add a `verify_token` field to `data/system/auth/strava.yml`. This can be any random string — it's used to validate that subscription challenges come from Strava.

```bash
# Generate a random token
openssl rand -hex 16
```

## 2. Cloudflare WAF Rules

Create two rules in **Security → WAF → Custom Rules**:

### Rule 1: Allow Strava Webhooks (POST)

- **Name:** Allow Strava Webhooks
- **Expression:**
  ```
  (http.request.uri.path eq "/api/v1/fitness/provider/webhook") and (
    ip.src in {
      52.1.196.92 52.4.243.43 52.70.212.225 54.209.86.30
      3.209.55.129 44.194.7.173 54.157.3.203 54.160.181.190
      18.206.20.56 3.208.213.46 34.194.140.119 34.203.235.59
    }
  )
  ```
- **Action:** Skip (bypass remaining rules)

### Rule 2: Allow Strava Webhook Validation (GET)

- **Name:** Allow Strava Webhook Validation
- **Expression:**
  ```
  (http.request.uri.path eq "/api/v1/fitness/provider/webhook") and (http.request.method eq "GET")
  ```
- **Action:** Skip

**IP source:** https://communityhub.strava.com/developers-api-7/whitelist-ip-address-webhook-1840

These IPs are community-sourced and may change. If webhooks stop arriving, check that forum thread.

## 3. Register Subscription

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -d client_id=91629 \
  -d client_secret=<secret> \
  -d callback_url=https://<domain>/api/v1/fitness/provider/webhook \
  -d verify_token=<your-verify-token>
```

**Response:**
```json
{ "id": 12345 }
```

## 4. Verify

```bash
# Check subscription status
curl -G https://www.strava.com/api/v3/push_subscriptions \
  -d client_id=91629 \
  -d client_secret=<secret>

# Check webhook info
curl -G "https://<domain>/api/v1/fitness/provider/webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=test123"
# Should return: {"hub.challenge":"test123"}
```

## Troubleshooting

### Webhooks not arriving

1. Check Cloudflare WAF logs — are requests being blocked?
2. Verify subscription is active: `GET /api/v3/push_subscriptions`
3. Check if Strava IPs have changed (see community forum link above)
4. Check backend logs: `strava.webhook.*`

### Enrichment not happening

1. Check job files: `data/household/common/strava/strava-webhooks/`
2. Look for `status: unmatched` — means no fitness session matched
3. Check the fitness session has `participants.*.strava.activityId` populated
4. Check backend logs: `strava.enrichment.*`

### Delete subscription

```bash
curl -X DELETE "https://www.strava.com/api/v3/push_subscriptions/<subscription_id>" \
  -d client_id=91629 \
  -d client_secret=<secret>
```

## Circuit Breaker

The enrichment service has three layers of loop protection:

1. **Event filter:** Only `aspect_type: "create"` events trigger enrichment
2. **Cooldown set:** Recently-enriched activity IDs are cached in-memory for 1 hour
3. **Job store:** Completed jobs are skipped on re-delivery

This prevents infinite loops when `updateActivity` triggers a Strava `update` webhook.
