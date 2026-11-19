package net.kckern.daylight.api;

/**
 * Implemented by the payload (webview-host). The shell's kiosk Activity forwards its
 * lifecycle here. Every method is called on the main thread. If one throws, the Activity
 * detaches the controller and shows its fallback screen.
 */
public interface KioskController {
    /** Build the content view and call setContentView on host.activity(). */
    void onHostAttached(KioskHost host);

    /** The Activity is going away or another controller is taking over. Must not throw. */
    void onHostDetached();

    /** onStart / onStop. */
    void onHostVisible(boolean visible);

    void onHostResumed();

    void onHostPaused();

    default void onHostPermissionsResult(int requestCode) { }

    void onHostWindowFocus(boolean focused);

    /** An android.view.KeyEvent. Return true to consume it. */
    boolean onHostKey(Object keyEvent);

    /** An android.content.Intent delivered to the running Activity. */
    void onHostNewIntent(Object intent);
}
