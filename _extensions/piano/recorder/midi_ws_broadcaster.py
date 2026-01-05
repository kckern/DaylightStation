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
from queue import Queue, Empty, Full
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
        except Full:
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
