#!/usr/bin/env python3
"""
Auto MIDI Session Recorder - Working Version
Automatically records MIDI sessions, breaking into separate files after periods of silence.
"""

import mido
import time
import os
import sys
import logging
from datetime import datetime
from threading import Timer, Lock
import signal

# WebSocket broadcasting (optional)
try:
    from midi_ws_broadcaster import MidiWebSocketBroadcaster
    from midi_message_converter import (
        midi_message_to_json,
        create_session_start_message,
        create_session_end_message
    )
    WS_AVAILABLE = True
except ImportError:
    WS_AVAILABLE = False

class AutoMIDIRecorder:
    def __init__(self, output_dir, silence_timeout=30, ws_url=None):
        self.base_output_dir = os.path.expanduser(output_dir)
        self.silence_timeout = silence_timeout
        self.current_session = None
        self.current_session_path = None
        self.current_log_path = None
        self.session_messages = []
        self.last_message_time = None
        self.silence_timer = None
        self.is_recording = False
        self.session_lock = Lock()
        self._current_device_name = None
        self._session_start_time = None

        # Ensure base output directory exists
        os.makedirs(self.base_output_dir, exist_ok=True)

        # Setup logging in the _recorder directory (same as script location)
        script_dir = os.path.dirname(os.path.abspath(__file__))
        log_file = os.path.join(script_dir, 'midi_recorder.log')
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(log_file),
                logging.StreamHandler(sys.stdout)
            ]
        )
        self.logger = logging.getLogger(__name__)

        # WebSocket broadcaster (optional)
        self.broadcaster = None
        if ws_url and WS_AVAILABLE:
            try:
                self.broadcaster = MidiWebSocketBroadcaster(ws_url)
                self.broadcaster.start()
                self.logger.info(f"WebSocket broadcasting enabled: {ws_url}")
            except Exception as e:
                self.logger.error(f"Failed to start broadcaster: {e}")
                self.broadcaster = None
        elif ws_url and not WS_AVAILABLE:
            self.logger.warning("WebSocket URL provided but websockets package not installed")

        # Setup signal handlers for graceful shutdown
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)
        
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals gracefully."""
        self.logger.info(f"Received signal {signum}, shutting down...")
        self.stop_recording()
        # Stop broadcaster
        if self.broadcaster:
            self.broadcaster.stop(flush=True)
        sys.exit(0)
    
    def find_midi_device(self):
        """Find the first available MIDI input device."""
        input_names = mido.get_input_names()

        if not input_names:
            self.logger.warning("No MIDI input devices found!")
            return None

        device_name = None

        # Prefer Digital Keyboard or Yamaha devices if available
        for name in input_names:
            if 'Digital Keyboard' in name or 'yamaha' in name.lower():
                self.logger.info(f"Found preferred device: {name}")
                device_name = name
                break

        # Otherwise use the first non-virtual device
        if not device_name:
            for name in input_names:
                if 'virtual' not in name.lower() and 'garageband' not in name.lower():
                    self.logger.info(f"Using first non-virtual device: {name}")
                    device_name = name
                    break

        # Last resort: use first available
        if not device_name:
            device_name = input_names[0]
            self.logger.info(f"Using first available device: {device_name}")

        # Store device name for broadcasting
        self._current_device_name = device_name
        return device_name
    
    def start_new_session(self):
        """Start a new MIDI recording session."""
        try:
            # NOTE: Caller must already hold session_lock

            # End current session if exists
            if self.current_session:
                self._save_current_session()

            # Start new session with new format: YYYY-MM/YYYY-MM-DD HH.MM.SS.mid
            now = datetime.now()
            year_month = now.strftime("%Y-%m")
            timestamp = now.strftime("%Y-%m-%d %H.%M.%S")

            # Create year-month subdirectory
            session_dir = os.path.join(self.base_output_dir, year_month)
            os.makedirs(session_dir, exist_ok=True)

            self.current_session = f"{timestamp}.mid"
            self.current_session_path = os.path.join(session_dir, self.current_session)
            self.current_log_path = os.path.join(session_dir, f"{timestamp}.log")
            self.session_messages = []
            self.last_message_time = time.time()
            self._session_start_time = time.time()

            # Create placeholder log file instead of MIDI file
            with open(self.current_log_path, 'w') as f:
                f.write(f"Recording started: {timestamp}\n")

            self.logger.info(f"Recording: {self.current_session}")

            # Broadcast session start
            if self.broadcaster:
                session_id = self.current_session.replace('.mid', '')
                self.broadcaster.broadcast(
                    create_session_start_message(
                        session_id,
                        self._current_device_name or "Unknown"
                    )
                )
        except Exception as e:
            self.logger.error(f"ERROR in start_new_session: {e}", exc_info=True)

    def _save_current_session(self):
        """Save the current session to a MIDI file and remove log placeholder."""
        if not self.session_messages or not self.current_session:
            return

        try:
            # Create MIDI file
            mid = mido.MidiFile()
            track = mido.MidiTrack()

            # Add messages to track
            for msg in self.session_messages:
                track.append(msg)
            mid.tracks.append(track)

            # Save final MIDI file
            mid.save(self.current_session_path)

            # Remove log placeholder
            if self.current_log_path and os.path.exists(self.current_log_path):
                os.remove(self.current_log_path)

            self.logger.info(f"Saved: {self.current_session} ({len(self.session_messages)} messages)")

            # Broadcast session end
            if self.broadcaster:
                session_id = self.current_session.replace('.mid', '')
                duration = time.time() - self._session_start_time if self._session_start_time else 0
                note_count = sum(1 for m in self.session_messages if m.type in ('note_on', 'note_off'))
                self.broadcaster.broadcast(
                    create_session_end_message(
                        session_id=session_id,
                        duration=duration,
                        note_count=note_count,
                        file_path=os.path.relpath(self.current_session_path, self.base_output_dir)
                    )
                )

        except Exception as e:
            self.logger.error(f"Error saving session {self.current_session}: {e}")

    def _on_silence_timeout(self):
        """Called when silence timeout is reached."""
        self.logger.info(f"Silence timeout ({self.silence_timeout}s) reached")
        with self.session_lock:
            if self.current_session:
                self._save_current_session()
                self.current_session = None
                self.current_session_path = None
                self.current_log_path = None
                self.session_messages = []

    def _reset_silence_timer(self):
        """Reset the silence timeout timer."""
        if self.silence_timer:
            self.silence_timer.cancel()
        
        self.silence_timer = Timer(self.silence_timeout, self._on_silence_timeout)
        self.silence_timer.start()

    def process_midi_message(self, msg):
        """Process incoming MIDI message."""
        try:
            current_time = time.time()

            with self.session_lock:
                # Start new session if none exists
                if not self.current_session:
                    self.start_new_session()

                # Calculate delta time from last message in seconds
                if self.last_message_time is not None:
                    delta_seconds = current_time - self.last_message_time
                    # Ensure delta is non-negative
                    if delta_seconds < 0:
                        delta_seconds = 0
                    # Convert to MIDI ticks (480 ticks per beat, assume 120 BPM = 2 beats/sec)
                    # So: 480 ticks/beat * 2 beats/sec = 960 ticks/sec
                    ticks = int(delta_seconds * 960)
                    msg.time = min(ticks, 65535)  # Cap at max MIDI delta time
                else:
                    msg.time = 0  # First message

                # Add message to current session
                self.session_messages.append(msg.copy())
                self.last_message_time = current_time

                # Append to log file for real-time tracking
                with open(self.current_log_path, 'a') as f:
                    f.write(f"{current_time}: {msg}\n")

                # Broadcast MIDI event
                if self.broadcaster:
                    session_id = self.current_session.replace('.mid', '') if self.current_session else None
                    json_msg = midi_message_to_json(msg, session_id)
                    if json_msg:
                        self.broadcaster.broadcast(json_msg)

                # Reset silence timer
                self._reset_silence_timer()

        except Exception as e:
            self.logger.error(f"ERROR in process_midi_message: {e}", exc_info=True)

    def start_recording(self):
        """Start the auto-recording process."""
        device_name = self.find_midi_device()
        if not device_name:
            self.logger.error("No MIDI devices available!")
            return False
        
        self.logger.info(f"Starting auto-recorder with device: {device_name}")
        self.logger.info(f"Output directory: {self.base_output_dir}")
        self.logger.info(f"Silence timeout: {self.silence_timeout} seconds")
        
        try:
            with mido.open_input(device_name) as inport:
                self.is_recording = True
                self.logger.info("Auto-recorder started. Waiting for MIDI input...")
                
                for msg in inport:
                    if not self.is_recording:
                        break
                    
                    # Only process note and control messages (ignore clock, meta, etc.)
                    if msg.type in ['note_on', 'note_off', 'control_change', 'program_change', 'pitchwheel']:
                        self.process_midi_message(msg)
                        
        except KeyboardInterrupt:
            self.logger.info("Recording interrupted by user")
        except Exception as e:
            self.logger.error(f"Recording error: {e}")
        finally:
            self.stop_recording()
        
        return True

    def stop_recording(self):
        """Stop recording and save current session."""
        self.is_recording = False

        if self.silence_timer:
            self.silence_timer.cancel()

        with self.session_lock:
            if self.current_session:
                self._save_current_session()

        # Stop broadcaster
        if self.broadcaster:
            self.broadcaster.stop(flush=True)

        self.logger.info("Auto-recorder stopped")

def load_config():
    """Load configuration from config.yml next to the script."""
    import yaml

    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, 'config.yml')

    default_config = {
        'silence_timeout': 30,
        'websocket': {
            'enabled': False,
            'host': 'localhost',
            'port': 3112,
            'path': '/ws'
        }
    }

    if os.path.exists(config_path):
        try:
            with open(config_path, 'r') as f:
                file_config = yaml.safe_load(f) or {}
            # Merge with defaults
            config = {**default_config, **file_config}
            # Deep merge websocket section
            if 'websocket' in file_config:
                config['websocket'] = {**default_config['websocket'], **file_config['websocket']}
            return config
        except Exception as e:
            logging.warning(f"Failed to load config.yml: {e}, using defaults")
            return default_config
    else:
        return default_config


def main():
    # Load configuration
    config = load_config()

    # Configuration - get parent directory of _recorder
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.dirname(script_dir)  # Parent directory
    silence_timeout = config.get('silence_timeout', 30)

    # Build WebSocket URL if enabled
    ws_url = None
    ws_config = config.get('websocket', {})
    if ws_config.get('enabled', False):
        host = ws_config.get('host', 'localhost')
        port = ws_config.get('port', 3112)
        path = ws_config.get('path', '/ws')
        ws_url = f"ws://{host}:{port}{path}"
        logging.info(f"WebSocket broadcasting: {ws_url}")

    # Create recorder
    recorder = AutoMIDIRecorder(output_dir, silence_timeout, ws_url=ws_url)

    # Start recording
    try:
        success = recorder.start_recording()
        if not success:
            sys.exit(1)
    except Exception as e:
        recorder.logger.error(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()