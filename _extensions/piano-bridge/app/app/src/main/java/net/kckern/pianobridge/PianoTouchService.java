package net.kckern.pianobridge;

import android.accessibilityservice.AccessibilityService;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;

/**
 * PianoTouchService — the SHELL's AccessibilityService. A forwarder, nothing more.
 *
 * An AccessibilityService must be manifest-declared, so the INSTANCE lives in the
 * installed APK. But everything it is used FOR — the synthetic touch that fights the
 * SM-T590's input-recency throttle, the L5 power-dialog restart — is policy, and
 * policy belongs in the hot-swappable payload. So this class holds the OS handle and
 * hands it to the payload on bind/unbind; the payload calls dispatchGesture /
 * performGlobalAction / getRootInActiveWindow on it directly.
 *
 * canPerformGestures + canRetrieveWindowContent are declared in
 * res/xml/piano_touch_service.xml — those are frozen with the shell.
 */
public class PianoTouchService extends AccessibilityService {

    private static final String TAG = "PianoBridge-Touch";
    private static volatile PianoTouchService INSTANCE;

    /** The bound instance, or null. Handed to the payload through ShellServices. */
    public static AccessibilityService current() { return INSTANCE; }

    @Override
    public void onServiceConnected() {
        INSTANCE = this;
        Log.i(TAG, "AccessibilityService connected — forwarding to payload");
        ShellLog.note("A11Y", "connected");
        PayloadLoader l = PianoBridgeService.loader();
        if (l != null) l.onAccessibilityConnected(this);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) { /* emitter only */ }
    @Override public void onInterrupt() { }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        INSTANCE = null;
        ShellLog.note("A11Y", "unbound");
        PayloadLoader l = PianoBridgeService.loader();
        if (l != null) l.onAccessibilityDisconnected();
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        INSTANCE = null;
        super.onDestroy();
    }
}
