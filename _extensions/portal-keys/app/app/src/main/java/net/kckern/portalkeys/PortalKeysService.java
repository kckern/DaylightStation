package net.kckern.portalkeys;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.PowerManager;
import android.util.Log;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

import java.io.IOException;

/**
 * Repurposes the Portal's volume buttons for the DaylightStation kiosk.
 *
 *   VOLUME_UP / VOLUME_DOWN      → consumed, drive the SPA's software master volume
 *   VOLUME_DOWN double-press     → sleep the display via FKB REST
 *   any volume key while asleep  → wake the display, volume unchanged
 *
 * MEASURED on this hardware (getevent + observed presses, 2026-07-20/21):
 *   camera button = KEY_MUTE on /dev/input/event0   (there is NO separate camera keycode)
 *   volume down   = KEY_VOLUMEDOWN on /dev/input/event0
 *   volume up     = KEY_VOLUMEUP on /dev/input/event2
 *
 * TWO HARDWARE CONSTRAINTS discovered the hard way, both documented at their use sites:
 *   1. The camera button never reaches accessibility (privacy HAL) — see onKeyEvent.
 *   2. LONG presses never reach accessibility (firmware claims them) — hence the
 *      double-press gesture rather than hold-to-sleep.
 * Only SHORT presses of the volume keys are available to this service.
 *
 * Why the screen toggle lives HERE and not in the SPA: it has to work when the WebView
 * is dozing or wedged, which is exactly when the SPA cannot be trusted to respond.
 * Everything else routes to the browser, where the volume curve, HUD and persistence
 * already exist — so remapping later never means reflashing.
 */
public class PortalKeysService extends AccessibilityService
        implements ControlServer.StatusProvider {

    public static final String TAG = "PORTALKEYS";

    private PowerManager powerManager;
    private Config config;
    private FkbClient fkb;
    private EventLog eventLog;
    private ControlServer server;

    /** FKB REST calls must never run on the input-dispatch thread. */
    private HandlerThread workerThread;
    private Handler worker;

    /** Timestamp of the last distinct VOLUME_DOWN press, for double-press detection. */
    private long lastVolDownAt = 0;

    private volatile boolean bound = false;
    private volatile long connectedAt = 0;
    private volatile int keysSeen = 0;

    // ── Lifecycle ────────────────────────────────────────────────────────────

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();

        powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        config = new Config(this);
        fkb = new FkbClient(config);
        eventLog = new EventLog();

        workerThread = new HandlerThread("portalkeys-worker");
        workerThread.start();
        worker = new Handler(workerThread.getLooper());

        server = new ControlServer(eventLog, config, this);
        try {
            // timeout 0 = no socket read timeout. A finite one makes NanoWSD throw
            // "Read timed out" on every idle client every N seconds, churning threads
            // and spamming the log. Same choice piano-bridge makes.
            server.start(0, true);
            eventLog.add("control-server-started port=" + ControlServer.PORT);
            Log.i(TAG, "control-server-started: port " + ControlServer.PORT);
        } catch (IOException e) {
            // Non-fatal: keys still work, only the SPA bridge and pkctl are lost.
            Log.e(TAG, "control-server-failed: " + e.getMessage());
            eventLog.add("control-server-failed " + e.getMessage());
        }

        bound = true;
        connectedAt = System.currentTimeMillis();
        eventLog.add("service-connected");
        Log.i(TAG, "service-connected: bound and listening for key events");
    }

    @Override
    public void onDestroy() {
        bound = false;
        Log.w(TAG, "service-destroyed: no longer receiving keys");
        if (server != null) server.stop();
        if (workerThread != null) workerThread.quitSafely();
        super.onDestroy();
    }

    // ── Key handling ─────────────────────────────────────────────────────────

    /**
     * The camera button is NOT usable as a trigger.
     *
     * Verified on hardware 2026-07-21: it is wired to Portal's privacy subsystem at the
     * HAL level (audio_extn_fb_set_privacy_mode / PrivacyModeController), physically
     * gating the camera and mic. It never enters normal key dispatch, so no
     * AccessibilityService can see it — the service logged 16 key events during testing,
     * every one a volume key and not a single KEYCODE_MUTE. Reading the resulting privacy
     * state is gated behind com.facebook.permission.prod.FB_APP_COMMUNICATION, a
     * signature permission we cannot hold.
     *
     * Hence the volume keys carry the whole interface.
     */
    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        boolean down = event.getAction() == KeyEvent.ACTION_DOWN;
        boolean interactive = powerManager != null && powerManager.isInteractive();
        String name = KeyEvent.keyCodeToString(code);

        boolean isVolume = code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN;
        if (!isVolume) return false; // everything else passes through untouched

        keysSeen++;
        broadcast(name, down ? "down" : "up", interactive);

        // ── Display is OFF: any volume key wakes it, and changes nothing else. ──
        // Stepping the volume blind (with no HUD visible) would be a silent surprise.
        if (!interactive) {
            if (down && config.screenToggleEnabled()) {
                lastVolDownAt = 0; // a wake press must never count toward a double-press
                wakeDisplay();
            }
            return config.screenToggleEnabled();
        }

        // ── Display is ON ──
        // Double-press VOLUME_DOWN sleeps the display. repeatCount==0 filters out
        // auto-repeat, so only genuinely distinct presses count.
        if (code == KeyEvent.KEYCODE_VOLUME_DOWN && down && event.getRepeatCount() == 0) {
            long now = System.currentTimeMillis();
            if (lastVolDownAt > 0 && (now - lastVolDownAt) <= config.doublePressMs()) {
                lastVolDownAt = 0; // consume the pair so a 3rd press doesn't re-fire
                if (config.screenToggleEnabled()) {
                    eventLog.add("double-press-sleep fired");
                    Log.i(TAG, "double-press: sleeping display");
                    sleepDisplay();
                }
            } else {
                lastVolDownAt = now;
            }
        }

        // Consuming is what stops Android moving STREAM_MUSIC underneath the SPA. The
        // escape hatch matters: if the SPA breaks, flipping consumeVolume=false over
        // pkctl restores hardware volume with no reinstall and no trip to the panel.
        return config.consumeVolume();
    }

    // Why double-press and not hold: verified on hardware 2026-07-21, Portal's firmware
    // claims LONG presses before they reach accessibility. Holding VOLUME_DOWN fired
    // `powerLongPress: LONG_PRESS_POWER_GLOBAL_ACTIONS` (the power menu) and this service
    // saw ZERO key events for the entire hold, while short presses arrive normally. The
    // same is true of the camera button (privacy HAL) — see onKeyEvent. Volume-up +
    // volume-down together is out for the same reason: that's Android's 3-second
    // accessibility shortcut. Short presses are the only input this device will give us.

    private void broadcast(String keyName, String action, boolean interactive) {
        eventLog.add("key " + keyName + " " + action + " interactive=" + interactive);
        Log.i(TAG, "key code=" + keyName + " action=" + action + " interactive=" + interactive);
        if (server != null) server.broadcastKey(keyName, action, interactive);
    }

    /** FKB REST is network I/O — never on the input-dispatch thread. */
    private void sleepDisplay() {
        worker.post(new Runnable() {
            @Override public void run() {
                boolean ok = fkb.screenOff();
                eventLog.add("screen-off ok=" + ok + (ok ? "" : " err=" + fkb.lastError()));
            }
        });
    }

    private void wakeDisplay() {
        worker.post(new Runnable() {
            @Override public void run() {
                boolean ok = fkb.screenOn();
                eventLog.add("screen-on ok=" + ok + (ok ? "" : " err=" + fkb.lastError()));
            }
        });
    }

    // ── StatusProvider (for pkctl /status) ───────────────────────────────────

    @Override public boolean isServiceBound()   { return bound; }
    @Override public long    connectedAtMillis(){ return connectedAt; }
    @Override public int     keysSeen()         { return keysSeen; }
    @Override public boolean isDisplayOn()      { return powerManager != null && powerManager.isInteractive(); }
    @Override public String  fkbLastError()     { return fkb == null ? null : fkb.lastError(); }

    /** Blocking download+install; the control server already runs off the main thread. */
    @Override public String installUpdate(String url) {
        return new SelfUpdater(this, eventLog).install(url);
    }

    /**
     * Our own logcat lines, so a failure is diagnosable without a shell.
     *
     * Needs READ_LOGS, granted once over USB (`pm grant`) and persistent thereafter.
     * Without it logcat returns only this process's own output, which is still useful —
     * so a missing grant degrades rather than fails.
     */
    @Override public String readLogcat(int lines) {
        try {
            Process p = new ProcessBuilder("logcat", "-d", "-t", String.valueOf(lines), "-s", TAG)
                    .redirectErrorStream(true).start();
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            try (java.io.InputStream in = p.getInputStream()) {
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            p.waitFor();
            return out.toString("UTF-8");
        } catch (Exception e) {
            return "logcat unavailable: " + e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    // ── Unused AccessibilityService surface ──────────────────────────────────

    @Override public void onAccessibilityEvent(AccessibilityEvent event) { /* keys only */ }
    @Override public void onInterrupt() { Log.w(TAG, "on-interrupt"); }
}
