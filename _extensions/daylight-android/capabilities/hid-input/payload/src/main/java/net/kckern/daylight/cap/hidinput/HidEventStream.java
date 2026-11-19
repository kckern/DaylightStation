package net.kckern.daylight.cap.hidinput;

import java.util.function.Consumer;
import java.util.function.Supplier;
import org.json.JSONObject;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/** Decoded USB reports and repeats belong to the focused kiosk document that received the press. */
final class HidEventStream {
    private final Supplier<Consumer<JSONObject>> currentTarget;
    private final ScheduledExecutorService repeats = Executors.newSingleThreadScheduledExecutor();
    private final Map<Integer, ScheduledFuture<?>> repeatTasks = new ConcurrentHashMap<>();
    private final AtomicLong events = new AtomicLong();

    HidEventStream(Supplier<Consumer<JSONObject>> currentTarget) { this.currentTarget = currentTarget; }

    void publish(final HidKeyEvent event) {
        if ("up".equals(event.action)) stopRepeat(event.usage);
        Consumer<JSONObject> target = currentTarget.get();
        if (target == null || repeats.isShutdown()) return;
        if ("down".equals(event.action) && !event.repeat && event.repeatable()) startRepeat(event, target);
        send(event, target);
    }

    private void send(HidKeyEvent event, Consumer<JSONObject> target) {
        if (repeats.isShutdown()) return;
        events.incrementAndGet();
        target.accept(event.asJson());
    }

    private void startRepeat(final HidKeyEvent event, Consumer<JSONObject> target) {
        stopRepeat(event.usage);
        try {
            repeatTasks.put(event.usage, repeats.scheduleAtFixedRate(new Runnable() {
                @Override public void run() { send(event.asRepeat(), target); }
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
