package net.kckern.daylight.api;

/** Implemented by the payload. The shell's accessibility service forwards every event to it. */
public interface AccessibilityDelegate {
    /** An android.view.KeyEvent. Return true to consume it. */
    boolean onKeyEvent(Object keyEvent);

    /** An android.view.accessibility.AccessibilityEvent. */
    void onAccessibilityEvent(Object event);
}
