package net.kckern.daylight.shellkit;

import java.util.ArrayList;
import java.util.List;

/**
 * The rows of the mini player's long-press sheet (R5), by state; destructive last. Pure.
 * "open" is Open Now playing, "play_on" opens Now playing with the target picker,
 * "stop_clear" stops this phone and clears its queue (with Undo), "stop_screen" stops the
 * screen Now playing is controlling (no Undo: the screen's own state cannot be put back).
 */
public final class MiniPlayerMenu {
    private MiniPlayerMenu() { }

    /** {@code canAct}: the entry has a transport (not a bare start). */
    public static List<String> rows(boolean canAct, String target) {
        List<String> out = new ArrayList<>();
        out.add("open");
        out.add("play_on");
        if (canAct) out.add("local".equals(target) ? "stop_clear" : "stop_screen");
        return out;
    }

    public static String label(String row, String targetName) {
        switch (row) {
            case "open": return "Open Now playing";
            case "play_on": return "Play on…";
            case "stop_clear": return "Stop and clear";
            default: return "Stop on " + (targetName == null || targetName.isEmpty() ? "a screen" : targetName);
        }
    }

    public static boolean undoable(String row) { return "stop_clear".equals(row); }
}
