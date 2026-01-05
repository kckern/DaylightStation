# Telegram Bot Deployment & Management Runbook

**Last Updated:** December 15, 2025  
**Author:** DaylightStation Team

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Quick Reference](#quick-reference)
4. [Deployment Procedures](#deployment-procedures)
5. [Webhook Management](#webhook-management)
6. [Slash Command Management](#slash-command-management)
7. [Troubleshooting](#troubleshooting)
8. [Emergency Procedures](#emergency-procedures)

---

## Overview

This runbook covers the deployment and management of Telegram bots in the DaylightStation system:

| Bot | Bot ID | Purpose |
|-----|--------|---------|
| **NutriBot** | 6898194425 | Food logging and nutrition tracking |
| **Journalist** | 580626020 | Journaling and life logging |

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Telegram Servers                         │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTPS POST (webhook)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Our API Servers                           │
│  ┌─────────────────────┐    ┌─────────────────────┐        │
│  │  Production         │    │  Development        │        │
│  │  daylightstation-   │    │  api-dev.mydomain.net │        │
│  │  api.mydomain.net     │    │                     │        │
│  └─────────────────────┘    └─────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

### Required Environment Variables

```bash
# In config.secrets.yml or environment
TELEGRAM_NUTRIBOT_TOKEN=<nutribot-token>
TELEGRAM_JOURNALIST_TOKEN=<journalist-token>
```

### CLI Tool Location

```bash
# Telegram admin CLI
node backend/chatbots/cli/telegram-admin.mjs <command>

# Alias (add to .bashrc/.zshrc)
alias tg-admin='node backend/chatbots/cli/telegram-admin.mjs'
```

---

## Quick Reference

### Check Bot Status

```bash
# NutriBot status
node backend/chatbots/cli/telegram-admin.mjs status nutribot

# Journalist status
node backend/chatbots/cli/telegram-admin.mjs status journalist
```

### Switch Webhook Environment

```bash
# Switch NutriBot to production
node backend/chatbots/cli/telegram-admin.mjs webhook:set nutribot prod

# Switch NutriBot to development
node backend/chatbots/cli/telegram-admin.mjs webhook:set nutribot dev
```

### Update Slash Commands

```bash
# Set NutriBot commands from preset
node backend/chatbots/cli/telegram-admin.mjs commands:set nutribot
```

---

## Deployment Procedures

### Standard Deployment (Production)

1. **Pre-deployment checks:**
   ```bash
   # Check current status
   node backend/chatbots/cli/telegram-admin.mjs status nutribot
   
   # Note pending update count
   # If > 100, consider dropping pending updates
   ```

2. **Deploy code:**
   ```bash
   # Deploy via standard pipeline
   ./deploy.sh
   ```

3. **Post-deployment verification:**
   ```bash
   # Verify webhook is still active
   node backend/chatbots/cli/telegram-admin.mjs webhook:info nutribot
   
   # Test with a message in Telegram
   # Check logs for successful processing
   ```

### Development Deployment

1. **Switch webhook to dev:**
   ```bash
   node backend/chatbots/cli/telegram-admin.mjs webhook:set nutribot dev
   ```

2. **Test changes locally or on dev server**

3. **Switch back to prod when done:**
   ```bash
   node backend/chatbots/cli/telegram-admin.mjs webhook:set nutribot prod
   ```

### New Bot Setup

1. **Create bot with @BotFather:**
   - Send `/newbot` to @BotFather
   - Follow prompts to set name and username
   - Save the token

2. **Add token to secrets:**
   ```yaml
   # config.secrets.yml
   TELEGRAM_NEWBOT_TOKEN: "123456:ABC-DEF..."
   ```

3. **Add to config.app.yml:**
   ```yaml
   chatbots:
     bots:
       newbot:
         telegram_bot_id: 123456789
         webhooks:
           dev: https://api-dev.mydomain.net/newbot
           prod: https://daylightstation-api.mydomain.net/newbot
   ```

4. **Set webhook:**
   ```bash
   node backend/chatbots/cli/telegram-admin.mjs webhook:set newbot prod
   ```

5. **Set commands:**
   ```bash
   # First add preset to COMMAND_PRESETS in TelegramBotManager.mjs
   node backend/chatbots/cli/telegram-admin.mjs commands:set newbot
   ```

---

## Webhook Management

### Webhook URLs

| Bot | Environment | URL |
|-----|-------------|-----|
| NutriBot | Production | `https://daylightstation-api.mydomain.net/foodlog` |
| NutriBot | Development | `https://api-dev.mydomain.net/foodlog` |
| Journalist | Production | `https://daylightstation-api.mydomain.net/journalist` |
| Journalist | Development | `https://api-dev.mydomain.net/journalist` |

### Set Webhook

```bash
# Via CLI
node backend/chatbots/cli/telegram-admin.mjs webhook:set <bot> <env>

# Via API (legacy)
curl https://daylightstation-api.mydomain.net/api/prod  # Set to prod
curl https://daylightstation-api.mydomain.net/api/dev   # Set to dev
```

### View Webhook Info

```bash
node backend/chatbots/cli/telegram-admin.mjs webhook:info nutribot
```

Output:
```
🔗 Webhook Info for nutribot

  URL:                    https://daylightstation-api.mydomain.net/foodlog
  Custom Certificate:     false
  Pending Update Count:   0
  Max Connections:        default
  Allowed Updates:        all
```

### Delete Webhook (Switch to Polling)

```bash
# Warning: Bot will stop receiving updates until webhook is set again
node backend/chatbots/cli/telegram-admin.mjs webhook:delete nutribot
```

### Drop Pending Updates

If there's a backlog of failed updates, you may want to clear them:

```bash
# Delete and re-set webhook to drop pending
node backend/chatbots/cli/telegram-admin.mjs webhook:delete nutribot
node backend/chatbots/cli/telegram-admin.mjs webhook:set nutribot prod
```

---

## Slash Command Management

### Current Command Presets

**NutriBot:**
| Command | Description |
|---------|-------------|
| `/start` | Start logging food |
| `/help` | Show help and tips |
| `/report` | Generate daily nutrition report |
| `/goals` | View or update nutrition goals |
| `/undo` | Undo last food log |
| `/clear` | Clear today's logs (with confirmation) |

**Journalist:**
| Command | Description |
|---------|-------------|
| `/start` | Start journaling |
| `/help` | Show help |
| `/today` | View today's entries |
| `/week` | View this week's summary |
| `/prompt` | Get a writing prompt |

### List Current Commands

```bash
node backend/chatbots/cli/telegram-admin.mjs commands:list nutribot
```

### Set Commands from Preset

```bash
node backend/chatbots/cli/telegram-admin.mjs commands:set nutribot
```

### Delete All Commands

```bash
node backend/chatbots/cli/telegram-admin.mjs commands:delete nutribot
```

### Adding Custom Commands

1. Edit `backend/chatbots/_lib/telegram/TelegramBotManager.mjs`
2. Update the `COMMAND_PRESETS` object:
   ```javascript
   export const COMMAND_PRESETS = {
     nutribot: [
       { command: 'start', description: 'Start logging food' },
       { command: 'newcommand', description: 'Your new command' },
       // ...
     ],
   };
   ```
3. Run: `node backend/chatbots/cli/telegram-admin.mjs commands:set nutribot`

---

## Troubleshooting

### Bot Not Responding

1. **Check webhook status:**
   ```bash
   node backend/chatbots/cli/telegram-admin.mjs webhook:info nutribot
   ```

2. **Look for errors:**
   - Check `last_error_message` in webhook info
   - Check server logs for errors

3. **Common issues:**
   - SSL certificate problems → Ensure HTTPS is valid
   - Server not responding → Check if API is running
   - Wrong URL → Re-set webhook

4. **Reset webhook:**
   ```bash
   node backend/chatbots/cli/telegram-admin.mjs webhook:set nutribot prod
   ```

### High Pending Update Count

If `pending_update_count` is high (> 100):

1. **Check if server is processing updates**
2. **Consider dropping pending updates:**
   ```bash
   # Delete and re-set will drop pending
   node backend/chatbots/cli/telegram-admin.mjs webhook:delete nutribot
   node backend/chatbots/cli/telegram-admin.mjs webhook:set nutribot prod
   ```

### Commands Not Showing in Telegram

1. **Verify commands are set:**
   ```bash
   node backend/chatbots/cli/telegram-admin.mjs commands:list nutribot
   ```

2. **Re-set commands:**
   ```bash
   node backend/chatbots/cli/telegram-admin.mjs commands:set nutribot
   ```

3. **Clear Telegram cache:**
   - On mobile: Close and reopen chat
   - On desktop: Restart Telegram

### Token Issues

If you see "Unauthorized" errors:

1. **Verify token is set:**
   ```bash
   echo $TELEGRAM_NUTRIBOT_TOKEN
   ```

2. **Check token in config.secrets.yml**

3. **Regenerate token via @BotFather if compromised:**
   - `/mybots` → Select bot → API Token → Revoke

---

## Emergency Procedures

### Bot Sending Spam or Errors

**Immediate action:** Disable webhook to stop processing

```bash
# Stop all incoming messages
node backend/chatbots/cli/telegram-admin.mjs webhook:delete nutribot

# Investigate logs
tail -f /var/log/daylightstation/api.log

# Fix issue, then re-enable
node backend/chatbots/cli/telegram-admin.mjs webhook:set nutribot prod
```

### Switch to Development During Incident

```bash
# Route traffic to dev server
node backend/chatbots/cli/telegram-admin.mjs webhook:set nutribot dev
```

### Complete Bot Disable

If bot is compromised:

1. **Delete webhook:**
   ```bash
   node backend/chatbots/cli/telegram-admin.mjs webhook:delete nutribot
   ```

2. **Revoke token via @BotFather:**
   - `/mybots` → Select bot → API Token → Revoke current token

3. **Generate new token and update secrets**

### Rollback Deployment

1. **Switch to known-good version:**
   ```bash
   git checkout <last-known-good-tag>
   ./deploy.sh
   ```

2. **Verify webhook is working:**
   ```bash
   node backend/chatbots/cli/telegram-admin.mjs status nutribot
   ```

---

## Maintenance Schedule

| Task | Frequency | Command |
|------|-----------|---------|
| Check bot status | Daily | `telegram-admin.mjs status nutribot` |
| Review webhook errors | Weekly | `telegram-admin.mjs webhook:info nutribot` |
| Update commands | As needed | `telegram-admin.mjs commands:set nutribot` |
| Token rotation | Annually | Via @BotFather |

---

## Contact & Escalation

- **Telegram Bot API Docs:** https://core.telegram.org/bots/api
- **@BotFather:** https://t.me/BotFather
- **Bot Support:** @BotSupport (for serious issues)

---

*End of Runbook*
