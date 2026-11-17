package net.kckern.daylight.cap.volumekeys;

import android.content.Context;
import android.hardware.display.DisplayManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.PowerManager;
import android.util.Log;
import android.view.Display;
import android.view.KeyEvent;

import net.kckern.daylight.core.AccessibilityHub;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Json;
import net.kckern.daylight.core.spi.InputLock;
import net.kckern.daylight.core.spi.ScreenPower;

import java.util.concurrent.Executor;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;

/**
 * The volume-key filter, from portal-keys' PortalKeysService. Only short presses
 * reach it: the Portal's firmware claims long presses before accessibility sees them
 * (holding volume-down opened the power menu and delivered no key events), and
 * volume-up with volume-down is Android's accessibility shortcut.
 */
final class VolumeKeys implements AccessibilityHub.KeyFilter {
    static final String TAG = "PORTALKEYS";

    private final CoreContext core;
    private final KeysConfig config;
    private final PowerManager powerManager;
    private final DisplayManager displayManager;
    /** Is the panel lit, and what time is it. Replaced in JVM tests, which have no display. */
    private final BooleanSupplier panelLit;
    private final LongSupplier clock;
    /** Screen power is I/O and must never run on the input-dispatch thread. */
    private HandlerThread workerThread;
    private volatile Executor worker;
    /** Timestamp of the last distinct VOLUME_DOWN press, for double-press detection. */
    private long lastVolDownAt = 0;
    private volatile int keysSeen = 0;
    private volatile int otherKeysSeen = 0;

    VolumeKeys(Context ctx, CoreContext core, KeysConfig config) {
        this.core = core;
        this.config = config;
        this.powerManager = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        this.displayManager = (DisplayManager) ctx.getSystemService(Context.DISPLAY_SERVICE);
        this.panelLit = this::isPanelLit;
        this.clock = System::currentTimeMillis;
    }

    /** Test seam: the panel's state, the clock and the worker are given, and there is no Android behind them. */
    VolumeKeys(CoreContext core, KeysConfig config, BooleanSupplier panelLit, LongSupplier clock, Executor worker) {
        this.core = core;
        this.config = config;
        this.powerManager = null;
        this.displayManager = null;
        this.panelLit = panelLit;
        this.clock = clock;
        this.worker = worker;
    }

    void start() {
        workerThread = new HandlerThread("portalkeys-worker");
        workerThread.start();
        final Handler handler = new Handler(workerThread.getLooper());
        worker = handler::post;
    }

    void stop() {
        worker = null;
        if (workerThread != null) { workerThread.quitSafely(); workerThread = null; }
    }

    int keysSeen() { return keysSeen; }
    /** Keys other than the volume keys that passed through. Counted, never recorded. */
    int otherKeysSeen() { return otherKeysSeen; }

    /**
     * Is the panel lit? Display.getState(), not PowerManager.isInteractive(): on the
     * Portal the latter said "on" for a panel that was dark. With that wrong answer
     * the wake branch never ran and control fell through to the display-on branch,
     * where two volume presses sleep the display, so pressing a key to wake the panel
     * put it further to sleep. Falls back to the old signal only when the display
     * service is unavailable.
     */
    boolean isPanelLit() {
        Integer state = null;
        if (displayManager != null) {
            Display display = displayManager.getDisplay(Display.DEFAULT_DISPLAY);
            if (display != null) state = display.getState();
        }
        return panelLit(state, powerManager != null && powerManager.isInteractive());
    }

    /** The display's own state when there is one; the power manager's word only without it. */
    static boolean panelLit(Integer displayState, boolean interactive) {
        return displayState != null ? displayState == Display.STATE_ON : interactive;
    }

    @Override
    public boolean onKeyEvent(KeyEvent event) {
        return onKey(event.getKeyCode(), event.getAction() == KeyEvent.ACTION_DOWN, event.getRepeatCount());
    }

    /** The filter itself, on plain values: a KeyEvent cannot be built in a JVM test. */
    boolean onKey(int code, boolean down, int repeatCount) {
        boolean isVolume = code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN;
        if (!isVolume) {
            // Passed through untouched and counted, nothing more. The event log is served
            // by GET /log, and with a keyboard attached every key typed would be in it.
            otherKeysSeen++;
            return false;
        }
        boolean interactive = panelLit.getAsBoolean();
        String name = code == KeyEvent.KEYCODE_VOLUME_UP ? "KEYCODE_VOLUME_UP" : "KEYCODE_VOLUME_DOWN";

        keysSeen++;
        // Shutdown is enforced below the browser: it must also suppress the
        // physical double-press screen toggle and Android volume changes.
        InputLock lock = core.services().find(InputLock.class);
        if (lock != null && lock.active()) {
            core.log().add("key-suppressed-lockdown " + name + " revision=" + lock.revision());
            return true;
        }
        broadcast(name, down ? "down" : "up", interactive);
        // The page in this app's own kiosk hears the key as daylight:key, through the event
        // bus and webview-host. Once per press and once per release: a held key repeats on
        // the WebSocket, as it always did, and not here.
        if (repeatCount == 0) publishForPage(code, down);

        // Display is OFF: any volume key wakes it, and changes nothing else.
        // Stepping the volume blind, with no HUD visible, would be a surprise.
        if (!interactive) {
            if (down && config.screenToggleEnabled()) {
                lastVolDownAt = 0; // a wake press must never count toward a double press
                wakeDisplay();
            }
            return config.screenToggleEnabled();
        }

        // Display is ON: double-press VOLUME_DOWN sleeps it. repeatCount==0 filters out
        // auto-repeat, so only distinct presses count.
        if (code == KeyEvent.KEYCODE_VOLUME_DOWN && down && repeatCount == 0) {
            long now = clock.getAsLong();
            if (lastVolDownAt > 0 && (now - lastVolDownAt) <= config.doublePressMs()) {
                lastVolDownAt = 0; // consume the pair so a third press does not re-fire
                if (config.screenToggleEnabled()) {
                    core.log().add("double-press-sleep fired");
                    Log.i(TAG, "double-press: sleeping display");
                    sleepDisplay();
                }
            } else {
                lastVolDownAt = now;
            }
        }

        // Consuming is what stops Android moving STREAM_MUSIC underneath the page. The
        // escape hatch matters: if the page breaks, setting keys.consumeVolume to false
        // restores hardware volume with no reinstall and no trip to the panel.
        return config.consumeVolume();
    }

    /** The frame portal-keys sent for a key, character for character. */
    static String keyFrame(String keyName, String action, boolean interactive, long ts) {
        return "{\"type\":\"key\",\"key\":\"" + Json.escape(keyName)
                + "\",\"action\":\"" + Json.escape(action)
                + "\",\"interactive\":" + interactive
                + ",\"ts\":" + ts + "}";
    }

    private void broadcast(String keyName, String action, boolean interactive) {
        core.log().add("key " + keyName + " " + action + " interactive=" + interactive);
        Log.i(TAG, "key code=" + keyName + " action=" + action + " interactive=" + interactive);
        // onKeyEvent runs on the service's main thread; a socket write there kills the process.
        core.socket().broadcastAsync(keyFrame(keyName, action, interactive, clock.getAsLong()));
    }

    /** The key names webview-host uses for the keys it intercepts itself. */
    private void publishForPage(int code, boolean down) {
        try {
            core.events().publish("key", new org.json.JSONObject()
                    .put("code", code == KeyEvent.KEYCODE_VOLUME_UP ? "VolumeUp" : "VolumeDown")
                    .put("action", down ? "down" : "up"));
        } catch (Exception ignored) { }
    }

    private void sleepDisplay() { screen(false); }
    private void wakeDisplay() { screen(true); }

    private void screen(final boolean on) {
        Executor w = worker;
        if (w == null) return;
        w.execute(() -> {
            ScreenPower power = core.services().find(ScreenPower.class);
            if (power == null) {
                // Until phase 3's screen-power exists, nothing here can switch the panel.
                core.log().add("screen-toggle-unavailable");
                return;
            }
            boolean ok = on ? power.screenOn() : power.screenOff();
            core.log().add((on ? "screen-on" : "screen-off") + " ok=" + ok);
        });
    }
}
