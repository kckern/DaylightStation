# Remaining Legacy Items

Documented: 2026-01-22

## Chatbots Architecture (Verified Working)

The chatbot subsystem remains in `_legacy/chatbots/` by design:
- Secondary webhook server runs on port 3119
- Telegram webhooks route through `_legacy/chatbots/adapters/http/TelegramWebhookHandler.mjs`
- Bots: nutribot, journalist, homebot

This is intentional - chatbots migration is a separate project.

## Migration Status (Updated)

### Completed
- All logging → `src/0_infrastructure/logging/`
- Finance domain → `src/1_domains/finance/services/`
- Entropy domain → `src/1_domains/entropy/services/`
- Content domain → `src/1_domains/content/services/`

### Remaining in Legacy (By Design)
- `_legacy/chatbots/` - Separate migration project
- `_legacy/routers/` - Cron jobs, will migrate with scheduler refactor
- `_legacy/lib/` - Shims that re-export from new locations
