# Daylight Station Roadmap

Last updated: 2026-01-29

This roadmap reflects both the current development state and the long-term vision for Daylight Station.

---

## Legend

- ✅ Complete
- 🔄 In Progress
- 📋 Planned
- 💡 Conceptual / Future Vision

---

## Current State Summary

**What's Working:**
- Core platform running daily in production
- 4 fully functional frontend apps (TV, Fitness, Finance, Office)
- 14 harvester adapters pulling from external APIs
- 3 Telegram bots (Nutribot, Journalist, Homebot)
- Thermal printer integration
- MQTT sensor integration (heart rate, vibration)
- DDD architecture established

**What's In Progress:**
- DDD migration cleanup (on `refactor/ddd-migration` branch)
- 38 active implementation plans
- API layer error handling remediation
- Fresh video service refactoring

**What's Missing:**
- 3 placeholder frontend apps (Config, Home, Root navigation)
- Anti-doomscroll mobile feed
- Voice assistant integration
- E-ink display support
- Comprehensive documentation

---

## Q1 2026 (Current)

### Architecture & Technical Debt

| Item | Status | Notes |
|------|--------|-------|
| DDD layer structure | ✅ | 5 layers established |
| Port/adapter pattern | ✅ | Dependency injection throughout |
| Default exports on all classes | ✅ | Completed 2026-01-29 |
| DDD violations fix (9 tasks) | 🔄 | Plan ready, executing |
| API error handling remediation | 🔄 | 50+ handlers to fix |
| Application layer fs/path cleanup | 📋 | Create storage abstraction port |
| Fresh video service refactoring | 📋 | Design complete |
| Import alias migration | 📋 | Remove vendor references |
| Legacy cutover cleanup | 📋 | Remove old code paths |

### Core Features

| Item | Status | Notes |
|------|--------|-------|
| Fitness session management | ✅ | HR zones, multi-participant, voice memos |
| Workout video playback | ✅ | Plex integration with overlays |
| Nutribot meal logging | ✅ | Text, photo, voice, UPC |
| Journalist AI journaling | ✅ | Day-aware prompts |
| Finance dashboard | ✅ | Buxfer integration |
| TV media browser | ✅ | Plex + photo interstitials |
| Office kiosk dashboard | ✅ | Calendar, weather, entropy |
| Thermal printer receipts | ✅ | Morning output working |
| Watch state single source of truth | 📋 | Design complete |
| Media progress phase 2 | 📋 | Design complete |
| Fitness progress classifier | 📋 | Design complete |

### Bug Fixes

| Item | Status | Notes |
|------|--------|-------|
| Fitness session v3 payload dropped | ✅ | Fixed 2026-01-29 |
| Ambient LED HA URL resolution | ✅ | Fixed 2026-01-29 |
| Video queue stalling | ✅ | Fixed 2026-01-25 |
| Voice memo overlay instant close | 📋 | Reported, needs fix |
| Fitness watch history not syncing | 📋 | Reported, needs fix |
| NutriBot identity resolution | 📋 | Reported, needs fix |

### Documentation

| Item | Status | Notes |
|------|--------|-------|
| Backend architecture docs | ✅ | DDD layers documented |
| Coding standards | ✅ | Established and documented |
| Configuration guide | 🔄 | Exists but needs expansion |
| README overhaul | ✅ | Completed 2026-01-29 |
| Landing page copy | ✅ | Completed 2026-01-29 |
| Social media copy | ✅ | Completed 2026-01-29 |
| Pitch deck | ✅ | Completed 2026-01-29 |
| Adapter documentation | 📋 | 15+ adapters need docs |
| Use case documentation | 📋 | Placeholder only |
| Data model documentation | 📋 | Placeholder only |

---

## Q2 2026

### Architecture

| Item | Status | Notes |
|------|--------|-------|
| Complete DDD remediation | 📋 | B+ to A grade |
| Service resolution standardization | 📋 | ConfigService patterns |
| Messaging integration loader | 📋 | SystemBotLoader design |
| Device registry implementation | 📋 | Design exists |
| Test coverage audit | 📋 | Identify and fill gaps |
| E2E test suite | 📋 | Critical user flows |

### Frontend Apps

| Item | Status | Notes |
|------|--------|-------|
| ConfigApp implementation | 📋 | Currently placeholder |
| HomeApp implementation | 📋 | Currently placeholder |
| RootApp navigation menu | 📋 | Currently incomplete |
| HealthApp completion | 📋 | Basic structure exists |
| LifelogApp completion | 📋 | Basic structure exists |

### New Integrations (Inputs)

| Item | Status | Notes |
|------|--------|-------|
| Google Images gateway | 📋 | Unblocks NutriBot images |
| Quiz repository | 📋 | Unblocks Journalist quizzes |
| Immich adapter | 📋 | Photo library integration |
| Audiobookshelf adapter | 📋 | Audiobook progress |
| FreshRSS adapter | 📋 | RSS feed ingestion |
| Oura adapter | 💡 | Sleep/recovery data |
| Whoop adapter | 💡 | HRV/recovery data |
| YNAB adapter | 💡 | Budgeting alternative |

### New Outputs (Taps)

| Item | Status | Notes |
|------|--------|-------|
| E-ink dashboard support | 📋 | Low-power ambient display |
| SMS notifications | 📋 | Twilio integration |
| Calendar event creation | 📋 | Write back to Google Calendar |

### AI & Agents

| Item | Status | Notes |
|------|--------|-------|
| AI agents architecture | 📋 | Design exists |
| AI agents implementation | 📋 | After architecture |
| Mastra integration | 🔄 | Adapter exists |
| Local LLM support (Ollama) | 💡 | Privacy-first AI |

### Improvements

| Item | Status | Notes |
|------|--------|-------|
| Voice buffer upload (Telegram) | 📋 | ~90% complete |
| Voice food parsing | 📋 | ~80% complete |
| Improved onboarding flow | 📋 | Setup wizard |
| Configuration validation | 📋 | Helpful error messages |

---

## Q3 2026

### Mobile

| Item | Status | Notes |
|------|--------|-------|
| Anti-doomscroll feed | 💡 | Core vision feature |
| → RSS/Reddit ingestion | 📋 | Via FreshRSS adapter |
| → Personal grounding injection | 💡 | Photos, todos, health |
| → Time-on-feed warnings | 💡 | "You've been here 10 min" |
| → Custom algorithm controls | 💡 | User-defined ratio |
| Mobile companion app | 💡 | React Native or PWA |
| → Quick meal logging | 💡 | Camera + voice |
| → Push notification hub | 💡 | Aggregated alerts |
| → Location-based context | 💡 | Geofence triggers |

### Voice & Audio

| Item | Status | Notes |
|------|--------|-------|
| Voice assistant integration | 💡 | Self-hosted wake word |
| → Rhasspy/Mycroft integration | 💡 | Open-source voice |
| → Home control via voice | 💡 | "Turn off garage lights" |
| → Query capabilities | 💡 | "When's my next meeting?" |
| Phone call gateway | 💡 | For teens without smartphones |
| → Twilio integration | 💡 | Inbound/outbound calls |
| → Text-to-speech responses | 💡 | Query system via phone |
| → Parental controls | 💡 | Curated information access |

### Family & Multi-User

| Item | Status | Notes |
|------|--------|-------|
| Multi-user profiles | 📋 | Per-person dashboards |
| Family calendar synthesis | 💡 | Unified family view |
| Chore tracking & gamification | 💡 | Kids accountability |
| Allowance/budget per child | 💡 | Financial literacy |
| Guest mode | 💡 | Privacy when visitors present |

### New Integrations

| Item | Status | Notes |
|------|--------|-------|
| Mealie (recipes) | 💡 | Meal planning integration |
| Grocy (inventory) | 💡 | Household stock tracking |
| Paperless-ngx | 💡 | Document management |
| Apple Health (via export) | 💡 | iOS health data |

---

## Q4 2026

### AI & Intelligence

| Item | Status | Notes |
|------|--------|-------|
| Local LLM deployment | 💡 | Ollama/llama.cpp |
| RAG over personal data | 💡 | "What did I do last Tuesday?" |
| Predictive suggestions | 💡 | "You usually run on Mondays" |
| Anomaly detection | 💡 | "Your sleep is off this week" |
| Voice journal transcription | 💡 | Whisper integration |
| Second brain search | 💡 | Query all journal entries |

### Hardware Expansions

| Item | Status | Notes |
|------|--------|-------|
| DIY e-ink display kit | 💡 | Bill of materials + guide |
| Thermal printer templates | 💡 | Customizable receipt formats |
| Smart mirror integration | 💡 | Bathroom ambient display |
| Car dashboard mode | 💡 | Android Auto-style view |
| Wearable notifications | 💡 | Pebble/Garmin integration |

### Automation & Triggers

| Item | Status | Notes |
|------|--------|-------|
| Complex automation rules | 💡 | If X then Y across domains |
| Time-based context switching | 💡 | Morning mode, work mode, etc. |
| Location-based triggers | 💡 | "Arriving home" automations |
| Calendar-based preparation | 💡 | Pre-meeting briefings |
| Habit streak enforcement | 💡 | Lock media until X is done |

### Community & Ecosystem

| Item | Status | Notes |
|------|--------|-------|
| Plugin system | 💡 | Community adapters and taps |
| Adapter marketplace | 💡 | Share and discover integrations |
| Template library | 💡 | Pre-built kiosk layouts |
| Recipe sharing | 💡 | Community automation recipes |

---

## 2027+ (Vision)

### The "Private OS" for Family Life

| Item | Status | Notes |
|------|--------|-------|
| Every screen is a tap | 💡 | Ubiquitous computing realized |
| AI agents with full context | 💡 | "Plan my week" with life awareness |
| Proactive health interventions | 💡 | "Your HRV suggests rest today" |
| Financial autopilot suggestions | 💡 | "Move $500 to savings?" |
| Memory augmentation | 💡 | "What was that restaurant?" |
| Life timeline visualization | 💡 | Decade-view of your data |

### Potential Commercial Extensions

| Item | Status | Notes |
|------|--------|-------|
| Daylight Cloud (managed hosting) | 💡 | For non-self-hosters |
| Hardware kits | 💡 | Pre-configured kiosk bundles |
| Family office deployments | 💡 | Multi-property, managed |
| White-label licensing | 💡 | "Powered by Daylight Station" |

---

## Priority Matrix

### Must Have (Core Value Prop)
1. Stable core platform (fitness, TV, office, finance)
2. Thermal printer morning receipt
3. Telegram bots (nutribot, journalist)
4. Multi-source lifelog aggregation
5. Context-aware room displays

### Should Have (Differentiators)
1. Anti-doomscroll mobile feed
2. E-ink ambient displays
3. Voice assistant integration
4. AI agents with life context
5. Family multi-user support

### Nice to Have (Ecosystem)
1. Plugin system
2. Community adapter marketplace
3. Pre-built templates
4. Hardware kits

### Future Vision (North Star)
1. Every screen in the home is a tap
2. Phone becomes optional for daily life
3. AI that truly knows your life
4. The "private OS" for intentional living

---

## Contributing to the Roadmap

Interested in contributing? Here's what would help most:

### Immediate Needs
- **Adapters:** Oura, Whoop, YNAB, Mealie, Grocy
- **Documentation:** Adapter docs, configuration examples
- **Testing:** E2E test coverage, edge cases
- **Frontend:** ConfigApp, HomeApp implementation

### Medium-Term Needs
- **Mobile:** React Native or PWA expertise
- **Voice:** Rhasspy/Mycroft integration
- **E-ink:** Display driver experience
- **AI:** Local LLM deployment patterns

### How to Contribute
1. Check `__docs/plans/` for ready-to-implement designs
2. Check `__docs/_wip/` for investigations needing resolution
3. Open an issue to discuss new adapters or taps
4. See `CONTRIBUTING.md` for development setup

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-29 | Initial roadmap created |
| 2026-01-29 | Added current state from codebase analysis |
| 2026-01-29 | Incorporated vision from concept document |
