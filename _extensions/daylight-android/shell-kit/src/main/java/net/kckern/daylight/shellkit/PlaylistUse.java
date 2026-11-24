package net.kckern.daylight.shellkit;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Where a remembered playlist is used, read from the preferences map. A playlist is in use
 * when it is shown on Drive, is a day's Driving Radio playlist, or is a widget button's.
 * Pure over a snapshot so it can be tested without Android.
 */
public final class PlaylistUse {
    private PlaylistUse() {}

    public static final String DRIVE_STAPLE = "drive_staple.";
    public static final String RADIO_DAY = "driving_radio.";
    private static final String WIDGET_ACTION = "button.";

    public static boolean onDrive(Map<String, ?> all, String id) {
        return Boolean.TRUE.equals(all.get(DRIVE_STAPLE + id));
    }

    /** The day keys (0 is the default) whose rule is this playlist. */
    public static List<Integer> radioDays(Map<String, ?> all, String id) {
        List<Integer> days = new ArrayList<>();
        for (Map.Entry<String, ?> entry : all.entrySet()) {
            String key = entry.getKey();
            if (!key.startsWith(RADIO_DAY) || !id.equals(entry.getValue())) continue;
            try { days.add(Integer.parseInt(key.substring(RADIO_DAY.length()))); }
            catch (NumberFormatException ignored) { /* not a day key */ }
        }
        java.util.Collections.sort(days);
        return days;
    }

    public static int widgets(Map<String, ?> all, String id) {
        int count = 0;
        for (Map.Entry<String, ?> entry : all.entrySet()) {
            String key = entry.getKey();
            if (key.startsWith(WIDGET_ACTION) && key.endsWith(".action") && key.indexOf('.', WIDGET_ACTION.length()) == key.length() - ".action".length()
                    && ("c:" + id).equals(entry.getValue())) count++;
        }
        return count;
    }

    public static boolean inUse(Map<String, ?> all, String id) {
        return onDrive(all, id) || !radioDays(all, id).isEmpty() || widgets(all, id) > 0;
    }

    /** "Drive · Monday · 2 widgets", or "" when nothing uses it. */
    public static String describe(Map<String, ?> all, String id, String[] weekdays) {
        List<String> parts = new ArrayList<>();
        if (onDrive(all, id)) parts.add("Drive");
        for (int day : radioDays(all, id)) {
            parts.add(day == 0 ? "Radio default" : weekdays != null && day < weekdays.length ? weekdays[day] : "Radio");
        }
        int widgets = widgets(all, id);
        if (widgets > 0) parts.add(widgets == 1 ? "1 widget" : widgets + " widgets");
        return String.join(" · ", parts);
    }
}
