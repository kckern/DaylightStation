package net.kckern.audiobridge;

import android.content.Context;
import android.graphics.PixelFormat;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;

/**
 * A 1x1 transparent, untouchable overlay window.
 *
 * Android 11 decides whether a foreground service may use the microphone when
 * the start is requested: a caller with nothing visible is a background start
 * and gets no mic. Showing this window in the caller's process first (boot
 * receiver or launcher activity) makes the start count as foreground. Needs
 * SYSTEM_ALERT_WINDOW, granted over adb: appops set <pkg> SYSTEM_ALERT_WINDOW allow
 */
final class OverlayAnchor {
    private static final String TAG = "AudioBridge";
    /** Time for the window manager to register the window before we start the service. */
    static final long SETTLE_MS = 400;

    private static View view;

    private OverlayAnchor() {}

    static synchronized boolean ensure(Context context) {
        if (view != null) return true;
        Context app = context.getApplicationContext();
        try {
            if (!Settings.canDrawOverlays(app)) {
                Log.w(TAG, "overlay.denied — SYSTEM_ALERT_WINDOW not granted");
                return false;
            }
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    1, 1,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                    PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.START;
            View v = new View(app);
            app.getSystemService(WindowManager.class).addView(v, lp);
            view = v;
            Log.i(TAG, "overlay.added");
            return true;
        } catch (RuntimeException e) {
            Log.w(TAG, "overlay.failed", e);
            return false;
        }
    }

    static synchronized void remove(Context context) {
        if (view == null) return;
        try { context.getApplicationContext().getSystemService(WindowManager.class).removeView(view); }
        catch (RuntimeException e) { Log.w(TAG, "overlay.remove-failed", e); }
        view = null;
    }
}
