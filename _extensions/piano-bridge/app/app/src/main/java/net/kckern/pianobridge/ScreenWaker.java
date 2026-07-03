package net.kckern.pianobridge;

import android.util.Log;

import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

/**
 * ScreenWaker — pokes Fully Kiosk's {@code screenOn} REST endpoint on localhost
 * when the piano is played, so a BLE-MIDI note wakes the tablet even when the
 * WebView is dark.
 *
 * Why the bridge does this (see docs/_wip/plans/2026-07-01-piano-tablet-screen-
 * power-sync.md, "The three wake paths" → optional hardening): once FKB has
 * powered the backlight off, the in-browser screensaver's own MIDI/touch wake
 * can't fire — a backgrounded WebView gets its timers + Web MIDI throttled and
 * touch is not delivered. This service, by contrast, receives every note-on via
 * {@link PianoBridgeService.PianoMidiReceiver} (a foreground service owning the
 * BLE-MIDI device directly), so it can nudge FKB screenOn regardless of display
 * state. The DS backend runs an equivalent WS-driven wake; either revives it.
 *
 * poke() is called on the MIDI thread per note-on, so it must be cheap and
 * non-blocking: a time-based cooldown (CAS-guarded) drops all but one note per
 * window, and the actual HTTP GET runs on a single daemon thread.
 */
public final class ScreenWaker {

    private static final String TAG = "PianoBridge-Wake";

    private final boolean enabled;
    private final String url;          // fully-built screenOn URL (password baked in)
    private final long cooldownMs;
    private final ExecutorService exec;
    private final AtomicLong lastWakeAt = new AtomicLong(0);

    public ScreenWaker(DeviceConfig cfg) {
        this.enabled = cfg.fkbWakeEnabled();
        this.cooldownMs = cfg.fkbWakeCooldownMs();
        this.url = "http://" + cfg.fkbHost() + ":" + cfg.fkbPort()
                + "/?cmd=screenOn&type=json&password=" + enc(cfg.fkbPassword());
        this.exec = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "screen-waker");
            t.setDaemon(true);
            return t;
        });
        Log.i(TAG, "ScreenWaker enabled=" + enabled
                + " target=" + cfg.fkbHost() + ":" + cfg.fkbPort()
                + " cooldownMs=" + cooldownMs
                + " hasPassword=" + (!cfg.fkbPassword().isEmpty()));
    }

    /**
     * Fire-and-forget wake, debounced to at most one HTTP poke per cooldown
     * window. Safe to call on the MIDI thread for every note-on.
     */
    public void poke() {
        if (!enabled) return;
        long now = System.currentTimeMillis();
        long last = lastWakeAt.get();
        if (now - last < cooldownMs) return;
        // Claim the window atomically so a burst of notes fires exactly one poke.
        if (!lastWakeAt.compareAndSet(last, now)) return;
        try {
            exec.execute(this::doWake);
        } catch (Exception ignored) {
            // executor shut down (service stopping) — drop the poke
        }
    }

    private void doWake() {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(3000);
            c.setReadTimeout(3000);
            c.setRequestMethod("GET");
            int code = c.getResponseCode();
            Log.i(TAG, "screenOn poke -> HTTP " + code);
        } catch (Exception e) {
            Log.w(TAG, "screenOn poke failed: " + e.getMessage());
        } finally {
            if (c != null) c.disconnect();
        }
    }

    public void shutdown() {
        exec.shutdownNow();
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }
}
