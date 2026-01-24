# Telegram Secret Token Validation Design

## Overview

Implement full `X-Telegram-Bot-Api-Secret-Token` compliance for webhook security.

## Requirements

1. **Hybrid token approach**: Per-bot token if configured, falls back to shared global token
2. **Silent 200 drop**: Return `200 OK` on validation failure (no signal to attackers, no Telegram retries)
3. **Warn logging**: Log failed validations at `warn` level with IP and bot name
4. **Single middleware**: Token validation inside existing `webhookValidationMiddleware`

## Configuration

### YAML Structure

**Global fallback** (`system/apps/telegram.yml`):
```yaml
token: "..."
botId: "..."
secretToken: "shared-fallback-token"  # NEW
```

**Per-bot override** (`system/apps/chatbots.yml`):
```yaml
bots:
  journalist:
    telegram_bot_id: "..."
    secretToken: "journalist-specific-token"  # NEW (optional)
  nutribot:
    telegram_bot_id: "..."
    secretToken: "nutribot-specific-token"    # NEW (optional)
  homebot:
    telegram_bot_id: "..."
    # No secretToken - uses global fallback
```

## Implementation

### 1. Middleware Signature Change

```javascript
// Before
webhookValidationMiddleware(botName)

// After
webhookValidationMiddleware(botName, { secretToken } = {})
```

### 2. Validation Logic

Token check happens first, before payload validation:

```javascript
export function webhookValidationMiddleware(botName = 'unknown', { secretToken } = {}) {
  return (req, res, next) => {
    // Token validation (if configured)
    if (secretToken) {
      const headerToken = req.headers['x-telegram-bot-api-secret-token'];
      if (headerToken !== secretToken) {
        logger.warn('webhook.auth.failed', {
          botName,
          ip: req.ip || req.headers['x-forwarded-for'],
          hasToken: !!headerToken,
          traceId: req.traceId
        });
        return res.status(200).json({ ok: true });
      }
    }
    // ... existing payload validation
  };
}
```

### 3. Router Updates

Each router resolves token with hybrid fallback:

```javascript
// nutribot.mjs
webhookValidationMiddleware('nutribot', {
  secretToken: nutribotConfig.secretToken || telegramConfig.secretToken
})
```

## Files Modified

| File | Change |
|------|--------|
| `backend/src/0_infrastructure/http/middleware/validation.mjs` | Add secretToken option, token validation logic |
| `backend/src/4_api/routers/nutribot.mjs` | Pass secretToken to middleware |
| `backend/src/4_api/routers/journalist.mjs` | Pass secretToken to middleware |
| `backend/src/4_api/routers/homebot.mjs` | Pass secretToken to middleware |
| `backend/src/app.mjs` | Extract secretToken from configs, pass to router factories |
| `data/system/apps/telegram.yml` | Add global secretToken field |
| `data/system/apps/chatbots.yml` | Add per-bot secretToken fields |

## Security Notes

- Token values never logged (only presence)
- Silent 200 response prevents enumeration attacks
- No timing attack concern (not cryptographic comparison)
