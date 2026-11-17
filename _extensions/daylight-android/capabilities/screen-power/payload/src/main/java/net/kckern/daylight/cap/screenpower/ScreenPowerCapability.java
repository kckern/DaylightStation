package net.kckern.daylight.cap.screenpower;

import android.accessibilityservice.AccessibilityService;
import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.display.DisplayManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Display;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.MainThread;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Requests;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.SettingsRegistry.Type;
import net.kckern.daylight.core.UnsupportedException;
import net.kckern.daylight.core.spi.DeviceAdminAccess;
import net.kckern.daylight.core.spi.KioskSurface;
import net.kckern.daylight.core.spi.NoteListener;
import net.kckern.daylight.core.spi.ScreenControl;
import net.kckern.daylight.core.spi.ScreenPower;

import org.json.JSONObject;

import java.util.Calendar;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Screen on and off, brightness, the locks that keep the control API reachable with
 * the display off, and reboot where this app is device owner.
 */
public final class ScreenPowerCapability implements Capability, ScreenControl, ScreenPower {
    /** AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN, added in API 28. Used only at or above it. */
    private static final int GLOBAL_ACTION_LOCK_SCREEN = 8;

    private CoreContext core;
    private volatile Context context;
    private volatile PowerManager power;
    private volatile PowerManager.WakeLock cpuLock;
    private volatile WifiManager.WifiLock wifiLock;
    private volatile ExecutorService worker;
    private volatile boolean running;
    private volatile DisplayManager displays;
    /** What the page was last told, so a change is published once. Null before the first reading. */
    private volatile Boolean lastPublished;
    private final WakeGate gate = new WakeGate();
    /** The platform level. A seam: on the JVM Build.VERSION.SDK_INT reads 0. */
    private volatile int sdkInt = Build.VERSION.SDK_INT;
    void useSdkForTest(int sdk) { sdkInt = sdk; }
    private final Object workerGuard = new Object();
    /**
     * Held by start() while it takes things and by stop() while it gives them back, so
     * the two never interleave. start() waits on nothing while it holds this (no main
     * thread, no network), so a stop() that arrives in the middle waits only for it to
     * finish and then releases everything it took.
     */
    private final Object lifecycle = new Object();
    private boolean receiverRegistered;
    // Read on the MIDI thread for every note-on, so they are kept here and not looked up there.
    private volatile int cooldownMs = 8000;
    private volatile String noWakeStart = "", noWakeEnd = "";

    /** A played note wakes a dark display. On the MIDI thread: one comparison while a wake is recent. */
    private final NoteListener onNote = new NoteListener() {
        @Override public void noteOn(int note, int velocity, long epochMs) { poke(); }
    };

    /** A trigger only: what is published is the display's own state, read when this fires. */
    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent intent) { publishScreen(); }
    };

    /** The Portal's backlight changes without the screen-on and screen-off broadcasts; this hears it. */
    private final DisplayManager.DisplayListener displayListener = new DisplayManager.DisplayListener() {
        @Override public void onDisplayAdded(int displayId) { }
        @Override public void onDisplayRemoved(int displayId) { }
        @Override public void onDisplayChanged(int displayId) { if (displayId == Display.DEFAULT_DISPLAY) publishScreen(); }
    };

    @Override public String name() { return "screen-power"; }

    private int integer(String key) { return (Integer) core.settings().get(key); }
    private boolean bool(String key) { return (Boolean) core.settings().get(key); }
    private String str(String key) { return (String) core.settings().get(key); }
    private void note(String m) { if (core.shell() != null) core.shell().note("SCREEN", m); }

    @Override public void register(CoreContext core) {
        this.core = core;
        SettingsRegistry s = core.settings();
        s.declare("power.keepScreenOn", Type.BOOLEAN, true);
        s.declare("power.wifiLock", Type.BOOLEAN, true);
        s.declare("power.preventSleepWhileScreenOff", Type.BOOLEAN, true);
        s.declare("power.screenVerifyMs", Type.INTEGER, 3000, SettingsRegistry.range(0, 60_000));
        s.declare("power.wakeCooldownMs", Type.INTEGER, 8000, SettingsRegistry.range(0, 3_600_000));
        s.declare("power.noWakeStart", Type.STRING, "");
        s.declare("power.noWakeEnd", Type.STRING, "");
        s.onChange(key -> {
            if (running && "power.keepScreenOn".equals(key)) applyKeepScreenOn();
            if (key.startsWith("power.")) readWakeSettings();
        });
        core.services().provide(ScreenControl.class, this);
        core.services().provide(ScreenPower.class, this);

        Router router = core.router();
        router.route("POST", "/screen", req -> {
            JSONObject body = Requests.body(req);
            if (!(body.opt("on") instanceof Boolean)) throw new IllegalArgumentException("body needs 'on': true or false");
            boolean want = body.getBoolean("on");
            if (!want) {
                ScreenOffPath.Choice path = offPath();
                if (path.kind == ScreenOffPath.Kind.NONE) throw new UnsupportedException(path.reason);
            }
            boolean state = setOn(want, integer("power.screenVerifyMs"));
            // ok only when the display's own state says so.
            return Router.Response.json(200, (state == want ? Replies.ok() : Replies.err("screen_state_unchanged")).put("screenOn", state));
        });
        router.route("POST", "/screen/brightness", req -> {
            JSONObject body = Requests.body(req);
            if (!(body.opt("level") instanceof Integer)) throw new IllegalArgumentException("body needs 'level': 0..255");
            int level = body.getInt("level");
            if (level < 0 || level > 255) throw new IllegalArgumentException("level must be 0..255");
            Context c = context;
            if (c == null) throw new UnsupportedException("screen-power is not running");
            if (!Settings.System.canWrite(c)) throw new UnsupportedException("WRITE_SETTINGS is not granted");
            Settings.System.putInt(c.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE,
                    Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
            Settings.System.putInt(c.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, level);
            int read = Settings.System.getInt(c.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, -1);
            return Router.Response.json(200, (read == level ? Replies.ok() : Replies.err("brightness_unchanged")).put("level", read));
        });
        router.route("POST", "/device/reboot", req -> {
            if (!canReboot()) throw new UnsupportedException("device owner required");
            if (!rebootSoon()) throw new UnsupportedException("screen-power is not running");
            return Router.Response.json(200, Replies.ok().put("rebooting", true));
        });
    }

    private void readWakeSettings() {
        cooldownMs = integer("power.wakeCooldownMs");
        noWakeStart = str("power.noWakeStart");
        noWakeEnd = str("power.noWakeEnd");
    }

    /** Only a device owner can reboot the device. The Shield can never be one. */
    private boolean canReboot() {
        DeviceAdminAccess admin = core.services().find(DeviceAdminAccess.class);
        return admin != null && admin.isOwner();
    }

    /** After a short delay, so the answer leaves first. False when there is nothing to run it on. */
    private boolean rebootSoon() {
        final DeviceAdminAccess admin = core.services().find(DeviceAdminAccess.class);
        ExecutorService w = worker();
        if (admin == null || w == null) return false;
        note("reboot requested");
        try {
            w.execute(() -> {
                try { Thread.sleep(500); } catch (InterruptedException ignored) { return; }
                try { admin.reboot(); } catch (Throwable t) { note("reboot failed: " + t); }
            });
            return true;
        } catch (Exception shutDown) {
            return false;
        }
    }

    /** The worker, made on first use while running; null once stopped. */
    private ExecutorService worker() {
        synchronized (workerGuard) {
            if (!running) return null;
            if (worker == null) {
                worker = Executors.newSingleThreadExecutor(r -> {
                    Thread t = new Thread(r, "daylight-screen");
                    t.setDaemon(true);
                    return t;
                });
            }
            return worker;
        }
    }

    /** On the payload loader's worker thread, which has no Looper. Nothing here waits on the main thread. */
    @SuppressLint("WakelockTimeout")
    @Override public void start() {
        Context ctx = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: there is no screen.
        if (ctx == null) return;
        synchronized (lifecycle) { startLocked(ctx); }
    }

    @SuppressLint("WakelockTimeout")
    private void startLocked(Context ctx) {
        context = ctx;
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        power = pm;
        readWakeSettings();
        running = true;
        core.notes().subscribe(onNote);
        // With the display off the Portal drops off the network (Measured, portal-keys README
        // "Display off => no network"). These two locks are what keep the control API reachable,
        // so a remote screen-off can always be followed by a remote screen-on. Held for as
        // long as the payload runs, which is why they carry no timeout.
        try {
            if (pm != null && bool("power.preventSleepWhileScreenOff")) holdCpu();
            if (bool("power.wifiLock")) {
                Context app = ctx.getApplicationContext();
                WifiManager wifi = app == null ? null : (WifiManager) app.getSystemService(Context.WIFI_SERVICE);
                if (wifi != null) {
                    WifiManager.WifiLock lock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "daylight:wifi");
                    lock.setReferenceCounted(false);
                    lock.acquire();
                    wifiLock = lock;
                }
            }
        } catch (Exception e) {
            note("could not take the keep-awake locks: " + e.getMessage());
        }
        applyKeepScreenOn();
        IntentFilter filter = new IntentFilter(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        ctx.registerReceiver(screenReceiver, filter);
        receiverRegistered = true;
        try {
            DisplayManager dm = (DisplayManager) ctx.getSystemService(Context.DISPLAY_SERVICE);
            if (dm != null) {
                dm.registerDisplayListener(displayListener, new Handler(Looper.getMainLooper()));
                displays = dm;
            }
        } catch (Exception e) {
            note("could not watch the display: " + e.getMessage());
        }
        lastPublished = isOn();
        note("started keepScreenOn=" + bool("power.keepScreenOn") + " cpuLock=" + (cpuLock != null)
                + " wifiLock=" + (wifiLock != null) + " screenOff=" + offPath().kind);
    }

    @SuppressLint("WakelockTimeout")
    private void holdCpu() {
        PowerManager pm = power;
        if (pm == null || cpuLock != null) return;
        PowerManager.WakeLock lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "daylight:cpu");
        lock.setReferenceCounted(false);
        lock.acquire();
        cpuLock = lock;
    }

    private void applyKeepScreenOn() {
        KioskSurface surface = core.services().find(KioskSurface.class);
        if (surface != null) surface.setKeepScreenOn(bool("power.keepScreenOn"));
    }

    /** May be called twice, and while start() is still running. */
    @Override public void stop() {
        // Seen at once by poke(), publishScreen() and worker(), before the lock is had.
        running = false;
        synchronized (lifecycle) { stopLocked(); }
    }

    private void stopLocked() {
        running = false;
        try { if (core != null) core.notes().unsubscribe(onNote); } catch (Throwable ignored) { }
        Context c = context;
        if (receiverRegistered && c != null) {
            receiverRegistered = false;
            try { c.unregisterReceiver(screenReceiver); } catch (Throwable ignored) { }
        }
        DisplayManager dm = displays;
        displays = null;
        try { if (dm != null) dm.unregisterDisplayListener(displayListener); } catch (Throwable ignored) { }
        PowerManager.WakeLock cpu = cpuLock;
        cpuLock = null;
        try { if (cpu != null) cpu.release(); } catch (Throwable ignored) { }
        WifiManager.WifiLock wifi = wifiLock;
        wifiLock = null;
        try { if (wifi != null) wifi.release(); } catch (Throwable ignored) { }
        ExecutorService w;
        synchronized (workerGuard) { w = worker; worker = null; }
        if (w != null) w.shutdownNow();
    }

    /** Tell the page (daylight:screen) and whoever else listens, once per change, what the display itself says. */
    private void publishScreen() {
        if (!running) return;
        boolean on = isOn();
        Boolean last = lastPublished;
        if (last != null && last == on) return;
        lastPublished = on;
        try { core.events().publish("screen", new JSONObject().put("on", on)); } catch (Exception ignored) { }
    }

    ScreenOffPath.Choice offPath() {
        DeviceAdminAccess admin = core.services().find(DeviceAdminAccess.class);
        boolean adminActive = false;
        try { adminActive = admin != null && admin.adminActive(); } catch (Throwable ignored) { }
        return ScreenOffPath.choose(adminActive, core.accessibility().service() != null, sdkInt);
    }

    // ── ScreenControl ─────────────────────────────────────────────────────────

    /** The display's own state, not PowerManager.isInteractive() (Measured on the Portal: the latter stayed true on a dark panel). */
    @Override public boolean isOn() {
        try {
            Context c = context;
            DisplayManager dm = c == null ? null : (DisplayManager) c.getSystemService(Context.DISPLAY_SERVICE);
            Display d = dm == null ? null : dm.getDisplay(Display.DEFAULT_DISPLAY);
            return d != null && d.getState() == Display.STATE_ON;
        } catch (Exception e) {
            return false;
        }
    }

    @Override public boolean canTurnOff() { return offPath().kind != ScreenOffPath.Kind.NONE; }

    @SuppressWarnings("deprecation")
    @Override public boolean setOn(final boolean on, long waitMs) {
        if (on) {
            PowerManager pm = power;
            if (pm != null) {
                PowerManager.WakeLock wake = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                        | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE, "daylight:wake");
                wake.acquire(3000);
            }
        } else {
            ScreenOffPath.Choice path = offPath();
            if (path.kind == ScreenOffPath.Kind.NONE) throw new UnsupportedException(path.reason);
            // A screen-off we cannot undo remotely is a trap. Hold the CPU lock for this one even if the setting is off.
            try { if (running) holdCpu(); } catch (Exception e) { note("could not hold the CPU awake: " + e.getMessage()); }
            if (path.kind == ScreenOffPath.Kind.DEVICE_ADMIN) {
                core.services().find(DeviceAdminAccess.class).lockNow();
            } else {
                AccessibilityService service = core.accessibility().service();
                boolean accepted = service != null && service.performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
                if (!accepted) note("the accessibility lock-screen action was refused");
            }
        }
        if (waitMs > 0) MainThread.waitFor(() -> isOn() == on, waitMs);
        boolean state = isOn();
        note("screen " + (on ? "on" : "off") + " requested, display reads " + (state ? "on" : "off"));
        return state;
    }

    @Override public void poke() {
        if (!running) return;
        long now = System.currentTimeMillis();
        int cooldown = cooldownMs;
        if (gate.cooling(now, cooldown)) return;
        Calendar c = Calendar.getInstance();
        int minute = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
        if (!gate.allow(now, minute, cooldown, noWakeStart, noWakeEnd)) return;
        ExecutorService w = worker();
        if (w == null) return;
        try { w.execute(() -> { if (!isOn()) setOn(true, 0); }); } catch (Exception ignored) { }
    }

    // ── ScreenPower (volume-keys) ─────────────────────────────────────────────

    @Override public boolean screenOn() {
        try { return setOn(true, integer("power.screenVerifyMs")); } catch (Exception e) { return false; }
    }

    /** True when the display reads off afterwards. */
    @Override public boolean screenOff() {
        try { return canTurnOff() && !setOn(false, integer("power.screenVerifyMs")); } catch (Exception e) { return false; }
    }
}
