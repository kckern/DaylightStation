package net.kckern.daylight.api;

/**
 * The last-known labels and links of the quick-settings tiles and the widget. The
 * payload writes them into one private preferences file through the shell's Context;
 * the installed tile services and the widget provider only read it, so they draw
 * without a payload. Both sides take the file name and the keys from here.
 *
 *   tile.<1..4>.label | tile.<1..4>.icon | tile.<1..4>.uri
 *   widget.<1..4>.label | widget.<1..4>.icon | widget.<1..4>.uri
 *
 * An empty uri means the slot is unassigned. Each slot and each action also has a
 * `direct` field (see DIRECT).
 *
 * Every action is also written under its own id, for the one-action button widgets:
 * a widget remembers an action id, and its chooser lists the ids in order.
 *
 *   action.ids                                    the action ids, comma-separated, in order
 *   action.<id>.label | action.<id>.icon | action.<id>.uri
 *
 * An action that no longer exists has its three fields emptied.
 */
public final class SurfaceKeys {
    public static final String PREFS = "daylight_surfaces";
    public static final int TILE_SLOTS = 4;
    public static final int WIDGET_SLOTS = 4;
    public static final String LABEL = "label";
    public static final String ICON = "icon";
    public static final String URI = "uri";
    /**
     * The action id again when the action plays household media and may be started
     * with no window (DirectPlay); empty otherwise. Written beside label, icon and uri
     * for a tile slot, a widget slot and every action.
     */
    public static final String DIRECT = "direct";
    private static final String LINK_PREFIX = "daylight://";

    private SurfaceKeys() { }

    public static String tile(int slot, String field) { return key("tile", slot, TILE_SLOTS, field); }

    public static String widget(int slot, String field) { return key("widget", slot, WIDGET_SLOTS, field); }

    /** The ids of every action, comma-separated, in the order a chooser lists them. */
    public static final String ACTION_IDS = "action.ids";

    /** Whether this is the shape every action id has: a lower-case letter, then letters, digits and hyphens, 32 at most. */
    public static boolean actionId(String id) {
        if (id == null || id.isEmpty() || id.length() > 32) return false;
        for (int i = 0; i < id.length(); i++) {
            char c = id.charAt(i);
            boolean letter = c >= 'a' && c <= 'z';
            if (i == 0 ? !letter : !(letter || (c >= '0' && c <= '9') || c == '-')) return false;
        }
        return true;
    }

    /** The key of one field of one action. Anything that is not an action id makes no key. */
    public static String action(String id, String field) {
        if (!actionId(id)) throw new IllegalArgumentException("not an action id");
        return "action." + id + "." + field;
    }

    private static String key(String surface, int slot, int slots, String field) {
        if (slot < 1 || slot > slots) throw new IllegalArgumentException(surface + " slot " + slot + " is outside 1-" + slots);
        return surface + "." + slot + "." + field;
    }

    /**
     * Whether a cached uri may be launched by a tile or the widget: only the app's own
     * link scheme, exactly as the payload writes it. Anything else in the cache is
     * treated as an unassigned slot.
     */
    public static boolean launchable(String uri) {
        return uri != null && uri.startsWith(LINK_PREFIX) && uri.length() > LINK_PREFIX.length();
    }
}
