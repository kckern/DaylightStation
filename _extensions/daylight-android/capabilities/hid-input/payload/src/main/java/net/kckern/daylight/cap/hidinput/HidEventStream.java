package net.kckern.daylight.cap.hidinput;

import net.kckern.daylight.core.SocketHub;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Keyboard events for the page, with host-side key repeat, on the control WebSocket.
 * In portal-keys this was a loopback WebSocket server on its own port; the repeat
 * logic is unchanged and the transport is the core hub.
 */
final class HidEventStream {
    private final SocketHub socket;
    private final ScheduledExecutorService repeats = Executors.newSingleThreadScheduledExecutor();
    private final Map<Integer, ScheduledFuture<?>> repeatTasks = new ConcurrentHashMap<>();
    private final AtomicLong events = new AtomicLong();

    HidEventStream(SocketHub socket) { this.socket = socket; }

    void publish(final HidKeyEvent event) {
        if ("down".equals(event.action) && !event.repeat && event.repeatable()) startRepeat(event);
        if ("up".equals(event.action)) stopRepeat(event.usage);
        send(event);
    }

    private void send(final HidKeyEvent event) {
        events.incrementAndGet();
        socket.broadcastAsync(event.toJson());
    }

    private void startRepeat(final HidKeyEvent event) {
        stopRepeat(event.usage);
        try {
            repeatTasks.put(event.usage, repeats.scheduleAtFixedRate(new Runnable() {
                @Override public void run() { send(event.asRepeat()); }
            }, 450, 50, TimeUnit.MILLISECONDS));
        } catch (RejectedExecutionException stopped) {
            // A key report that raced stop(): the key is sent once and does not repeat.
        }
    }

    private void stopRepeat(int usage) {
        ScheduledFuture<?> task = repeatTasks.remove(usage);
        if (task != null) task.cancel(false);
    }

    long events() { return events.get(); }

    void stop() {
        for (ScheduledFuture<?> task : repeatTasks.values()) task.cancel(false);
        repeatTasks.clear();
        repeats.shutdownNow();
    }
}
