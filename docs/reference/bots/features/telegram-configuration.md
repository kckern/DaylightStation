# Telegram Bot Configuration

Configures Telegram bot tokens for chatbot webhooks (NutriBot, Journalist, HomeBot).

## Related code

- `backend/src/app.mjs:497-541` - Telegram adapter initialization
- `backend/src/2_adapters/messaging/TelegramAdapter.mjs` - Telegram API client
- `backend/_legacy/lib/config/loader.mjs` - Config loading and merging

## Configuration

Telegram configuration is loaded from `data/system/apps/telegram.yml`.

### Required File

Create `data/system/apps/telegram.yml`:

```yaml
# Telegram Bot Configuration
token: "YOUR_BOT_TOKEN"
botId: "YOUR_BOT_ID"
```

The bot ID is the numeric portion before the colon in the token (e.g., `6898194425` from `6898194425:AAFlH...`).

### How It Works

The config loader merges files from `apps/` directory into `process.env` under their filename. So `apps/telegram.yml` becomes `process.env.telegram`:

```javascript
// In backend/src/app.mjs
const telegramConfig = process.env.telegram || {};
// telegramConfig.token is now available
```

### Secrets Alternative

Bot tokens can also be stored in `data/system/secrets.yml`:

```yaml
TELEGRAM_NUTRIBOT_TOKEN: "6898194425:AAFlH..."
TELEGRAM_JOURNALIST_BOT_TOKEN: "580626020:AAFH..."
```

However, these are loaded as flat keys (`process.env.TELEGRAM_NUTRIBOT_TOKEN`), not as structured config. The `apps/telegram.yml` approach is preferred for the new backend.

## Verification

After configuration, check the startup logs:

```bash
docker logs daylight-station 2>&1 | grep telegramConfigured
```

Expected output:
```json
{"event":"nutribot.mounted","data":{"telegramConfigured":true}}
{"event":"journalist.mounted","data":{"telegramConfigured":true}}
```

If `telegramConfigured: false`, the token wasn't loaded.

## Webhook Setup

Telegram webhooks must be registered with Telegram's API to receive messages.

### Webhook URLs

| Bot | Webhook Path | Full URL |
|-----|--------------|----------|
| NutriBot | `/api/nutribot/webhook` | `https://your-domain/api/nutribot/webhook` |
| Journalist | `/api/journalist/webhook` | `https://your-domain/api/journalist/webhook` |

### Register Webhook

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-domain/api/nutribot/webhook"
```

## Troubleshooting

### Bot not responding to messages

1. Check `telegramConfigured: true` in logs
2. Verify webhook is registered: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
3. Check for errors in container logs after sending a message

### "Telegram bot token is required"

The `apps/telegram.yml` file is missing or has no `token` field.
