package net.kckern.daylight.cap.caractions.shell;

import java.util.HashMap;
import java.util.Map;

/**
 * Which car actions are running. A tap on an action that is already running is
 * ignored until its answer arrives or its deadline passes, so a second tap from a
 * driver who saw nothing happen does not toggle a door or a light back. Pure; the
 * screen touches it on the main thread only.
 */
final class RunGuard {
    /** The car prefix of the row's second line while its action runs. */
    static final String SENDING = "Sending";

    private final long deadlineMs;
    private final Map<String, Long> started = new HashMap<>();

    RunGuard(long deadlineMs) { this.deadlineMs = deadlineMs; }

    /** True when the action may start now; it is then marked running from {@code nowMs}. */
    boolean tryStart(String id, long nowMs) {
        if (id == null || id.isEmpty()) return false;
        if (running(id, nowMs)) return false;
        started.put(id, nowMs);
        return true;
    }

    /** True while the action's answer has not come back and its deadline has not passed. */
    boolean running(String id, long nowMs) {
        Long at = started.get(id);
        if (at == null) return false;
        if (nowMs - at >= deadlineMs) {
            started.remove(id);
            return false;
        }
        return true;
    }

    /** The answer came back (or the run failed): the action may be tapped again. */
    void finish(String id) { started.remove(id); }

    /** The toast shown the moment an action is tapped. */
    static String sending(String label) { return SENDING + " " + label + "…"; }
}
