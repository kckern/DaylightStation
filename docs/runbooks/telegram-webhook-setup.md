# Telegram Webhook Setup

Reference for setting up and troubleshooting Telegram bot webhooks.

## Webhook Registration

Each bot needs its webhook registered with Telegram. The `secret_token` ensures only Telegram can call your webhook (prevents spoofing).

### Register webhook
```bash
curl "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d "url=$WEBHOOK_URL" \
  -d "secret_token=$SECRET_TOKEN"
```

### Verify webhook
```bash
curl "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
```

### Remove webhook
```bash
curl "https://api.telegram.org/bot$TOKEN/deleteWebhook"
```

## Quick Setup Commands

Bot tokens are in `system/auth/telegram.yml`, secret_tokens in `system/bots.yml`.

### Nutribot
```bash
curl "https://api.telegram.org/bot$(cat system/auth/telegram.yml | grep nutribot | awk '{print $2}')/setWebhook" \
  -d "url=https://daylightstation.kckern.net/api/v1/nutribot/webhook" \
  -d "secret_token=$(cat system/bots.yml | grep -A2 'nutribot:' | grep secret_token | awk '{print $2}')"
```

### Generate new secret_token
```bash
openssl rand -hex 32
```

## Cloudflare Configuration

If using Cloudflare, ensure Telegram IPs are allowed through firewall rules.

**Telegram IP ranges:**
- 91.108.0.0/16
- 149.154.0.0/16

**Example filter expression allowing Telegram:**
```
(ip.src ne YOUR_IP and not ip.src in {136.226.0.0/16})
and not ends_with(http.request.uri.path, "/pinhole")
and not ip.src in {91.108.0.0/16 149.154.0.0/16}
```

## Troubleshooting

### Check webhook status
```bash
TOKEN=$(grep nutribot system/auth/telegram.yml | awk '{print $2}' | tr -d '"')
curl "https://api.telegram.org/bot${TOKEN}/getWebhookInfo" | jq
```

### Test webhook manually
```bash
curl "https://your-domain.com/api/v1/nutribot/webhook" \
  -H "X-Telegram-Bot-Api-Secret-Token: YOUR_SECRET_TOKEN" \
  -d '{"message":{"message_id":999,"from":{"id":123},"chat":{"id":123},"text":"test"}}'
```

### Common issues

1. **403 Forbidden from Telegram**: Check Cloudflare firewall rules, ensure Telegram IPs are allowed
2. **Bad Request on reply**: Check bot token is correct, API endpoint is reachable
3. **Pending updates stuck**: Delete and re-register webhook to clear Telegram's queue
