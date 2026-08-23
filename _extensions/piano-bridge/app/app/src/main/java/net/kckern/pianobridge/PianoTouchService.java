package net.kckern.pianobridge;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;

/**
 * PianoTouchService — an AccessibilityService whose only job is to dispatch a
 * tiny synthetic gesture on demand.
 *
 * Why (docs/reference/piano/performance.md): the SM-T590 clamps the WebView's
 * MAIN thread to ~6fps after a stretch with no TOUCH input, and BLE-MIDI does not
 * count as touch — so the piano UI starves while being played. A real touch lifts
 * the throttle; an app can synthesize touch only via AccessibilityService
 * `dispatchGesture`. TouchPulser calls {@link #swipe} on each note (cadence-
 * limited) so *playing* keeps generating the OS-level input that un-throttles the
 * frame clock. This service reads nothing (onAccessibilityEvent is a no-op); it is
 * a gesture emitter, self-enabled over the LAN via WRITE_SECURE_SETTINGS.
 *
 * OPEN QUESTION (verify on-device via the fps telemetry): whether an accessibility-
 * INJECTED gesture is treated the same as a hardware touch by the input-recency
 * throttle. If not, this won't help — hence the pbctl `tapWakeEnabled` toggle to
 * A/B it against `perf.diagnostics` without a rebuild.
 */
public class PianoTouchService extends AccessibilityService {

    private static final String TAG = "PianoBridge-Touch";
    private static volatile PianoTouchService INSTANCE;

    /** True once the system has bound the service (so gestures can dispatch). */
    public static boolean isConnected() { return INSTANCE != null; }

    /**
     * Dispatch a tiny vertical swipe from (x,y) down by {@code len} px over
     * {@code durationMs}. A swipe (not a tap) so it moves past touch-slop and can
     * never register as a click on whatever is under the corner. Static + null-safe
     * so the MIDI path can fire it without holding a reference.
     * @return true if a gesture was dispatched (service bound), false otherwise.
     */
    public static boolean swipe(int x, int y, int len, int durationMs) {
        PianoTouchService s = INSTANCE;
        if (s == null) return false;
        return s.doSwipe(x, y, len, durationMs);
    }

    private boolean doSwipe(int x, int y, int len, int durationMs) {
        try {
            Path p = new Path();
            p.moveTo(x, y);
            p.lineTo(x, y + Math.max(1, len));
            GestureDescription gesture = new GestureDescription.Builder()
                    .addStroke(new GestureDescription.StrokeDescription(p, 0, Math.max(1, durationMs)))
                    .build();
            // callback + handler null → completion runs on the main thread; we don't
            // need the result. dispatchGesture is safe to call off the main thread.
            return dispatchGesture(gesture, null, null);
        } catch (Exception e) {
            Log.w(TAG, "dispatchGesture failed: " + e.getMessage());
            return false;
        }
    }

    /**
     * The FKB-independent recovery lever. Every rung of the KioskWatchdog ladder
     * (loadStartUrl / restartApp / rebootDevice) is an HTTP call to FKB's own REST
     * server on :2323 — so when THAT server is what died (FKB alive and painting,
     * :2323 refusing), the whole ladder no-ops and ends "NEEDS HUMAN". On 2026-08-22
     * that cost a physical trip to the tablet twice in one evening, and 23 probes
     * from the untrusted_app sandbox confirmed force-stop / kill / crash / reboot /
     * wifi-bounce are all permission-denied.
     *
     * An AccessibilityService is different: it is bound by the SYSTEM, and
     * performGlobalAction is available to it without any of those permissions.
     * GLOBAL_ACTION_POWER_DIALOG raises the power menu; a synthetic tap on
     * "Restart" then reboots the device with nothing FKB-owned in the loop.
     *
     * Only ever used as the rung BELOW L4, after the FKB route has already failed
     * to reach :2323 — it is not a first resort.
     * @return true if the power dialog was requested (service bound), else false.
     */
    public static boolean powerDialog() {
        PianoTouchService s = INSTANCE;
        if (s == null) return false;
        try {
            boolean ok = s.performGlobalAction(GLOBAL_ACTION_POWER_DIALOG);
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
        PianoTouchService s = INSTANCE;
        if (s == null) return false;
        try {
            android.view.accessibility.AccessibilityNodeInfo root = s.getRootInActiveWindow();
            if (root == null) { Log.w(TAG, "clickText: no active window root"); return false; }
            boolean hit = clickTextIn(root, needle.toLowerCase());
            Log.i(TAG, "clickText(\"" + needle + "\") -> " + hit);
            return hit;
        } catch (Exception e) {
            Log.w(TAG, "clickText failed: " + e.getMessage());
            return false;
        }
    }

    private static boolean clickTextIn(android.view.accessibility.AccessibilityNodeInfo n, String needle) {
        if (n == null) return false;
        CharSequence t = n.getText(); CharSequence d = n.getContentDescription();
        String txt = ((t == null ? "" : t) + " " + (d == null ? "" : d)).toLowerCase();
        if (txt.contains(needle)) {
            // Click the node itself or the nearest clickable ancestor.
            android.view.accessibility.AccessibilityNodeInfo c = n;
            for (int up = 0; c != null && up < 6; up++) {
                if (c.isClickable()) {
                    return c.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);
                }
                c = c.getParent();
            }
        }
        for (int i = 0; i < n.getChildCount(); i++) {
            if (clickTextIn(n.getChild(i), needle)) return true;
        }
        return false;
    }

    @Override
    public void onServiceConnected() {
        INSTANCE = this;
        Log.i(TAG, "AccessibilityService connected — synthetic touch available");
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) { /* emitter only */ }

    @Override public void onInterrupt() { }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        INSTANCE = null;
        Log.i(TAG, "AccessibilityService unbound");
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        INSTANCE = null;
        super.onDestroy();
    }
}
