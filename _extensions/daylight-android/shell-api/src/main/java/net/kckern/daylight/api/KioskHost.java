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

    boolean resumed();
}
