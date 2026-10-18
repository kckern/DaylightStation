package net.kckern.pianobridge;

import android.util.Log;

import org.json.JSONObject;

import java.util.List;
import java.util.Timer;
import java.util.TimerTask;

/**
 * ForegroundWatch — samples the window list every second through the bridge's own
 * accessibility service and reports every change of the app in front.
 *
 * Two jobs (2026-10-14: a child reached the Play Store and stayed 40 minutes):
 *   1. Evidence. Each change goes to the log store at once ({@link ForegroundTrail}
 *      events, context.app:piano-bridge) and to the durable crash log, with the
 *      windows that appeared over the kiosk just before. That trail is the vector.
 *   2. Speed and independence. The foreground guard reads {@link #front()} before
 *      asking FKB, so a stale fkbPassword can no longer blind it, and leaving FKB
 *      triggers a guard pass immediately instead of on its next 10 s tick.
 */
final class ForegroundWatch {

    private static final String TAG = "PianoBridge-Fg";
    static final long INTERVAL_MS = 1_000L;
    private static final long FRESH_MS = 3_000L;

    private static volatile String front;
    private static volatile long frontAtMs;

    private final BridgeCore core;
    private final ForegroundTrail trail = new ForegroundTrail();
    private volatile DeviceConfig cfg;
    private Timer timer;
    private final java.util.concurrent.atomic.AtomicBoolean recallInFlight =
            new java.util.concurrent.atomic.AtomicBoolean();

    ForegroundWatch(BridgeCore core, DeviceConfig cfg) {
        this.core = core;
        this.cfg = cfg;
    }

    void updateConfig(DeviceConfig c) { this.cfg = c; }

    /** The app in front per the last sample, or null if that sample is stale or absent. */
    static String front() {
        String f = front;
        return f != null && System.currentTimeMillis() - frontAtMs <= FRESH_MS ? f : null;
    }

    synchronized void start() {
        if (timer != null) return;
        timer = new Timer("PianoBridge-fg", true);
        timer.scheduleAtFixedRate(new TimerTask() {
            @Override public void run() {
                try { tick(); } catch (Throwable t) { Log.w(TAG, "tick failed", t); }
            }
        }, 2_000L, INTERVAL_MS);
        Log.i(TAG, "foreground watch every " + INTERVAL_MS + "ms");
    }

    synchronized void stop() {
        if (timer != null) { timer.cancel(); timer = null; }
        front = null;
    }

    JSONObject snapshot() {
        JSONObject o = new JSONObject();
        try {
            o.put("a11yBound", A11y.isConnected());
            o.put("front", trail.front() == null ? JSONObject.NULL : trail.front());
            o.put("sampleAgoMs", frontAtMs == 0 ? -1 : System.currentTimeMillis() - frontAtMs);
            o.put("trail", trail.trail());
        } catch (Exception ignored) { }
        return o;
    }

    private void tick() {
        List<ForegroundTrail.Win> wins = A11y.windows();
        if (wins == null) return;                       // a11y not bound: say nothing, guess nothing
        long now = System.currentTimeMillis();
        List<ForegroundTrail.Event> events = trail.sample(now, wins);
        if (trail.front() != null) { front = trail.front(); frontAtMs = now; }

        boolean away = false;
        for (ForegroundTrail.Event e : events) {
            LogEvents.emit(cfg, e.msg, e.level, e.data);
            if (!"kiosk.window.overlay".equals(e.msg)) {
                CrashLog.note("FOREGROUND", e.msg + " " + e.data);
            }
            if ("kiosk.foreground.left".equals(e.msg) || "kiosk.foreground.changed".equals(e.msg)) away = true;
        }
        // Recheck Settings even when only the activity/dialog changed within its package.
        // A pairing exception expires or ends as soon as the active dialog no longer matches.
        if (away || KioskSettingsGuard.SETTINGS_PACKAGE.equals(front)) {
            KioskSettingsGuard g = core.getKioskSettingsGuard();
            if (g != null && recallInFlight.compareAndSet(false, true)) {
                // Off the sampling thread: a recall can take a second.
                new Thread(() -> {
                    try { g.foregroundTick(); } catch (Throwable t) { Log.w(TAG, "immediate recall failed", t); }
                    finally { recallInFlight.set(false); }
                }, "PianoBridge-fg-recall").start();
            }
        }
    }
}
