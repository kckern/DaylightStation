# DDD File Map

**Last Updated:** 2026-01-12

Complete mapping of `backend/src/` structure with references to legacy code locations.

---

## Summary

| Layer | Files | Description |
|-------|-------|-------------|
| 0_infrastructure | 26 | Cross-cutting concerns |
| 1_domains | 111 | Business logic |
| 2_adapters | 76 | External integrations |
| 3_applications | 60 | Use case orchestration |
| 4_api | 39 | HTTP routes |
| **Total** | **313** | |

---

## 0_infrastructure/ (26 files)

### config/
| New File | Legacy Source |
|----------|---------------|
| `ConfigService.mjs` | `_legacy/lib/config/index.mjs` |
| `index.mjs` | `_legacy/lib/config/` |

### logging/
| New File | Legacy Source |
|----------|---------------|
| `dispatcher.js` | `_legacy/lib/logging/dispatcher.js` |
| `logger.js` | `_legacy/lib/logging/logger.js` |
| `config.js` | `_legacy/lib/logging/config.js` |
| `ingestion.js` | `_legacy/lib/logging/ingestion.js` |
| `utils.js` | `_legacy/lib/logging/utils.js` |
| `transports/ConsoleTransport.js` | `_legacy/lib/logging/transports/` |
| `transports/FileTransport.js` | `_legacy/lib/logging/transports/` |
| `transports/LogglyTransport.js` | `_legacy/lib/logging/transports/` |

### eventbus/
| New File | Legacy Source |
|----------|---------------|
| `IEventBus.mjs` | New (port interface) |
| `EventBusImpl.mjs` | New (core implementation) |
| `WebSocketEventBus.mjs` | `_legacy/routers/websocket.mjs` |
| `MqttAdapter.mjs` | `_legacy/lib/mqtt.mjs` |

### scheduling/
| New File | Legacy Source |
|----------|---------------|
| `TaskRegistry.mjs` | `_legacy/lib/cron/TaskRegistry.mjs` |
| `index.mjs` | New |

### routing/
| New File | Legacy Source |
|----------|---------------|
| `RoutingConfig.mjs` | New (toggle system) |
| `ShimMetrics.mjs` | New (toggle system) |
| `index.mjs` | New |

### proxy/
| New File | Legacy Source |
|----------|---------------|
| `ProxyService.mjs` | `_legacy/routers/plexProxy.mjs` (partial) |

---

## 1_domains/ (111 files)

### content/
| New File | Legacy Source |
|----------|---------------|
| `entities/ContentItem.mjs` | `_legacy/routers/media.mjs` (extracted) |
| `entities/WatchState.mjs` | `_legacy/lib/mediaMemory.mjs` |
| `services/ContentSourceRegistry.mjs` | New |
| `ports/IContentSource.mjs` | New (port interface) |
| `ports/IWatchStateStore.mjs` | New (port interface) |

### fitness/
| New File | Legacy Source |
|----------|---------------|
| `entities/Session.mjs` | `_legacy/routers/fitness.mjs:127-203` |
| `entities/Participant.mjs` | `_legacy/routers/fitness.mjs:189-200` |
| `entities/Zone.mjs` | `_legacy/routers/fitness.mjs:632-717` |
| `services/SessionService.mjs` | `_legacy/routers/fitness.mjs` |
| `services/ZoneService.mjs` | `_legacy/routers/fitness.mjs:632-717` |
| `services/TimelineService.mjs` | `_legacy/routers/fitness.mjs:64-125` |
| `ports/ISessionStore.mjs` | New (port interface) |
| `ports/IZoneLedController.mjs` | New (port interface) |

### finance/
| New File | Legacy Source |
|----------|---------------|
| `entities/Budget.mjs` | `_legacy/lib/budgetlib/` |
| `entities/Transaction.mjs` | `_legacy/lib/buxfer.mjs` |
| `entities/Account.mjs` | `_legacy/lib/buxfer.mjs` |
| `entities/Mortgage.mjs` | `_legacy/lib/budget.mjs` |
| `services/BudgetService.mjs` | `_legacy/lib/budget.mjs` |
| `services/MortgageService.mjs` | `_legacy/lib/budget.mjs` |
| `services/TransactionClassifier.mjs` | `_legacy/lib/budgetlib/` |
| `services/MortgageCalculator.mjs` | `_legacy/lib/budgetlib/` |
| `ports/ITransactionSource.mjs` | New (port interface) |

### messaging/
| New File | Legacy Source |
|----------|---------------|
| `entities/Message.mjs` | `_legacy/chatbots/domain/` |
| `entities/Conversation.mjs` | `_legacy/chatbots/domain/` |
| `entities/Notification.mjs` | New |
| `services/ConversationService.mjs` | `_legacy/chatbots/application/` |
| `services/NotificationService.mjs` | New |
| `ports/IMessagingGateway.mjs` | `_legacy/chatbots/infrastructure/` |
| `ports/IConversationStore.mjs` | New (port interface) |
| `ports/INotificationChannel.mjs` | New (port interface) |

### nutrition/
| New File | Legacy Source |
|----------|---------------|
| `entities/FoodItem.mjs` | `_legacy/chatbots/bots/nutribot/domain/` |
| `entities/NutriLog.mjs` | `_legacy/chatbots/bots/nutribot/domain/` |
| `entities/formatters.mjs` | `_legacy/chatbots/bots/nutribot/domain/` |
| `entities/schemas.mjs` | New (Zod validation) |
| `services/FoodLogService.mjs` | `_legacy/chatbots/bots/nutribot/application/` |
| `ports/IFoodLogStore.mjs` | New (port interface) |

### journaling/
| New File | Legacy Source |
|----------|---------------|
| `entities/JournalEntry.mjs` | `_legacy/chatbots/bots/journalist/domain/` |
| `services/JournalService.mjs` | `_legacy/chatbots/bots/journalist/application/` |
| `ports/IJournalStore.mjs` | New (port interface) |

### journalist/
| New File | Legacy Source |
|----------|---------------|
| `entities/*.mjs` | `_legacy/chatbots/bots/journalist/domain/entities/` |
| `services/*.mjs` | `_legacy/chatbots/bots/journalist/domain/services/` |
| Value objects | `_legacy/chatbots/bots/journalist/domain/value-objects/` |

### ai/
| New File | Legacy Source |
|----------|---------------|
| `ports/IAIGateway.mjs` | `_legacy/chatbots/infrastructure/ai/` |
| `ports/ITranscriptionService.mjs` | New (port interface) |

### health/
| New File | Legacy Source |
|----------|---------------|
| `services/HealthAggregationService.mjs` | `_legacy/lib/health.mjs` |

### gratitude/
| New File | Legacy Source |
|----------|---------------|
| `entities/Selection.mjs` | `_legacy/routers/gratitude.mjs` |
| `services/GratitudeService.mjs` | `_legacy/routers/gratitude.mjs` |
| `ports/IGratitudeStore.mjs` | New (port interface) |

### entropy/
| New File | Legacy Source |
|----------|---------------|
| `services/EntropyService.mjs` | `_legacy/lib/entropy.mjs` |

### home-automation/
| New File | Legacy Source |
|----------|---------------|
| Various | `_legacy/lib/homeassistant.mjs`, `_legacy/routers/exe.mjs` |

---

## 2_adapters/ (76 files)

### persistence/yaml/
| New File | Implements | Legacy Source |
|----------|------------|---------------|
| `YamlSessionStore.mjs` | ISessionStore | `_legacy/routers/fitness.mjs` |
| `YamlWatchStateStore.mjs` | IWatchStateStore | `_legacy/lib/mediaMemory.mjs` |
| `YamlFinanceStore.mjs` | IFinanceStore | `_legacy/lib/budget.mjs` |
| `YamlFoodLogStore.mjs` | IFoodLogStore | `_legacy/chatbots/bots/nutribot/` |
| `YamlNutriListStore.mjs` | INutriListStore | `_legacy/chatbots/bots/nutribot/` |
| `YamlNutriCoachStore.mjs` | INutriCoachStore | `_legacy/chatbots/bots/nutribot/` |
| `YamlJournalEntryRepository.mjs` | IJournalStore | `_legacy/chatbots/bots/journalist/` |
| `YamlMessageQueueRepository.mjs` | IMessageQueue | `_legacy/chatbots/bots/journalist/` |
| `YamlGratitudeStore.mjs` | IGratitudeStore | `_legacy/routers/gratitude.mjs` |
| `YamlHealthStore.mjs` | IHealthStore | `_legacy/lib/health.mjs` |
| `YamlConversationStore.mjs` | IConversationStore | New |
| `YamlLifelogStore.mjs` | ILifelogStore | `_legacy/lib/io.mjs` |
| `YamlAuthStore.mjs` | IAuthStore | `_legacy/lib/io.mjs` |

### harvester/ (16 harvesters)
| New File | Category | Legacy Source |
|----------|----------|---------------|
| `fitness/GarminHarvester.mjs` | Fitness | `_legacy/lib/garmin.mjs` |
| `fitness/StravaHarvester.mjs` | Fitness | `_legacy/lib/strava.mjs` |
| `fitness/WithingsHarvester.mjs` | Fitness | `_legacy/lib/withings.mjs` |
| `productivity/TodoistHarvester.mjs` | Productivity | `_legacy/lib/todoist.mjs` |
| `productivity/ClickUpHarvester.mjs` | Productivity | `_legacy/lib/clickup.mjs` |
| `productivity/GitHubHarvester.mjs` | Productivity | `_legacy/lib/github.mjs` |
| `social/LastfmHarvester.mjs` | Social | `_legacy/lib/lastfm.mjs` |
| `social/RedditHarvester.mjs` | Social | `_legacy/lib/reddit.mjs` |
| `social/LetterboxdHarvester.mjs` | Social | `_legacy/lib/letterboxd.mjs` |
| `social/GoodreadsHarvester.mjs` | Social | `_legacy/lib/goodreads.mjs` |
| `social/FoursquareHarvester.mjs` | Social | `_legacy/lib/foursquare.mjs` |
| `communication/GmailHarvester.mjs` | Communication | `_legacy/lib/gmail.mjs` |
| `communication/GCalHarvester.mjs` | Communication | `_legacy/lib/gcal.mjs` |
| `finance/ShoppingHarvester.mjs` | Finance | `_legacy/lib/shopping.mjs` |
| `other/WeatherHarvester.mjs` | Other | `_legacy/lib/weather.mjs` |
| `other/ScriptureHarvester.mjs` | Other | `_legacy/lib/scriptureguide.mjs` |

### ai/
| New File | Legacy Source |
|----------|---------------|
| `OpenAIAdapter.mjs` | `_legacy/lib/gpt.mjs`, `_legacy/chatbots/infrastructure/ai/` |
| `AnthropicAdapter.mjs` | New |

### content/
| New File | Legacy Source |
|----------|---------------|
| `media/plex/PlexAdapter.mjs` | `_legacy/lib/plex.mjs` |
| `media/filesystem/FilesystemAdapter.mjs` | `_legacy/routers/media.mjs` |
| `folder/FolderAdapter.mjs` | New |
| `local-content/LocalContentAdapter.mjs` | `_legacy/routers/fetch.mjs` (partial) |

### messaging/
| New File | Legacy Source |
|----------|---------------|
| `TelegramAdapter.mjs` | `_legacy/chatbots/infrastructure/messaging/` |
| `GmailAdapter.mjs` | `_legacy/lib/gmail.mjs` |

### finance/
| New File | Legacy Source |
|----------|---------------|
| `BuxferAdapter.mjs` | `_legacy/lib/buxfer.mjs` |

### home-automation/
| New File | Legacy Source |
|----------|---------------|
| `homeassistant/HomeAssistantAdapter.mjs` | `_legacy/lib/homeassistant.mjs` |
| `tv/TVControlAdapter.mjs` | `_legacy/routers/exe.mjs` |
| `kiosk/KioskAdapter.mjs` | `_legacy/routers/exe.mjs` |
| `tasker/TaskerAdapter.mjs` | `_legacy/routers/exe.mjs` |
| `remote-exec/RemoteExecAdapter.mjs` | `_legacy/routers/exe.mjs` |

### hardware/
| New File | Legacy Source |
|----------|---------------|
| `thermal-printer/ThermalPrinterAdapter.mjs` | `_legacy/lib/thermalprint.mjs` |
| `tts/TTSAdapter.mjs` | `_legacy/routers/tts.mjs` |
| `mqtt-sensor/MQTTSensorAdapter.mjs` | `_legacy/lib/mqtt.mjs` |

### proxy/
| New File | Legacy Source |
|----------|---------------|
| `PlexProxyAdapter.mjs` | `_legacy/routers/plexProxy.mjs` |
| `ImmichProxyAdapter.mjs` | New |
| `AudiobookshelfProxyAdapter.mjs` | New |
| `FreshRSSProxyAdapter.mjs` | New |

---

## 3_applications/ (60 files)

### nutribot/
| New File | Legacy Source |
|----------|---------------|
| `NutribotContainer.mjs` | `_legacy/chatbots/bots/nutribot/container.mjs` |
| `usecases/*.mjs` (24 files) | `_legacy/chatbots/bots/nutribot/application/usecases/` |
| `config/*.mjs` | `_legacy/chatbots/bots/nutribot/config/` |

### journalist/
| New File | Legacy Source |
|----------|---------------|
| `JournalistContainer.mjs` | `_legacy/chatbots/bots/journalist/container.mjs` |
| `usecases/*.mjs` (21 files) | `_legacy/chatbots/bots/journalist/application/usecases/` |
| `ports/*.mjs` | `_legacy/chatbots/bots/journalist/application/ports/` |

### finance/
| New File | Legacy Source |
|----------|---------------|
| `BudgetCompilationService.mjs` | `_legacy/lib/budget.mjs` |
| `FinanceHarvestService.mjs` | `_legacy/routers/harvest.mjs` (budget) |
| `TransactionCategorizationService.mjs` | `_legacy/lib/budgetlib/` |

### fitness/
| New File | Legacy Source |
|----------|---------------|
| `VoiceMemoTranscriptionService.mjs` | `_legacy/routers/fitness.mjs:494-595` |
| `transcriptionContext.mjs` | `_legacy/routers/fitness.mjs` |

---

## 4_api/ (39 files)

### routers/
| New Router | Path | Legacy Router |
|------------|------|---------------|
| `content.mjs` | `/api/content` | `_legacy/routers/media.mjs` (partial) |
| `proxy.mjs` | `/proxy` | `_legacy/routers/media.mjs` (partial) |
| `list.mjs` | `/api/list` | `_legacy/routers/fetch.mjs` (partial) |
| `play.mjs` | `/api/play` | `_legacy/routers/media.mjs` (partial) |
| `localContent.mjs` | `/api/local-content` | `_legacy/routers/fetch.mjs` (partial) |
| `fitness.mjs` | `/api/fitness` | `_legacy/routers/fitness.mjs` |
| `finance.mjs` | `/api/finance` | `_legacy/lib/budget.mjs`, `_legacy/routers/harvest.mjs` |
| `health.mjs` | `/api/health` | `_legacy/routers/health.mjs` |
| `gratitude.mjs` | `/api/gratitude` | `_legacy/routers/gratitude.mjs` |
| `entropy.mjs` | `/api/entropy` | `_legacy/lib/entropy.mjs` |
| `homeAutomation.mjs` | `/api/home` | `_legacy/routers/home.mjs`, `_legacy/routers/exe.mjs` |
| `journalist.mjs` | `/api/journalist` | `_legacy/routers/journalist.mjs` |
| `nutribot.mjs` | `/api/nutribot` | `_legacy/chatbots/` webhook |
| `messaging.mjs` | `/api/messaging` | New |
| `nutrition.mjs` | `/api/nutrition` | New |
| `journaling.mjs` | `/api/journaling` | New |
| `ai.mjs` | `/api/ai` | New |
| `printer.mjs` | `/api/printer` | `_legacy/routers/printer.mjs` |
| `tts.mjs` | `/api/tts` | `_legacy/routers/tts.mjs` |
| `externalProxy.mjs` | `/proxy/*` | `_legacy/routers/plexProxy.mjs` |

### routers/admin/
| New Router | Path | Purpose |
|------------|------|---------|
| `shims.mjs` | `/admin/shims` | Route toggle metrics |
| `legacy.mjs` | `/admin/legacy` | Legacy route hit tracking |

### middleware/
| New File | Purpose |
|----------|---------|
| `legacyCompat.mjs` | Legacy request format support |
| `legacyListShim.mjs` | /list compatibility |
| `legacyPlayShim.mjs` | /play compatibility |
| `legacyLocalContentShim.mjs` | /local-content compatibility |
| `legacyTracker.mjs` | Legacy route hit counting |

### shims/
| New File | Purpose |
|----------|---------|
| `finance.mjs` | Finance route compatibility |
| `content.mjs` | Content route compatibility |
| `index.mjs` | Shim registry |

### handlers/
| Directory | Purpose |
|-----------|---------|
| `nutribot/` | Nutribot-specific handlers |
| `journalist/` | Journalist-specific handlers |

---

## Legacy Files Still Active

These legacy files are still mounted in `server.mjs` (tracked via `/admin/legacy`):

| Legacy Router | Path | Status |
|---------------|------|--------|
| `fetch.mjs` | `/data/*` | Active - YAML serving |
| `harvest.mjs` | `/harvest/*` | Active - Uses new harvesters |
| `home.mjs` | `/home/*` | Active - Delegates to homeAutomation |
| `media.mjs` | `/media/*` | Active - Partial migration |
| `cron.mjs` | `/cron/*` | Active - Job scheduling |
| `plexProxy.mjs` | `/plex_proxy/*` | Deprecated - Use externalProxy |
| `exe.mjs` | `/exe/*` | Active - Remote execution |

---

## See Also

- [Backend Architecture](./backend-architecture.md) - Architecture overview
- [Migration Summary](./migration-summary.md) - Migration status
