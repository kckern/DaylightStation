package net.kckern.daylight.cap.onetap;

import net.kckern.daylight.cap.onetap.ActionCatalog.Action;

import java.util.List;
import java.util.Map;

/** The Android side of the surfaces, behind an interface so the plan and routes run in JVM tests. */
interface SurfaceSink {
    /** How many launcher shortcuts this device shows. */
    int maxShortcuts();

    /** Replace the dynamic shortcuts and write the tile cache. */
    void publish(List<Action> shortcuts, SurfacePlan.Linker linker, Map<String, String> tileCache);

    /** The ids of the shortcuts the launcher holds as pinned. */
    List<String> pinnedIds();

    /** Rewrite the pinned shortcuts in the plan with their current links, and disable the ones it says to. */
    void refreshPinned(SurfacePlan.Pins pins, SurfacePlan.Linker linker);

    /** Whether the launcher can pin shortcuts at all. */
    default boolean canPin() { return true; }

    /**
     * Ask the launcher to pin one action, under SurfacePlan.pinId. Throw
     * UnsupportedException when it cannot.
     *
     * @param confirmToken when not null, the launcher is to confirm the pin by sending
     *                     this token to the app's non-exported PinResultReceiver
     */
    void pin(Action action, String uri, String confirmToken);
}
