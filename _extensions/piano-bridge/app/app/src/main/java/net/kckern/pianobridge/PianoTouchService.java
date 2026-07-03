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
