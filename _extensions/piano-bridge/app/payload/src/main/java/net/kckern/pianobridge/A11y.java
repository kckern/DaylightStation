package net.kckern.pianobridge;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.util.Log;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * A11y — the payload-side face of the shell's AccessibilityService.
 *
 * The shell OWNS the PianoTouchService instance (it is manifest-declared, so it must
 * live in the installed APK); the payload owns what to do with it. The shell forwards
 * bind/unbind through {@code Payload.onAccessibilityConnected/Disconnected}, which
 * land in {@link #bind} / {@link #unbind}. Every static here mirrors the signature
 * the old PianoTouchService exposed, so TouchPulser / KioskWatchdog / ControlServer
 * call it exactly as before.
 *
 * Why (docs/reference/piano/performance.md): the SM-T590 clamps the WebView's MAIN
 * thread to ~6fps after a stretch with no TOUCH input, and BLE-MIDI does not count as
 * touch. {@link #swipe} emits the OS-level input that un-throttles the frame clock;
 * {@link #powerDialog} + {@link #clickText} are the FKB-independent reboot rung.
 */
public final class A11y {

    private static final String TAG = "PianoBridge-Touch";
    private static volatile AccessibilityService svc;

    private A11y() { }

    /** Called by Main when the shell reports the a11y service bound. */
    public static void bind(AccessibilityService s) {
        svc = s;
        Log.i(TAG, "AccessibilityService bound to payload — synthetic touch available");
    }

    /** Called by Main when the shell reports the a11y service unbound (or on payload stop). */
    public static void unbind() {
        svc = null;
        Log.i(TAG, "AccessibilityService unbound from payload");
    }

    /** True once the system has bound the service (so gestures can dispatch). */
    public static boolean isConnected() { return svc != null; }

    /**
     * Dispatch a tiny vertical swipe from (x,y) down by {@code len} px over
     * {@code durationMs}. A swipe (not a tap) so it moves past touch-slop and can
     * never register as a click on whatever is under the corner. Static + null-safe
     * so the MIDI path can fire it without holding a reference.
     * @return true if a gesture was dispatched (service bound), false otherwise.
     */
    public static boolean swipe(int x, int y, int len, int durationMs) {
        AccessibilityService s = svc;
        if (s == null) return false;
        return doSwipe(s, x, y, len, durationMs);
    }

    private static boolean doSwipe(AccessibilityService s, int x, int y, int len, int durationMs) {
        try {
            Path p = new Path();
            p.moveTo(x, y);
            p.lineTo(x, y + Math.max(1, len));
            GestureDescription gesture = new GestureDescription.Builder()
                    .addStroke(new GestureDescription.StrokeDescription(p, 0, Math.max(1, durationMs)))
                    .build();
            // callback + handler null → completion runs on the main thread; we don't
            // need the result. dispatchGesture is safe to call off the main thread.
            return s.dispatchGesture(gesture, null, null);
        } catch (Exception e) {
            Log.w(TAG, "dispatchGesture failed: " + e.getMessage());
            return false;
        }
    }

    /**
     * The FKB-independent recovery lever. Every rung of the KioskWatchdog ladder
     * (loadStartUrl / restartApp / rebootDevice) is an HTTP call to FKB's own REST
     * server on :2323 — so when THAT server is what died, the whole ladder no-ops.
     * An AccessibilityService is bound by the SYSTEM, and performGlobalAction is
     * available to it without any other permission. GLOBAL_ACTION_POWER_DIALOG raises
     * the power menu; a synthetic tap on "Restart" then reboots the device with
     * nothing FKB-owned in the loop. Only ever used as the rung BELOW L4.
     * @return true if the power dialog was requested (service bound), else false.
     */
    public static boolean powerDialog() {
        AccessibilityService s = svc;
        if (s == null) return false;
        try {
            boolean ok = s.performGlobalAction(AccessibilityService.GLOBAL_ACTION_POWER_DIALOG);
            Log.i(TAG, "GLOBAL_ACTION_POWER_DIALOG -> " + ok);
            return ok;
        } catch (Exception e) {
            Log.w(TAG, "performGlobalAction failed: " + e.getMessage());
            return false;
        }
    }

    /**
     * Click a node on screen by its visible text (case-insensitive contains), via the
     * accessibility node tree. Used to press "Restart" on the power dialog raised by
     * {@link #powerDialog()}. Text-based rather than coordinate-based so it survives
     * the Samsung power-menu layout without hard-coding pixel positions.
     * @return true if a matching clickable node was found and ACTION_CLICK accepted.
     */
    public static boolean clickText(String needle) {
        AccessibilityService s = svc;
        if (s == null) return false;
        try {
            AccessibilityNodeInfo root = s.getRootInActiveWindow();
            if (root == null) { Log.w(TAG, "clickText: no active window root"); return false; }
            boolean hit = clickTextIn(root, needle.toLowerCase());
            Log.i(TAG, "clickText(\"" + needle + "\") -> " + hit);
            return hit;
        } catch (Exception e) {
            Log.w(TAG, "clickText failed: " + e.getMessage());
            return false;
        }
    }

    private static boolean clickTextIn(AccessibilityNodeInfo n, String needle) {
        if (n == null) return false;
        CharSequence t = n.getText(); CharSequence d = n.getContentDescription();
        String txt = ((t == null ? "" : t) + " " + (d == null ? "" : d)).toLowerCase();
        if (txt.contains(needle)) {
            // Click the node itself or the nearest clickable ancestor.
            AccessibilityNodeInfo c = n;
            for (int up = 0; c != null && up < 6; up++) {
                if (c.isClickable()) {
                    return c.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                }
                c = c.getParent();
            }
        }
        for (int i = 0; i < n.getChildCount(); i++) {
            if (clickTextIn(n.getChild(i), needle)) return true;
        }
        return false;
    }
}
