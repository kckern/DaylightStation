# Gatekeeper Domain Design

> Controlled access to digital resources through constrained interfaces

**Last Updated:** 2026-01-30
**Status:** Design Complete, Ready for Implementation
**Marketing Name:** Project Talos (not used in codebase)

---

## Overview

Gatekeeper is a new domain that provides **policy-based access control** for digital resources delivered through constrained interfaces. It enables scenarios where users (or households) interact with Daylight Station through limited devices—a flip phone, a voice assistant, a restricted kiosk—with configurable guardrails.

The core question answered: **"Is this principal allowed to do this action on this resource, right now?"**

---

## The Vision: Smart Dumb Devices

Modern smartphones are designed to capture attention. Daylight Station already addresses this through purpose-built kiosks and ambient displays. Gatekeeper extends this philosophy to **any constrained interface**:

| Device | What It Is | What Gatekeeper Enables |
|--------|------------|------------------------|
| Flip phone | No browser, no apps, just SMS/voice | AI assistant, web lookups, media streaming via call-back |
| Voice assistant | No screen, just audio | Home control, schedule queries, safe search—without Alexa/Google |
| Restricted kiosk | Limited UI, specific purpose | Policy-gated access to capabilities |

The "smart" parts live in Daylight Station. The device stays simple. Parents (or household admins) control the policies.

---

## Use Cases

### 1. Teen Flip Phone (Primary)

A teenager gets a flip phone (e.g., Sunbeam F1 Pro) with no internet access. They text a dedicated number to interact with the Daylight Station assistant:

- **Web lookups:** "What is photosynthesis?" → AI-summarized response via SMS
- **Homework help:** "Help me understand quadratic equations" → Tutoring conversation
- **Media:** "Play the latest Planet Money" → System calls them back and streams audio
- **Weather/schedule:** "What's the weather?" / "When's my dentist appointment?"

**Guardrails:**
- Curfew: No responses after 9pm
- Prerequisites: Chores must be complete (checked via Todoist)
- Content filtering: AI applies household-appropriate guidelines
- Audit: Parents can review request/response logs

### 2. Home Voice Assistant

Replace Alexa/Google Home with a self-hosted, privacy-first assistant:

- **Home control:** "Turn off the garage lights"
- **Queries:** "When's my next meeting?" / "What's the weather?"
- **Safe for kids:** Any household member can use it, policies apply at household level

### 3. Gated Kiosk Access

Apply policies to existing Daylight Station frontends:

- **Guest mode:** Limited capabilities when visitors are present
- **Kid profiles:** Restricted media access on shared devices
- **Time-based:** Different capabilities during work hours vs evening

---

## Architecture

### IAM-Inspired Model

Gatekeeper borrows proven patterns from Identity and Access Management:

```
Principal  →  assumes  →  Role  →  has  →  Policy  →  governs  →  Action + Resource
    │                                          │
    └── member of → Group ← has ───────────────┘
                                               │
                                          Condition
                                        (time, prerequisite, context)
```

| Concept | Definition | Example |
|---------|------------|---------|
| **Principal** | WHO is requesting | User: `emma`, Household: `kern`, Device: `garage-kiosk` |
| **Role** | Bundle of policies | `supervised-teen`, `household-member`, `guest` |
| **Policy** | Collection of statements | "Allow web-lookup on wikipedia during daytime" |
| **Action** | WHAT operation | `web-lookup`, `media-stream`, `home-control` |
| **Resource** | WHAT thing | `wikipedia`, `plex:music`, `home-assistant:lights` |
| **Condition** | WHEN/WHERE | Time range, prerequisite check, location |
| **Effect** | Allow or Deny | Explicit deny wins, default deny |

### Policy Statement Structure

```yaml
policies:
  - name: teen-daytime-access
    statements:
      - effect: allow
        actions: [web-lookup, homework-help, schedule-query]
        resources: [wikipedia, weather, calendar]
        conditions:
          time: { after: "06:00", before: "21:00" }

      - effect: allow
        actions: [media-stream]
        resources: [plex:music, podcasts:educational]
        conditions:
          time: { after: "06:00", before: "21:00" }
          prerequisite: { check: "chores-complete", source: "todoist" }

      - effect: deny
        actions: [media-stream]
        resources: [youtube:*]  # No YouTube, even during daytime
```

---

## DDD Layer Mapping

### Domain Layer (Pure Policy Logic)

```
1_domains/gatekeeper/
├── entities/
│   ├── Principal.mjs           # { type: user|household|device, id, roles[] }
│   ├── Role.mjs                # { name, policies[], inheritsFrom? }
│   ├── Policy.mjs              # { name, statements[], priority }
│   └── PolicyStatement.mjs     # { effect, actions[], resources[], conditions[] }
│
├── services/
│   ├── PolicyEvaluator.mjs     # Evaluate request against policies
│   ├── ConditionChecker.mjs    # Check time, prerequisites, context
│   └── AuditService.mjs        # Log decisions for review
│
└── value-objects/
    ├── Effect.mjs              # allow | deny
    ├── Condition.mjs           # { type, params }
    ├── TimeRange.mjs           # { after, before, days[] }
    └── Prerequisite.mjs        # { check, source, cacheTtl }
```

### Application Layer (Orchestration)

```
3_applications/assistant/
├── AssistantOrchestrator.mjs   # Main flow: parse → evaluate → execute → deliver
│
├── capabilities/               # What the assistant can do
│   ├── WebLookup.mjs           # Fetch and summarize web content
│   ├── HomeworkHelp.mjs        # Tutoring conversation
│   ├── MediaDelivery.mjs       # Find and deliver audio/video
│   ├── ScheduleQuery.mjs       # Calendar, weather, tasks
│   └── HomeControl.mjs         # Home Assistant commands
│
├── profiles/                   # src_type capability profiles
│   └── DeliveryProfiles.mjs    # sms, voice, chat capabilities
│
└── ports/
    └── DeliveryPort.mjs        # Abstract delivery interface
```

### Adapter Layer (External Services)

```
2_adapters/
├── telnyx/                     # SMS send/receive, voice calls
│   └── TelnyxAdapter.mjs
│
├── speech/                     # STT/TTS (Whisper, Piper, etc.)
│   └── SpeechAdapter.mjs
│
├── ai/                         # LLM for intent parsing (existing)
├── media/                      # yt-dlp, ffmpeg, Plex (existing)
├── home-automation/            # Home Assistant (existing)
└── scheduling/                 # Calendar, Todoist (existing)
```

### API Layer (Channel Endpoints)

```
4_api/v1/assistant/
├── sms.mjs                     # Telnyx webhook handler
├── voice.mjs                   # Voice assistant endpoint
└── chat.mjs                    # Telegram/Matrix endpoint (dev/future)
```

---

## Channel Abstraction

The application layer doesn't know about channels (SMS, voice, chat). It knows about **src_type** capability profiles:

### Capability Profiles

```javascript
const PROFILES = {
  sms: {
    maxTextLength: 320,
    supportsAudio: 'callback',    // Must call them back
    supportsImages: true,         // MMS
    supportsButtons: false,
    supportsRichText: false,
  },
  voice: {
    maxTextLength: null,          // Spoken
    supportsAudio: 'inline',      // Speak directly
    supportsImages: false,
    supportsButtons: false,
    supportsRichText: false,
  },
  chat: {
    maxTextLength: 4096,
    supportsAudio: 'inline',      // Voice message
    supportsImages: true,
    supportsButtons: true,
    supportsRichText: true,
  },
};
```

### DeliveryPort Interface

```javascript
class DeliveryPort {
  async send(principal, response) { }
  async streamAudio(principal, audioStream) { }
  async requestCallback(principal, payload) { }
  getCapabilities() { return PROFILES[this.type]; }
}
```

The API layer injects the appropriate DeliveryPort implementation. The application works with interaction patterns, not transport protocols:

| Application Says | SMS Implementation | Voice Implementation |
|-----------------|-------------------|---------------------|
| `send(response)` | TelnyxAdapter.sendSms() | SpeechAdapter.synthesize() + speaker |
| `streamAudio(stream)` | TelnyxAdapter.initiateCall() | Direct audio output |
| `requestCallback(payload)` | TelnyxAdapter.initiateCall() | N/A (already have audio channel) |

---

## Request Flow

```
SMS arrives: "What's the weather?"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4_api/v1/assistant/sms.mjs                                      │
│                                                                 │
│ • TelnyxAdapter.parseWebhook(req.body)                         │
│ • UserResolver.resolve('phone', fromNumber) → principal        │
│ • Inject TelnyxDeliveryPort                                    │
│ • Call orchestrator                                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3_applications/assistant/AssistantOrchestrator                  │
│                                                                 │
│ 1. AI.parseIntent("What's the weather?")                       │
│    → { capability: 'schedule-query', params: { type: 'weather' } }
│                                                                 │
│ 2. Gatekeeper.evaluate(principal, 'schedule-query', 'weather') │
│    → { effect: 'allow' }                                       │
│                                                                 │
│ 3. ScheduleQuery.execute({ type: 'weather' })                  │
│    → { temp: 45, condition: 'sunny', summary: '45°F and sunny' }
│                                                                 │
│ 4. delivery.send(principal, { text: '45°F and sunny today' })  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ TelnyxDeliveryPort.send()                                       │
│                                                                 │
│ • TelnyxAdapter.sendSms(principal.phone, '45°F and sunny today')│
└─────────────────────────────────────────────────────────────────┘
```

---

## Audio Streaming Example

```
Teen texts: "Play me a podcast about economics"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ AssistantOrchestrator                                           │
│                                                                 │
│ 1. parseIntent → { capability: 'media', type: 'podcast' }      │
│                                                                 │
│ 2. gatekeeper.evaluate(emma, 'media', 'podcast') → allow       │
│                                                                 │
│ 3. MediaDelivery.findPodcast('economics')                      │
│    → { title: 'Planet Money', duration: '25:00', url }         │
│                                                                 │
│ 4. Check: delivery.getCapabilities().supportsAudio → 'callback'│
│                                                                 │
│ 5. delivery.send({                                             │
│      text: "Found 'Planet Money' (25 min). Calling you now..." │
│    })                                                           │
│                                                                 │
│ 6. delivery.requestCallback({                                  │
│      audio: MediaAdapter.streamUrl(url)                        │
│    })                                                           │
└─────────────────────────────────────────────────────────────────┘

// Behind the scenes:
// - Telnyx initiates outbound call to teen's flip phone
// - Audio streams through Telnyx voice API
// - DTMF tones for control: 5=rewind, 0=stop, #=skip
```

---

## Implementation Phases

### Phase 1: AI Concierge + Media Gateway

**Goal:** Teen can text for help and listen to approved audio content.

**Domain:**
- [ ] Principal, Role, Policy entities
- [ ] PolicyEvaluator service
- [ ] Basic ConditionChecker (time-based curfew)
- [ ] AuditService for logging

**Application:**
- [ ] AssistantOrchestrator
- [ ] WebLookup capability (AI-summarized web content)
- [ ] ScheduleQuery capability (weather, calendar)
- [ ] MediaDelivery capability (podcast/music streaming)
- [ ] DeliveryPort interface

**Adapters:**
- [ ] TelnyxAdapter (SMS send/receive)
- [ ] TelnyxAdapter (voice call initiation, audio streaming)
- [ ] Extend existing AI adapter for intent parsing

**API:**
- [ ] SMS webhook endpoint
- [ ] Basic admin endpoint for policy management

**Config:**
- [ ] Policy YAML schema
- [ ] Principal/Role configuration

### Phase 2: Advanced Conditions + Voice Assistant

**Goal:** Prerequisite checks, home voice assistant.

**Domain:**
- [ ] Prerequisite condition type (check Todoist, etc.)
- [ ] Location-based conditions

**Application:**
- [ ] HomeControl capability
- [ ] VoiceHandler channel support

**Adapters:**
- [ ] SpeechAdapter (Whisper STT, Piper TTS)
- [ ] Hardware integration for always-on mic/speaker

**API:**
- [ ] Voice assistant endpoint

### Phase 3: Social Relay (Future)

**Goal:** Bridge Discord/WhatsApp to SMS.

**Adapters:**
- [ ] MatrixAdapter (double-puppeting)
- [ ] Telnyx number pool for virtual contacts

**Application:**
- [ ] ChatRelay capability
- [ ] Contact mapping (group chat → virtual number)

---

## Configuration Schema

### Principals (in household config)

```yaml
# data/household/users/emma.yml
name: emma
roles: [supervised-teen]
identities:
  phone: "+15551234567"
  telegram: "123456789"
```

### Roles and Policies

```yaml
# data/household/apps/gatekeeper/config.yml
roles:
  supervised-teen:
    policies: [teen-base-access, teen-media-access]

  household-member:
    policies: [household-base-access]

policies:
  teen-base-access:
    statements:
      - effect: allow
        actions: [web-lookup, homework-help, schedule-query]
        resources: ["*"]
        conditions:
          curfew: { after: "06:00", before: "21:00" }

  teen-media-access:
    statements:
      - effect: allow
        actions: [media-stream]
        resources: [plex:music, podcasts:*]
        conditions:
          curfew: { after: "06:00", before: "21:00" }
          prerequisite: { check: chores-complete, source: todoist }

      - effect: deny
        actions: [media-stream]
        resources: [youtube:*]
```

---

## Integration Points

### Existing Daylight Station Components

| Component | How Gatekeeper Uses It |
|-----------|----------------------|
| ConfigService | Load policies, principals, roles |
| UserResolver | Resolve phone/telegram ID to principal |
| AI adapters | Parse intent from natural language |
| Media adapters | Fetch and transcode audio/video |
| Home-automation adapters | Execute home control commands |
| Scheduling adapters | Query calendar, weather, tasks |
| Todoist adapter | Check prerequisite completion |

### New Infrastructure Needed

| Component | Purpose |
|-----------|---------|
| TelnyxAdapter | SMS and voice call gateway |
| SpeechAdapter | STT/TTS for voice assistant |
| Policy YAML loader | Parse and validate policy configs |
| Audit log storage | Store request/response history |

---

## Parent Dashboard (Future)

A simple web UI for parents to:

- View audit logs (what did they ask? what was delivered?)
- Manage policies (adjust curfews, add/remove capabilities)
- See usage patterns (most common requests, blocked attempts)
- Configure prerequisites (link to Todoist lists)

This would be a new frontend app or section in ConfigApp.

---

## Marketing: Project Talos

For external communication, this feature set is branded as **Project Talos**:

> *Just as the ancient Talos circled Crete three times daily to maintain order, Project Talos circles your teen's digital life—handling the heavy lifting of internet, group chats, web searches, and media, so they only receive what's essential via the simplest interface possible: text and voice.*

**Pitch:** All the connection your kids need. None of the distractions. Give childhood back to the kids.

**Note:** "Talos" is marketing only. The codebase uses `gatekeeper` (domain) and `assistant` (application).

---

## Open Questions

1. **DTMF control during audio playback:** What controls should be available? (rewind, pause, skip, stop)

2. **Bluetooth file transfer:** When teen is home, can we push files directly via Bluetooth OPP? Requires hardware investigation.

3. **Emergency override:** Should there be a way for teens to bypass curfew in emergencies? How to prevent abuse?

4. **Multi-household:** Policies are household-scoped. How do shared-custody scenarios work?

5. **Cost management:** Telnyx charges per SMS/minute. Should there be usage caps as a policy condition?

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-30 | Initial design from brainstorming session |
