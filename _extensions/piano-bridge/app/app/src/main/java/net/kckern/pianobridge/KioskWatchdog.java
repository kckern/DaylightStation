package net.kckern.pianobridge;

import android.os.SystemClock;
import android.util.Log;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * KioskWatchdog — OUT-OF-PROCESS self-heal for the Fully Kiosk WebView.
 *
 * Why it lives in the bridge and not the page: the in-page sensor
 * (useRenderWatchdog.js) runs INSIDE the WebView and reports to the DS backend, so
 * when the WebView latches or its JS loop starves the sensor dies with it. The
 * bridge is a separate native process that SURVIVES WebView failure and already
 * commands FKB over REST — so it is the correct place to (a) observe WebView health
 * and (b) act on it.
 *
 * Health signal: the page POSTs a per-second heartbeat to /kiosk/beat
 * ({fps, visibility, url}). That beat stream is the one liveness signal that
 * reflects the WebView's real event-loop health — if the loop starves the fps
 * drops; if it latches the beats stop entirely.
 *
 * Verdicts:
 *   HEALTHY   recent beat, fps ok (or backlight off / building toward jank)
 *   DECAYED   recent beats, visible, fps < minFps sustained ≥ sustainSec
 *   DEAD      no beat for beatTimeoutMs (page JS loop dead / WebView latched)
 *
 * Escalation ladder (fires immediately on stall; each rung waits then re-checks the
 * beat before escalating). L2–L4 are suppressed inside the daily quiet window and L1
 * (invisible synthetic touch) is the only rung used at night:
 *   L1 TouchPulser.burst   the common SM-T590 input-recency throttle/decay
 *   L2 loadStartUrl        aged-page decay, dead JS loop
 *   L3 restartApp          stuck renderer process
 *   L4 rebootDevice        the hard WebView latch (reload+restartApp can't clear it)
 *
 * L4 is capped and the timestamp is PERSISTED (CrashLog.reboot.ts) so a reboot —
 * which restarts this very process — can't reset an in-memory counter and boot-loop.
 */
public final class KioskWatchdog {

    private static final String TAG = "PianoBridge-Kiosk";

    public enum Verdict { DISABLED, GRACE, NO_BEATS_YET, HEALTHY, SCREEN_OFF, BUILDING, DECAYED, DEAD }

    private final PianoBridgeService service;
    private volatile DeviceConfig cfg;

    // --- beat state (updated by onBeat, read by the eval loop) ---
    private volatile long lastBeatAtRt = 0;      // elapsedRealtime of last beat, 0 = none yet
    private volatile long lastBeatWallTs = 0;
    private volatile int lastFps = -1;
    private volatile String lastVisibility = "unknown";
    private volatile String lastUrl = "";
    private volatile long beatCount = 0;

    private final long startedAtRt = SystemClock.elapsedRealtime();
    private long lowMs = 0;                       // accumulated ms of visible-low-fps
    private volatile Verdict lastVerdict = Verdict.GRACE;
    private volatile long cooldownUntilRt = 0;

    // --- recovery bookkeeping (surfaced over /kiosk and /diagnostics) ---
    private final AtomicBoolean recovering = new AtomicBoolean(false);
    private final AtomicInteger burstCount = new AtomicInteger();
    private final AtomicInteger reloadCount = new AtomicInteger();
    private final AtomicInteger restartCount = new AtomicInteger();
    private final AtomicInteger rebootCount = new AtomicInteger();
    private volatile String lastAction = null;
    private volatile long lastActionWallTs = 0;
    private volatile String lastOutcome = null;

    private final ExecutorService recoveryExec = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "kiosk-recovery"); t.setDaemon(true); return t;
    });
    private java.util.Timer timer;

    public KioskWatchdog(PianoBridgeService service, DeviceConfig cfg) {
        this.service = service;
        this.cfg = cfg;
    }

    /** Swap in refreshed config (after a pbctl /config edit) WITHOUT losing beat state. */
    public void updateConfig(DeviceConfig cfg) { this.cfg = cfg; }

    public void start() {
        if (timer != null) return;
        long period = 2000L;
        timer = new java.util.Timer("kiosk-watchdog", true);
        timer.scheduleAtFixedRate(new java.util.TimerTask() {
            @Override public void run() { try { tick(period); } catch (Throwable t) { Log.e(TAG, "tick failed", t); } }
        }, period, period);
        CrashLog.note("WATCHDOG", "started (minFps=" + cfg.watchdogMinFps() + " beatTimeoutMs="
                + cfg.watchdogBeatTimeoutMs() + " recover=" + cfg.watchdogRecoverEnabled()
                + " reboot=" + cfg.watchdogRebootEnabled() + ")");
    }

    public void stop() {
        if (timer != null) { timer.cancel(); timer = null; }
        recoveryExec.shutdownNow();
    }

    /** Ingest a heartbeat from the page (POST /kiosk/beat). */
    public void onBeat(JSONObject beat) {
        lastBeatAtRt = SystemClock.elapsedRealtime();
        lastBeatWallTs = System.currentTimeMillis();
        lastFps = beat.optInt("fps", -1);
        lastVisibility = beat.optString("visibility", "unknown");
        lastUrl = beat.optString("url", "");
        beatCount++;
    }

    // --- evaluation ---------------------------------------------------------

    /**
     * Pure classification of the freshest beat. Extracted so the decision is
     * reviewable/testable without Android. `sawAnyBeat` gates DEAD so we never act
     * against a kiosk that simply never sent a beat (e.g. an old frontend build).
     */
    static Verdict classify(boolean enabled, long sinceStartMs, boolean sawAnyBeat,
                            long beatAgeMs, int fps, String visibility, long lowMsAccum,
                            int minFps, int sustainSec, long beatTimeoutMs, long graceMs) {
        if (!enabled) return Verdict.DISABLED;
        if (sinceStartMs < graceMs) return Verdict.GRACE;
        if (!sawAnyBeat) return Verdict.NO_BEATS_YET;
        if (beatAgeMs > beatTimeoutMs) return Verdict.DEAD;
        boolean visible = "visible".equals(visibility) || "unknown".equals(visibility);
        if (!visible) return Verdict.SCREEN_OFF;              // backlight off → rAF ~1fps, not a fault
        if (fps >= minFps) return Verdict.HEALTHY;
        return lowMsAccum >= (long) sustainSec * 1000 ? Verdict.DECAYED : Verdict.BUILDING;
    }

    /**
     * Pure gate (JVM-testable) for whether a recovery trigger may escalate past L1
     * (the invisible touch-burst) into the DISRUPTIVE rungs — L2 reload, L3
     * restartApp, L4 reboot — all of which remount the SPA and drop Web MIDI + the
     * bridge WS. Only DEAD qualifies: a dead page has stopped heartbeating, so its
     * JS loop is genuinely gone / the WebView is latched, which soft rungs can clear.
     * A DECAYED page is merely throttled but still alive and beating; remounting it
     * does not raise fps (proven on-device) and only manifests as a dropped piano
     * connection — the 2026-07-15 outage. Kept here so the policy is one obvious line.
     */
    static boolean escalatesPastL1(Verdict trigger) { return trigger == Verdict.DEAD; }

    private void tick(long periodMs) {
        DeviceConfig c = cfg;
        long now = SystemClock.elapsedRealtime();
        boolean sawAny = lastBeatAtRt != 0;
        long beatAge = sawAny ? now - lastBeatAtRt : now - startedAtRt;

        boolean visibleLow = sawAny && beatAge <= c.watchdogBeatTimeoutMs()
                && ("visible".equals(lastVisibility) || "unknown".equals(lastVisibility))
                && lastFps >= 0 && lastFps < c.watchdogMinFps();
        lowMs = visibleLow ? lowMs + periodMs : 0;

        Verdict v = classify(c.watchdogEnabled(), now - startedAtRt, sawAny, beatAge,
                lastFps, lastVisibility, lowMs,
                c.watchdogMinFps(), c.watchdogSustainSec(), c.watchdogBeatTimeoutMs(), c.watchdogGraceMs());

        if (v != lastVerdict) {
            CrashLog.note("WATCHDOG", "verdict " + lastVerdict + " → " + v
                    + " (fps=" + lastFps + " beatAgeMs=" + beatAge + " vis=" + lastVisibility + ")");
            lastVerdict = v;
        }

        // Both a stalled (DECAYED) and a dead (DEAD) page enter the ladder, but they
        // get DIFFERENT treatment there (see runLadder): DECAYED gets only the
        // invisible touch-burst, DEAD gets the full disruptive ladder. Escalating a
        // DECAYED page past L1 is the 2026-07-15 outage — see escalatesPastL1.
        boolean actionable = (v == Verdict.DEAD || v == Verdict.DECAYED);
        if (actionable && c.watchdogRecoverEnabled() && now >= cooldownUntilRt
                && recovering.compareAndSet(false, true)) {
            final Verdict trigger = v;
            recoveryExec.execute(() -> {
                try { runLadder(trigger); }
                catch (Throwable t) { Log.e(TAG, "ladder failed", t); CrashLog.note("RECOVERY", "ladder EXCEPTION " + t); }
                finally {
                    lowMs = 0;
                    cooldownUntilRt = SystemClock.elapsedRealtime() + cfg.watchdogLadderCooldownMs();
                    recovering.set(false);
                }
            });
        }
    }

    // --- the ladder ---------------------------------------------------------

    private void runLadder(Verdict trigger) {
        DeviceConfig c = cfg;
        CrashLog.note("RECOVERY", "LADDER start (trigger=" + trigger + " fps=" + lastFps + ")");
        // Two independent safety gates on the DISRUPTIVE rungs (L2 reload / L3 restart
        // / L4 reboot): the daily quiet window, AND FKB's authoritative screen state.
        // screenOn guards the common "screen off at night, rAF throttled to ~1fps" case
        // that visibilityState alone doesn't catch — without it a decayed night reading
        // could escalate to a 3am reboot. Fail-safe OPEN: if FKB can't tell us (unknown/
        // unreachable), assume on and allow recovery (a latched-but-lit kiosk MUST heal;
        // and if FKB REST is truly down, the disruptive rungs — which need it — no-op anyway).
        boolean quiet = inQuietWindow(c);
        boolean screenOn = fkbScreenOn(c);
        boolean disruptiveOk = !quiet && screenOn;

        // L1 — invisible synthetic-touch burst (the common un-throttle). Always safe.
        long t1 = SystemClock.elapsedRealtime();
        act("L1 touch-burst", burstCount);
        TouchPulser.burst(c, 6);
        sleep(3000);
        if (recovered(t1, c)) { finish("recovered@L1-touch"); return; }

        // A DECAYED page is SLOW but ALIVE — it is still heartbeating, just at the
        // SM-T590's aged-WebView rAF-throttle floor (~6-8fps), which the 2026-07-15
        // screenshot proved is a fully rendered, usable kiosk with MIDI connected.
        // Reload/restartApp provably do NOT raise fps on this hardware (the reason the
        // in-page useRenderWatchdog set SELF_HEAL_RESTART=false), so escalating past L1
        // just remounts the SPA every cooldown forever — tearing down Web MIDI + the
        // bridge WS and reading to the user as "the piano disconnected AGAIN." So the
        // disruptive rungs (reload/restart/reboot) are reserved for DEAD (beat-silence
        // = the JS loop is actually dead / WebView latched, which soft rungs CAN clear).
        if (!escalatesPastL1(trigger)) {
            finish("L1 only — DECAYED (slow but alive, still beating); disruptive rungs reserved for DEAD");
            return;
        }

        if (!disruptiveOk) {
            finish("L1 only — " + (quiet ? "quiet window" : "screen off")
                    + "; disruptive rungs (reload/restart/reboot) suppressed");
            return;
        }

        // L2 — reload the SPA.
        long t2 = SystemClock.elapsedRealtime();
        act("L2 loadStartUrl", reloadCount);
        FkbRest.command(c, "loadStartUrl");
        sleep(6500);
        if (recovered(t2, c)) { finish("recovered@L2-reload"); return; }

        // L3 — respawn the renderer.
        long t3 = SystemClock.elapsedRealtime();
        act("L3 restartApp", restartCount);
        FkbRest.command(c, "restartApp");
        sleep(8000);
        if (recovered(t3, c)) { finish("recovered@L3-restartApp"); return; }

        // L4 — reboot the device (the only thing that clears the hard latch). Capped.
        if (!c.watchdogRebootEnabled()) { finish("UNRECOVERED — reboot disabled (watchdogRebootEnabled=false)"); return; }
        long sinceReboot = System.currentTimeMillis() - CrashLog.lastRebootAt();
        if (sinceReboot < c.watchdogRebootMinGapMs()) {
            finish("UNRECOVERED — reboot suppressed by cap (last reboot " + (sinceReboot / 1000)
                    + "s ago < " + (c.watchdogRebootMinGapMs() / 1000) + "s) — NEEDS HUMAN");
            return;
        }
        act("L4 rebootDevice", rebootCount);
        CrashLog.recordReboot();           // persist BEFORE the reboot so the cap survives it
        CrashLog.note("RECOVERY", "issuing FKB rebootDevice — hard latch unrecoverable by soft ladder");
        FkbRest.command(c, "rebootDevice");
        finish("issued reboot");           // process is about to die with the device
    }

    private void act(String action, AtomicInteger counter) {
        counter.incrementAndGet();
        lastAction = action;
        lastActionWallTs = System.currentTimeMillis();
        CrashLog.note("RECOVERY", "→ " + action);
    }

    private void finish(String outcome) {
        lastOutcome = outcome;
        CrashLog.note("RECOVERY", "LADDER end: " + outcome);
    }

    /** True once a beat NEWER than the action shows healthy fps (reload remounts → fresh beats). */
    private boolean recovered(long actionAtRt, DeviceConfig c) {
        return lastBeatAtRt > actionAtRt && lastFps >= c.watchdogMinFps();
    }

    /** FKB's authoritative screen state; fail-safe OPEN (true) when it can't be read. */
    private boolean fkbScreenOn(DeviceConfig c) {
        try {
            JSONObject fkb = FkbRest.deviceInfo(c);
            if (!fkb.optBoolean("reachable", false)) return true; // FKB down → assume on
            Object s = fkb.opt("screenOn");
            if (s instanceof Boolean) return (Boolean) s;
            return true; // field absent/unknown → assume on
        } catch (Exception e) {
            return true;
        }
    }

    private boolean inQuietWindow(DeviceConfig c) {
        int start = parseHhmm(c.fkbWakeQuietStart());
        int end = parseHhmm(c.fkbWakeQuietEnd());
        if (start < 0 || end < 0 || start == end) return false;
        java.util.Calendar cal = java.util.Calendar.getInstance();
        int nowMin = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE);
        if (start < end) return nowMin >= start && nowMin < end;
        return nowMin >= start || nowMin < end;
    }

    private static int parseHhmm(String s) {
        if (s == null) return -1;
        s = s.trim();
        int colon = s.indexOf(':');
        if (colon <= 0) return -1;
        try {
            int h = Integer.parseInt(s.substring(0, colon).trim());
            int m = Integer.parseInt(s.substring(colon + 1).trim());
            if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
            return h * 60 + m;
        } catch (NumberFormatException e) { return -1; }
    }

    private static void sleep(long ms) { try { Thread.sleep(ms); } catch (InterruptedException ignored) { } }

    // --- introspection (GET /kiosk, embedded in /diagnostics) ---------------

    public JSONObject snapshot() {
        JSONObject o = new JSONObject();
        try {
            DeviceConfig c = cfg;
            long now = SystemClock.elapsedRealtime();
            boolean sawAny = lastBeatAtRt != 0;
            o.put("enabled", c.watchdogEnabled());
            o.put("recoverEnabled", c.watchdogRecoverEnabled());
            o.put("rebootEnabled", c.watchdogRebootEnabled());
            o.put("verdict", lastVerdict.name());
            o.put("lastFps", lastFps);
            o.put("lastVisibility", lastVisibility);
            o.put("lastUrl", lastUrl);
            o.put("beatCount", beatCount);
            o.put("lastBeatAgoMs", sawAny ? now - lastBeatAtRt : JSONObject.NULL);
            o.put("lastBeatWallTs", sawAny ? lastBeatWallTs : JSONObject.NULL);
            o.put("minFps", c.watchdogMinFps());
            o.put("sustainSec", c.watchdogSustainSec());
            o.put("beatTimeoutMs", c.watchdogBeatTimeoutMs());
            o.put("recovering", recovering.get());
            o.put("cooldownRemainingMs", Math.max(0, cooldownUntilRt - now));
            o.put("inQuietWindow", inQuietWindow(c));
            JSONObject counters = new JSONObject();
            counters.put("touchBurst", burstCount.get());
            counters.put("reload", reloadCount.get());
            counters.put("restartApp", restartCount.get());
            counters.put("reboot", rebootCount.get());
            o.put("recoveryCounts", counters);
            o.put("lastAction", lastAction == null ? JSONObject.NULL : lastAction);
            o.put("lastActionWallTs", lastActionWallTs == 0 ? JSONObject.NULL : lastActionWallTs);
            o.put("lastOutcome", lastOutcome == null ? JSONObject.NULL : lastOutcome);
            o.put("lastRebootAt", CrashLog.lastRebootAt());
            o.put("prevDeathUnclean", CrashLog.prevDeathUnclean());
            o.put("ok", true);
        } catch (Exception e) {
            try { o.put("ok", false).put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        return o;
    }
}
