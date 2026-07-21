package net.kckern.pianobridge;

import android.util.Log;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.LongSupplier;
import java.util.function.Supplier;

/**
 * KioskSettingsGuard — detects and repairs drift in Fully Kiosk's kiosk-critical
 * settings, so a debugging session that turns kiosk mode off can't leave the tablet
 * unlocked indefinitely.
 *
 * <p><b>Why it is separate from {@link KioskWatchdog}.</b> That watchdog answers "is
 * the WebView presenting frames?" on a 2s cadence and can reboot the device. This one
 * answers "is FKB still configured to be a kiosk?" on a 60s cadence and only ever
 * writes settings. Different question, different urgency, different blast radius —
 * so a separate timer and separate config keys, and nothing here touches the page-
 * health ladder.
 *
 * <p><b>The conflict this must respect.</b> Deploying a new bridge APK REQUIRES kiosk
 * mode to be off: FKB's kiosk mode auto-dismisses Android's install dialog and the
 * install dies with INSTALL_FAILED_ABORTED (README.md:163-168, deploy step 4). A guard
 * that blindly re-asserted kiosk mode would kill the confirm tap and break the very
 * deploy that ships it. Two mechanisms prevent that:
 * <ul>
 *   <li><b>Install hold</b> — after POST /update stamps
 *       {@code lastUpdateRequestAtMs}, the guard stands down for
 *       {@code watchdogKioskSettingsInstallHoldMs} (default 15 min). Inferred from
 *       install activity, so the deploy needs no new manual step.</li>
 *   <li><b>Disarm</b> — POST /kiosk/settings/disarm silences the guard for an hour
 *       (persisted, so it survives the bridge restarts that hands-on fiddling causes).</li>
 * </ul>
 *
 * <p>Per tick the guard is deliberately timid: it writes ONLY keys it has positively
 * observed to be wrong, never the whole desired set, and treats an unreadable FKB as
 * "unknown" rather than "everything drifted" (see {@link KioskSettings}).
 */
public final class KioskSettingsGuard {

    private static final String TAG = "PianoBridge-KioskSet";

    /** What the guard concluded on its last tick. */
    public enum Verdict {
        /** watchdogKioskSettingsEnabled=false. */
        DISABLED,
        /** Inside an explicit disarm window (POST /kiosk/settings/disarm). */
        DISARMED,
        /** An APK install may be in flight — see the class javadoc. */
        INSTALL_HOLD,
        /** fkbPassword unset, so FKB's REST API would just 401. */
        NO_PASSWORD,
        /** FKB did not answer (or answered with a login page) — state unknown. */
        UNREACHABLE,
        /** Read succeeded, nothing had drifted. */
        OK,
        /** Drift found and written back. */
        REPAIRED
    }

    // --- injection seams (device wiring in the public ctor, fakes in tests) ---

    /** The FKB operations the guard needs. Injected so the logic is testable offline. */
    public interface Fkb {
        /** FKB's live settings; EMPTY means unknown/unreachable, never "all wrong". */
        Map<String, String> listSettings();
        boolean setBoolean(String key, String value);
        boolean setString(String key, String value);
    }

    /** Durable event sink — CrashLog on device, a recorder in tests. */
    public interface Notes { void note(String kind, String msg); }

    /** Config snapshot for one tick, so tests need no Android Context. */
    public static final class Params {
        public final boolean enabled;
        public final long intervalMs;
        public final long installHoldMs;
        public final long disarmUntilMs;
        public final boolean hasPassword;
        public Params(boolean enabled, long intervalMs, long installHoldMs,
                      long disarmUntilMs, boolean hasPassword) {
            this.enabled = enabled;
            this.intervalMs = intervalMs;
            this.installHoldMs = installHoldMs;
            this.disarmUntilMs = disarmUntilMs;
            this.hasPassword = hasPassword;
        }
    }

    private final Supplier<Params> params;
    private final LongSupplier lastUpdateRequestAtMs;
    private final Fkb fkb;
    private final Notes notes;
    private final LongSupplier clock;

    // --- state (read by snapshot(), written by tick()) ---
    private volatile Verdict lastVerdict = null;
    private volatile long lastCheckAtMs = 0;
    private volatile int lastDriftCount = 0;
    private volatile String lastRepair = null;
    private final Map<String, AtomicInteger> repairsSinceBoot = new ConcurrentHashMap<>();
    /** One-shot latch: a permanently unconfigured device must not log every tick. */
    private volatile boolean noPasswordLogged = false;
    /** In-memory disarm, set by the API for IMMEDIATE effect; also persisted to config. */
    private volatile long disarmUntilOverrideMs = 0;

    private java.util.Timer timer;

    /** Device wiring: config from {@link DeviceConfig}, FKB over REST, log to CrashLog. */
    public KioskSettingsGuard(PianoBridgeService service, DeviceConfig cfg) {
        final DeviceConfig[] held = { cfg };
        this.configHolder = held;
        this.params = () -> {
            DeviceConfig c = held[0];
            return new Params(c.watchdogKioskSettingsEnabled(),
                    c.watchdogKioskSettingsIntervalMs(),
                    c.watchdogKioskSettingsInstallHoldMs(),
                    c.kioskSettingsDisarmUntilMs(),
                    !c.fkbPassword().isEmpty());
        };
        this.lastUpdateRequestAtMs = service::lastUpdateRequestAtMs;
        this.fkb = new Fkb() {
            @Override public Map<String, String> listSettings() { return FkbRest.listSettings(held[0]); }
            @Override public boolean setBoolean(String key, String value) { return set("setBooleanSetting", key, value); }
            @Override public boolean setString(String key, String value) { return set("setStringSetting", key, value); }
            private boolean set(String cmd, String key, String value) {
                Map<String, String> p = new LinkedHashMap<>();
                p.put("key", key);
                p.put("value", value);
                int code = FkbRest.command(held[0], cmd, p);
                return code >= 200 && code < 400;
            }
        };
        this.notes = CrashLog::note;
        this.clock = System::currentTimeMillis;
    }

    /** Test wiring: everything injected, no Android, no network. */
    KioskSettingsGuard(Supplier<Params> params, LongSupplier lastUpdateRequestAtMs,
                       Fkb fkb, Notes notes, LongSupplier clock) {
        this.configHolder = null;
        this.params = params;
        this.lastUpdateRequestAtMs = lastUpdateRequestAtMs;
        this.fkb = fkb;
        this.notes = notes;
        this.clock = clock;
    }

    /** Holds the live DeviceConfig on device (null in tests); swapped by updateConfig. */
    private final DeviceConfig[] configHolder;

    /** Swap in refreshed config after a pbctl /config edit, keeping counters. */
    public void updateConfig(DeviceConfig cfg) {
        if (configHolder != null) configHolder[0] = cfg;
    }

    public void start() {
        if (timer != null) return;
        long period = Math.max(5_000L, params.get().intervalMs);
        timer = new java.util.Timer("kiosk-settings-guard", true);
        timer.scheduleAtFixedRate(new java.util.TimerTask() {
            @Override public void run() {
                try { tick(); } catch (Throwable t) { Log.e(TAG, "tick failed", t); }
            }
        }, period, period);
        notes.note("KIOSKSET", "guard started (intervalMs=" + period
                + " keys=" + KioskSettings.DESIRED.size() + ")");
    }

    public void stop() {
        if (timer != null) { timer.cancel(); timer = null; }
    }

    // --- the tick -----------------------------------------------------------

    /**
     * One evaluation. Returns the verdict so it is directly assertable; the on-device
     * timer ignores the return value and reads {@link #snapshot()} instead.
     */
    Verdict tick() {
        Params p = params.get();
        long now = clock.getAsLong();
        lastCheckAtMs = now;

        if (!p.enabled) return record(Verdict.DISABLED, 0);

        long disarmUntil = Math.max(p.disarmUntilMs, disarmUntilOverrideMs);
        if (now < disarmUntil) return record(Verdict.DISARMED, 0);

        // Stand down while an APK install may be in flight — re-arming kiosk mode
        // mid-install auto-dismisses the confirm dialog and aborts the install.
        long sinceUpdate = now - lastUpdateRequestAtMs.getAsLong();
        if (lastUpdateRequestAtMs.getAsLong() > 0 && sinceUpdate < p.installHoldMs) {
            return record(Verdict.INSTALL_HOLD, 0);
        }

        if (!p.hasPassword) {
            // ONCE, not every tick: the durable log is head-truncated at 128KB, so a
            // per-tick note on a permanently unconfigured device would evict real history.
            if (!noPasswordLogged) {
                noPasswordLogged = true;
                notes.note("KIOSKSET", "fkbPassword is unset — kiosk-settings guard is INERT. "
                        + "Set it with `pbctl config set fkbPassword …`.");
            }
            return record(Verdict.NO_PASSWORD, 0);
        }

        Map<String, String> live = fkb.listSettings();
        if (live == null || live.isEmpty()) return record(Verdict.UNREACHABLE, 0);

        List<KioskSettings.Drift> drifts = KioskSettings.detect(live);
        if (drifts.isEmpty()) return record(Verdict.OK, 0);

        // Write ONLY what drifted, never the whole desired set.
        List<String> repaired = new ArrayList<>();
        for (KioskSettings.Drift d : drifts) {
            boolean ok = d.type == KioskSettings.Type.BOOL
                    ? fkb.setBoolean(d.key, d.desired)
                    : fkb.setString(d.key, d.desired);
            repaired.add(d.key + " " + d.live + "→" + d.desired + (ok ? "" : " [WRITE FAILED]"));
            if (ok) {
                repairsSinceBoot.computeIfAbsent(d.key, k -> new AtomicInteger()).incrementAndGet();
            }
        }
        lastRepair = String.join(", ", repaired);
        // This line is the whole point of the feature: it is how a kiosk found
        // switched off becomes visible after the fact.
        notes.note("KIOSKSET", "drift repaired: " + lastRepair);
        Log.w(TAG, "drift repaired: " + lastRepair);
        return record(Verdict.REPAIRED, drifts.size());
    }

    private Verdict record(Verdict v, int driftCount) {
        lastVerdict = v;
        lastDriftCount = driftCount;
        return v;
    }

    // --- disarm / re-arm ----------------------------------------------------

    /**
     * Silence the guard until {@code untilEpochMs} (0 = re-arm now). Takes effect
     * IMMEDIATELY in memory; the caller separately persists the value to config so it
     * survives the bridge restart that hands-on tablet work usually involves.
     */
    public void setDisarmUntil(long untilEpochMs) {
        disarmUntilOverrideMs = Math.max(0L, untilEpochMs);
        notes.note("KIOSKSET", untilEpochMs > 0
                ? "DISARMED until " + untilEpochMs + " (drift will not be repaired)"
                : "re-armed");
    }

    public long disarmUntilMs() {
        Params p = params.get();
        return Math.max(p.disarmUntilMs, disarmUntilOverrideMs);
    }

    // --- introspection (GET /kiosk/settings, embedded in /diagnostics) ------

    public JSONObject snapshot() {
        JSONObject o = new JSONObject();
        try {
            Params p = params.get();
            long now = clock.getAsLong();
            long lastUpdate = lastUpdateRequestAtMs.getAsLong();
            long disarmUntil = Math.max(p.disarmUntilMs, disarmUntilOverrideMs);

            o.put("ok", true);
            o.put("enabled", p.enabled);
            o.put("intervalMs", p.intervalMs);
            o.put("hasPassword", p.hasPassword);
            o.put("verdict", lastVerdict == null ? JSONObject.NULL : lastVerdict.name());
            o.put("lastCheckAtMs", lastCheckAtMs == 0 ? JSONObject.NULL : lastCheckAtMs);
            o.put("lastCheckAgoMs", lastCheckAtMs == 0 ? JSONObject.NULL : now - lastCheckAtMs);
            o.put("lastDriftCount", lastDriftCount);
            o.put("lastRepair", lastRepair == null ? JSONObject.NULL : lastRepair);
            o.put("disarmUntilMs", disarmUntil == 0 ? JSONObject.NULL : disarmUntil);
            o.put("disarmed", now < disarmUntil);
            o.put("installHoldMs", p.installHoldMs);
            o.put("lastUpdateRequestAtMs", lastUpdate == 0 ? JSONObject.NULL : lastUpdate);
            o.put("installHoldActive", lastUpdate > 0 && (now - lastUpdate) < p.installHoldMs);

            JSONObject repairs = new JSONObject();
            for (Map.Entry<String, AtomicInteger> e : repairsSinceBoot.entrySet()) {
                repairs.put(e.getKey(), e.getValue().get());
            }
            o.put("repairsSinceBoot", repairs);

            JSONObject desired = new JSONObject();
            for (Map.Entry<String, KioskSettings.Desired> e : KioskSettings.DESIRED.entrySet()) {
                desired.put(e.getKey(), e.getValue().value);
            }
            o.put("desired", desired);
        } catch (Exception e) {
            try { o.put("ok", false).put("error", String.valueOf(e.getMessage())); }
            catch (Exception ignored) { }
        }
        return o;
    }
}
