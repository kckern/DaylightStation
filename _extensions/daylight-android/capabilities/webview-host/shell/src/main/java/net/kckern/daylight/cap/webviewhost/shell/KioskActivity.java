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

    private KioskController controller;
    private boolean visible;
    private volatile boolean resumed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // A device with a swipe keyguard still shows the kiosk after a wake.
        if (Build.VERSION.SDK_INT >= 27) setShowWhenLocked(true);
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

    @Override
    public void attach(final KioskController next) {
        runOnUiThread(() -> {
            KioskController old = controller;
            controller = null;
            if (old != null) {
                try { old.onHostDetached(); } catch (Throwable t) { Log.w(TAG, "detach threw", t); }
            }
            if (next == null || isFinishing() || isDestroyed()) {
                showFallback("Daylight is restarting…");
                return;
            }
            controller = next;
            guard("attach", () -> next.onHostAttached(this));
            if (controller == next && visible) guard("visible", () -> next.onHostVisible(true));
            if (controller == next && resumed) guard("resume", next::onHostResumed);
            if (controller == next && hasWindowFocus()) guard("focus", () -> next.onHostWindowFocus(true));
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
        KioskController old = controller;
        controller = null;
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
        KioskController c = controller;
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
        KioskController c = controller;
        if (c != null) guard(what, () -> call.on(c));
    }

    private void guard(String what, Runnable r) {
        try { r.run(); } catch (Throwable t) { fail(what, t); }
    }

    /** A payload fault must not take the shell's Activity down with it. */
    private void fail(String what, Throwable t) {
        Log.e(TAG, "controller failed in " + what, t);
        KioskController broken = controller;
        controller = null;
        // Let the payload drop its views before the fallback replaces them.
        if (broken != null) {
            try { broken.onHostDetached(); } catch (Throwable ignored) { }
        }
        showFallback("The kiosk payload failed (" + what + "): " + t);
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
