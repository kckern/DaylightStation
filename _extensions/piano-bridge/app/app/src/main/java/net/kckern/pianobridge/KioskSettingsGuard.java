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
 *   <li><b>Install hold</b> — POST /update computes a deadline
 *       {@code now + watchdogKioskSettingsInstallHoldMs} (default 15 min) and both
 *       holds it in memory and PERSISTS it, so the hold survives the service restart
 *       that the install itself causes. Inferred from install activity, so the deploy
 *       needs no new manual step. See {@link #installHoldUntilMs()}.</li>
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

    /**
     * Persists one flat config key. Throws on failure — callers MUST surface that
     * rather than reporting a clean success, because a deadline that did not persist
     * silently reverts at the next restart.
     */
    public interface ConfigWriter { void write(String key, long value) throws Exception; }

    static final String KEY_DISARM_UNTIL = "kioskSettingsDisarmUntilEpochMs";
    static final String KEY_INSTALL_HOLD_UNTIL = "kioskSettingsInstallHoldUntilEpochMs";

    /** Config snapshot for one tick, so tests need no Android Context. */
    public static final class Params {
        public final boolean enabled;
        public final long intervalMs;
        /** Hold DURATION — used to compute a new deadline, and for display. */
        public final long installHoldMs;
        /** PERSISTED hold deadline (epoch ms). Survives the restart an install causes. */
        public final long installHoldUntilMs;
        public final long disarmUntilMs;
        public final boolean hasPassword;
        public Params(boolean enabled, long intervalMs, long installHoldMs,
                      long installHoldUntilMs, long disarmUntilMs, boolean hasPassword) {
            this.enabled = enabled;
            this.intervalMs = intervalMs;
            this.installHoldMs = installHoldMs;
            this.installHoldUntilMs = installHoldUntilMs;
            this.disarmUntilMs = disarmUntilMs;
            this.hasPassword = hasPassword;
        }
    }

    private final Supplier<Params> params;
    private final LongSupplier lastUpdateRequestAtMs;
    private final Fkb fkb;
    private final Notes notes;
    private final LongSupplier clock;
    private final ConfigWriter configWriter;

    // --- state (read by snapshot(), written by tick()) ---
    private volatile Verdict lastVerdict = null;
    private volatile long lastCheckAtMs = 0;
    private volatile int lastDriftCount = 0;
    private volatile String lastRepair = null;
    private final Map<String, AtomicInteger> repairsSinceBoot = new ConcurrentHashMap<>();
    /** One-shot latch: a permanently unconfigured device must not log every tick. */
    private volatile boolean noPasswordLogged = false;

    // --- the two in-memory + persisted deadline pairs ------------------------
    //
    // {@code null} means "this process has issued no explicit instruction" — the
    // persisted config value then governs, which is how a deadline survives the restart
    // an APK install causes. A non-null value is THIS PROCESS'S latest explicit
    // instruction and WINS, including when it is 0 (a clear).
    //
    // These were previously plain longs combined with max(persisted, inMemory), and
    // that is precisely what made the v23 rearm bug possible: max() cannot express a
    // clear. Zeroing the in-memory half left the stale persisted deadline winning, so
    // `pbctl kiosk-rearm` printed success while the guard stayed inert. Any future
    // in-memory + persisted pair must use this shape, not max().
    private volatile Long disarmUntilOverride = null;
    private volatile Long installHoldUntilOverride = null;

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
                    c.kioskSettingsInstallHoldUntilMs(),
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
        // Persist through the MERGING writeOverride (no sibling key is disturbed), then
        // refresh the cached DeviceConfig so the persisted half of every deadline pair
        // is read fresh. Without that refresh a write lands on disk while this guard
        // keeps reading the value it loaded at startup — half of the v23 rearm bug.
        this.configWriter = (key, value) -> {
            DeviceConfig.writeOverride(service, key + ": " + value + "\n");
            service.reloadConfigOnly();
        };
    }

    /** Test wiring: everything injected, no Android, no network. */
    KioskSettingsGuard(Supplier<Params> params, LongSupplier lastUpdateRequestAtMs,
                       Fkb fkb, Notes notes, LongSupplier clock) {
        this(params, lastUpdateRequestAtMs, fkb, notes, clock, (key, value) -> { });
    }

    /** Test wiring with a config store, so persistence round-trips are assertable. */
    KioskSettingsGuard(Supplier<Params> params, LongSupplier lastUpdateRequestAtMs,
                       Fkb fkb, Notes notes, LongSupplier clock, ConfigWriter configWriter) {
        this.configHolder = null;
        this.configWriter = configWriter;
        this.params = params;
        this.lastUpdateRequestAtMs = lastUpdateRequestAtMs;
        this.fkb = fkb;
        this.notes = notes;
        this.clock = clock;
    }

    /** Holds the live DeviceConfig on device (null in tests); swapped by updateConfig. */
    private final DeviceConfig[] configHolder;

    /**
     * Swap in refreshed config after a pbctl /config edit, keeping counters.
     *
     * <p>Also RETIRES both in-memory deadline overrides. A freshly loaded config is by
     * definition the newest authority — it is what our own persist just wrote, or what
     * an operator set directly with {@code pbctl config set}. Keeping a stale override
     * alive past a reload would make {@code config set} silently ineffective on these
     * two keys, which is the mirror image of the v23 bug.
     */
    public void updateConfig(DeviceConfig cfg) {
        if (configHolder != null) configHolder[0] = cfg;
        disarmUntilOverride = null;
        installHoldUntilOverride = null;
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

    /** The outcome of one pass: what was found wrong, and what was successfully fixed. */
    static final class Pass {
        final Verdict verdict;
        /** Keys observed to have drifted. Empty unless the pass got as far as reading. */
        final List<String> drifted;
        /** Keys actually written back OK — diverges from {@link #drifted} on write failure. */
        final List<String> repaired;
        Pass(Verdict verdict, List<String> drifted, List<String> repaired) {
            this.verdict = verdict; this.drifted = drifted; this.repaired = repaired;
        }
    }

    /**
     * One scheduled evaluation. Returns the verdict so it is directly assertable; the
     * on-device timer ignores the return value and reads {@link #snapshot()} instead.
     */
    Verdict tick() { return runPass(false).verdict; }

    /**
     * One evaluation.
     *
     * <p><b>What {@code force} does, and what it deliberately does NOT.</b> A forced
     * pass (POST /kiosk/settings/check) bypasses the INSTALL HOLD but is still refused
     * by DISABLED and DISARMED. The distinction is inference vs. instruction: the
     * install hold is something the guard *inferred* from a recent /update, and the
     * operator asking for a check right now has better information than the inference
     * — they know whether an install is really pending. Disabled and disarmed are
     * explicit human settings meaning "leave this alone", and a request to check is
     * not a request to override them. A future reader will wonder why the three gates
     * aren't treated alike; this is why.
     *
     * <p>Synchronized so a forced pass and the timer's pass can't interleave their
     * reads, writes and result bookkeeping.
     */
    synchronized Pass runPass(boolean force) {
        Params p = params.get();
        long now = clock.getAsLong();
        lastCheckAtMs = now;

        if (!p.enabled) return refuse(Verdict.DISABLED);

        long disarmUntil = disarmUntilMs();
        if (now < disarmUntil) return refuse(Verdict.DISARMED);

        // Stand down while an APK install may be in flight — re-arming kiosk mode
        // mid-install auto-dismisses the confirm dialog and aborts the install.
        if (!force && now < installHoldUntilMs()) return refuse(Verdict.INSTALL_HOLD);

        if (!p.hasPassword) {
            // ONCE, not every tick: the durable log is head-truncated at 128KB, so a
            // per-tick note on a permanently unconfigured device would evict real history.
            if (!noPasswordLogged) {
                noPasswordLogged = true;
                notes.note("KIOSKSET", "fkbPassword is unset — kiosk-settings guard is INERT. "
                        + "Set it with `pbctl config set fkbPassword …`.");
            }
            return refuse(Verdict.NO_PASSWORD);
        }

        Map<String, String> live = fkb.listSettings();
        if (live == null || live.isEmpty()) return refuse(Verdict.UNREACHABLE);

        List<KioskSettings.Drift> drifts = KioskSettings.detect(live);
        if (drifts.isEmpty()) return record(Verdict.OK, emptyList(), emptyList());

        // Write ONLY what drifted, never the whole desired set.
        List<String> drifted = new ArrayList<>();
        List<String> repaired = new ArrayList<>();
        List<String> detail = new ArrayList<>();
        for (KioskSettings.Drift d : drifts) {
            drifted.add(d.key);
            boolean ok = d.type == KioskSettings.Type.BOOL
                    ? fkb.setBoolean(d.key, d.desired)
                    : fkb.setString(d.key, d.desired);
            detail.add(d.key + " " + d.live + "→" + d.desired + (ok ? "" : " [WRITE FAILED]"));
            if (ok) {
                repaired.add(d.key);
                repairsSinceBoot.computeIfAbsent(d.key, k -> new AtomicInteger()).incrementAndGet();
            }
        }
        lastRepair = String.join(", ", detail);
        // This line is the whole point of the feature: it is how a kiosk found
        // switched off becomes visible after the fact.
        notes.note("KIOSKSET", "drift repaired: " + lastRepair);
        Log.w(TAG, "drift repaired: " + lastRepair);
        return record(Verdict.REPAIRED, drifted, repaired);
    }

    /** A pass that stopped at a gate — no read, no write, nothing found. */
    private Pass refuse(Verdict v) { return record(v, emptyList(), emptyList()); }

    private Pass record(Verdict v, List<String> drifted, List<String> repaired) {
        lastVerdict = v;
        lastDriftCount = drifted.size();
        return new Pass(v, drifted, repaired);
    }

    private static List<String> emptyList() { return java.util.Collections.emptyList(); }

    /**
     * Run one pass RIGHT NOW, bypassing the install hold, and report what happened.
     * Drives POST /kiosk/settings/check — the deploy-time acceptance test. See
     * {@link #runPass} for why this overrides the hold but not a disarm.
     */
    public JSONObject forceCheck() {
        Pass p = runPass(true);
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("forced", true);
            o.put("verdict", p.verdict.name());
            o.put("driftCount", p.drifted.size());
            o.put("drifted", new org.json.JSONArray(p.drifted));
            o.put("repaired", new org.json.JSONArray(p.repaired));
            o.put("lastRepair", lastRepair == null ? JSONObject.NULL : lastRepair);
        } catch (Exception e) {
            try { o.put("ok", false).put("error", String.valueOf(e.getMessage())); }
            catch (Exception ignored) { }
        }
        return o;
    }

    // --- disarm / re-arm ----------------------------------------------------

    /**
     * Set the in-memory disarm deadline only (0 = armed). Prefer
     * {@link #disarmForMinutes} / {@link #rearm}, which also persist and report
     * honestly; this is the raw half, used by them and by tests.
     */
    public void setDisarmUntil(long untilEpochMs) {
        disarmUntilOverride = Math.max(0L, untilEpochMs);
    }

    /** The in-memory install-hold deadline only (0 = no hold). See {@link #setDisarmUntil}. */
    public void setInstallHoldUntil(long untilEpochMs) {
        installHoldUntilOverride = Math.max(0L, untilEpochMs);
    }

    /**
     * Effective disarm deadline: this process's explicit instruction if it has issued
     * one, otherwise the persisted config value. See the field comments for why this is
     * NOT {@code max(persisted, inMemory)}.
     */
    public long disarmUntilMs() {
        Long o = disarmUntilOverride;
        return o != null ? o : params.get().disarmUntilMs;
    }

    /**
     * Effective install-hold deadline, same rule as {@link #disarmUntilMs}.
     *
     * <p>The persisted half is the v22 fix: an APK install STOPS this service, deploy
     * step 7 relaunches it (and says to repeat until it answers), and a hold living
     * only in a {@link PianoBridgeService} field reset to 0 on each such restart —
     * leaving a retried or second install with no hold at all.
     *
     * <p>We persist the DEADLINE, not the request timestamp, so later reducing
     * {@code watchdogKioskSettingsInstallHoldMs} cannot retroactively cut short a hold
     * that is already running.
     */
    public long installHoldUntilMs() {
        Long o = installHoldUntilOverride;
        return o != null ? o : params.get().installHoldUntilMs;
    }

    /** Disarm for {@code minutes}, persisting the deadline. Clamped 1…1440 by the caller. */
    public JSONObject disarmForMinutes(int minutes) {
        long until = clock.getAsLong() + minutes * 60_000L;
        return applyDeadline(KEY_DISARM_UNTIL, until, "kiosk_settings_disarm",
                "DISARMED until " + until + " (drift will not be repaired)");
    }

    /** Re-arm now: clears BOTH the in-memory and the persisted disarm deadline. */
    public JSONObject rearm() {
        return applyDeadline(KEY_DISARM_UNTIL, 0L, "kiosk_settings_rearm", "re-armed");
    }

    /**
     * Arm the install hold until {@code untilEpochMs}, persisting it. Called from
     * {@link PianoBridgeService#markUpdateRequested()} — the same both-halves path as
     * disarm, so the hold can never end up applied to only one of them.
     */
    public JSONObject holdInstallUntil(long untilEpochMs) {
        return applyDeadline(KEY_INSTALL_HOLD_UNTIL, untilEpochMs, "kiosk_settings_install_hold",
                "install requested — kiosk-settings guard holding off until " + untilEpochMs);
    }

    /**
     * Apply a deadline to BOTH halves of a pair and report each half honestly.
     *
     * <p>The invariant this exists to enforce: <b>setting writes both, and clearing
     * must clear both.</b> The v23 rearm cleared only the in-memory half, so the stale
     * persisted deadline kept the guard inert while the CLI reported success — the
     * worst failure mode available, since the operator walks away believing the tablet
     * is protected. A half-applied change is reported as {@code ok:false} with a
     * warning, never as a clean success.
     */
    private synchronized JSONObject applyDeadline(String key, long value, String action, String note) {
        if (KEY_DISARM_UNTIL.equals(key)) setDisarmUntil(value); else setInstallHoldUntil(value);

        boolean persisted;
        String error = null;
        try {
            configWriter.write(key, value);
            persisted = true;
        } catch (Exception e) {
            persisted = false;
            error = String.valueOf(e.getMessage());
            Log.w(TAG, "could not persist " + key + "=" + value, e);
        }

        notes.note("KIOSKSET", persisted
                ? note
                : "WARN: " + note + " applied IN MEMORY ONLY — could not persist " + key
                        + " (" + error + "); it will revert when the bridge restarts");

        JSONObject o = new JSONObject();
        try {
            o.put("ok", persisted);
            o.put("action", action);
            o.put("inMemoryCleared", true);      // the in-memory half always applies
            o.put("inMemoryValue", value);
            o.put("persistedCleared", persisted);
            if (!persisted) {
                o.put("warning", "applied in memory only — could not persist " + key
                        + " (" + error + "). It will revert when the bridge restarts; "
                        + "clear it by hand with `pbctl config set " + key + " " + value + "`.");
            }
        } catch (Exception ignored) { }
        return o;
    }

    // --- introspection (GET /kiosk/settings, embedded in /diagnostics) ------

    public JSONObject snapshot() {
        JSONObject o = new JSONObject();
        try {
            Params p = params.get();
            long now = clock.getAsLong();
            long lastUpdate = lastUpdateRequestAtMs.getAsLong();
            long disarmUntil = disarmUntilMs();

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
            long holdUntil = installHoldUntilMs();
            o.put("installHoldMs", p.installHoldMs);
            o.put("installHoldUntilMs", holdUntil == 0 ? JSONObject.NULL : holdUntil);
            o.put("installHoldRemainingMs", Math.max(0L, holdUntil - now));
            o.put("lastUpdateRequestAtMs", lastUpdate == 0 ? JSONObject.NULL : lastUpdate);
            o.put("installHoldActive", now < holdUntil);

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
