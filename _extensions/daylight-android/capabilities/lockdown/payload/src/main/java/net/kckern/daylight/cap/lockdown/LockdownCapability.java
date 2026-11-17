package net.kckern.daylight.cap.lockdown;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.webkit.WebView;

import net.kckern.daylight.core.AccessibilityHub;
import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.EventBus;
import net.kckern.daylight.core.LogEvents;
import net.kckern.daylight.core.MainThread;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Requests;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsControl;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.SettingsRegistry.Type;
import net.kckern.daylight.core.UnsupportedException;
import net.kckern.daylight.core.kiosk.AllowRules;
import net.kckern.daylight.core.spi.DeviceAdminAccess;
import net.kckern.daylight.core.spi.InputLock;
import net.kckern.daylight.core.spi.KioskSurface;
import net.kckern.daylight.core.spi.LockdownControl;
import net.kckern.daylight.core.spi.PackageGate;
import net.kckern.daylight.core.spi.PairingDialogExemption;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.Set;
import java.util.Timer;
import java.util.TimerTask;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Keeps the kiosk in front. A one-second watcher samples the windows through the
 * accessibility service and recalls the kiosk when something that is not allowed is in
 * front, or when it cannot tell what is. The mode (owner or app) is read at run time.
 */
public final class LockdownCapability implements Capability, LockdownControl {
    /** The Activity webview-host's shell half declares; the device manifest gives it the HOME filter. */
    static final String KIOSK_ACTIVITY = "net.kckern.daylight.cap.webviewhost.shell.KioskActivity";
    private static final long TICK_MS = 1_000L;
    /** No unlock outlasts this, whatever was asked for and whatever is stored. */
    static final int MAX_UNLOCK_MIN = 60;
    /** While the PIN prompt may be up, the kiosk window losing focus is our own doing. */
    private static final long PIN_PROMPT_MS = 60_000L;

    private CoreContext core;
    private volatile Context context;
    private volatile String ownPackage = "";
    private volatile boolean running;

    private A11yFace a11y;
    private final Exemptions exemptions = new Exemptions();
    private final ExitGesture gesture = new ExitGesture();
    private final HomeState home = new HomeState();
    private final ControlCenter controlCenter = new ControlCenter();
    private final AtomicInteger recalls = new AtomicInteger();
    private final Set<String> blocked = ConcurrentHashMap.newKeySet();
    private final Object lockGuard = new Object();
    private LockState lockState = new LockState();                 // guarded by lockGuard
    private volatile InputLockState inputLock = new InputLockState();

    private volatile ForegroundTrail trail;
    private volatile OwnerPolicy owner;
    private volatile StatusBarShield shield;
    private volatile File stateFile, inputFile;
    private Timer timer;

    private long ticks, awaySinceMs;
    private int consecutiveRecalls, selfEnableAttempts;
    private volatile String front, ownerError;
    private volatile long frontAtMs, pinPromptAtMs;
    private volatile JSONObject lastRecall;
    // Refreshed by the watcher every 5 s, so GET /lockdown never makes a system call.
    private volatile boolean factAdmin, factOwner, factLockTask, factOverlay, factAdminFeature;

    private final EventBus.Listener onFocus = (topic, detail) -> {
        // The shade, the power menu or recents took focus from the kiosk. Ask the system to close them.
        if (!"kiosk-focus".equals(topic) || detail.optBoolean("focused", true)) return;
        Context c = context;
        if (c == null || !running || !locked()) return;
        // Not over our own PIN prompt, and not over a pairing dialog the page asked for.
        if (System.currentTimeMillis() - pinPromptAtMs < PIN_PROMPT_MS || pairingDialogAllowed()) return;
        try { c.sendBroadcast(new Intent(Intent.ACTION_CLOSE_SYSTEM_DIALOGS)); } catch (Exception ignored) { }
    };

    private final DeviceAdminAccess admin = new DeviceAdminAccess() {
        @Override public boolean adminActive() { OwnerPolicy o = owner; return o != null && o.adminActive(); }
        @Override public boolean isOwner() { OwnerPolicy o = owner; return o != null && o.isOwner(); }
        @Override public void lockNow() {
            OwnerPolicy o = owner;
            if (o == null) throw new UnsupportedException("device admin required");
            o.lockNow();
        }
        @Override public void reboot() {
            OwnerPolicy o = owner;
            if (o == null) throw new UnsupportedException("device owner required");
            o.reboot();
        }
    };

    private final InputLock inputLockService = new InputLock() {
        @Override public boolean active() { return inputLock.active(System.currentTimeMillis()); }
        @Override public long revision() { return inputLock.revision(); }
    };

    /**
     * For lease-gate. Closed means "not allowed in front": the watcher recalls the kiosk
     * whenever the package appears. Where this app is device owner the package is hidden
     * as well. Nothing is enforced while the kiosk is unlocked, so the gate is not ready then.
     */
    private final PackageGate gate = new PackageGate() {
        @Override public boolean ready() { return running && locked(); }

        @Override public boolean isHidden(String packageName) { return packageName != null && blocked.contains(packageName); }

        @Override public boolean setHidden(String packageName, boolean hidden) {
            if (packageName == null || packageName.isEmpty() || packageName.equals(ownPackage)) return false;
            OwnerPolicy o = owner;
            boolean ownerMode = o != null && ownerMode();
            if (hidden) {
                blocked.add(packageName);
                // The recall holds whether or not the hide took, so the gate is closed either way.
                if (ownerMode && !o.setHidden(packageName, true)) note("could not hide " + packageName + "; it is recalled instead");
                return true;
            }
            // A package that could not be shown again stays closed here too, so the two agree.
            if (ownerMode && !o.setHidden(packageName, false)) return false;
            blocked.remove(packageName);
            return true;
        }

        @Override public String hidingUnsupportedReason() { return LockdownCapability.this.hidingUnsupportedReason(); }
    };

    @Override public String name() { return "lockdown"; }

    // ── settings ──────────────────────────────────────────────────────────────

    private String str(String key) { return (String) core.settings().get(key); }
    private int integer(String key) { return (Integer) core.settings().get(key); }
    private boolean bool(String key) { return (Boolean) core.settings().get(key); }
    private KioskSurface surface() { return core.services().find(KioskSurface.class); }
    private void note(String message) { if (core.shell() != null) core.shell().note("LOCKDOWN", message); }

    /** The unlock ceiling in ms: the setting, held to 1..60 minutes whatever is stored. */
    private long ceilingMs() {
        return Math.max(1, Math.min(MAX_UNLOCK_MIN, integer("lockdown.maxUnlockMin"))) * 60_000L;
    }

    @Override public void register(CoreContext core) {
        this.core = core;
        this.a11y = new A11yFace(core.accessibility());
        SettingsRegistry s = core.settings();
        s.declare("lockdown.enabled", Type.BOOLEAN, true);
        s.declare("lockdown.mode", Type.STRING, "auto", SettingsRegistry.oneOf(LockMode.SETTINGS));
        s.declare("lockdown.allowedApps", Type.STRING, "");
        s.declare("lockdown.recallGraceMs", Type.INTEGER, 0, SettingsRegistry.range(0, 60_000));
        // The ceiling and the default length of an unlock. It cannot be switched off.
        s.declare("lockdown.maxUnlockMin", Type.INTEGER, MAX_UNLOCK_MIN, SettingsRegistry.range(1, MAX_UNLOCK_MIN));
        // How long the PIN gesture unlocks for. Shorter than an API unlock, and never past the ceiling.
        s.declare("lockdown.pinUnlockMin", Type.INTEGER, 10, SettingsRegistry.range(1, MAX_UNLOCK_MIN));
        // A secret: never returned, never compiled in. Empty means the gesture is off.
        s.declareSecret("lockdown.exitPin");
        s.declare("lockdown.immersive", Type.BOOLEAN, true);
        s.declare("lockdown.statusBarShield", Type.BOOLEAN, true);
        s.declare("lockdown.selfEnableAccessibility", Type.BOOLEAN, true);
        s.declare("lockdown.ownerRestrictions", Type.BOOLEAN, false);
        s.declare("lockdown.ownerHidePackages", Type.STRING, "");
        s.declare("lockdown.dismissControlCenter", Type.BOOLEAN, false);
        s.onChange(key -> {
            // The window events the dismissal needs are asked for only while it is on.
            if (running && "lockdown.dismissControlCenter".equals(key)) listenToAccessibility();
        });

        core.services().provide(LockdownControl.class, this);
        core.services().provide(DeviceAdminAccess.class, admin);
        core.services().provide(InputLock.class, inputLockService);
        core.services().provide(PackageGate.class, gate);

        Router router = core.router();
        router.route("GET", "/lockdown", req -> Router.Response.json(200, status()));
        router.route("POST", "/lockdown/lock", req -> {
            if (!bool("lockdown.enabled")) throw new UnsupportedException("lockdown.enabled is false");
            synchronized (lockGuard) { lockState.lock(); persist(); }
            applyLocked(true);
            note("locked by request");
            return Router.Response.json(200, Replies.ok().put("locked", true).put("mode", mode()));
        });
        router.route("POST", "/lockdown/unlock", req -> {
            // With lockdown off there is nothing to unlock, and an unlock recorded now would
            // be waiting, with its window, for the moment lockdown is switched on.
            if (!bool("lockdown.enabled")) throw new UnsupportedException("lockdown.enabled is false");
            JSONObject body = Requests.body(req);
            Long forMs = null;
            if (body.has("forMs")) {
                if (!(body.get("forMs") instanceof Number)) throw new IllegalArgumentException("forMs must be a number of milliseconds");
                forMs = body.getLong("forMs");
            }
            long relockAt = unlock(forMs, "request");
            JSONObject o = Replies.ok().put("locked", false);
            if (relockAt > 0) o.put("relockAtMs", relockAt);
            return Router.Response.json(200, o);
        });
        // Beyond the control API contract: the ordered stop and release portal-keys took on
        // PUT /lockdown. While it is active the volume keys do nothing (volume-keys asks).
        router.route("POST", "/lockdown/input", req -> {
            LockdownCommand command = LockdownCommand.parse(req.body, System.currentTimeMillis());
            InputLockState state = inputLock;
            synchronized (state) {
                if (!state.apply(command)) {
                    return Router.Response.error(409, "stale_revision", "message", "stale or conflicting input lock revision");
                }
                // Stored before it is acknowledged: the caller treats the answer as the lock holding.
                if (!write(inputFile, state.toJson())) {
                    return Router.Response.error(500, "internal", "message", "the input lock could not be stored");
                }
            }
            note("input lock " + (command.locked ? "set" : "cleared") + " revision=" + state.revision());
            return Router.Response.json(200, inputLockJson(Replies.ok()));
        });
    }

    private JSONObject inputLockJson(JSONObject o) throws Exception {
        InputLockState state = inputLock;
        long until = state.until();
        return o.put("inputLocked", state.active(System.currentTimeMillis()))
                .put("revision", state.revision())
                .put("lockedUntil", until > 0 && until != Long.MAX_VALUE ? (Object) until : JSONObject.NULL);
    }

    // ── lifecycle ─────────────────────────────────────────────────────────────

    /** On the payload loader's worker thread, which has no Looper. Nothing here waits on the main thread. */
    @Override public void start() {
        Context ctx = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: there is nothing to watch.
        if (ctx == null) return;
        context = ctx;
        ownPackage = ctx.getPackageName();
        trail = new ForegroundTrail(ownPackage);
        owner = new OwnerPolicy(ctx);
        shield = new StatusBarShield(ctx);
        File stateDir = new File(core.shell().payloadDir(), "state");
        stateFile = new File(stateDir, "lockdown.json");
        inputFile = new File(stateDir, "input-lock.json");
        synchronized (lockGuard) {
            lockState = LockState.parse(read(stateFile));
            // A stored unlock with no end, or with one beyond the ceiling, is not honored.
            if (lockState.enforceCeiling(System.currentTimeMillis(), ceilingMs())) persist();
        }
        inputLock = InputLockState.parse(read(inputFile));
        running = true;

        core.events().subscribe(onFocus);
        a11y.onWindowsChanged(this::onWindowsChanged);
        listenToAccessibility();
        KioskSurface s = surface();
        if (s != null) s.observeTouches(this::onTouchDown);
        refreshFacts();
        applyLocked(locked());

        timer = new Timer("daylight-lockdown", true);
        timer.scheduleAtFixedRate(new TimerTask() {
            @Override public void run() {
                try { tick(System.currentTimeMillis()); } catch (Throwable t) { note("tick failed: " + t); }
            }
        }, TICK_MS, TICK_MS);
        note("started locked=" + locked() + " mode=" + mode() + " a11yBound=" + a11y.bound()
                + " adminActive=" + factAdmin + " overlayGranted=" + factOverlay);
    }

    /**
     * Window-state events name the activity in front; windows-changed events are what the
     * Control Center dismissal reacts to, and are asked for only when it is on. The hub
     * changes the service's info, which belongs on the main thread.
     */
    private void listenToAccessibility() {
        final int types = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                | (bool("lockdown.dismissControlCenter") ? AccessibilityEvent.TYPE_WINDOWS_CHANGED : 0);
        MainThread.post(() -> {
            AccessibilityHub hub = core.accessibility();
            hub.removeEventListener(a11y);
            if (running) hub.addEventListener(types, a11y);
        });
    }

    /** May be called twice, and while start() is still running. Does not wait on the main thread. */
    @Override public void stop() {
        running = false;
        Timer t = timer;
        timer = null;
        if (t != null) t.cancel();
        if (core == null) return;
        try { core.events().unsubscribe(onFocus); } catch (Throwable ignored) { }
        try { MainThread.post(() -> core.accessibility().removeEventListener(a11y)); } catch (Throwable ignored) { }
        try {
            KioskSurface s = surface();
            if (s != null && context != null) s.observeTouches(null);
        } catch (Throwable ignored) { }
        StatusBarShield sh = shield;
        if (sh != null) sh.set(false);
    }

    // ── the watcher ───────────────────────────────────────────────────────────

    /** One pass of the watcher. The timer calls it every second; nowMs is the wall clock. */
    void tick(long nowMs) {
        if (!running) return;
        ticks++;
        boolean relocked;
        synchronized (lockGuard) {
            relocked = lockState.tick(nowMs);
            if (lockState.enforceCeiling(nowMs, ceilingMs())) relocked = true;
            if (relocked) persist();
        }
        if (relocked) { note("relocked: the unlock window ended"); applyLocked(true); }
        boolean locked = locked();
        KioskSurface surface = surface();

        List<ForegroundTrail.Win> wins = a11y.windows();
        if (wins != null) {
            for (ForegroundTrail.Event e : trail.sample(nowMs, wins)) report(e);
            if (trail.front() != null) { front = trail.front(); frontAtMs = nowMs; }
        }
        boolean fresh = frontAtMs != 0 && nowMs - frontAtMs <= RecallDecision.FRESH_MS;
        boolean resumed = surface != null && surface.inForeground();
        awaySinceMs = RecallDecision.awaySince(awaySinceMs, resumed, nowMs);
        exemptions.observeFront(fresh ? front : null, nowMs);

        RecallDecision.Input in = new RecallDecision.Input();
        in.locked = locked;
        in.screenOn = RecallDecision.screenOn(displayState());
        in.kioskResumed = resumed;
        in.watcherBound = a11y.bound();
        in.front = front;
        in.frontActivity = a11y.activityFor(front);
        in.sampleAgeMs = frontAtMs == 0 ? Long.MAX_VALUE : nowMs - frontAtMs;
        in.ownPackage = ownPackage;
        in.allow = AllowRules.parseOrEmpty(str("lockdown.allowedApps"));
        in.exemptions = exemptions;
        in.nowMs = nowMs;
        in.awaySinceMs = awaySinceMs;
        in.graceMs = integer("lockdown.recallGraceMs");
        in.blocked = blocked;
        in.pairingDialogAllowed = pairingDialogAllowed();
        RecallDecision.Decision d = RecallDecision.decide(in);
        if (d.recall) {
            consecutiveRecalls++;
            doRecall(d.reason, RecallDecision.shouldNote(consecutiveRecalls));
        } else {
            consecutiveRecalls = 0;
        }

        if (ticks % 5 == 0) {
            refreshFacts();
            observeHome();
            OwnerPolicy o = owner;
            if (locked && o != null && ownerMode()) {
                enforceOwner();
                if (surface != null && surface.inForeground() && !o.lockTaskActive()) surface.setLockTask(true);
            }
            StatusBarShield sh = shield;
            if (sh != null) sh.set(locked && bool("lockdown.statusBarShield"));
        }
        if (ticks % 30 == 0) selfEnableAccessibility();
    }

    private void refreshFacts() {
        OwnerPolicy o = owner;
        StatusBarShield sh = shield;
        if (o == null || sh == null) return;
        factAdmin = o.adminActive();
        factOwner = o.isOwner();
        factLockTask = o.lockTaskActive();
        factAdminFeature = o.adminFeature();
        factOverlay = sh.granted();
    }

    private void report(ForegroundTrail.Event e) {
        // The overlay events are frequent and only useful as the trail inside a "left" event.
        if (!"kiosk.window.overlay".equals(e.msg)) note(e.msg + " " + e.data);
        try {
            core.events().publish("foreground", new JSONObject().put("event", e.msg).put("level", e.level).put("data", e.data));
        } catch (Exception ignored) { }
    }

    /** Display.getState(), or null when it cannot be read. Never PowerManager.isInteractive(): wrong on the Portal. */
    private Integer displayState() {
        try {
            Context c = context;
            DisplayManager dm = c == null ? null : (DisplayManager) c.getSystemService(Context.DISPLAY_SERVICE);
            Display d = dm == null ? null : dm.getDisplay(Display.DEFAULT_DISPLAY);
            return d == null ? null : d.getState();
        } catch (Exception e) {
            return null;
        }
    }

    private boolean pairingDialogAllowed() {
        try {
            for (PairingDialogExemption p : core.services().all(PairingDialogExemption.class)) if (p.allowed()) return true;
        } catch (Throwable ignored) { /* Evidence that cannot be read grants nothing. */ }
        return false;
    }

    /** Accessibility-context start first (the one Measured to work from the background), then HOME, then a plain start. */
    private void doRecall(String reason, boolean noteIt) {
        KioskSurface surface = surface();
        String how = "failed";
        if (surface != null) {
            Intent intent = null;
            try { intent = surface.kioskIntent(); } catch (Throwable ignored) { }
            if (a11y.startActivity(intent)) {
                how = "accessibility";
            } else {
                boolean homePressed = home.homeIsKiosk && a11y.home();
                how = surface.bringToFront() ? (homePressed ? "home+service" : "service") : (homePressed ? "home" : "failed");
            }
        }
        recalls.incrementAndGet();
        try {
            String from = front;
            JSONObject r = new JSONObject().put("atMs", System.currentTimeMillis())
                    .put("from", from == null ? JSONObject.NULL : from).put("reason", reason).put("how", how);
            lastRecall = r;
            if (noteIt) note("recall #" + consecutiveRecalls + " " + r);
            core.events().publish("foreground", new JSONObject().put("event", "kiosk.recall").put("level", "warn").put("data", r));
        } catch (Exception ignored) { }
    }

    /** What HOME resolves to, read from the system. A set-home command's own answer is never evidence. */
    private void observeHome() {
        try {
            Context c = context;
            PackageManager pm = c == null ? null : c.getPackageManager();
            if (pm == null) return;
            Intent query = new Intent(Intent.ACTION_MAIN);
            query.addCategory(Intent.CATEGORY_HOME);
            ResolveInfo r = pm.resolveActivity(query, PackageManager.MATCH_DEFAULT_ONLY);
            String component = r == null || r.activityInfo == null ? null : r.activityInfo.packageName + "/" + r.activityInfo.name;
            String event = home.observe(component, ownPackage, KIOSK_ACTIVITY);
            if (event != null) note(event + " home=" + component + " incidents=" + home.incidents);
        } catch (Exception e) {
            note("could not read the home app: " + e.getMessage());
        }
    }

    /** The grant is the fragile part (portal-keys README): put our service back when it is found unbound. */
    private void selfEnableAccessibility() {
        Context c = context;
        if (c == null || a11y.bound() || !bool("lockdown.selfEnableAccessibility")) return;
        try {
            if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED) return;
            JSONObject result = SettingsControl.enableAccessibilityService(c, ownPackage + "/" + AccessibilityHub.SERVICE_CLASS);
            if (RecallDecision.shouldNote(++selfEnableAttempts)) note("accessibility service unbound; re-enable: " + result);
        } catch (Exception e) {
            note("could not re-enable the accessibility service: " + e.getMessage());
        }
    }

    // ── the Portal's Control Center ───────────────────────────────────────────

    private boolean dismissingControlCenter() {
        boolean rawLocked;
        synchronized (lockGuard) { rawLocked = lockState.locked(); }
        // Left alone during an unlock window, so the panel can be used for maintenance.
        return running && rawLocked && bool("lockdown.dismissControlCenter");
    }

    private boolean controlCenterOpen() {
        Point size = a11y.displaySize();
        return size != null && ControlCenter.isOpen(a11y.windowSizes(), size.x, size.y);
    }

    /** The accessibility service's main thread, on every windows-changed event. */
    private void onWindowsChanged() {
        if (!dismissingControlCenter() || !controlCenterOpen()) return;
        if (!controlCenter.shouldStart(System.currentTimeMillis())) return;
        scheduleDismiss(1);
    }

    private void scheduleDismiss(final int attempt) {
        if (!ControlCenter.mayAttempt(attempt)) {
            note("control center: gave up after " + ControlCenter.MAX_ATTEMPTS + " attempts");
            return;
        }
        MainThread.postDelayed(() -> {
            if (!dismissingControlCenter()) return;
            if (!controlCenterOpen()) {
                if (attempt > 1) note("control center dismissed after " + (attempt - 1) + " attempt(s)");
                return;
            }
            Point size = a11y.displaySize();
            // A swipe starting inside the panel: once the panel is gone it cannot land on the page as a tap.
            if (size != null) a11y.swipe(size.x / 2f, size.y * 0.25f, size.x / 2f, size.y * 0.98f, 250);
            controlCenter.swiped(System.currentTimeMillis());
            scheduleDismiss(attempt + 1);
        }, ControlCenter.SETTLE_MS);
    }

    // ── locking ───────────────────────────────────────────────────────────────

    private boolean ownerMode() { return "owner".equals(LockMode.resolve(str("lockdown.mode"), factOwner)); }

    private String mode() { return LockMode.resolve(str("lockdown.mode"), factOwner); }

    private String hidingUnsupportedReason() {
        if (ownerMode()) return null;
        return factAdminFeature
                ? "this app is not device owner: a closed package is kept from the front instead of being hidden"
                : "this device has no android.software.device_admin feature, so no app can be device owner: a closed package is kept from the front instead of being hidden";
    }

    private static String webViewPackage() {
        try {
            PackageInfo p = WebView.getCurrentWebViewPackage();
            return p == null ? null : p.packageName;
        } catch (Throwable t) {
            return null;
        }
    }

    private void enforceOwner() {
        OwnerPolicy o = owner;
        if (o == null) return;
        Set<String> packages = new TreeSet<>();
        packages.add(ownPackage);
        packages.addAll(AllowRules.parseOrEmpty(str("lockdown.allowedApps")).exactPackages());
        packages.addAll(exemptions.packages(System.currentTimeMillis()));
        packages.removeAll(blocked);
        List<String> hide = OwnerHide.packages(str("lockdown.ownerHidePackages"), ownPackage, webViewPackage());
        ownerError = o.apply(packages, new ComponentName(ownPackage, KIOSK_ACTIVITY), bool("lockdown.ownerRestrictions"), hide);
    }

    private void applyLocked(boolean locked) {
        KioskSurface surface = surface();
        if (surface != null) surface.setImmersive(locked && bool("lockdown.immersive"));
        OwnerPolicy o = owner;
        if (o != null) {
            factOwner = o.isOwner();
            if (ownerMode()) {
                if (locked) {
                    enforceOwner();
                    if (surface != null) surface.setLockTask(true);
                } else {
                    if (surface != null) surface.setLockTask(false);
                    ownerError = o.release();
                }
            }
        }
        StatusBarShield sh = shield;
        if (sh != null) sh.set(locked && bool("lockdown.statusBarShield"));
    }

    /** Every unlock ends: with no duration it gets the ceiling, and a longer one is cut to it. The PIN gesture asks for lockdown.pinUnlockMin. */
    private long unlock(Long forMs, String why) {
        long relockAt;
        synchronized (lockGuard) {
            relockAt = lockState.unlock(System.currentTimeMillis(), forMs, ceilingMs());
            persist();
        }
        applyLocked(false);
        note("unlocked by " + why + " relockAtMs=" + relockAt);
        return relockAt;
    }

    /** Main thread, every touch-down on the kiosk window. */
    private void onTouchDown(float x, float y, int width, int height) {
        // No PIN, no gesture: the only way out is then the token-protected API.
        if (str("lockdown.exitPin").isEmpty() || !locked()) return;
        if (!gesture.tap(x, y, width, height, System.currentTimeMillis())) return;
        KioskSurface surface = surface();
        if (surface == null) return;
        pinPromptAtMs = System.currentTimeMillis();
        surface.promptPin("Enter PIN", entered -> {
            pinPromptAtMs = 0;
            // The PIN is read when it is checked, and neither it nor what was typed is logged.
            long lockedOutBefore = gesture.lockedOutUntilMs();
            ExitGesture.Pin result = gesture.attempt(entered, str("lockdown.exitPin"), System.currentTimeMillis());
            note("exit gesture: " + result);
            long lockedOutUntil = gesture.lockedOutUntilMs();
            if (lockedOutUntil != lockedOutBefore) warnPinLockout(lockedOutUntil);
            if (result == ExitGesture.Pin.OK) unlock(integer("lockdown.pinUnlockMin") * 60_000L, "PIN");
        });
    }

    /**
     * Five wrong PINs in a row: someone is guessing at the kiosk. Said once, as a warning,
     * in the event log, on the event bus and to the log store. Never the PIN or what was typed.
     */
    private void warnPinLockout(long untilMs) {
        try {
            JSONObject data = new JSONObject().put("wrongAttempts", ExitGesture.MAX_WRONG).put("untilMs", untilMs);
            core.log().add("lockdown.pin.lockout " + data);
            core.events().publish("lockdown", new JSONObject().put("event", "lockdown.pin.lockout").put("level", "warn").put("data", data));
            LogEvents.emit("lockdown.pin.lockout", "warn", data);
        } catch (Throwable ignored) { }
    }

    /** Caller holds lockGuard. */
    private void persist() {
        if (stateFile != null && !write(stateFile, lockState.toJson())) note("could not persist lock state");
    }

    private static boolean write(File file, String text) {
        if (file == null) return true;      // not started: nothing to store to
        try {
            File dir = file.getParentFile();
            if (dir != null) dir.mkdirs();
            File part = new File(file.getPath() + ".part");
            Files.write(part.toPath(), text.getBytes(StandardCharsets.UTF_8));
            Files.move(part.toPath(), file.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String read(File f) {
        try {
            return f != null && f.isFile() ? new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8) : null;
        } catch (Exception e) {
            return "";          // present and unreadable: not the same as absent
        }
    }

    /**
     * GET /lockdown. The backend polls this about once a second during an arcade session
     * and for excursion probes, so it reads memory only: no binder call, no file, no
     * window sample. Everything slow is refreshed by the watcher.
     */
    private JSONObject status() throws Exception {
        long now = System.currentTimeMillis();
        String allowed = str("lockdown.allowedApps");
        String inFront = front(), activity = frontActivity();
        KioskSurface surface = surface();
        long relockAt;
        synchronized (lockGuard) { relockAt = lockState.relockAtMs(); }
        JSONObject recall = lastRecall;
        StatusBarShield sh = shield;
        ForegroundTrail t = trail;
        String hiding = hidingUnsupportedReason();
        JSONObject o = Replies.ok()
                .put("locked", locked())
                .put("enabled", bool("lockdown.enabled"))
                .put("mode", mode())
                .put("watcher", running ? "running" : "stopped")
                .put("homeIsKiosk", home.homeIsKiosk)
                .put("home", home.home == null ? JSONObject.NULL : home.home)
                .put("allowedApps", new JSONArray(AllowRules.parseOrEmpty(allowed).describe()))
                .put("exemptions", new JSONArray(exemptions.describe(now)))
                .put("blockedPackages", new JSONArray(new TreeSet<>(blocked)))
                .put("packageHiding", new JSONObject().put("supported", hiding == null)
                        .put("reason", hiding == null ? JSONObject.NULL : hiding))
                .put("pairingDialogAllowed", pairingDialogAllowed())
                .put("foreground", inFront == null ? JSONObject.NULL : inFront)
                .put("foregroundActivity", activity == null ? JSONObject.NULL : activity)
                .put("kioskInForeground", surface != null && surface.inForeground())
                .put("recallsSinceBoot", recalls.get())
                .put("lastRecall", recall == null ? JSONObject.NULL : recall)
                .put("a11yBound", a11y.bound())
                .put("adminActive", factAdmin)
                .put("deviceOwner", factOwner)
                .put("lockTaskActive", factLockTask)
                .put("overlayGranted", factOverlay)
                .put("shieldShown", sh != null && sh.shown)
                .put("exitGesture", !str("lockdown.exitPin").isEmpty())
                .put("trail", t == null ? new JSONArray() : t.trail());
        o.put("inputLock", inputLockJson(new JSONObject()));
        if (relockAt > 0) o.put("relockAtMs", relockAt);
        String allowError = AllowRules.errorIn(allowed);
        if (allowError != null) o.put("allowedAppsError", allowError);
        String ownerErr = ownerError;
        if (ownerErr != null) o.put("ownerError", ownerErr);
        String modeError = LockMode.error(str("lockdown.mode"), factOwner);
        if (modeError != null) o.put("modeError", modeError);
        return o;
    }

    // ── LockdownControl ───────────────────────────────────────────────────────

    @Override public boolean locked() {
        if (!bool("lockdown.enabled")) return false;
        synchronized (lockGuard) { return lockState.locked(); }
    }

    /**
     * The package in front, or null when it cannot be known. The kiosk Activity's own
     * lifecycle answers first, so this is right even with the accessibility service unbound.
     */
    @Override public String front() {
        KioskSurface s = surface();
        if (s != null && s.inForeground() && !ownPackage.isEmpty()) return ownPackage;
        return frontAtMs != 0 && System.currentTimeMillis() - frontAtMs <= RecallDecision.FRESH_MS ? front : null;
    }

    @Override public String frontActivity() {
        KioskSurface s = surface();
        if (s != null && s.inForeground() && !ownPackage.isEmpty()) return KIOSK_ACTIVITY;
        String pkg = front();
        return pkg == null ? null : a11y.activityFor(pkg);
    }

    @Override public String lastAway() { ForegroundTrail t = trail; return t == null ? null : t.lastAway(); }

    @Override public void allowWhileInFront(String packageName) {
        exemptions.allowWhileInFront(packageName, System.currentTimeMillis());
        // Lock task refuses to start a package that is not on its list, so widen the list before the launch.
        if (owner != null && ownerMode() && locked()) enforceOwner();
        note("allowed while in front: " + packageName);
    }

    @Override public void allowFor(String rule, long durationMs) {
        exemptions.allowFor(rule, System.currentTimeMillis(), durationMs);
        if (owner != null && ownerMode() && locked()) enforceOwner();
        note("allowed for " + Math.min(durationMs, Exemptions.MAX_MS) + " ms: " + rule);
    }

    @Override public void revoke(String rule) {
        exemptions.revoke(rule);
        // The lock-task list was widened for the rule; narrow it again.
        if (owner != null && ownerMode() && locked()) enforceOwner();
        note("exemption ended: " + rule);
    }

    @Override public boolean recall(long waitMs) {
        final KioskSurface surface = surface();
        if (surface == null) return false;
        if (surface.inForeground()) return true;
        doRecall("requested", true);
        return MainThread.waitFor(surface::inForeground, waitMs);
    }
}
