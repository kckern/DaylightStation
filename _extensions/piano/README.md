# Piano Extension

Real-time MIDI recording and visualization for DaylightStation.

## Components

```
_extentions/piano/
├── recorder/           # Python MIDI recorder (runs on piano's computer)
│   ├── auto_midi_recorder.py
│   ├── midi_ws_broadcaster.py
│   ├── midi_message_converter.py
│   ├── config.example.yml
│   ├── requirements.txt
│   ├── install.sh
│   └── com.user.midirecorder.plist.example
├── simulation.mjs      # MIDI simulator for testing
└── package.json
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Digital Piano  │────▶│  MIDI Recorder  │────▶│  DaylightStation│────▶│  Piano          │
│  (USB MIDI)     │     │  (Python)       │ WS  │  Backend        │ WS  │  Visualizer     │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  .mid Files     │
                        │  (local storage)│
                        └─────────────────┘
```

---

## MIDI Recorder Installation

The recorder runs on the computer connected to your MIDI keyboard.

### Prerequisites

- Python 3.8+
- USB MIDI keyboard
- Network access to DaylightStation backend

### Quick Start

```bash
# Clone or copy the recorder folder to your piano's computer
cd /path/to/your/music/sessions/_recorder

# Copy files from this repo
cp -r _extentions/piano/recorder/* .

# Run install script
chmod +x install.sh
./install.sh

# Edit config
nano config.yml
# Set websocket.host to your DaylightStation IP

# Start recording
source .venv/bin/activate
python3 auto_midi_recorder.py
```

### Manual Installation

```bash
# Create directory for recordings
mkdir -p ~/Music/Sessions/_recorder
cd ~/Music/Sessions/_recorder

# Copy recorder files
cp auto_midi_recorder.py midi_ws_broadcaster.py midi_message_converter.py .
cp config.example.yml config.yml

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install mido python-rtmidi websockets PyYAML

# Edit config
nano config.yml
```

### Configuration

Edit `config.yml`:

```yaml
# Recording settings
silence_timeout: 30  # End session after 30s of silence

# WebSocket broadcasting
websocket:
  enabled: true
  host: 10.0.0.10    # Your DaylightStation IP
  port: 3112
  path: /ws
```

### Running as a Service (macOS)

To auto-start the recorder on login:

```bash
# Copy and edit the plist template
cp com.user.midirecorder.plist.example ~/Library/LaunchAgents/com.user.midirecorder.plist

# Edit paths in the plist
nano ~/Library/LaunchAgents/com.user.midirecorder.plist

# Load the service
launchctl load ~/Library/LaunchAgents/com.user.midirecorder.plist

# Check status
launchctl list | grep midirecorder

# View logs
tail -f midi_recorder_stdout.log
```

### Running as a Service (Linux/systemd)

Create `/etc/systemd/user/midi-recorder.service`:

```ini
[Unit]
Description=MIDI Recorder
After=network.target sound.target

[Service]
Type=simple
WorkingDirectory=/path/to/recorder
ExecStart=/path/to/recorder/.venv/bin/python3 auto_midi_recorder.py
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Then:
```bash
systemctl --user enable midi-recorder
systemctl --user start midi-recorder
```

---

## MIDI Simulator

For testing the Piano Visualizer without a real keyboard.

### Setup

```bash
cd _extentions/piano
npm install
```

### Usage

```bash
# Interactive mode
npm run sim

# Auto-play demo sequence
npm run demo

# Random notes (Ctrl+C to stop)
npm run random

# Custom DaylightStation host
node simulation.mjs --host 10.0.0.10
```

### Interactive Commands

| Command | Action |
|---------|--------|
| `s` | Start session |
| `e` | End session |
| `60` | Play note by MIDI number (60 = C4) |
| `c4`, `d#5` | Play note by name |
| `chord` | Play C major chord |
| `sus on` | Sustain pedal on |
| `sus off` | Sustain pedal off |
| `scale` | Play C major scale |
| `melody` | Play "Mary Had a Little Lamb" |
| `chords` | Play C-G-Am-F progression |
| `q` | Quit |

Sample command: `node simulation.mjs --host localhost  melody`

---

## Frontend Integration

The Piano Visualizer is automatically shown in OfficeApp when:
- MIDI events are received
- No media player is currently active

It auto-dismisses 2 seconds after a session ends.

### Manual Integration

To add the visualizer to other apps:

```jsx
import { PianoVisualizer, useMidiSubscription } from '../modules/Piano';

function MyComponent() {
  const { activeNotes, sustainPedal, sessionInfo, isPlaying } = useMidiSubscription();

  if (isPlaying) {
    return <PianoVisualizer onSessionEnd={() => console.log('Done')} />;
  }

  return <NormalContent />;
}
```

---

## WebSocket Message Format

### Topic: `midi`

Subscribe with:
```json
{"type": "bus_command", "action": "subscribe", "topics": ["midi"]}
```

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

### Control Events

```json
{
  "topic": "midi",
  "source": "piano",
  "type": "control",
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
  "data": {
    "event": "session_end",
    "sessionId": "2024-01-15 10.30.00",
    "duration": 300.5,
    "noteCount": 1523,
    "filePath": "2024-01/2024-01-15 10.30.00.mid"
  }
}
```

---

## Troubleshooting

### No MIDI device found

```bash
# List MIDI devices (macOS)
python3 -c "import mido; print(mido.get_input_names())"

# Common issues:
# - Keyboard not powered on
# - USB cable not connected
# - Need to install python-rtmidi backend
```

### WebSocket not connecting

```bash
# Test connectivity
curl http://YOUR_HOST:3112/health

# Check recorder logs
tail -f midi_recorder.log

# Common issues:
# - Firewall blocking port 3112
# - Wrong host in config.yml
# - DaylightStation not running
```

### Notes not showing in visualizer

1. Check OfficeApp console for `piano.midi.*` logs
2. Verify subscription: `{"type":"bus_command","action":"subscribe","topics":["midi"]}`
3. Check if player is active (blocks piano visualizer)
