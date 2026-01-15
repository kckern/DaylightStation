"""
MIDI Message Converter Module

Converts mido MIDI messages to JSON format for WebSocket broadcasting.
"""

import os
from datetime import datetime, timezone
from typing import Dict, Any, Optional

# Minimum session duration in seconds to keep recordings
MIN_SESSION_DURATION_SECONDS = 30

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
    deleted = False
    
    # Delete short recordings (under MIN_SESSION_DURATION_SECONDS)
    if duration < MIN_SESSION_DURATION_SECONDS and file_path:
        deleted = delete_short_recording(file_path, duration)
    
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
            "filePath": None if deleted else file_path,
            "deleted": deleted
        }
    }


def delete_short_recording(file_path: str, duration: float) -> bool:
    """
    Delete MIDI and associated MP3 files for recordings under minimum duration.
    
    Args:
        file_path: Path to the MIDI file
        duration: Recording duration in seconds
        
    Returns:
        True if files were deleted, False otherwise
    """
    deleted_any = False
    
    # Delete MIDI file
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
            print(f"[MIDI] Deleted short recording ({duration:.1f}s < {MIN_SESSION_DURATION_SECONDS}s): {file_path}")
            deleted_any = True
        except OSError as e:
            print(f"[MIDI] Failed to delete {file_path}: {e}")
    
    # Delete associated MP3 file (same name, different extension)
    if file_path:
        mp3_path = os.path.splitext(file_path)[0] + '.mp3'
        if os.path.exists(mp3_path):
            try:
                os.remove(mp3_path)
                print(f"[MIDI] Deleted associated MP3: {mp3_path}")
                deleted_any = True
            except OSError as e:
                print(f"[MIDI] Failed to delete {mp3_path}: {e}")
    
    return deleted_any
