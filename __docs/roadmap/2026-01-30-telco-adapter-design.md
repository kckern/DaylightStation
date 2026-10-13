# Telco Adapter Design

> SMS, MMS, and voice communication through abstracted telephony providers

**Last Updated:** 2026-01-30
**Status:** Design Complete, Ready for Implementation
**Initial Provider:** Telnyx

---

## Overview

The Telco adapter provides telephony capabilities (SMS, MMS, voice calls) through an abstracted interface. The API and application layers don't know which provider (Telnyx, Twilio, etc.) is being used—they work with the `TelcoPort` interface.

This adapter enables:
- **SMS/MMS messaging** for the gatekeeper assistant
- **Voice calls** for audio content delivery (podcasts, music)
- **Real-time voice conversation** with AI (driving mode)

---

## Architecture

### Layer Responsibilities

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4_api/v1/assistant/                                                         │
│                                                                             │
│ • Receives webhooks (provider-agnostic route)                              │
│ • Calls adapter.parseWebhook() to normalize                                │
│ • Passes normalized events to application layer                            │
│ • Uses adapter for responses                                               │
│                                                                             │
│ Does NOT know: Telnyx vs Twilio, webhook payload formats                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3_applications/assistant/                                                   │
│                                                                             │
│ • Orchestrates request handling                                            │
│ • Checks gatekeeper policies                                               │
│ • Executes capabilities (web lookup, media, etc.)                          │
│ • Uses TelcoPort for delivery                                              │
│                                                                             │
│ Does NOT know: Telnyx, Twilio, WebSockets, DTMF key mappings              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2_adapters/telco/                                                           │
│                                                                             │
│ • TelcoPort interface (what app layer sees)                                │
│ • VoiceProcessorPort interface (for AI conversation)                       │
│ • Provider implementations (Telnyx, Twilio)                                │
│ • Handles all provider-specific details                                    │
│                                                                             │
│ Knows: Telnyx API, webhook formats, WebSocket media streams, DTMF         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
2_adapters/telco/
├── TelcoPort.mjs                    # Interface definition
├── VoiceProcessorPort.mjs           # AI voice processing interface
├── PlaybackControlPort.mjs          # Abstract playback controls
├── telnyx/
│   ├── TelnyxAdapter.mjs            # Main adapter (implements TelcoPort)
│   ├── TelnyxWebhookParser.mjs      # Parse Telnyx webhook payloads
│   ├── TelnyxMediaStreamHandler.mjs # WebSocket audio streaming
│   └── TelnyxDTMFMapper.mjs         # Map DTMF keys to PlaybackControl actions
└── twilio/                          # Future
    └── TwilioAdapter.mjs

2_adapters/ai/
├── OpenAIRealtimeAdapter.mjs        # Implements VoiceProcessorPort
└── (future) LocalVoiceAdapter.mjs   # Whisper + Piper
```

---

## Port Interfaces

### TelcoPort

The primary interface for telephony operations:

```javascript
/**
 * TelcoPort - Telephony adapter interface
 *
 * Implementations: TelnyxAdapter, TwilioAdapter (future)
 */
interface TelcoPort {
  // === Lifecycle ===

  /**
   * Start the adapter, attach WebSocket handlers
   * @param {Object} httpServer - HTTP server for WS upgrade
   */
  start(httpServer: HttpServer): Promise<void>

  /**
   * Stop the adapter, close connections
   */
  stop(): Promise<void>

  // === Webhook Handling ===

  /**
   * Parse provider-specific webhook into normalized event
   * @returns Normalized event (sms.inbound, call.answered, etc.)
   */
  parseWebhook(req: Request): NormalizedTelcoEvent

  // === SMS/MMS ===

  /**
   * Send SMS message
   */
  sendSms(to: string, message: string): Promise<MessageResult>

  /**
   * Send MMS with media attachment
   */
  sendMms(to: string, message: string, mediaUrl: string): Promise<MessageResult>

  // === Voice Calls ===

  /**
   * Initiate outbound call
   */
  initiateCall(to: string, options?: CallOptions): Promise<CallSession>

  /**
   * Answer inbound call
   */
  answerCall(callId: string): Promise<CallSession>

  /**
   * End active call
   */
  hangup(callId: string): Promise<void>

  // === Audio Streaming ===

  /**
   * Stream audio to active call (for podcast/music playback)
   */
  streamAudio(callId: string, audioSource: AudioSource): Promise<void>

  /**
   * Stop audio streaming
   */
  stopAudio(callId: string): Promise<void>

  // === Voice Conversation ===

  /**
   * Start AI voice conversation on call
   * @param voiceProcessor - VoiceProcessorPort implementation
   */
  startVoiceConversation(
    callId: string,
    voiceProcessor: VoiceProcessorPort,
    options?: VoiceConversationOptions
  ): Promise<VoiceConversationSession>

  // === Events ===

  onSmsReceived(callback: (event: SmsEvent) => void): void
  onCallReceived(callback: (event: CallEvent) => void): void
  onCallAnswered(callback: (event: CallEvent) => void): void
  onCallEnded(callback: (event: CallEvent) => void): void
  onPlaybackControl(callback: (event: PlaybackControlEvent) => void): void
}
```

### VoiceProcessorPort

Interface for AI voice processing (STT + LLM + TTS):

```javascript
/**
 * VoiceProcessorPort - Voice AI processing interface
 *
 * Implementations: OpenAIRealtimeAdapter, LocalVoiceAdapter (future)
 */
interface VoiceProcessorPort {
  /**
   * Create a voice processing session
   */
  createSession(options: VoiceSessionOptions): VoiceSession
}

interface VoiceSession {
  // === Audio I/O ===

  /**
   * Send audio chunk to processor
   */
  sendAudio(chunk: Buffer): void

  /**
   * Send text directly (for non-voice input)
   */
  sendText(text: string): void

  // === Events ===

  /**
   * Fired when speech is transcribed
   */
  onTranscript(callback: (text: string, isFinal: boolean) => void): void

  /**
   * Fired when AI generates response text
   */
  onResponseText(callback: (text: string) => void): void

  /**
   * Fired when AI generates audio response
   */
  onResponseAudio(callback: (chunk: Buffer) => void): void

  /**
   * Fired when user interrupts (barge-in)
   */
  onInterruption(callback: () => void): void

  /**
   * Fired on error
   */
  onError(callback: (error: Error) => void): void

  // === Control ===

  /**
   * Interrupt current response
   */
  interrupt(): void

  /**
   * Close session
   */
  close(): void
}

interface VoiceSessionOptions {
  systemPrompt: string           // AI instructions
  voice?: string                 // TTS voice selection
  temperature?: number           // Response randomness
  interruptible?: boolean        // Allow barge-in (default: true)
}
```

### PlaybackControlPort

Abstract interface for playback controls (application layer sees actions, not keys):

```javascript
/**
 * PlaybackControlPort - Abstract playback control actions
 *
 * Application layer uses these actions.
 * Adapter maps provider-specific inputs (DTMF, voice commands) to actions.
 */
interface PlaybackControlPort {
  // === Actions (what application layer knows) ===

  rewind(seconds: number): void
  fastForward(seconds: number): void
  pause(): void
  resume(): void
  stop(): void

  // === Events ===

  onAction(callback: (action: PlaybackAction) => void): void
}

type PlaybackAction =
  | { type: 'rewind', seconds: number }
  | { type: 'fastForward', seconds: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'unknown', raw: string }  // Unrecognized input

/**
 * TelnyxDTMFMapper - Maps DTMF keys to PlaybackActions
 *
 * This is internal to the adapter. Application never sees DTMF.
 */
const DTMF_MAP = {
  '1': { type: 'rewind', seconds: 30 },
  '3': { type: 'fastForward', seconds: 30 },
  '5': { type: 'pause' },      // Toggle pause/resume
  '0': { type: 'stop' },
  // Others map to { type: 'unknown', raw: key }
};
```

---

## Normalized Event Types

Events normalized from provider-specific webhooks:

```javascript
interface NormalizedTelcoEvent {
  type: TelcoEventType
  provider: 'telnyx' | 'twilio'
  timestamp: Date
  raw: object                    // Original webhook payload
}

type TelcoEventType =
  // SMS
  | 'sms.inbound'
  | 'sms.delivered'
  | 'sms.failed'
  // MMS
  | 'mms.inbound'
  | 'mms.delivered'
  // Voice
  | 'call.inbound'
  | 'call.answered'
  | 'call.hangup'
  | 'call.failed'
  // Media
  | 'media.stream.started'
  | 'media.stream.stopped'
  | 'dtmf.received'

interface SmsInboundEvent extends NormalizedTelcoEvent {
  type: 'sms.inbound'
  from: string
  to: string
  body: string
  mediaUrls?: string[]           // MMS attachments
}

interface CallInboundEvent extends NormalizedTelcoEvent {
  type: 'call.inbound'
  from: string
  to: string
  callId: string
}

interface DtmfEvent extends NormalizedTelcoEvent {
  type: 'dtmf.received'
  callId: string
  digit: string
}
```

---

## WebSocket Media Streaming

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VOICE CALL FLOW                                   │
│                                                                             │
│  Flip Phone                     Daylight Station                            │
│  ─────────                     ─────────────────                            │
│      │                               │                                      │
│      │ ──── Call to +1555... ────►   │                                      │
│      │                               │                                      │
│      │                    ┌──────────┴──────────┐                          │
│      │                    │   TelnyxAdapter     │                          │
│      │                    │                     │                          │
│      │ ◄─── Audio ────    │  ┌───────────────┐  │    ┌──────────────────┐  │
│      │                    │  │ MediaStream   │◄─┼───►│ VoiceProcessor   │  │
│      │ ──── Audio ────►   │  │ Handler (WS)  │  │    │ (OpenAI Realtime)│  │
│      │                    │  └───────────────┘  │    └──────────────────┘  │
│      │                    │                     │                          │
│      │ ──── DTMF ─────►   │  ┌───────────────┐  │                          │
│      │                    │  │ DTMF Mapper   │──┼──► PlaybackControlEvent  │
│      │                    │  └───────────────┘  │                          │
│      │                    └─────────────────────┘                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### WebSocket Handling (Internal to Adapter)

```javascript
// TelnyxAdapter - internal implementation detail
class TelnyxAdapter implements TelcoPort {
  #httpServer;
  #wss;
  #activeCalls = new Map();

  async start(httpServer) {
    this.#httpServer = httpServer;

    // Attach WebSocket server for Telnyx media streams
    this.#wss = new WebSocketServer({
      server: httpServer,
      path: '/ws/telco/media'
    });

    this.#wss.on('connection', (ws, req) => {
      this.#handleMediaStreamConnection(ws, req);
    });
  }

  #handleMediaStreamConnection(ws, req) {
    const callId = this.#extractCallId(req);
    const call = this.#activeCalls.get(callId);

    if (!call) {
      ws.close(4000, 'Unknown call');
      return;
    }

    // Bidirectional audio piping
    ws.on('message', (data) => {
      // Audio from phone → process
      if (call.voiceProcessor) {
        call.voiceProcessor.sendAudio(data);
      }
    });

    // Audio from processor → phone
    if (call.voiceProcessor) {
      call.voiceProcessor.onResponseAudio((chunk) => {
        ws.send(chunk);
      });
    }
  }
}
```

---

## Configuration

### Provider Configuration

```yaml
# data/household/apps/assistant/config.yml
telco:
  provider: telnyx                 # or 'twilio'

  telnyx:
    api_key_ref: TELNYX_API_KEY    # Reference to secret
    messaging_profile_id: "..."
    voice_connection_id: "..."
    primary_number: "+15551234567"
    webhook_url: "https://daylight.example.com/api/v1/assistant/webhook/telco"

  # Future
  twilio:
    account_sid_ref: TWILIO_ACCOUNT_SID
    auth_token_ref: TWILIO_AUTH_TOKEN
```

### Voice Processor Configuration

```yaml
# data/household/apps/assistant/config.yml
voice_processor:
  provider: openai_realtime        # or 'local'

  openai_realtime:
    api_key_ref: OPENAI_API_KEY
    model: gpt-4o-realtime-preview
    voice: alloy

  # Future
  local:
    stt:
      engine: whisper
      model: base.en
    tts:
      engine: piper
      voice: en_US-amy-medium
```

---

## Request Flows

### SMS Assistant Request

```
SMS arrives: "What's the capital of France?"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4_api: POST /api/v1/assistant/webhook/telco                     │
│                                                                 │
│ • telcoAdapter.parseWebhook(req) → SmsInboundEvent             │
│ • UserResolver.resolve('phone', event.from) → principal        │
│ • Call application layer                                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3_applications/assistant: AssistantOrchestrator                 │
│                                                                 │
│ • AI.parseIntent("What's the capital of France?")              │
│   → { capability: 'web-lookup', query: 'capital of France' }   │
│                                                                 │
│ • Gatekeeper.evaluate(principal, 'web-lookup', '*') → allow    │
│                                                                 │
│ • WebLookup.execute({ query }) → "Paris"                       │
│                                                                 │
│ • delivery.send({ text: "The capital of France is Paris." })   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2_adapters/telco: TelnyxAdapter                                 │
│                                                                 │
│ • sendSms(principal.phone, "The capital of France is Paris.")  │
│ • Telnyx API call                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Voice Conversation (Driving Mode)

```
Teen calls the assistant number
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Telnyx webhook: call.inbound                                    │
│                                                                 │
│ • telcoAdapter.parseWebhook() → CallInboundEvent               │
│ • Resolve principal from caller ID                              │
│ • Gatekeeper.evaluate(principal, 'voice-assistant', '*')       │
│ • If allowed: telcoAdapter.answerCall(callId)                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Start voice conversation                                        │
│                                                                 │
│ • voiceProcessor = openAIRealtimeAdapter.createSession({       │
│     systemPrompt: gatekeeperPolicy.systemPrompt                │
│   })                                                            │
│                                                                 │
│ • telcoAdapter.startVoiceConversation(callId, voiceProcessor)  │
│                                                                 │
│ • Telnyx connects media stream WebSocket                       │
│ • Audio flows: Phone ↔ Telnyx ↔ Adapter ↔ OpenAI Realtime     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Conversation loop (handled by OpenAI Realtime)                  │
│                                                                 │
│ • Teen speaks → STT → LLM → TTS → Audio to phone              │
│ • Gatekeeper policies embedded in system prompt                │
│ • Interruption (barge-in) handled automatically                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Call ends                                                       │
│                                                                 │
│ • Teen hangs up OR curfew triggers hangup                      │
│ • voiceProcessor.close()                                        │
│ • Audit log: conversation summary                               │
└─────────────────────────────────────────────────────────────────┘
```

### Audio Playback with DTMF Controls

```
Teen texts: "Play the latest Planet Money"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ AssistantOrchestrator                                           │
│                                                                 │
│ • Find podcast → { title, audioUrl, duration }                 │
│ • delivery.send({ text: "Calling you with Planet Money..." })  │
│ • delivery.requestCallback({ audio: audioStream })             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ TelnyxAdapter                                                   │
│                                                                 │
│ • initiateCall(teen.phone)                                     │
│ • On answer: streamAudio(callId, audioStream)                  │
│ • Listen for DTMF events                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
         Teen presses '1'  │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ TelnyxDTMFMapper (internal to adapter)                          │
│                                                                 │
│ • DTMF '1' → { type: 'rewind', seconds: 30 }                   │
│ • Emit PlaybackControlEvent                                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Application layer receives PlaybackAction                       │
│                                                                 │
│ • action.type === 'rewind'                                     │
│ • audioStream.seek(-30)                                         │
│ • Continue playback                                            │
│                                                                 │
│ (Application never knew it was DTMF key '1')                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: SMS + Audio Callback

**Goal:** Teen can text assistant, receive audio via callback.

**Adapter:**
- [ ] TelcoPort interface definition
- [ ] TelnyxAdapter: SMS send/receive
- [ ] TelnyxAdapter: Outbound call initiation
- [ ] TelnyxAdapter: Audio streaming to call
- [ ] TelnyxWebhookParser
- [ ] PlaybackControlPort interface
- [ ] TelnyxDTMFMapper

**Infrastructure:**
- [ ] Telnyx account setup (see runbook)
- [ ] 10DLC registration
- [ ] Webhook endpoint in API layer

**Integration:**
- [ ] Wire into assistant application
- [ ] Connect to gatekeeper for policy checks

### Phase 2: Voice Conversation

**Goal:** Real-time AI conversation over phone call.

**Adapter:**
- [ ] VoiceProcessorPort interface
- [ ] OpenAIRealtimeAdapter
- [ ] TelnyxAdapter: Media stream WebSocket handling
- [ ] TelnyxAdapter: startVoiceConversation()

**Integration:**
- [ ] Gatekeeper policy as system prompt
- [ ] Inbound call handling
- [ ] Curfew-based call termination

### Phase 3: Provider Abstraction

**Goal:** Support multiple providers.

- [ ] TwilioAdapter (if needed)
- [ ] Provider selection via config
- [ ] Consistent behavior across providers

### Phase 4: Local Voice Processing

**Goal:** Replace OpenAI Realtime with local processing.

- [ ] LocalVoiceAdapter (Whisper + Piper)
- [ ] Latency optimization
- [ ] Fallback strategy (local → cloud)

---

## Cost Considerations

### Telnyx Pricing (Estimated)

| Item | Cost |
|------|------|
| Phone number | $1/month |
| 10DLC campaign | $3/month |
| SMS outbound | $0.004/message |
| SMS inbound | $0.004/message |
| MMS outbound | $0.015/message |
| Voice outbound | $0.007/minute |
| Voice inbound | $0.0035/minute |

### OpenAI Realtime API Pricing

| Item | Cost |
|------|------|
| Audio input | $0.06/minute |
| Audio output | $0.24/minute |
| Text input | $5/1M tokens |
| Text output | $20/1M tokens |

**Example monthly cost (moderate use):**
- 500 SMS messages: $4
- 60 minutes voice calls (audio playback): $0.50
- 30 minutes AI conversation: ~$9
- **Total: ~$15/month**

---

## Security Considerations

### Webhook Validation

```javascript
// Telnyx webhook signature validation
function validateTelnyxWebhook(req) {
  const signature = req.headers['telnyx-signature-ed25519'];
  const timestamp = req.headers['telnyx-timestamp'];
  const payload = req.body;

  // Verify signature using Telnyx public key
  return telnyx.webhooks.verifySignature(payload, signature, timestamp);
}
```

### Principal Resolution

- Phone numbers are resolved to principals via UserResolver
- Unknown numbers are rejected (no anonymous access)
- Audit log includes all requests, successful or not

### Voice Conversation Safety

- System prompt includes content guardrails
- Gatekeeper policies enforced before call starts
- Curfew can terminate active calls
- All conversations can be summarized in audit log (not recorded)

---

## Testing Strategy

### Unit Tests

- TelnyxWebhookParser: Verify event normalization
- TelnyxDTMFMapper: Verify key → action mapping
- VoiceProcessorPort mock for conversation flow

### Integration Tests

- Webhook endpoint with mock payloads
- SMS round-trip with test number
- Call initiation with Telnyx test credentials

### Manual Testing

- Real device testing (flip phone)
- DTMF control verification
- Voice conversation quality

---

## Open Questions

1. **Call recording:** Should AI conversations be recorded for safety? Privacy implications?

2. **Multi-call handling:** Can teen have multiple calls? (Probably not on flip phone)

3. **Call transfer:** Should assistant be able to transfer to parent?

4. **Voicemail:** If assistant doesn't answer, what happens?

5. **Group MMS:** How to handle group messages? (Future, with Matrix relay)

---

## Related Documents

- [Gatekeeper Domain Design](./2026-01-30-gatekeeper-domain-design.md) - Policy engine
- Telnyx Setup Runbook (TODO) - Account and 10DLC setup
- Voice Assistant Design (TODO) - Home assistant integration

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-30 | Initial design from brainstorming session |
