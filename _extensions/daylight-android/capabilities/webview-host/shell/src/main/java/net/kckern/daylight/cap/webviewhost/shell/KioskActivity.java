package net.kckern.daylight.cap.webviewhost.shell;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.widget.TextView;

import net.kckern.daylight.api.KioskController;
import net.kckern.daylight.api.KioskHost;
import net.kckern.daylight.api.KioskSlot;
import net.kckern.daylight.api.ShellComponents;

/**
 * The kiosk window. An Activity must be declared in the installed APK, so this class
 * lives in the shell; everything it shows and does belongs to a payload-side
 * KioskController, which the webview-host capability attaches.
 *
 * Rule for editing this file: forward, do not decide. A change here needs a shell
 * install; a change in the controller is a payload swap.
 */
public class KioskActivity extends Activity implements KioskHost {
    private static final String TAG = "Daylight-Kiosk";
    /** By name: this module cannot reference the shell app module. */
    private static final String SHELL_SERVICE = "net.kckern.daylight.shell.ShellService";

    /** Main thread only. */
    private final KioskSlot slot = new KioskSlot();
    private boolean visible;
    /** The controller that threw and is waiting to be attached again, and how often it has been tried. Main thread only. */
    private KioskController failed;
    private int retryAttempts;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable retryAttach = () -> {
        KioskController again = failed;
        // Only while nothing else has taken the window in the meantime.
        if (again == null || slot.current() != null || isFinishing() || isDestroyed()) return;
        failed = null;
        attachNow(again);
    };
    /** A controller that has stayed attached this long is taken to be healthy again. */
    private static final long HEALTHY_AFTER_MS = 60_000L;
    private final Runnable markHealthy = () -> { if (slot.current() != null) retryAttempts = 0; };
    private volatile boolean resumed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Nothing is shown over a lock screen here. Whether this device does is its
        // device file's decision, which the controller passes on (showWhenLocked below).
        showFallback("Daylight is starting…");
        try {
            startForegroundService(new Intent().setClassName(this, SHELL_SERVICE));
        } catch (Exception e) {
            showFallback("The Daylight service could not start: " + e.getMessage());
        }
        ShellComponents.publish(COMPONENT, this);
    }

    // ── KioskHost ─────────────────────────────────────────────────────────────

    @Override public Object activity() { return this; }

    @Override public boolean resumed() { return resumed; }

    /** The value stays through a payload swap; a new Activity starts at "no" again. Below API 27 it is always "no". */
    @Override
    public void showWhenLocked(final boolean on) {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 27) setShowWhenLocked(on);
        });
    }

    @Override
    public void attach(final KioskController next) {
        runOnUiThread(() -> {
            // A controller handed over by the payload ends any wait to retry an older one.
            if (next != failed) { failed = null; retryAttempts = 0; }
            main.removeCallbacks(retryAttach);
            attachNow(next);
        });
    }

    private void attachNow(final KioskController next) {
        // The same component can be reported twice; the attached controller stays as it is.
        if (slot.holds(next)) return;
        KioskController old = slot.replace(next);
        if (old != null) {
            try { old.onHostDetached(); } catch (Throwable t) { Log.w(TAG, "detach threw", t); }
        }
        if (next == null || isFinishing() || isDestroyed()) {
            slot.clear();
            showFallback("Daylight is restarting…");
            return;
        }
        guard("attach", () -> next.onHostAttached(this));
        if (slot.current() == next && visible) guard("visible", () -> next.onHostVisible(true));
        if (slot.current() == next && resumed) guard("resume", next::onHostResumed);
        if (slot.current() == next && hasWindowFocus()) guard("focus", () -> next.onHostWindowFocus(true));
        if (slot.current() == next) {
            main.removeCallbacks(markHealthy);
            main.postDelayed(markHealthy, HEALTHY_AFTER_MS);
        }
    }

    /**
     * Compare and clear, together, on the main thread. A payload that is stopping names
     * its own controller; if another controller has attached since, nothing happens.
     */
    @Override
    public void detach(final KioskController expected) {
        runOnUiThread(() -> {
            // A stopping payload's controller is not to be attached again either.
            if (failed == expected) { failed = null; main.removeCallbacks(retryAttach); }
            if (!slot.releaseIf(expected)) return;
            try { expected.onHostDetached(); } catch (Throwable t) { Log.w(TAG, "detach threw", t); }
            showFallback("Daylight is restarting…");
        });
    }

    // ── lifecycle, forwarded ──────────────────────────────────────────────────

    @Override protected void onStart() {
        super.onStart();
        visible = true;
        forward("visible", c -> c.onHostVisible(true));
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        forward("resume", KioskController::onHostResumed);
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        forward("permissions", c -> c.onHostPermissionsResult(code));
    }

    @Override protected void onPause() {
        resumed = false;
        forward("pause", KioskController::onHostPaused);
        super.onPause();
    }

    @Override protected void onStop() {
        visible = false;
        forward("hidden", c -> c.onHostVisible(false));
        super.onStop();
    }

    @Override protected void onDestroy() {
        // Only when this instance is still the published one: a newer Activity may have replaced it.
        if (ShellComponents.get(COMPONENT) == this) ShellComponents.publish(COMPONENT, null);
        main.removeCallbacks(retryAttach);
        main.removeCallbacks(markHealthy);
        failed = null;
        KioskController old = slot.clear();
        if (old != null) {
            try { old.onHostDetached(); } catch (Throwable t) { Log.w(TAG, "detach threw", t); }
        }
        super.onDestroy();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        forward("intent", c -> c.onHostNewIntent(intent));
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        forward("focus", c -> c.onHostWindowFocus(hasFocus));
    }

    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        KioskController c = slot.current();
        if (c != null) {
            try {
                if (c.onHostKey(event)) return true;
            } catch (Throwable t) {
                fail("key", t);
            }
        }
        return super.dispatchKeyEvent(event);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private interface Call { void on(KioskController c); }

    private void forward(String what, Call call) {
        KioskController c = slot.current();
        if (c != null) guard(what, () -> call.on(c));
    }

    private void guard(String what, Runnable r) {
        try { r.run(); } catch (Throwable t) { fail(what, t); }
    }

    /** A payload fault must not take the shell's Activity down with it. */
    private void fail(String what, Throwable t) {
        Log.e(TAG, "controller failed in " + what, t);
        KioskController broken = slot.clear();
        // Let the payload drop its views before the fallback replaces them.
        if (broken != null) {
            try { broken.onHostDetached(); } catch (Throwable ignored) { }
        }
        // The fallback is not where this ends. The same controller is attached again
        // after a wait that doubles up to a minute; a new controller from the payload, or
        // the payload stopping, cancels it.
        main.removeCallbacks(markHealthy);
        if (broken != null && !isFinishing() && !isDestroyed()) {
            failed = broken;
            retryAttempts++;
            long delay = KioskSlot.retryDelayMs(retryAttempts);
            main.removeCallbacks(retryAttach);
            main.postDelayed(retryAttach, delay);
            showFallback("The kiosk payload failed (" + what + "): " + t + "\nTrying again in " + (delay / 1000) + " s.");
        } else {
            showFallback("The kiosk payload failed (" + what + "): " + t);
        }
    }

    private void showFallback(String message) {
        TextView text = new TextView(this);
        text.setText(message);
        text.setTextColor(Color.rgb(140, 140, 140));
        text.setTextSize(18);
        text.setGravity(Gravity.CENTER);
        text.setBackgroundColor(Color.BLACK);
        setContentView(text);
    }
}
