# MIDI WebSocket Broadcaster Design Document

## Overview

This document describes the design for adding WebSocket broadcasting capabilities to the `auto_midi_recorder.py` script, enabling real-time MIDI events from a digital piano to be published to the DaylightStation message bus. This allows frontend applications (OfficeApp, a dedicated Piano Visualizer, etc.) to subscribe and display live piano activity.

## Current State

The `auto_midi_recorder.py` script:
- Connects to a MIDI input device (Digital Keyboard, Yamaha, etc.)
- Listens for MIDI messages in real-time via the `mido` library
- Records sessions to `.mid` files, splitting on silence timeouts (30s default)
- Handles message types: `note_on`, `note_off`, `control_change`, `program_change`, `pitchwheel`
- Runs as a standalone Python process, typically on the same machine as the keyboard

## Goals

1. **Real-time Broadcasting**: Publish MIDI events to DaylightStation's WebSocket message bus as they occur
2. **Minimal Latency**: Events should reach frontend within ~50ms of key press
3. **Non-blocking**: Broadcasting should not interfere with recording functionality
4. **Resilient**: Handle WebSocket disconnects gracefully without losing recording capability
5. **Configurable**: Allow enabling/disabling broadcasting, configuring server URL

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Digital Piano  │     │  MIDI Recorder  │     │  DaylightStation│     │  Frontend       │
│  (Yamaha, etc)  │────►│  (Python)       │────►│  Backend        │────►│  Apps           │
│                 │ USB │                 │ WS  │  (Node.js)      │ WS  │  (OfficeApp)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                              │ File I/O
                              ▼
                        ┌─────────────────┐
                        │  .mid Files     │
                        │  (Dropbox)      │
                        └─────────────────┘
```

## Message Format

### Topic: `midi`

All MIDI events will be published with `topic: 'midi'` for subscription filtering.

### Note Events

```json
{
  "topic": "midi",
  "source": "piano",
  "type": "note",
  "timestamp": "2024-01-15T10:30:00.123Z",
  "sessionId": "2024-01-15 10.30.00",
  "data": {
    "event": "note_on",
    "note": 60,
    "noteName": "C4",
    "velocity": 80,
    "channel": 0
  }
}
```

```json
{
  "topic": "midi",
  "source": "piano",
  "type": "note",
  "timestamp": "2024-01-15T10:30:00.456Z",
  "sessionId": "2024-01-15 10.30.00",
  "data": {
    "event": "note_off",
    "note": 60,
    "noteName": "C4",
    "velocity": 0,
    "channel": 0
  }
}
```

### Control Change Events

```json
{
  "topic": "midi",
  "source": "piano",
  "type": "control",
  "timestamp": "2024-01-15T10:30:01.000Z",
  "sessionId": "2024-01-15 10.30.00",
  "data": {
    "event": "control_change",
    "control": 64,
    "controlName": "sustain",
    "value": 127,
    "channel": 0
  }
}
```

### Session Events

```json
{
  "topic": "midi",
  "source": "piano",
  "type": "session",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "data": {
    "event": "session_start",
    "sessionId": "2024-01-15 10.30.00",
    "device": "Digital Keyboard"
  }
}
```

```json
{
  "topic": "midi",
  "source": "piano",
  "type": "session",
  "timestamp": "2024-01-15T10:35:00.000Z",
  "data": {
    "event": "session_end",
    "sessionId": "2024-01-15 10.30.00",
    "duration": 300,
    "noteCount": 1523,
    "filePath": "2024-01/2024-01-15 10.30.00.mid"
  }
}
```

## Implementation Plan

### Phase 1: WebSocket Client Module

Create a new class `MidiWebSocketBroadcaster` to handle WebSocket communication:

```python
class MidiWebSocketBroadcaster:
    """
    Async WebSocket client for broadcasting MIDI events to DaylightStation.
    Runs in a separate thread to avoid blocking MIDI processing.
    """

    def __init__(self, server_url, reconnect_interval=5):
        self.server_url = server_url  # e.g., "ws://localhost:3112/ws"
        self.reconnect_interval = reconnect_interval
        self.ws = None
        self.connected = False
        self.message_queue = queue.Queue()
        self.running = False
        self.thread = None

    def start(self):
        """Start the broadcaster thread."""
        pass

    def stop(self):
        """Stop the broadcaster and close connection."""
        pass

    def broadcast(self, message):
        """Queue a message for broadcasting (non-blocking)."""
        pass

    def _run(self):
        """Main thread loop: connect, send queued messages, reconnect on failure."""
        pass

    def _connect(self):
        """Establish WebSocket connection."""
        pass

    def _send_queued_messages(self):
        """Send all queued messages."""
        pass
```

### Phase 2: MIDI-to-JSON Conversion

Add helper functions to convert MIDI messages to JSON format:

```python
# Note name lookup (MIDI note number to name)
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def midi_note_to_name(note):
    """Convert MIDI note number (0-127) to note name (e.g., 'C4')."""
    octave = (note // 12) - 1
    name = NOTE_NAMES[note % 12]
    return f"{name}{octave}"

# Control change names
CONTROL_NAMES = {
    1: 'modulation',
    7: 'volume',
    10: 'pan',
    11: 'expression',
    64: 'sustain',
    65: 'portamento',
    66: 'sostenuto',
    67: 'soft_pedal',
    # ... etc
}

def midi_message_to_json(msg, session_id):
    """Convert a mido Message to a JSON-serializable dict."""
    base = {
        "topic": "midi",
        "source": "piano",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "sessionId": session_id
    }

    if msg.type in ['note_on', 'note_off']:
        # note_on with velocity 0 is equivalent to note_off
        event = 'note_off' if (msg.type == 'note_off' or msg.velocity == 0) else 'note_on'
        return {
            **base,
            "type": "note",
            "data": {
                "event": event,
                "note": msg.note,
                "noteName": midi_note_to_name(msg.note),
                "velocity": msg.velocity,
                "channel": msg.channel
            }
        }

    elif msg.type == 'control_change':
        return {
            **base,
            "type": "control",
            "data": {
                "event": "control_change",
                "control": msg.control,
                "controlName": CONTROL_NAMES.get(msg.control, f"cc{msg.control}"),
                "value": msg.value,
                "channel": msg.channel
            }
        }

    elif msg.type == 'pitchwheel':
        return {
            **base,
            "type": "control",
            "data": {
                "event": "pitchwheel",
                "pitch": msg.pitch,  # -8192 to 8191
                "channel": msg.channel
            }
        }

    elif msg.type == 'program_change':
        return {
            **base,
            "type": "control",
            "data": {
                "event": "program_change",
                "program": msg.program,
                "channel": msg.channel
            }
        }

    return None
```

### Phase 3: Integration with AutoMIDIRecorder

Modify `AutoMIDIRecorder.__init__()` to optionally create a broadcaster:

```python
def __init__(self, output_dir, silence_timeout=30, ws_url=None):
    # ... existing init code ...

    # WebSocket broadcaster (optional)
    self.broadcaster = None
    if ws_url:
        self.broadcaster = MidiWebSocketBroadcaster(ws_url)
        self.broadcaster.start()
        self.logger.info(f"WebSocket broadcasting enabled: {ws_url}")
```

Modify `process_midi_message()` to broadcast:

```python
def process_midi_message(self, msg):
    try:
        current_time = time.time()

        with self.session_lock:
            # Start new session if none exists
            if not self.current_session:
                self.start_new_session()
                # Broadcast session start
                if self.broadcaster:
                    self.broadcaster.broadcast({
                        "topic": "midi",
                        "source": "piano",
                        "type": "session",
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                        "data": {
                            "event": "session_start",
                            "sessionId": self.current_session.replace('.mid', ''),
                            "device": self._current_device_name
                        }
                    })

            # ... existing message processing ...

            # Broadcast MIDI event
            if self.broadcaster:
                session_id = self.current_session.replace('.mid', '') if self.current_session else None
                json_msg = midi_message_to_json(msg, session_id)
                if json_msg:
                    self.broadcaster.broadcast(json_msg)

            # ... rest of method ...
```

Modify `_save_current_session()` to broadcast session end:

```python
def _save_current_session(self):
    if not self.session_messages or not self.current_session:
        return

    try:
        # ... existing save code ...

        # Broadcast session end
        if self.broadcaster:
            self.broadcaster.broadcast({
                "topic": "midi",
                "source": "piano",
                "type": "session",
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "data": {
                    "event": "session_end",
                    "sessionId": self.current_session.replace('.mid', ''),
                    "duration": time.time() - self._session_start_time,
                    "noteCount": len(self.session_messages),
                    "filePath": os.path.relpath(self.current_session_path, self.base_output_dir)
                }
            })
    except Exception as e:
        # ... existing error handling ...
```

### Phase 4: Configuration

Add environment variable and command-line support:

```python
def main():
    # Configuration
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.dirname(script_dir)
    silence_timeout = int(os.environ.get('MIDI_SILENCE_TIMEOUT', 30))

    # WebSocket configuration
    ws_enabled = os.environ.get('MIDI_WS_ENABLED', 'false').lower() == 'true'
    ws_host = os.environ.get('DAYLIGHT_HOST', 'localhost')
    ws_port = os.environ.get('DAYLIGHT_PORT', '3112')
    ws_url = f"ws://{ws_host}:{ws_port}/ws" if ws_enabled else None

    # Create recorder
    recorder = AutoMIDIRecorder(output_dir, silence_timeout, ws_url=ws_url)

    # ... rest of main ...
```

## Backend Changes

### Update WebSocket Router

Add handling for `midi` source in `backend/routers/websocket.mjs`:

```javascript
ws.on('message', (message) => {
  const data = JSON.parse(message.toString());

  // ... existing handlers ...

  // Handle MIDI events from piano recorder
  if (data.source === 'piano' && data.topic === 'midi') {
    broadcastToWebsockets({
      topic: 'midi',
      ...data
    });
    logger.debug('Broadcasted MIDI event', { type: data.type });
  }
});
```

### Add Topic to OfficeApp (Optional)

If OfficeApp should receive MIDI events, add `'midi'` to the topic list in `WebSocketContext.jsx`:

```javascript
const OFFICE_TOPICS = ['playback', 'menu', 'system', 'gratitude', 'legacy', 'midi'];
```

Or create a dedicated MIDI visualizer that subscribes specifically to `'midi'`.

## Frontend Consumption

### React Hook Example

```javascript
import { useWebSocketSubscription } from '../hooks/useWebSocket';

function PianoVisualizer() {
  const [activeNotes, setActiveNotes] = useState(new Set());
  const [sessionInfo, setSessionInfo] = useState(null);

  useWebSocketSubscription('midi', (data) => {
    if (data.type === 'note') {
      setActiveNotes(prev => {
        const next = new Set(prev);
        if (data.data.event === 'note_on') {
          next.add(data.data.note);
        } else {
          next.delete(data.data.note);
        }
        return next;
      });
    } else if (data.type === 'session') {
      setSessionInfo(data.data);
    }
  }, []);

  return (
    <div className="piano-visualizer">
      <PianoKeyboard activeNotes={activeNotes} />
      {sessionInfo && <SessionStatus info={sessionInfo} />}
    </div>
  );
}
```

### Visualization Ideas

1. **Piano Keyboard**: Visual piano with keys lighting up on press
2. **Note Waterfall**: Notes falling down like Guitar Hero/Synthesia
3. **Waveform Display**: Audio visualization synced with MIDI
4. **Session Stats**: Note count, duration, tempo detection
5. **OfficeApp Integration**: Show "Now Playing: Piano" with visual feedback

## Dependencies

### Python (Recorder)

Add to requirements or install:

```
websocket-client>=1.6.0
```

Or use the built-in `websockets` library with asyncio.

### Recommended: `websockets` (async)

```python
import asyncio
import websockets
import json
from queue import Queue
from threading import Thread

class MidiWebSocketBroadcaster:
    def __init__(self, server_url):
        self.server_url = server_url
        self.queue = Queue()
        self.running = False
        self.loop = None
        self.thread = None

    def start(self):
        self.running = True
        self.thread = Thread(target=self._run_event_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if self.loop:
            self.loop.call_soon_threadsafe(self.loop.stop)

    def broadcast(self, message):
        """Non-blocking: queue message for async sending."""
        if self.running:
            self.queue.put(message)

    def _run_event_loop(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self._async_main())

    async def _async_main(self):
        while self.running:
            try:
                async with websockets.connect(self.server_url) as ws:
                    logging.info(f"Connected to {self.server_url}")
                    while self.running:
                        # Non-blocking check for queued messages
                        while not self.queue.empty():
                            msg = self.queue.get_nowait()
                            await ws.send(json.dumps(msg))
                        await asyncio.sleep(0.01)  # 10ms poll interval
            except Exception as e:
                logging.warning(f"WebSocket error: {e}, reconnecting in 5s...")
                await asyncio.sleep(5)
```

## Error Handling

### Connection Failures

- Queue messages during disconnect (with max queue size)
- Reconnect with exponential backoff (5s, 10s, 20s, max 60s)
- Log warnings but don't crash the recorder

### Message Failures

- Log and skip individual message failures
- Don't block MIDI processing for WebSocket issues

### Graceful Shutdown

- Flush remaining queued messages on shutdown
- Close WebSocket cleanly
- Existing signal handlers should call `broadcaster.stop()`

## Testing

### Unit Tests

1. Test MIDI-to-JSON conversion for all message types
2. Test note name conversion (edge cases: 0, 127, middle C)
3. Test queue behavior during disconnect

### Integration Tests

1. Start recorder with mock WebSocket server
2. Send MIDI messages, verify JSON format
3. Simulate disconnect/reconnect

### Manual Testing

```bash
# Terminal 1: Start DaylightStation backend
cd backend && npm start

# Terminal 2: Start MIDI recorder with WebSocket
cd ~/Dropbox/Personal/Music/Sessions/_recorder
MIDI_WS_ENABLED=true DAYLIGHT_HOST=localhost python3 auto_midi_recorder.py

# Terminal 3: Monitor WebSocket messages
websocat ws://localhost:3112/ws
# Then type: {"type":"bus_command","action":"subscribe","topics":["midi"]}
```

## Rollout Plan

1. **Phase 1**: Implement `MidiWebSocketBroadcaster` class with queue and reconnect logic
2. **Phase 2**: Add MIDI-to-JSON conversion helpers
3. **Phase 3**: Integrate with `AutoMIDIRecorder`, gated by environment variable
4. **Phase 4**: Update backend to handle `midi` topic routing
5. **Phase 5**: Create frontend piano visualizer component
6. **Phase 6**: Test end-to-end with real piano

## Future Enhancements

1. **Chord Detection**: Analyze simultaneous notes and broadcast chord names
2. **Tempo Detection**: Calculate and broadcast estimated BPM
3. **MIDI File Playback**: Option to replay recorded sessions through WebSocket
4. **Multi-Device Support**: Tag messages with device ID for multiple keyboards
5. **Latency Optimization**: Use UDP for lowest latency (separate from reliable WS)

---

# Detailed Technical Implementation Plan

This section provides a comprehensive, phased implementation guide with specific file changes, code snippets, acceptance criteria, and dependency ordering.

## Implementation Overview

| Phase | Component | Files Affected | Dependencies |
|-------|-----------|----------------|--------------|
| 1 | WebSocket Broadcaster Module | 1 new Python file | None |
| 2 | MIDI-to-JSON Conversion | Same file or separate module | Phase 1 |
| 3 | AutoMIDIRecorder Integration | 1 existing Python file | Phase 1, 2 |
| 4 | Configuration & CLI | Same file as Phase 3 | Phase 3 |
| 5 | Backend WebSocket Router | 1 existing JS file | Phase 4 |
| 6 | Frontend Piano Visualizer | 3-5 new React files | Phase 5 |
| 7 | Testing & Documentation | Test files + docs | All phases |

---

## Phase 1: WebSocket Broadcaster Module

### Objective
Create a standalone, thread-safe WebSocket client module that can broadcast messages without blocking the main MIDI processing loop.

### New File: `_recorder/midi_ws_broadcaster.py`

#### Class Structure

```python
"""
MIDI WebSocket Broadcaster Module

A thread-safe, async WebSocket client for broadcasting MIDI events
to the DaylightStation message bus. Designed for non-blocking operation
with automatic reconnection and message queuing.
"""

import asyncio
import json
import logging
import time
from queue import Queue, Empty
from threading import Thread, Event
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class MidiWebSocketBroadcaster:
    """
    Async WebSocket client for broadcasting MIDI events to DaylightStation.

    Features:
    - Runs in a dedicated daemon thread (non-blocking)
    - Automatic reconnection with exponential backoff
    - Message queue with configurable max size
    - Graceful shutdown with message flush
    - Connection state tracking for monitoring
    """

    # Configuration constants
    DEFAULT_RECONNECT_BASE = 5      # Base reconnect interval (seconds)
    DEFAULT_RECONNECT_MAX = 60      # Maximum reconnect interval (seconds)
    DEFAULT_QUEUE_MAX_SIZE = 1000   # Max queued messages during disconnect
    DEFAULT_POLL_INTERVAL = 0.01    # Queue poll interval (seconds)
    DEFAULT_FLUSH_TIMEOUT = 2.0     # Timeout for flushing on shutdown

    def __init__(
        self,
        server_url: str,
        reconnect_base: float = DEFAULT_RECONNECT_BASE,
        reconnect_max: float = DEFAULT_RECONNECT_MAX,
        max_queue_size: int = DEFAULT_QUEUE_MAX_SIZE
    ):
        self.server_url = server_url
        self.reconnect_base = reconnect_base
        self.reconnect_max = reconnect_max
        self.max_queue_size = max_queue_size

        # Internal state
        self._queue: Queue = Queue(maxsize=max_queue_size)
        self._running: bool = False
        self._connected: bool = False
        self._stop_event: Event = Event()
        self._thread: Optional[Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        # Statistics
        self._stats = {
            'messages_sent': 0,
            'messages_dropped': 0,
            'reconnect_count': 0,
            'last_connected': None,
            'last_error': None
        }

    @property
    def is_running(self) -> bool:
        """Check if broadcaster thread is running."""
        return self._running and self._thread is not None and self._thread.is_alive()

    @property
    def is_connected(self) -> bool:
        """Check if WebSocket is currently connected."""
        return self._connected

    @property
    def stats(self) -> Dict[str, Any]:
        """Get broadcaster statistics."""
        return {
            **self._stats,
            'queue_size': self._queue.qsize(),
            'is_running': self.is_running,
            'is_connected': self.is_connected
        }

    def start(self) -> bool:
        """Start the broadcaster thread. Returns True if started successfully."""
        if self.is_running:
            logger.warning("Broadcaster already running")
            return False

        self._running = True
        self._stop_event.clear()
        self._thread = Thread(
            target=self._run_event_loop,
            daemon=True,
            name="MidiWSBroadcaster"
        )
        self._thread.start()
        logger.info(f"MIDI WebSocket Broadcaster started: {self.server_url}")
        return True

    def stop(self, flush: bool = True) -> None:
        """Stop the broadcaster. If flush=True, attempt to send queued messages."""
        if not self._running:
            return

        logger.info("Stopping MIDI WebSocket Broadcaster...")
        self._running = False
        self._stop_event.set()

        if self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(self._loop.stop)

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=self.DEFAULT_FLUSH_TIMEOUT if flush else 0.5)

        self._thread = None
        self._connected = False
        logger.info("MIDI WebSocket Broadcaster stopped")

    def broadcast(self, message: Dict[str, Any]) -> bool:
        """Queue a message for broadcasting (non-blocking). Returns True if queued."""
        if not self._running:
            return False

        try:
            self._queue.put_nowait(message)
            return True
        except Exception:
            self._stats['messages_dropped'] += 1
            logger.warning(f"Message dropped: queue full ({self.max_queue_size})")
            return False

    def _run_event_loop(self) -> None:
        """Run the asyncio event loop in the dedicated thread."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)

        try:
            self._loop.run_until_complete(self._async_main())
        except Exception as e:
            logger.error(f"Event loop error: {e}")
        finally:
            self._loop.close()
            self._loop = None

    async def _async_main(self) -> None:
        """Main async loop: connect, send messages, handle reconnection."""
        try:
            import websockets
        except ImportError:
            logger.error("websockets package not installed. Run: pip install websockets")
            return

        reconnect_delay = self.reconnect_base

        while self._running and not self._stop_event.is_set():
            try:
                async with websockets.connect(
                    self.server_url,
                    ping_interval=20,
                    ping_timeout=10,
                    close_timeout=5
                ) as ws:
                    self._connected = True
                    self._stats['last_connected'] = time.time()
                    reconnect_delay = self.reconnect_base

                    logger.info(f"Connected to WebSocket: {self.server_url}")

                    while self._running and not self._stop_event.is_set():
                        await self._send_queued_messages(ws)
                        await asyncio.sleep(self.DEFAULT_POLL_INTERVAL)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self._connected = False
                self._stats['last_error'] = str(e)
                self._stats['reconnect_count'] += 1

                logger.warning(
                    f"WebSocket error: {e}. Reconnecting in {reconnect_delay}s..."
                )

                # Interruptible wait
                await asyncio.sleep(min(reconnect_delay, 1))
                if self._stop_event.is_set():
                    break

                reconnect_delay = min(reconnect_delay * 2, self.reconnect_max)

        self._connected = False

    async def _send_queued_messages(self, ws) -> None:
        """Send all currently queued messages."""
        messages_sent = 0
        max_batch = 50

        while messages_sent < max_batch:
            try:
                message = self._queue.get_nowait()
                await ws.send(json.dumps(message))
                self._stats['messages_sent'] += 1
                messages_sent += 1
            except Empty:
                break
            except Exception as e:
                logger.error(f"Failed to send message: {e}")
                self._stats['messages_dropped'] += 1
                break
```

### Acceptance Criteria - Phase 1

| Criterion | Test Method |
|-----------|-------------|
| Thread Safety | Multiple threads call `broadcast()` simultaneously |
| Non-blocking | `broadcast()` returns in < 1ms |
| Reconnection | Auto-reconnects with 5s → 10s → 20s → 60s backoff |
| Queue Limits | Messages dropped when queue > 1000 items |
| Graceful Shutdown | `stop()` completes in < 2 seconds |
| Statistics | `stats` returns queue size, counts, connection state |

### Dependencies
```
websockets>=10.0
```

---

## Phase 2: MIDI-to-JSON Conversion

### Objective
Create helper functions for converting `mido` MIDI messages to the JSON message format.

### New File: `_recorder/midi_message_converter.py`

```python
"""
MIDI Message Converter Module

Converts mido MIDI messages to JSON format for WebSocket broadcasting.
"""

from datetime import datetime, timezone
from typing import Dict, Any, Optional

# MIDI note names
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# Standard MIDI CC names
CONTROL_NAMES = {
    1: 'modulation',
    7: 'volume',
    10: 'pan',
    11: 'expression',
    64: 'sustain',
    65: 'portamento',
    66: 'sostenuto',
    67: 'soft_pedal',
    91: 'reverb',
    93: 'chorus',
}


def midi_note_to_name(note: int) -> str:
    """Convert MIDI note number (0-127) to name (e.g., 'C4')."""
    if not 0 <= note <= 127:
        return f"Note{note}"
    octave = (note // 12) - 1
    return f"{NOTE_NAMES[note % 12]}{octave}"


def get_control_name(control: int) -> str:
    """Get human-readable name for MIDI CC number."""
    return CONTROL_NAMES.get(control, f"cc{control}")


def get_timestamp() -> str:
    """Get current UTC timestamp in ISO 8601 format."""
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def midi_message_to_json(msg, session_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Convert a mido Message to a JSON-serializable dictionary.

    Args:
        msg: A mido Message object
        session_id: Current session identifier

    Returns:
        JSON-serializable dict or None if unsupported message type
    """
    base = {
        "topic": "midi",
        "source": "piano",
        "timestamp": get_timestamp(),
        "sessionId": session_id
    }

    if msg.type in ('note_on', 'note_off'):
        event = 'note_off' if (msg.type == 'note_off' or msg.velocity == 0) else 'note_on'
        return {
            **base,
            "type": "note",
            "data": {
                "event": event,
                "note": msg.note,
                "noteName": midi_note_to_name(msg.note),
                "velocity": msg.velocity,
                "channel": msg.channel
            }
        }

    elif msg.type == 'control_change':
        return {
            **base,
            "type": "control",
            "data": {
                "event": "control_change",
                "control": msg.control,
                "controlName": get_control_name(msg.control),
                "value": msg.value,
                "channel": msg.channel
            }
        }

    elif msg.type == 'pitchwheel':
        return {
            **base,
            "type": "control",
            "data": {
                "event": "pitchwheel",
                "pitch": msg.pitch,
                "channel": msg.channel
            }
        }

    elif msg.type == 'program_change':
        return {
            **base,
            "type": "control",
            "data": {
                "event": "program_change",
                "program": msg.program,
                "channel": msg.channel
            }
        }

    return None


def create_session_start_message(session_id: str, device_name: str) -> Dict[str, Any]:
    """Create a session start message."""
    return {
        "topic": "midi",
        "source": "piano",
        "type": "session",
        "timestamp": get_timestamp(),
        "sessionId": session_id,
        "data": {
            "event": "session_start",
            "sessionId": session_id,
            "device": device_name
        }
    }


def create_session_end_message(
    session_id: str,
    duration: float,
    note_count: int,
    file_path: Optional[str] = None
) -> Dict[str, Any]:
    """Create a session end message."""
    return {
        "topic": "midi",
        "source": "piano",
        "type": "session",
        "timestamp": get_timestamp(),
        "sessionId": session_id,
        "data": {
            "event": "session_end",
            "sessionId": session_id,
            "duration": round(duration, 2),
            "noteCount": note_count,
            "filePath": file_path
        }
    }
```

### Acceptance Criteria - Phase 2

| Criterion | Test |
|-----------|------|
| Note naming | `midi_note_to_name(60)` → `"C4"` |
| Note naming edge | `midi_note_to_name(0)` → `"C-1"`, `midi_note_to_name(127)` → `"G9"` |
| Velocity 0 handling | `note_on` with velocity 0 → `note_off` event |
| Control names | `get_control_name(64)` → `"sustain"` |
| Unknown controls | `get_control_name(42)` → `"cc42"` |
| All message types | `note_on`, `note_off`, `control_change`, `pitchwheel`, `program_change` |

---

## Phase 3: AutoMIDIRecorder Integration

### Objective
Integrate the WebSocket broadcaster into the existing recorder without disrupting core functionality.

### File to Modify: `_recorder/auto_midi_recorder.py`

### Change 1: Add Imports

```python
# Add after existing imports
from midi_ws_broadcaster import MidiWebSocketBroadcaster
from midi_message_converter import (
    midi_message_to_json,
    create_session_start_message,
    create_session_end_message
)
```

### Change 2: Modify `__init__` Method

```python
def __init__(self, output_dir, silence_timeout=30, ws_url=None):
    # ... existing initialization ...

    # WebSocket broadcaster (optional)
    self.broadcaster = None
    self._current_device_name = None

    if ws_url:
        try:
            self.broadcaster = MidiWebSocketBroadcaster(ws_url)
            self.broadcaster.start()
            self.logger.info(f"WebSocket broadcasting enabled: {ws_url}")
        except Exception as e:
            self.logger.error(f"Failed to start broadcaster: {e}")
            self.broadcaster = None
```

### Change 3: Modify `process_midi_message` Method

Add broadcasting calls at strategic points:

```python
def process_midi_message(self, msg):
    try:
        current_time = time.time()

        with self.session_lock:
            # Start new session if needed
            if not self.current_session:
                self.start_new_session()

                # Broadcast session start
                if self.broadcaster:
                    session_id = self.current_session.replace('.mid', '')
                    self.broadcaster.broadcast(
                        create_session_start_message(
                            session_id,
                            self._current_device_name or "Unknown"
                        )
                    )

            # ... existing message processing ...

            # Broadcast MIDI event
            if self.broadcaster:
                session_id = self.current_session.replace('.mid', '') if self.current_session else None
                json_msg = midi_message_to_json(msg, session_id)
                if json_msg:
                    self.broadcaster.broadcast(json_msg)

    except Exception as e:
        self.logger.error(f"Error processing message: {e}")
```

### Change 4: Modify `_save_current_session` Method

```python
def _save_current_session(self):
    if not self.session_messages or not self.current_session:
        return

    try:
        # ... existing save logic ...

        # Broadcast session end
        if self.broadcaster:
            session_id = self.current_session.replace('.mid', '')
            duration = time.time() - self._session_start_time
            note_count = sum(1 for m in self.session_messages
                           if m.type in ('note_on', 'note_off'))

            self.broadcaster.broadcast(
                create_session_end_message(
                    session_id=session_id,
                    duration=duration,
                    note_count=note_count,
                    file_path=os.path.relpath(
                        self.current_session_path,
                        self.base_output_dir
                    )
                )
            )

    except Exception as e:
        self.logger.error(f"Error saving session: {e}")
```

### Change 5: Modify Shutdown Handler

```python
def _handle_shutdown(self, signum, frame):
    self.logger.info("Shutdown signal received...")

    # ... existing shutdown logic ...

    # Stop broadcaster
    if self.broadcaster:
        self.broadcaster.stop(flush=True)
```

### Acceptance Criteria - Phase 3

| Criterion | Test |
|-----------|------|
| Backward compatible | Works without `ws_url` parameter |
| Non-blocking | Broadcasting doesn't delay recording |
| Session events | `session_start` and `session_end` broadcast correctly |
| All MIDI events | All supported types broadcast |
| Error isolation | WS failures don't affect recording |

---

## Phase 4: Configuration & CLI

### Objective
Add environment variable and command-line argument support.

### File to Modify: `_recorder/auto_midi_recorder.py` (main function)

```python
import argparse

def main():
    parser = argparse.ArgumentParser(
        description='Auto MIDI Recorder with WebSocket Broadcasting'
    )
    parser.add_argument('--ws-url', help='WebSocket URL for broadcasting')
    parser.add_argument('--ws-enabled', action='store_true',
                       help='Enable WS using DAYLIGHT_HOST/PORT env vars')
    parser.add_argument('--silence-timeout', type=int, default=30,
                       help='Silence timeout in seconds (default: 30)')
    parser.add_argument('--output-dir', help='Output directory for MIDI files')
    args = parser.parse_args()

    # Configuration
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = args.output_dir or os.path.dirname(script_dir)
    silence_timeout = int(os.environ.get('MIDI_SILENCE_TIMEOUT', args.silence_timeout))

    # WebSocket URL resolution
    ws_url = None
    if args.ws_url:
        ws_url = args.ws_url
    elif args.ws_enabled or os.environ.get('MIDI_WS_ENABLED', '').lower() == 'true':
        host = os.environ.get('DAYLIGHT_HOST', 'localhost')
        port = os.environ.get('DAYLIGHT_PORT', '3112')
        ws_url = f"ws://{host}:{port}/ws"

    logging.info(f"WebSocket: {ws_url or 'disabled'}")

    recorder = AutoMIDIRecorder(output_dir, silence_timeout, ws_url=ws_url)
    # ... rest of main ...
```

### Configuration Priority (Highest to Lowest)

1. `--ws-url` CLI argument
2. `--ws-enabled` CLI flag + `DAYLIGHT_HOST`/`DAYLIGHT_PORT` env vars
3. `MIDI_WS_ENABLED=true` env var + `DAYLIGHT_HOST`/`DAYLIGHT_PORT` env vars

### Usage Examples

```bash
# Explicit URL
python3 auto_midi_recorder.py --ws-url ws://192.168.1.5:3112/ws

# Environment variables
MIDI_WS_ENABLED=true DAYLIGHT_HOST=localhost python3 auto_midi_recorder.py

# Disabled (default)
python3 auto_midi_recorder.py
```

---

## Phase 5: Backend WebSocket Router

### Objective
Update DaylightStation backend to route MIDI messages to subscribers.

### File to Modify: `backend/routers/websocket.mjs`

### Add MIDI Handler

```javascript
// Inside ws.on('message', ...) handler

// Handle MIDI events from piano recorder
if (data.source === 'piano' && data.topic === 'midi') {
  if (!data.type || !data.timestamp) {
    logger.warn('Invalid MIDI message: missing fields', { data });
    return;
  }

  broadcastToWebsockets({
    topic: 'midi',
    source: data.source,
    type: data.type,
    timestamp: data.timestamp,
    sessionId: data.sessionId,
    data: data.data
  });

  logger.debug('Broadcasted MIDI event', {
    type: data.type,
    event: data.data?.event
  });
  return;
}
```

### Add Topic to Allowed List (if applicable)

```javascript
const ALLOWED_TOPICS = [
  'playback', 'menu', 'system', 'gratitude', 'legacy',
  'midi'  // Add this
];
```

---

## Phase 6: Frontend Piano Visualizer

### Objective
Create React components for real-time piano visualization.

### Directory Structure

```
frontend/src/modules/Piano/
├── index.js
├── PianoVisualizer.jsx
├── PianoVisualizer.scss
├── components/
│   ├── PianoKeyboard.jsx
│   ├── PianoKeyboard.scss
│   └── SessionStatus.jsx
└── hooks/
    └── useMidiSubscription.js
```

### Key Component: `useMidiSubscription.js`

```javascript
import { useState, useCallback } from 'react';
import { useWebSocketSubscription } from '../../../hooks/useWebSocket';

export function useMidiSubscription() {
  const [activeNotes, setActiveNotes] = useState(new Map());
  const [sustainPedal, setSustainPedal] = useState(false);
  const [sessionInfo, setSessionInfo] = useState(null);

  const handleMidiMessage = useCallback((data) => {
    const { type, data: eventData } = data;

    if (type === 'note') {
      const { event, note, velocity } = eventData;
      setActiveNotes(prev => {
        const next = new Map(prev);
        if (event === 'note_on' && velocity > 0) {
          next.set(note, { velocity, timestamp: Date.now() });
        } else {
          next.delete(note);
        }
        return next;
      });
    }

    if (type === 'control' && eventData.controlName === 'sustain') {
      setSustainPedal(eventData.value >= 64);
    }

    if (type === 'session') {
      setSessionInfo(eventData);
      if (eventData.event === 'session_start') {
        setActiveNotes(new Map());
      }
    }
  }, []);

  useWebSocketSubscription('midi', handleMidiMessage, [handleMidiMessage]);

  return { activeNotes, sustainPedal, sessionInfo, isPlaying: activeNotes.size > 0 };
}
```

### Key Component: `PianoKeyboard.jsx`

```jsx
import React, { useMemo } from 'react';
import './PianoKeyboard.scss';

const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11];
const isWhiteKey = (note) => WHITE_KEYS.includes(note % 12);

export function PianoKeyboard({ activeNotes = new Map(), startNote = 21, endNote = 108 }) {
  const keys = useMemo(() => {
    const result = [];
    for (let note = startNote; note <= endNote; note++) {
      const isActive = activeNotes.has(note);
      const velocity = activeNotes.get(note)?.velocity || 0;

      result.push(
        <div
          key={note}
          className={`key ${isWhiteKey(note) ? 'white' : 'black'} ${isActive ? 'active' : ''}`}
          style={{ '--velocity': velocity / 127 }}
          data-note={note}
        />
      );
    }
    return result;
  }, [activeNotes, startNote, endNote]);

  return <div className="piano-keyboard">{keys}</div>;
}
```

---

## Phase 7: Testing & Documentation

### Unit Test Coverage Requirements

| Module | Target Coverage |
|--------|-----------------|
| `midi_ws_broadcaster.py` | 90% |
| `midi_message_converter.py` | 95% |
| `auto_midi_recorder.py` (new code) | 85% |
| Frontend components | 80% |

### Integration Test: End-to-End Flow

```python
# test_integration.py
import pytest
import asyncio
import json
import websockets

@pytest.mark.asyncio
async def test_midi_broadcast_flow():
    """Test: MIDI in → JSON → WebSocket → Frontend"""
    received = []

    async def client():
        async with websockets.connect("ws://localhost:3112/ws") as ws:
            await ws.send(json.dumps({
                "type": "bus_command",
                "action": "subscribe",
                "topics": ["midi"]
            }))
            msg = await asyncio.wait_for(ws.recv(), timeout=5)
            received.append(json.loads(msg))

    # Start client, trigger MIDI, verify receipt
    # ... implementation details ...

    assert len(received) > 0
    assert received[0]['topic'] == 'midi'
```

### Manual Test Checklist

- [ ] Start backend on localhost:3112
- [ ] Start recorder with `MIDI_WS_ENABLED=true`
- [ ] Verify "WebSocket broadcasting enabled" in logs
- [ ] Play notes on keyboard
- [ ] Verify `session_start` in backend logs
- [ ] Verify note events in backend logs
- [ ] Open frontend visualizer
- [ ] Verify keys light up in real-time
- [ ] Test sustain pedal behavior
- [ ] Stop playing, wait for timeout
- [ ] Verify `session_end` with correct note count

---

## Dependency Graph

```
Phase 7: Testing & Documentation
            │
    ┌───────┴───────┐
    │               │
Phase 6          Phase 5
Frontend         Backend
    │               │
    └───────┬───────┘
            │
        Phase 4
     Configuration
            │
        Phase 3
      Integration
            │
    ┌───────┴───────┐
    │               │
Phase 1          Phase 2
Broadcaster      Converter
```

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Recording interrupted by WS | Queue + separate thread isolates failures |
| High latency | Queue limits + message dropping |
| Memory leaks | Daemon threads + explicit cleanup |
| Frontend performance | React.memo + debounced renders |

## Success Metrics

| Metric | Target |
|--------|--------|
| Latency (key → visual) | < 50ms |
| Recording reliability | 100% (no WS-caused failures) |
| Reconnection time | < 5s |
| Memory overhead | < 10MB |
| CPU overhead | < 5% during play |
