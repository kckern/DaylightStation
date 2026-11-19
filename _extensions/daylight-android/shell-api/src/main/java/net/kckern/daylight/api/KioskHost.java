package net.kckern.daylight.api;

/** Implemented by the shell's kiosk Activity. Published as the shell component "kiosk-activity". */
public interface KioskHost {
    String COMPONENT = "kiosk-activity";

    /** The android.app.Activity. */
    Object activity();

    /**
     * Hand the Activity to a controller, or pass null to detach. Safe from any thread;
     * the work happens on the main thread. With no controller the Activity shows its
     * own fallback screen.
     */
    void attach(KioskController controller);

    /**
     * Detach {@code expected} if it is still the attached controller, and do nothing
     * otherwise. Safe from any thread; the comparison and the detach happen together on
     * the main thread. A payload that is stopping calls this, never attach(null): its
     * stop() can land after the next payload's controller has attached.
     */
    void detach(KioskController expected);

    boolean resumed();

    /**
     * Whether the window shows over the device's lock screen. The Activity does not
     * until a controller says so; the controller says what the device file decided
     * (webview.showWhenLocked). Safe from any thread.
     */
    void showWhenLocked(boolean on);
}
