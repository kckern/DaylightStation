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

    /** Ask the launcher to pin one action, under SurfacePlan.pinId. Throw UnsupportedException when it cannot. */
    void pin(Action action, String uri);
}
