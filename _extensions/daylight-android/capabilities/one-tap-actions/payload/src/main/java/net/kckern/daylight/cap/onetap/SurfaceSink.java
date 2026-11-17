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

    /** Ask the launcher to pin one action. Throw UnsupportedException when it cannot. */
    void pin(Action action, String uri);
}
