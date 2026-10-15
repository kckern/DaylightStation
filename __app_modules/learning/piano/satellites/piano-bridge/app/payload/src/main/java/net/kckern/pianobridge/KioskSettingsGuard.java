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
        /** FKB did not answer — state unknown. */
        UNREACHABLE,
        /** FKB answered but refused fkbPassword ({"status":"Error"}): the guard is blind. */
        AUTH_FAILED,
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
        /** FKB's deviceInfo.foregroundApp; null/empty means UNKNOWN. */
        default String foregroundApp() { return null; }
        /** Bring FKB back to the front (device: a11y HOME, then FKB toForeground). */
        default boolean toForeground() { return false; }
        /** True when FKB's latest answer was a login refusal (stale fkbPassword). */
        default boolean authFailing() { return false; }
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
        public final boolean foregroundEnabled;
        public final long foregroundIntervalMs;
        /** How long Android Settings may stay in front (Bluetooth pairing) before recall. */
        public final long settingsGraceMs;
        public Params(boolean enabled, long intervalMs, long installHoldMs,
                      long installHoldUntilMs, long disarmUntilMs, boolean hasPassword) {
            this(enabled, intervalMs, installHoldMs, installHoldUntilMs, disarmUntilMs, hasPassword,
                    true, 10_000L, 180_000L);
        }
        public Params(boolean enabled, long intervalMs, long installHoldMs,
                      long installHoldUntilMs, long disarmUntilMs, boolean hasPassword,
                      boolean foregroundEnabled, long foregroundIntervalMs, long settingsGraceMs) {
            this.foregroundEnabled = foregroundEnabled;
            this.foregroundIntervalMs = foregroundIntervalMs;
            this.settingsGraceMs = settingsGraceMs;
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
    /** Noted once per refusal streak, cleared when FKB accepts the password again. */
    private volatile boolean authFailLogged = false;

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
    private java.util.Timer foregroundTimer;

    /**
     * Hard ceiling on any window in which the guard stands down (disarm or install
     * hold). Kids reached other apps on 2026-10-09; a stand-down is the one state in
     * which nothing pulls them back, so no stand-down may outlast an hour — including
     * one written straight into config with `pbctl config set`.
     */
    static final long MAX_STAND_DOWN_MS = 60 * 60_000L;

    /** Fully Kiosk's own package — the only app that belongs in front. */
    static final String FKB_PACKAGE = "de.ozerov.fully";
    /** Android Settings: reachable on purpose (Bluetooth pairing tile), so it gets a grace. */
    static final String SETTINGS_PACKAGE = "com.android.settings";
    /** The bridge's own activity (`fkb launch net.kckern.pianobridge` bounces the process). */
    static final String BRIDGE_PACKAGE = "net.kckern.pianobridge";

    /** Device wiring: config from {@link DeviceConfig}, FKB over REST, log to CrashLog. */
    public KioskSettingsGuard(BridgeCore service, DeviceConfig cfg) {
        final DeviceConfig[] held = { cfg };
        this.configHolder = held;
        this.params = () -> {
            DeviceConfig c = held[0];
            return new Params(c.watchdogKioskSettingsEnabled(),
                    c.watchdogKioskSettingsIntervalMs(),
                    c.watchdogKioskSettingsInstallHoldMs(),
                    c.kioskSettingsInstallHoldUntilMs(),
                    c.kioskSettingsDisarmUntilMs(),
                    !c.fkbPassword().isEmpty(),
                    c.watchdogKioskForegroundEnabled(),
                    c.watchdogKioskForegroundIntervalMs(),
                    c.watchdogKioskForegroundSettingsGraceMs());
        };
        this.lastUpdateRequestAtMs = service::lastUpdateRequestAtMs;
        this.fkb = new Fkb() {
            @Override public Map<String, String> listSettings() { return FkbRest.listSettings(held[0]); }
            @Override public boolean setBoolean(String key, String value) { return set("setBooleanSetting", key, value); }
            @Override public boolean setString(String key, String value) { return set("setStringSetting", key, value); }
            @Override public String foregroundApp() {
                // Our own accessibility service first: it needs no FKB password, so a
                // stale fkbPassword cannot blind the guard again (2026-10-14).
                String seen = ForegroundWatch.front();
                if (seen != null) return seen;
                JSONObject info = FkbRest.deviceInfo(held[0]);
                Object fg = info.opt("foreground");
                return fg == null || fg == JSONObject.NULL ? null : String.valueOf(fg);
            }
            @Override public boolean toForeground() {
                // Android refuses FKB's own toForeground from the background (it answers
                // OK and does nothing). HOME, then a direct start from the a11y context,
                // which is exempt from that block; toForeground last, belt and braces.
                boolean home = A11y.home();
                boolean launched = A11y.launch(FKB_PACKAGE);
                int code = FkbRest.command(held[0], "toForeground");
                return home || launched || (code >= 200 && code < 400);
            }
            @Override public boolean authFailing() { return FkbRest.authFailing(); }
            private boolean set(String cmd, String key, String value) {
                Map<String, String> p = new LinkedHashMap<>();
                p.put("key", key);
                p.put("value", value);
                int code = FkbRest.command(held[0], cmd, p);
                return code >= 200 && code < 400;
            }
        };
        // Durable on the tablet AND in the log store: a recall or a blind guard is
        // exactly what has to be findable afterwards without reaching the tablet.
        this.notes = (kind, msg) -> {
            CrashLog.note(kind, msg);
            JSONObject d = new JSONObject();
            try { d.put("kind", kind).put("note", msg); } catch (Exception ignored) { }
            // Startup is routine; everything else this guard notes is a recall or a fault.
            LogEvents.emit(held[0], "kiosk.guard.note", msg.startsWith("guard started") ? "info" : "warn", d);
        };
        this.clock = System::currentTimeMillis;
        // Persist through the MERGING writeOverride (no sibling key is disturbed), then
        // refresh the cached DeviceConfig so the persisted half of every deadline pair
        // is read fresh. Without that refresh a write lands on disk while this guard
        // keeps reading the value it loaded at startup — half of the v23 rearm bug.
        this.configWriter = (key, value) -> {
            DeviceConfig.writeOverride(service.getContext(), key + ": " + value + "\n");
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
        long fgPeriod = Math.max(2_000L, params.get().foregroundIntervalMs);
        foregroundTimer = new java.util.Timer("kiosk-foreground-guard", true);
        foregroundTimer.scheduleAtFixedRate(new java.util.TimerTask() {
            @Override public void run() {
                try { foregroundTick(); } catch (Throwable t) { Log.e(TAG, "foreground tick failed", t); }
            }
        }, fgPeriod, fgPeriod);
        notes.note("KIOSKSET", "guard started (intervalMs=" + period
                + " foregroundIntervalMs=" + fgPeriod
                + " keys=" + KioskSettings.DESIRED.size() + ")");
    }

    public void stop() {
        if (timer != null) { timer.cancel(); timer = null; }
        if (foregroundTimer != null) { foregroundTimer.cancel(); foregroundTimer = null; }
    }

    // --- the foreground pass ------------------------------------------------

    /** What the foreground pass concluded. */
    public enum ForegroundVerdict {
        DISABLED, DISARMED, INSTALL_HOLD, NO_PASSWORD,
        /** FKB did not report a foreground app. */
        UNKNOWN,
        /** FKB refused fkbPassword, so the foreground cannot be read. Nothing is recalled. */
        AUTH_FAILED,
        /** FKB is in front. */
        HOME,
        /** An allowed app (Settings, the bridge) is in front, within its grace. */
        GRACE,
        /** Something else was in front and toForeground was sent. */
        RECALLED,
        /** toForeground was sent and FKB refused it. */
        RECALL_FAILED
    }

    private volatile ForegroundVerdict lastForegroundVerdict = null;
    private volatile String lastForegroundApp = null;
    /** First moment FKB was seen NOT in front, 0 while it is. Grace counts from here. */
    private volatile long awaySinceMs = 0;
    private volatile String lastRecall = null;
    private final AtomicInteger recallsSinceBoot = new AtomicInteger();
    private volatile int recallsThisExcursion = 0;

    /**
     * One foreground check: if anything but FKB is in front, call FKB back.
     *
     * <p>The grace is measured from FIRST LEAVING FKB, not from entering the current
     * app, so hopping Settings → another app → Settings cannot restart the clock. Any
     * non-allowed app is recalled on the very tick it is seen. Honors the same disarm
     * and install hold as the settings pass — the install dialog and the battery-
     * exemption dialog are not FKB either.
     */
    synchronized ForegroundVerdict foregroundTick() {
        Params p = params.get();
        long now = clock.getAsLong();
        if (!p.enabled || !p.foregroundEnabled) return fg(ForegroundVerdict.DISABLED, null);
        if (now < effectiveDisarmUntil(now)) return fg(ForegroundVerdict.DISARMED, null);
        if (now < effectiveInstallHoldUntil(now)) return fg(ForegroundVerdict.INSTALL_HOLD, null);
        if (!p.hasPassword) return fg(ForegroundVerdict.NO_PASSWORD, null);

        String app = fkb.foregroundApp();
        if (app == null || app.isEmpty()) {
            if (fkb.authFailing()) {
                noteAuthFailed();
                return fg(ForegroundVerdict.AUTH_FAILED, null);
            }
            return fg(ForegroundVerdict.UNKNOWN, null);
        }
        authFailLogged = false;
        if (FKB_PACKAGE.equals(app)) {
            awaySinceMs = 0;
            recallsThisExcursion = 0;
            return fg(ForegroundVerdict.HOME, app);
        }
        if (awaySinceMs == 0) awaySinceMs = now;
        long away = now - awaySinceMs;
        long grace = graceFor(app, p);
        if (away < grace) return fg(ForegroundVerdict.GRACE, app);

        boolean ok = fkb.toForeground();
        int n = recallsSinceBoot.incrementAndGet();
        lastRecall = app + " after " + (away / 1000) + "s" + (ok ? "" : " [toForeground FAILED]");
        // The away clock is NOT reset here — only seeing FKB in front resets it, so a
        // recall that did not take keeps being retried and stays visible as awayForMs.
        // Note the first recall of an excursion and every 30th retry, so a stuck one
        // cannot evict real history from the head-truncated durable log.
        recallsThisExcursion++;
        if (recallsThisExcursion == 1 || recallsThisExcursion % 30 == 0) {
            notes.note("KIOSKSET", "foreground recalled: " + lastRecall
                    + (recallsThisExcursion > 1 ? " (retry " + recallsThisExcursion + ")" : ""));
        }
        Log.w(TAG, "foreground recalled (#" + n + "): " + lastRecall);
        return fg(ok ? ForegroundVerdict.RECALLED : ForegroundVerdict.RECALL_FAILED, app);
    }

    private static long graceFor(String app, Params p) {
        if (SETTINGS_PACKAGE.equals(app)) return p.settingsGraceMs;
        if (BRIDGE_PACKAGE.equals(app)) return 120_000L;
        return 0L;
    }

    private ForegroundVerdict fg(ForegroundVerdict v, String app) {
        lastForegroundVerdict = v;
        if (app != null) lastForegroundApp = app;
        return v;
    }

    // --- stand-down ceiling -------------------------------------------------

    /** Disarm deadline, cut back to {@link #MAX_STAND_DOWN_MS} from now if longer. */
    private long effectiveDisarmUntil(long now) {
        long until = disarmUntilMs();
        if (until > now + MAX_STAND_DOWN_MS) {
            until = now + MAX_STAND_DOWN_MS;
            applyDeadline(KEY_DISARM_UNTIL, until, "kiosk_settings_disarm_capped",
                    "disarm deadline beyond the 1h ceiling — capped to " + until);
        }
        return until;
    }

    /** Install-hold deadline, cut back to {@link #MAX_STAND_DOWN_MS} from now if longer. */
    private long effectiveInstallHoldUntil(long now) {
        long until = installHoldUntilMs();
        if (until > now + MAX_STAND_DOWN_MS) {
            until = now + MAX_STAND_DOWN_MS;
            applyDeadline(KEY_INSTALL_HOLD_UNTIL, until, "kiosk_settings_install_hold_capped",
                    "install-hold deadline beyond the 1h ceiling — capped to " + until);
        }
        return until;
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

        long disarmUntil = effectiveDisarmUntil(now);
        if (now < disarmUntil) return refuse(Verdict.DISARMED);

        // Stand down while an APK install may be in flight — re-arming kiosk mode
        // mid-install auto-dismisses the confirm dialog and aborts the install.
        if (!force && now < effectiveInstallHoldUntil(now)) return refuse(Verdict.INSTALL_HOLD);

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
        if (live == null || live.isEmpty()) {
            if (fkb.authFailing()) {
                noteAuthFailed();
                return refuse(Verdict.AUTH_FAILED);
            }
            return refuse(Verdict.UNREACHABLE);
        }
        authFailLogged = false;

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
    /**
     * Once per refusal streak, not every tick: the durable log is head-truncated, and
     * a foreground tick every 10 s would evict real history within a day.
     */
    private void noteAuthFailed() {
        if (authFailLogged) return;
        authFailLogged = true;
        notes.note("KIOSKSET", "FKB REFUSED fkbPassword — foreground guard, settings guard "
                + "and the recovery ladder are BLIND. Fix: `pbctl config set fkbPassword …`.");
        Log.e(TAG, "FKB refused fkbPassword — kiosk guards blind");
    }

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
     * only in a {@link BridgeCore} field reset to 0 on each such restart —
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

    /** Disarm for {@code minutes}, persisting the deadline. Clamped 1…60 by the caller. */
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
     * {@link BridgeCore#markUpdateRequested()} — the same both-halves path as
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

            JSONObject fgo = new JSONObject();
            fgo.put("enabled", p.foregroundEnabled);
            fgo.put("intervalMs", p.foregroundIntervalMs);
            fgo.put("settingsGraceMs", p.settingsGraceMs);
            fgo.put("verdict", lastForegroundVerdict == null ? JSONObject.NULL : lastForegroundVerdict.name());
            fgo.put("lastApp", lastForegroundApp == null ? JSONObject.NULL : lastForegroundApp);
            fgo.put("awayForMs", awaySinceMs == 0 ? JSONObject.NULL : now - awaySinceMs);
            fgo.put("lastRecall", lastRecall == null ? JSONObject.NULL : lastRecall);
            fgo.put("recallsSinceBoot", recallsSinceBoot.get());
            o.put("foreground", fgo);
            o.put("maxStandDownMs", MAX_STAND_DOWN_MS);

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
